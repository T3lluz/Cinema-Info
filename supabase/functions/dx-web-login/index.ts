import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const DX_API = "https://api.dx.no/v3";
const AUTH0 = "https://login.dx.no";
const APP = "https://app.dx.no";
const CLIENT_ID = "3y0iSEXBv8kI91Y5a2UiwEjfh2miWClo";
const REALM = "Username-Password-Authentication";
const PARTNER_ID = "202";
const AUTH0_CLIENT =
  "eyJuYW1lIjoiYXV0aDAuanMiLCJ2ZXJzaW9uIjoiOS4yMy4xIn0=";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function absorbSetCookie(res: Response, jar: Map<string, string>) {
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

function cookieHeader(jar: Map<string, string>, names?: string[]) {
  const entries = [...jar.entries()].filter(([k]) =>
    names ? names.includes(k) : true
  );
  return entries.map(([k, v]) => `${k}=${v}`).join("; ");
}

async function fetchManual(
  url: string,
  init: RequestInit & { jar?: Map<string, string> } = {},
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

/** Legacy api.dx.no email/password — returns profile + session cookie (no authToken). */
async function loginLegacy(email: string, password: string) {
  const jar = new Map<string, string>();
  const res = await fetchManual(`${DX_API}/auth/login`, {
    method: "POST",
    jar,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: APP,
      Referer: `${APP}/`,
    },
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok) return null;

  const session = jar.get("dx_api_session");
  const nested = (data.data || {}) as Record<string, unknown>;
  const user = (data.user || {}) as Record<string, unknown>;
  const token =
    data.authToken ||
    data.token ||
    data.access_token ||
    data.accessToken ||
    nested.authToken ||
    nested.token ||
    session;
  if (!token) return null;

  const roles = (data.partnerRoles || []) as Array<Record<string, unknown>>;
  const partner = (roles[0]?.partner || {}) as Record<string, unknown>;

  return {
    type: session && token === session ? ("session" as const) : ("session" as const),
    token: String(token),
    email: String(data.email || user.email || email),
    partnerId: String(
      data.partnerId || data.partner_id || partner.id || PARTNER_ID,
    ),
    source: "api.dx.no",
  };
}

/**
 * Official DX Web login: app.dx.no starts PKCE, Auth0 co/authenticate +
 * authorize with login_ticket, then apiweb/callback exchanges the code
 * server-side. Direct Auth0 /oauth/token is rejected for this client.
 */
async function loginDxWeb(email: string, password: string) {
  const jar = new Map<string, string>();

  const start = await fetchManual(`${APP}/apiweb/login`, {
    method: "GET",
    jar,
    headers: { Accept: "text/html,application/xhtml+xml" },
  });
  const authUrl = start.headers.get("location") || "";
  if (!authUrl.includes("login.dx.no/authorize")) {
    const err = new Error("DX Web login start failed");
    (err as { code?: string }).code = "auth0";
    throw err;
  }

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
      credential_type:
        "http://auth0.com/oauth/grant-type/password-realm",
      username: email,
      password,
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
    const err = new Error(desc || "Wrong email or password.");
    (err as { code?: string }).code = /wrong email or password/i.test(desc)
      ? "login"
      : "auth0";
    throw err;
  }
  const loginTicket = co.login_ticket || co.loginTicket;
  if (!loginTicket) {
    const err = new Error("Auth0 login ticket missing");
    (err as { code?: string }).code = "auth0";
    throw err;
  }

  const u = new URL(authUrl);
  u.searchParams.set("login_ticket", String(loginTicket));
  u.searchParams.set("realm", REALM);

  const authRes = await fetchManual(u.toString(), {
    method: "GET",
    jar,
    headers: { Accept: "text/html", Referer: `${APP}/` },
  });
  const callback = authRes.headers.get("location") || "";
  if (!callback.includes("/apiweb/callback") || !callback.includes("code=")) {
    const err = new Error("Auth0 authorization code missing");
    (err as { code?: string }).code = "auth0";
    throw err;
  }

  const cbRes = await fetchManual(callback, {
    method: "GET",
    jar,
    headers: {
      Accept: "text/html,application/xhtml+xml",
      Referer: `${AUTH0}/`,
    },
  });
  // Expect 302 to https://app.dx.no
  if (cbRes.status >= 400 && cbRes.status !== 302) {
    const err = new Error("DX Web callback failed");
    (err as { code?: string }).code = "auth0";
    throw err;
  }

  const session = jar.get("dxweb_session");
  const xsrf = jar.get("XSRF-TOKEN");
  const affinity = jar.get("DXWEB_AFFINITY");
  if (!session) {
    const err = new Error("DX Web session cookie missing");
    (err as { code?: string }).code = "auth0";
    throw err;
  }

  const cookie = cookieHeader(jar, [
    "dxweb_session",
    "XSRF-TOKEN",
    "DXWEB_AFFINITY",
  ]);
  const meRes = await fetch(`${APP}/api/v1/auth/`, {
    headers: {
      Accept: "application/json",
      "User-Agent": UA,
      Referer: `${APP}/`,
      Cookie: cookie,
      ...(xsrf
        ? { "X-XSRF-TOKEN": decodeURIComponent(xsrf) }
        : {}),
    },
  });
  const meText = await meRes.text();
  let me: Record<string, unknown> = {};
  try {
    me = meText ? JSON.parse(meText) : {};
  } catch {
    me = {};
  }
  if (!meRes.ok || !me.authenticated) {
    const err = new Error("DX Web session not authenticated");
    (err as { code?: string }).code = "auth0";
    throw err;
  }

  const auth = (me.auth || {}) as Record<string, unknown>;
  const partners = (me.partners || []) as Array<Record<string, unknown>>;
  const partnerId = partners[0]?.partnerID || PARTNER_ID;

  // Opaque token for the browser — cookies used by the data proxy.
  const token = JSON.stringify({
    dxweb_session: session,
    "XSRF-TOKEN": xsrf || "",
    DXWEB_AFFINITY: affinity || "",
  });

  return {
    type: "dxweb" as const,
    token,
    email: String(auth.email || email),
    partnerId: String(partnerId),
    source: "app.dx.no",
  };
}

function parseDxwebToken(token: string) {
  try {
    const o = JSON.parse(token) as Record<string, string>;
    if (o.dxweb_session) return o;
  } catch {
    /* not json */
  }
  return null;
}

function extractScannedCount(data: unknown): number | null {
  if (data == null) return null;
  if (typeof data === "number" && Number.isFinite(data)) return data;
  if (Array.isArray(data)) {
    let used = 0;
    let saw = false;
    for (const row of data) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const status = String(
        r.checkin_status || r.checkInStatus || r.status || "",
      ).toLowerCase();
      if (
        r.scanned === true ||
        r.checkedIn === true ||
        r.checked_in === true ||
        status === "checked_in" ||
        status === "scanned" ||
        status === "used" ||
        status === "in"
      ) {
        used += 1;
        saw = true;
      }
    }
    if (saw) return used;
    // Some payloads are a bare ticket list where presence means sold; not scanned.
    return null;
  }
  if (typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  for (const key of [
    "scanned",
    "scannedCount",
    "scannedTickets",
    "checkedIn",
    "checkedInCount",
    "checked_in",
    "used",
    "usedCount",
    "attendance",
    "admissions",
    "innsjekk",
  ]) {
    const v = o[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  for (const nest of ["ticketSale", "ticketSales", "data", "stats", "statistics"]) {
    const child = o[nest];
    if (Array.isArray(child)) {
      for (const row of child) {
        const n = extractScannedCount(row);
        if (n != null) return n;
      }
    } else {
      const n = extractScannedCount(child);
      if (n != null) return n;
    }
  }
  return null;
}

/** Fetch scanned count using a stored DX Web session (cookie jar JSON). */
async function fetchScanned(body: {
  token?: string;
  type?: string;
  partnerId?: string;
  eventId?: string;
}) {
  const eventId = String(body.eventId || "");
  const partnerId = String(body.partnerId || PARTNER_ID);
  if (!eventId) return json({ error: "eventId required" }, 400);
  if (!body.token) return json({ error: "token required" }, 400);

  const dxweb = parseDxwebToken(body.token);
  if (dxweb) {
    const cookie = [
      `dxweb_session=${dxweb.dxweb_session}`,
      dxweb["XSRF-TOKEN"] ? `XSRF-TOKEN=${dxweb["XSRF-TOKEN"]}` : "",
      dxweb.DXWEB_AFFINITY ? `DXWEB_AFFINITY=${dxweb.DXWEB_AFFINITY}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": UA,
      Referer: `${APP}/`,
      Cookie: cookie,
    };
    if (dxweb["XSRF-TOKEN"]) {
      headers["X-XSRF-TOKEN"] = decodeURIComponent(dxweb["XSRF-TOKEN"]);
    }

    const urls = [
      `${APP}/api/v1/partners/${partnerId}/events/${eventId}`,
      `${DX_API}/partners/${partnerId}/events/${eventId}/tickets`,
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url, { headers });
        if (!res.ok) continue;
        const data = await res.json();
        const n = extractScannedCount(data);
        if (n != null) return json({ scanned: n, source: url });
      } catch {
        /* try next */
      }
    }
    return json({ scanned: null });
  }

  // Legacy api.dx.no session cookie stored as raw token.
  const headers = {
    Accept: "application/json",
    "User-Agent": UA,
    Cookie: `dx_api_session=${body.token}`,
    authToken: body.token,
  };
  try {
    const res = await fetch(
      `${DX_API}/partners/${partnerId}/events/${eventId}/tickets`,
      { headers },
    );
    if (res.ok) {
      const data = await res.json();
      const n = extractScannedCount(data);
      if (n != null) return json({ scanned: n, source: "api.dx.no/tickets" });
    }
  } catch {
    /* ignore */
  }
  return json({ scanned: null });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (body.action === "scanned") {
    return await fetchScanned({
      token: body.token ? String(body.token) : undefined,
      type: body.type ? String(body.type) : undefined,
      partnerId: body.partnerId ? String(body.partnerId) : undefined,
      eventId: body.eventId ? String(body.eventId) : undefined,
    });
  }

  const email = String(body.email || "").trim();
  const password = String(body.password || "");
  if (!email || !password) {
    return json({ error: "Email and password required", code: "login" }, 400);
  }

  try {
    // Prefer official DX Web (Auth0 via app.dx.no) — this is what w.dx.no users have.
    try {
      const dxweb = await loginDxWeb(email, password);
      return json(dxweb);
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "login") throw err;
      // Fall through to legacy api.dx.no for accounts that still work there.
      const legacy = await loginLegacy(email, password);
      if (legacy) return json(legacy);
      throw err;
    }
  } catch (e) {
    const err = e as Error & { code?: string };
    const code = err.code || "login";
    const status = code === "login" ? 403 : 502;
    return json(
      {
        error: err.message || "Login failed",
        code,
      },
      status,
    );
  }
});
