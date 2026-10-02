/**
 * Cinema Info on t3lluz.com.
 *
 * One Deno process, two listeners:
 *
 *   PORT (8080)        the public side, reached at t3lluz.com/CinemaInfo
 *                      both through the Cloudflare tunnel and through
 *                      Caddy on the tailnet:
 *                        /CinemaInfo/            the app (static, built by
 *                                                deploy/server/update.sh)
 *                        /CinemaInfo/api/live    everything live, prefetched
 *                        /CinemaInfo/api/dx      the DX bridge, cached
 *                        /CinemaInfo/api/omdb    film lookups
 *                        /CinemaInfo/api/feedback  notes from staff
 *
 *   ADMIN_PORT (8081)  the feedback hub. Only Caddy on the tailnet proxies
 *                      to it (feedback.t3lluz.com), and it refuses anyone
 *                      outside ADMIN_ALLOW besides.
 *
 * GitHub Pages serves the same app and calls the same /api routes across
 * origins, so both copies show the same prefetched figures.
 */
import { handler as omdbHandler } from "../supabase/functions/omdb-lookup/index.ts";
import {
  cachedScanned,
  cachedSeats,
  liveHealth,
  liveSnapshot,
  passThrough,
  startLive,
} from "./live.ts";
import {
  addFeedback,
  deleteFeedback,
  feedbackCounts,
  listFeedback,
  startFeedback,
  updateFeedback,
} from "./feedback.ts";

const PORT = Number(Deno.env.get("PORT")) || 8080;
const ADMIN_PORT = Number(Deno.env.get("ADMIN_PORT")) || 8081;
const SITE_DIR = Deno.env.get("SITE_DIR") || "/build/current";
const DATA_DIR = Deno.env.get("DATA_DIR") || "/data";
const BASE = "/CinemaInfo";
const ADMIN_ALLOW = (Deno.env.get("ADMIN_ALLOW") || "172.30.0.,127.0.0.1")
  .split(",").map((s) => s.trim()).filter(Boolean);
const HUB_HTML = new URL("./hub.html", import.meta.url);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, if-none-match",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "ETag",
  "Access-Control-Max-Age": "86400",
  // A tailnet device resolves t3lluz.com to a 100.x address, which Chrome
  // treats as a local network when GitHub Pages calls it.
  "Access-Control-Allow-Private-Network": "true",
};

const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function json(data: unknown, status = 200, extra: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS,
      ...SECURITY,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

/* —— Who is asking ————————————————————————————————————————————————— */

/**
 * The tunnel sets CF-Connecting-IP (Cloudflare overwrites any a client
 * sends); Caddy sets X-Forwarded-For. Either way the socket itself is the
 * proxy, so the header is the only useful answer.
 */
function clientIp(req: Request, info: Deno.ServeHandlerInfo) {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const addr = info.remoteAddr as Deno.NetAddr;
  return addr?.hostname || "unknown";
}

/**
 * Fixed windows per address. Generous on purpose: every phone at the box
 * office shares one public address, and so do their feedback notes.
 */
const buckets = new Map<string, { until: number; n: number }>();
function limited(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.until) {
    buckets.set(key, { until: now + windowMs, n: 1 });
    return false;
  }
  b.n++;
  return b.n > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.until) buckets.delete(k);
}, 60_000);

/* —— Static files —————————————————————————————————————————————————— */

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  webmanifest: "application/manifest+json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  txt: "text/plain; charset=utf-8",
};

/**
 * Same rules as the dashboard's Caddyfile: the shell, the service worker
 * and the programme always revalidate; stamped scripts and styles never
 * change under the same URL; icons and posters keep for a day.
 */
function cacheControl(rel: string, url: URL) {
  const v = url.searchParams.get("v");
  if (/\.(js|css)$/.test(rel) && v && v !== "dev" && rel !== "sw.js") {
    return "public, max-age=31536000, immutable";
  }
  if (rel.startsWith("assets/") || rel.startsWith("posters/")) {
    return "public, max-age=86400";
  }
  return "no-cache";
}

async function serveStatic(req: Request, url: URL, rel: string) {
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  // Normalised by URL already; refuse anything that still climbs out.
  if (rel.split("/").some((part) => part === ".." || part.startsWith("."))) {
    return new Response("Not found", { status: 404 });
  }
  const path = `${SITE_DIR}/${rel}`;
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.stat(path);
    if (stat.isDirectory) {
      return Response.redirect(`${url.origin}${url.pathname}/`, 301);
    }
  } catch {
    return new Response("Not found", {
      status: 404,
      headers: { ...SECURITY, "Content-Type": "text/plain" },
    });
  }

  const etag = `W/"${stat.size.toString(36)}-${
    (stat.mtime?.getTime() || 0).toString(36)
  }"`;
  const headers: Record<string, string> = {
    ...SECURITY,
    "Content-Type": TYPES[rel.split(".").pop() || ""] ||
      "application/octet-stream",
    "Cache-Control": cacheControl(rel, url),
    ETag: etag,
  };
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  if (req.method === "HEAD") {
    headers["Content-Length"] = String(stat.size);
    return new Response(null, { headers });
  }
  const file = await Deno.open(path, { read: true });
  headers["Content-Length"] = String(stat.size);
  return new Response(file.readable, { headers });
}

/* —— API ———————————————————————————————————————————————————————————— */

async function readJson(req: Request, max = 64 * 1024) {
  const text = await req.text();
  if (text.length > max) throw new Error("too large");
  const body = JSON.parse(text || "{}");
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("object expected");
  }
  return body as Record<string, unknown>;
}

async function etagOf(text: string) {
  const digest = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(text),
  );
  return `"${
    [...new Uint8Array(digest).slice(0, 10)].map((b) =>
      b.toString(16).padStart(2, "0")
    ).join("")
  }"`;
}

async function api(req: Request, route: string, ip: string) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (route === "live" && (req.method === "GET" || req.method === "HEAD")) {
    if (limited(`live:${ip}`, 900, 60_000)) return json({ error: "slow down" }, 429);
    const url = new URL(req.url);
    const days = (url.searchParams.get("days") || "").split(",")
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 3);
    const have = new Set(
      (url.searchParams.get("have") || "").split(",").filter(Boolean),
    );
    const text = JSON.stringify(liveSnapshot(days, have));
    const etag = await etagOf(text);
    if (req.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: { ...CORS, ETag: etag, "Cache-Control": "no-cache" },
      });
    }
    return new Response(text, {
      headers: {
        ...CORS,
        ...SECURITY,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        ETag: etag,
      },
    });
  }

  if (route === "health" && req.method === "GET") {
    return json({ ok: true, ...liveHealth() });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (route === "dx" || route === "dx-web-login") {
    if (limited(`dx:${ip}`, 1200, 60_000)) return json({ error: "slow down" }, 429);
    let body: Record<string, unknown>;
    try {
      body = await readJson(req);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const out = body.debug
      ? await passThrough(body)
      : body.action === "seats"
      ? await cachedSeats(body)
      : body.action === "scanned"
      ? await cachedScanned(body)
      : await passThrough(body);
    return json(out.data, out.status);
  }

  if (route === "omdb" || route === "omdb-lookup") {
    if (limited(`omdb:${ip}`, 300, 60_000)) return json({ error: "slow down" }, 429);
    const res = await omdbHandler(req);
    return res;
  }

  if (route === "feedback") {
    if (limited(`fb:${ip}`, 20, 10 * 60_000) || limited("fb:all", 300, 86_400_000)) {
      return json({ error: "Too many messages, try again later", code: "rate" }, 429);
    }
    let body: Record<string, unknown>;
    try {
      body = await readJson(req, 16 * 1024);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    // A hidden field people never fill in; form-filling bots do.
    if (body.website) return json({ ok: true });
    const result = await addFeedback(body, ip);
    if ("error" in result) return json({ error: result.error }, 400);
    console.log(`feedback: new ${result.note.kind} (${result.note.message.length} chars)`);
    return json({ ok: true, id: result.note.id }, 201);
  }

  return json({ error: "Not found" }, 404);
}

/* —— Public listener ——————————————————————————————————————————————— */

async function publicHandler(req: Request, info: Deno.ServeHandlerInfo) {
  const url = new URL(req.url);
  const path = url.pathname;
  const lower = path.toLowerCase();
  const base = BASE.toLowerCase();

  if (lower === base) {
    return Response.redirect(`${url.origin}${BASE}/${url.search}`, 301);
  }
  if (!lower.startsWith(`${base}/`)) {
    return new Response("Not found", { status: 404 });
  }

  const rest = path.slice(BASE.length + 1);
  if (rest.toLowerCase().startsWith("api/")) {
    try {
      return await api(req, rest.slice(4).replace(/\/+$/, ""), clientIp(req, info));
    } catch (err) {
      console.error("api error", err);
      return json({ error: "Server error" }, 500);
    }
  }

  // One spelling, so the service worker and its caches see one app.
  if (!path.startsWith(`${BASE}/`) && req.method === "GET") {
    return Response.redirect(`${url.origin}${BASE}/${rest}${url.search}`, 301);
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  let rel: string;
  try {
    rel = decodeURIComponent(rest);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  return serveStatic(req, url, rel);
}

/* —— Admin listener (the feedback hub) ———————————————————————————— */

function adminAllowed(info: Deno.ServeHandlerInfo) {
  const host = (info.remoteAddr as Deno.NetAddr)?.hostname || "";
  return ADMIN_ALLOW.some((prefix) => host === prefix || host.startsWith(prefix));
}

async function adminHandler(req: Request, info: Deno.ServeHandlerInfo) {
  if (!adminAllowed(info)) return new Response("Forbidden", { status: 403 });
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const noStore = { "Cache-Control": "no-store", ...SECURITY };

  if (path === "/" && req.method === "GET") {
    return new Response(await Deno.readTextFile(HUB_HTML), {
      headers: { ...noStore, "Content-Type": "text/html; charset=utf-8" },
    });
  }
  if (path === "/api/feedback" && req.method === "GET") {
    return new Response(
      JSON.stringify({ items: listFeedback(), ...feedbackCounts() }),
      { headers: { ...noStore, "Content-Type": "application/json" } },
    );
  }
  if (path === "/api/health" && req.method === "GET") {
    return new Response(
      JSON.stringify({ ...liveHealth(), feedback: feedbackCounts() }),
      { headers: { ...noStore, "Content-Type": "application/json" } },
    );
  }
  const m = path.match(/^\/api\/feedback\/([0-9a-f-]{36})$/);
  if (m && req.method === "PATCH") {
    let body: Record<string, unknown>;
    try {
      body = await readJson(req, 4096);
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }
    const note = await updateFeedback(m[1], body);
    return note
      ? new Response(JSON.stringify(note), {
        headers: { ...noStore, "Content-Type": "application/json" },
      })
      : new Response("Not found", { status: 404 });
  }
  if (m && req.method === "DELETE") {
    return (await deleteFeedback(m[1]))
      ? new Response(null, { status: 204 })
      : new Response("Not found", { status: 404 });
  }
  return new Response("Not found", { status: 404 });
}

/* —— Start ————————————————————————————————————————————————————————— */

await startFeedback(DATA_DIR);
await startLive({ siteDir: SITE_DIR, dataDir: DATA_DIR });

Deno.serve({ port: PORT, hostname: "0.0.0.0" }, publicHandler);
Deno.serve({ port: ADMIN_PORT, hostname: "0.0.0.0" }, adminHandler);
