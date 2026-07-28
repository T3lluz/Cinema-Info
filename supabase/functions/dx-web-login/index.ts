import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * DX bridge for Cinema Info.
 *
 * Check-in state lives in one place: app.dx.no's purchase list, where
 * every ticket carries `used` / `usedDateTime` once it has been scanned
 * at the door. app.dx.no sends no CORS headers at all, so a browser
 * cannot read it — this function holds the session and returns counts.
 *
 * Sessions are short (the app.dx.no cookie lasts about a day) but the
 * Auth0 SSO cookie behind it lasts about three, and replaying the
 * authorize step with it mints a fresh session without a password. When
 * that happens the refreshed token is handed back so the caller can
 * store it.
 */

const AUTH0 = "https://login.dx.no";
const APP = "https://app.dx.no";
const CLIENT_ID = "3y0iSEXBv8kI91Y5a2UiwEjfh2miWClo";
const REALM = "Username-Password-Authentication";
const PARTNER_ID = "202";
const AUTH0_CLIENT = "eyJuYW1lIjoiYXV0aDAuanMiLCJ2ZXJzaW9uIjoiOS4yMy4xIn0=";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/** Cookies worth carrying between calls: the session plus its SSO root. */
const KEEP_COOKIES = [
  "dxweb_session",
  "XSRF-TOKEN",
  "DXWEB_AFFINITY",
  "auth0",
  "did",
];

/** Events fetched at once; each purchase list is a sizeable payload. */
const CONCURRENCY = 4;
const MAX_EVENTS = 24;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Jar = Map<string, string>;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function absorbSetCookie(res: Response, jar: Jar) {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const list =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (() => {
          const single = res.headers.get("set-cookie");
          return single ? [single] : [];
        })();
  for (const raw of list) {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) jar.set(name, value);
  }
}

function cookieHeader(jar: Jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function fetchManual(
  url: string,
  init: RequestInit & { jar?: Jar } = {},
) {
  const jar = init.jar;
  const headers = new Headers(init.headers || {});
  if (jar) {
    const cookie = cookieHeader(jar);
    if (cookie) headers.set("Cookie", cookie);
  }
  if (!headers.has("User-Agent")) headers.set("User-Agent", UA);
  const res = await fetch(url, { ...init, headers, redirect: "manual" });
  if (jar) absorbSetCookie(res, jar);
  return res;
}

function dxError(message: string, code: string) {
  const err = new Error(message) as Error & { code?: string };
  err.code = code;
  return err;
}

function packToken(jar: Jar) {
  const out: Record<string, string> = {};
  for (const name of KEEP_COOKIES) {
    const value = jar.get(name);
    if (value) out[name] = value;
  }
  return JSON.stringify(out);
}

function unpackToken(token: string): Jar | null {
  try {
    const parsed = JSON.parse(token) as Record<string, string>;
    if (!parsed || typeof parsed !== "object") return null;
    const jar: Jar = new Map();
    for (const name of KEEP_COOKIES) {
      if (parsed[name]) jar.set(name, parsed[name]);
    }
    // Only the SSO cookie is strictly required — a session can be reminted.
    return jar.has("dxweb_session") || jar.has("auth0") ? jar : null;
  } catch {
    return null;
  }
}

/**
 * Walk the app.dx.no login: it starts an Auth0 authorize, Auth0 turns
 * email + password into a login ticket, and the callback exchanges the
 * resulting code for a session cookie. `credentials` may be omitted to
 * renew silently off the SSO cookie already in the jar.
 */
async function authorize(
  jar: Jar,
  credentials?: { email: string; password: string },
) {
  const start = await fetchManual(`${APP}/apiweb/login`, {
    method: "GET",
    jar,
    headers: { Accept: "text/html,application/xhtml+xml" },
  });
  const authUrl = start.headers.get("location") || "";
  if (!authUrl.includes("login.dx.no/authorize")) {
    throw dxError("DX Web login start failed", "auth0");
  }

  let target = authUrl;
  if (credentials) {
    const coRes = await fetchManual(`${AUTH0}/co/authenticate`, {
      method: "POST",
      jar,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: APP,
        Referer: `${APP}/`,
        "Auth0-Client": AUTH0_CLIENT,
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        credential_type: "http://auth0.com/oauth/grant-type/password-realm",
        username: credentials.email,
        password: credentials.password,
        realm: REALM,
      }),
    });
    const coText = await coRes.text();
    let co: Record<string, unknown> = {};
    try {
      co = coText ? JSON.parse(coText) : {};
    } catch {
      co = {};
    }
    if (!coRes.ok) {
      const desc = String(co.error_description || co.description || "");
      throw dxError(
        desc || "Wrong email or password.",
        /wrong email or password|invalid/i.test(desc) ? "login" : "auth0",
      );
    }
    const ticket = co.login_ticket || co.loginTicket;
    if (!ticket) throw dxError("Auth0 login ticket missing", "auth0");

    const u = new URL(authUrl);
    u.searchParams.set("login_ticket", String(ticket));
    u.searchParams.set("realm", REALM);
    target = u.toString();
  }

  const authRes = await fetchManual(target, {
    method: "GET",
    jar,
    headers: { Accept: "text/html", Referer: `${APP}/` },
  });
  const callback = authRes.headers.get("location") || "";
  if (!callback.includes("/apiweb/callback") || !callback.includes("code=")) {
    throw dxError("Auth0 authorization code missing", "auth0");
  }

  const cbRes = await fetchManual(callback, {
    method: "GET",
    jar,
    headers: { Accept: "text/html,application/xhtml+xml", Referer: `${AUTH0}/` },
  });
  if (cbRes.status >= 400) throw dxError("DX Web callback failed", "auth0");
  if (!jar.get("dxweb_session")) {
    throw dxError("DX Web session cookie missing", "auth0");
  }
}

async function login(email: string, password: string) {
  const jar: Jar = new Map();
  await authorize(jar, { email, password });

  const meRes = await fetch(`${APP}/api/v1/auth/`, {
    headers: {
      Accept: "application/json",
      "User-Agent": UA,
      Referer: `${APP}/`,
      Cookie: cookieHeader(jar),
    },
  });
  const me = meRes.ok
    ? ((await meRes.json()) as Record<string, unknown>)
    : {};
  if (!me.authenticated) throw dxError("DX Web session not authenticated", "auth0");

  const auth = (me.auth || {}) as Record<string, unknown>;
  const partners = (me.partners || []) as Array<Record<string, unknown>>;

  return {
    type: "dxweb" as const,
    token: packToken(jar),
    email: String(auth.email || email),
    partnerId: String(partners[0]?.partnerID || PARTNER_ID),
    source: "app.dx.no",
  };
}

/** GET as the signed-in user, returning 401 verbatim so callers can renew. */
async function apiGet(jar: Jar, path: string) {
  const res = await fetch(APP + path, {
    headers: {
      Accept: "application/json",
      "User-Agent": UA,
      Referer: `${APP}/`,
      Cookie: cookieHeader(jar),
    },
  });
  return res;
}

type Count = { scanned: number; sold: number };

/**
 * Tally one event from its purchase list. Annulled tickets are refunds —
 * they are gone from the sold figure DX reports, so they must not count
 * on either side of "is everyone in?".
 */
function countUsedTickets(payload: unknown): Count | null {
  const data = (payload as { data?: { purchases?: unknown } })?.data;
  const purchases = data?.purchases;
  if (!Array.isArray(purchases)) return null;

  let scanned = 0;
  let sold = 0;
  for (const purchase of purchases) {
    const items = (purchase as { purchaseItems?: unknown[] })?.purchaseItems;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const tickets = (item as { tickets?: unknown[] })?.tickets;
      if (!Array.isArray(tickets)) continue;
      for (const raw of tickets) {
        const ticket = raw as Record<string, unknown>;
        if (ticket.annulled) continue;
        const n = Number(ticket.count) || 1;
        sold += n;
        if (ticket.used) scanned += n;
      }
    }
  }
  return { scanned, sold };
}

async function fetchScanned(body: {
  token?: string;
  partnerId?: string;
  eventIds?: unknown;
  debug?: boolean;
}) {
  if (!body.token) return json({ error: "token required" }, 400);
  const partnerId = String(body.partnerId || PARTNER_ID);
  const eventIds = (Array.isArray(body.eventIds) ? body.eventIds : [])
    .map((id) => String(id))
    .filter((id) => /^\d+$/.test(id))
    .slice(0, MAX_EVENTS);
  if (!eventIds.length) return json({ error: "eventIds required" }, 400);

  const jar = unpackToken(body.token);
  if (!jar) return json({ error: "Unreadable token", code: "auth" }, 401);

  const log: string[] = [];
  let renewed = false;

  const load = async (eventId: string): Promise<Count | null> => {
    const path = `/api/v1/partners/${partnerId}/purchases?eventId=${eventId}`;
    let res = await apiGet(jar, path);

    if (res.status === 401 || res.status === 403) {
      // Session aged out — mint a new one off the SSO cookie and retry.
      if (!renewed) {
        renewed = true;
        try {
          await authorize(jar);
          log.push("session renewed from SSO cookie");
        } catch (e) {
          log.push(`renew failed: ${(e as Error).message}`);
          throw dxError("DX session expired", "auth");
        }
      }
      res = await apiGet(jar, path);
      if (res.status === 401 || res.status === 403) {
        throw dxError("DX session expired", "auth");
      }
    }

    if (!res.ok) {
      log.push(`${eventId} → HTTP ${res.status}`);
      return null;
    }
    const count = countUsedTickets(await res.json());
    log.push(
      count
        ? `${eventId} → ${count.scanned}/${count.sold} used`
        : `${eventId} → no purchase list in response`,
    );
    return count;
  };

  const counts: Record<string, Count> = {};
  try {
    for (let i = 0; i < eventIds.length; i += CONCURRENCY) {
      const slice = eventIds.slice(i, i + CONCURRENCY);
      const results = await Promise.all(slice.map(load));
      slice.forEach((id, n) => {
        const count = results[n];
        if (count) counts[id] = count;
      });
    }
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "auth") {
      return json({ error: err.message, code: "auth", log }, 401);
    }
    return json({ error: err.message, log }, 502);
  }

  return json({
    counts,
    source: "app.dx.no/purchases",
    ...(renewed ? { token: packToken(jar) } : {}),
    ...(body.debug ? { log } : {}),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (body.action === "scanned") {
    return await fetchScanned({
      token: body.token ? String(body.token) : undefined,
      partnerId: body.partnerId ? String(body.partnerId) : undefined,
      eventIds: body.eventIds,
      debug: Boolean(body.debug),
    });
  }

  const email = String(body.email || "").trim();
  const password = String(body.password || "");
  if (!email || !password) {
    return json({ error: "Email and password required", code: "login" }, 400);
  }

  try {
    return json(await login(email, password));
  } catch (e) {
    const err = e as Error & { code?: string };
    const code = err.code || "login";
    return json(
      { error: err.message || "Login failed", code },
      code === "login" ? 403 : 502,
    );
  }
});
