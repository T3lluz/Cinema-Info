#!/usr/bin/env node
/**
 * Sign in to app.dx.no from the command line and read any of its API
 * paths — the same session the `dx-web-login` Edge Function holds, in a
 * shape that can be piped into jq while debugging.
 *
 * Credentials come from the environment, never from the repo:
 *
 *   DX_EMAIL=... DX_PASSWORD=... node scripts/dx-session.mjs <path…>
 *
 * Examples:
 *   node scripts/dx-session.mjs /api/v1/auth/
 *   node scripts/dx-session.mjs /api/v1/partners/202/events?fromDate=2026-07-01
 *   node scripts/dx-session.mjs --token            # print a reusable token
 *   DX_TOKEN=… node scripts/dx-session.mjs /api/v1/auth/   # reuse one
 */

const AUTH0 = "https://login.dx.no";
const APP = "https://app.dx.no";
const CLIENT_ID = "3y0iSEXBv8kI91Y5a2UiwEjfh2miWClo";
const REALM = "Username-Password-Authentication";
const AUTH0_CLIENT = "eyJuYW1lIjoiYXV0aDAuanMiLCJ2ZXJzaW9uIjoiOS4yMy4xIn0=";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const KEEP_COOKIES = ["dxweb_session", "XSRF-TOKEN", "DXWEB_AFFINITY", "auth0", "did"];

function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function absorbSetCookie(res, jar) {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

async function step(url, { jar, ...init } = {}) {
  const headers = new Headers(init.headers || {});
  const cookie = jar ? cookieHeader(jar) : "";
  if (cookie) headers.set("Cookie", cookie);
  if (!headers.has("User-Agent")) headers.set("User-Agent", UA);
  const res = await fetch(url, { ...init, headers, redirect: "manual" });
  if (jar) absorbSetCookie(res, jar);
  return res;
}

/** app.dx.no → Auth0 authorize → apiweb/callback, as the browser walks it. */
async function authorize(jar, credentials) {
  const start = await step(`${APP}/apiweb/login`, {
    jar,
    headers: { Accept: "text/html,application/xhtml+xml" },
  });
  const authUrl = start.headers.get("location") || "";
  if (!authUrl.includes("login.dx.no/authorize")) {
    throw new Error("DX login start failed (no Auth0 redirect)");
  }

  let target = authUrl;
  if (credentials) {
    const res = await step(`${AUTH0}/co/authenticate`, {
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
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error_description || "Wrong email or password");
    }
    const ticket = body.login_ticket || body.loginTicket;
    if (!ticket) throw new Error("Auth0 login ticket missing");
    const u = new URL(authUrl);
    u.searchParams.set("login_ticket", String(ticket));
    u.searchParams.set("realm", REALM);
    target = u.toString();
  }

  const authRes = await step(target, {
    jar,
    headers: { Accept: "text/html", Referer: `${APP}/` },
  });
  const callback = authRes.headers.get("location") || "";
  if (!callback.includes("/apiweb/callback") || !callback.includes("code=")) {
    throw new Error("Auth0 authorization code missing");
  }

  const cb = await step(callback, {
    jar,
    headers: { Accept: "text/html,application/xhtml+xml", Referer: `${AUTH0}/` },
  });
  if (cb.status >= 400) throw new Error(`DX callback failed (${cb.status})`);
  if (!jar.get("dxweb_session")) throw new Error("DX session cookie missing");
}

function packToken(jar) {
  const out = {};
  for (const name of KEEP_COOKIES) {
    const value = jar.get(name);
    if (value) out[name] = value;
  }
  return JSON.stringify(out);
}

/** A signed-in session: reuse DX_TOKEN when it still works, else log in. */
export async function openDxSession({
  email = process.env.DX_EMAIL,
  password = process.env.DX_PASSWORD,
  token = process.env.DX_TOKEN,
} = {}) {
  const jar = new Map();
  if (token) {
    try {
      for (const [k, v] of Object.entries(JSON.parse(token))) {
        if (KEEP_COOKIES.includes(k)) jar.set(k, String(v));
      }
    } catch {
      jar.clear();
    }
  }

  let signedIn = false;
  if (jar.size) {
    const me = await step(`${APP}/api/v1/auth/`, {
      jar,
      headers: { Accept: "application/json", Referer: `${APP}/` },
    });
    signedIn = me.ok && Boolean((await me.json().catch(() => ({}))).authenticated);
    // A dead session can still be reminted from the SSO cookie alone.
    if (!signedIn && jar.get("auth0")) {
      await authorize(jar).then(
        () => (signedIn = true),
        () => jar.clear()
      );
    }
  }

  if (!signedIn) {
    if (!email || !password) {
      throw new Error(
        "DX_EMAIL and DX_PASSWORD are required (see .cursor/skills/dx-account)"
      );
    }
    await authorize(jar, { email, password });
  }

  return {
    token: packToken(jar),
    async get(path) {
      const res = await fetch(APP + path, {
        headers: {
          Accept: "application/json",
          "User-Agent": UA,
          Referer: `${APP}/`,
          Cookie: cookieHeader(jar),
        },
      });
      if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
      return res.json();
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const session = await openDxSession();

  if (!args.length || args.includes("--token")) {
    console.log(session.token);
    if (!args.length) console.error("Pass an app.dx.no path to read one.");
    return;
  }

  for (const path of args) {
    const data = await session.get(path.startsWith("/") ? path : `/${path}`);
    console.log(JSON.stringify(data, null, 2));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
