import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const DX_API = "https://api.dx.no/v3";
const AUTH0 = "https://login.dx.no";
const CLIENT_ID = "3y0iSEXBv8kI91Y5a2UiwEjfh2miWClo";
const AUDIENCE = "https://app.dx.no/";
const REDIRECT_URI = "https://app.dx.no/apiweb/callback";
const REALM = "Username-Password-Authentication";
const PARTNER_ID = "202";
const AUTH0_CLIENT =
  "eyJuYW1lIjoiYXV0aDAuanMiLCJ2ZXJzaW9uIjoiOS4yMy4xIn0=";

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

function b64url(buf: ArrayBuffer | Uint8Array) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function pkce() {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = b64url(verifierBytes);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: b64url(digest) };
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

function cookieHeader(jar: Map<string, string>) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function loginLegacy(email: string, password: string) {
  const res = await fetch(`${DX_API}/auth/login`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
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
  const nested = (data.data || {}) as Record<string, unknown>;
  const user = (data.user || {}) as Record<string, unknown>;
  const token =
    data.authToken ||
    data.token ||
    data.access_token ||
    data.accessToken ||
    nested.authToken ||
    nested.token;
  if (!token) return null;
  return {
    type: "session" as const,
    token: String(token),
    email: String(data.email || user.email || email),
    partnerId: String(
      data.partnerId || data.partner_id || user.partnerId || PARTNER_ID,
    ),
    source: "api.dx.no",
  };
}

async function loginAuth0(email: string, password: string) {
  const jar = new Map<string, string>();

  const coRes = await fetch(`${AUTH0}/co/authenticate`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: "https://app.dx.no",
      Referer: "https://app.dx.no/",
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
  absorbSetCookie(coRes, jar);
  const coText = await coRes.text();
  let co: Record<string, unknown> = {};
  try {
    co = coText ? JSON.parse(coText) : {};
  } catch {
    co = { raw: coText.slice(0, 300) };
  }
  if (!coRes.ok) {
    const desc = String(co.error_description || co.description || "");
    const err = new Error(desc || "Auth0 authenticate failed");
    (err as { code?: string }).code =
      /wrong email or password/i.test(desc) ? "login" : "auth0";
    throw err;
  }
  const loginTicket = co.login_ticket || co.loginTicket;
  if (!loginTicket) {
    const err = new Error("Auth0 login ticket missing");
    (err as { code?: string }).code = "auth0";
    throw err;
  }

  const { verifier, challenge } = await pkce();
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: "openid profile email offline_access",
    audience: AUDIENCE,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    login_ticket: String(loginTicket),
    realm: REALM,
  });

  let location = `${AUTH0}/authorize?${params}`;
  let code = "";
  for (let hops = 0; hops < 10; hops += 1) {
    const cookie = cookieHeader(jar);
    const res = await fetch(location, {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "text/html,application/json",
        Origin: "https://app.dx.no",
        Referer: "https://app.dx.no/",
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
    absorbSetCookie(res, jar);

    const loc = res.headers.get("location") || "";
    if (loc) {
      const abs = new URL(loc, location);
      if (
        abs.origin + abs.pathname === REDIRECT_URI ||
        abs.href.startsWith(REDIRECT_URI)
      ) {
        code = abs.searchParams.get("code") || "";
        break;
      }
      location = abs.href;
      continue;
    }

    // Some environments follow redirects and expose final URL.
    try {
      const finalUrl = new URL(res.url);
      if (
        finalUrl.origin + finalUrl.pathname === REDIRECT_URI ||
        finalUrl.href.startsWith(REDIRECT_URI)
      ) {
        code = finalUrl.searchParams.get("code") || "";
        break;
      }
    } catch {
      /* ignore */
    }

    // Last resort: look for code in HTML body (rare).
    const body = await res.text();
    const m = body.match(/[?&]code=([^&"']+)/);
    if (m) {
      code = decodeURIComponent(m[1]);
      break;
    }
    break;
  }

  if (!code) {
    const err = new Error("Auth0 authorization code missing");
    (err as { code?: string }).code = "auth0";
    throw err;
  }

  const tokenRes = await fetch(`${AUTH0}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: "https://app.dx.no",
      "Auth0-Client": AUTH0_CLIENT,
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    }),
  });
  const tokenText = await tokenRes.text();
  let tokens: Record<string, unknown> = {};
  try {
    tokens = tokenText ? JSON.parse(tokenText) : {};
  } catch {
    tokens = {};
  }
  if (!tokenRes.ok || !tokens.access_token) {
    const err = new Error(
      String(
        tokens.error_description || tokens.error || "Auth0 token exchange failed",
      ),
    );
    (err as { code?: string }).code = "auth0";
    throw err;
  }

  let emailOut = email;
  try {
    const parts = String(tokens.id_token || "").split(".");
    if (parts.length >= 2) {
      const payload = JSON.parse(
        atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
      );
      if (payload.email) emailOut = String(payload.email);
    }
  } catch {
    /* ignore */
  }

  return {
    type: "auth0" as const,
    token: String(tokens.access_token),
    refreshToken: tokens.refresh_token
      ? String(tokens.refresh_token)
      : undefined,
    email: emailOut,
    partnerId: PARTNER_ID,
    source: "login.dx.no",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: { email?: string; password?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const email = String(body.email || "").trim();
  const password = String(body.password || "");
  if (!email || !password) {
    return json({ error: "Email and password required", code: "login" }, 400);
  }

  try {
    const legacy = await loginLegacy(email, password);
    if (legacy) return json(legacy);

    const auth0 = await loginAuth0(email, password);
    return json(auth0);
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
