#!/usr/bin/env node
/**
 * Serve public/ on localhost and reload the open tab when files change.
 * No packages — Node built-ins only.
 *
 *   node scripts/dev-server.mjs
 *   PORT=8080 node scripts/dev-server.mjs
 */

import { createReadStream, existsSync, readFileSync, statSync, watch } from "node:fs";
import { createServer } from "node:http";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../public", import.meta.url)));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || "0.0.0.0";
const RELOAD_PATH = "/__dev/reload";
const VERSION_PATH = "/__dev/version";

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const LIVE_RELOAD = `<script>
(function () {
  if (navigator.serviceWorker) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (r) { r.unregister(); });
    });
  }
  var seen = 0;
  function apply(data) {
    if (!data || !data.version) return;
    if (!seen) { seen = data.version; return; }
    if (data.version === seen) return;
    seen = data.version;
    if (data.kind === "css") {
      document.querySelectorAll('link[rel="stylesheet"]').forEach(function (link) {
        var url = new URL(link.href, location.href);
        url.searchParams.set("v", String(Date.now()));
        link.href = url.pathname + url.search;
      });
      return;
    }
    location.reload();
  }
  function poll() {
    fetch(${JSON.stringify(VERSION_PATH)}, { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(apply)
      .catch(function () {});
  }
  poll();
  setInterval(poll, 400);
  try {
    var es = new EventSource(${JSON.stringify(RELOAD_PATH)});
    es.onmessage = function (ev) {
      try { apply(JSON.parse(ev.data)); } catch (e) {}
    };
  } catch (e) {}
})();
</script>`;

const clients = new Set();
let version = 1;
let kind = "reload";
let reloadTimer = null;
let pendingKind = null;

function snapshot() {
  return { version, kind };
}

function send(next) {
  const payload = `data: ${JSON.stringify(next)}\n\n`;
  for (const res of clients) res.write(payload);
}

function scheduleReload(nextKind) {
  if (pendingKind !== "reload") pendingKind = nextKind;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    kind = pendingKind || "reload";
    pendingKind = null;
    version += 1;
    send(snapshot());
    const who = clients.size === 1 ? "1 stream" : `${clients.size} streams`;
    console.log(`reload (${kind} #${version}) → ${who}`);
  }, 80);
}

function safeFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const cleaned = decoded.replace(/^\/+/, "");
  const full = resolve(ROOT, cleaned);
  const rel = relative(ROOT, full);
  if (rel.startsWith("..") || rel.split(sep).includes("..")) return null;
  return full;
}

function fileFor(urlPath) {
  const file = safeFile(urlPath);
  if (!file) return null;
  if (existsSync(file) && statSync(file).isDirectory()) {
    const index = join(file, "index.html");
    return existsSync(index) ? index : null;
  }
  if (existsSync(file) && statSync(file).isFile()) return file;
  if (!extname(file)) {
    const index = join(file, "index.html");
    if (existsSync(index)) return index;
  }
  return null;
}

function json(res, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": data.length,
  });
  res.end(data);
}

function serve(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === VERSION_PATH) {
    json(res, snapshot());
    return;
  }

  if (url.pathname === RELOAD_PATH) {
    req.socket.setTimeout(0);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`retry: 1000\ndata: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res);
    const ping = setInterval(() => {
      if (res.writableEnded) return;
      res.write(": ping\n\n");
    }, 15000);
    req.on("close", () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }

  const file = fileFor(url.pathname === "/" ? "/index.html" : url.pathname);
  if (!file) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  if (extname(file).toLowerCase() === ".html") {
    let html = readFileSync(file, "utf8");
    if (html.includes("</body>")) {
      html = html.replace("</body>", `${LIVE_RELOAD}\n</body>`);
    } else {
      html += LIVE_RELOAD;
    }
    const body = Buffer.from(html);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Length": body.length,
    });
    res.end(body);
    return;
  }

  const type = MIME[extname(file).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Content-Length": statSync(file).size,
  });
  createReadStream(file).pipe(res);
}

function watchPublic() {
  watch(ROOT, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const name = filename.split(sep).pop() || "";
    if (name.startsWith(".") || name.endsWith("~") || name.endsWith(".swp")) {
      return;
    }
    const nextKind = extname(filename).toLowerCase() === ".css" ? "css" : "reload";
    scheduleReload(nextKind);
  });
}

const server = createServer(serve);
server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`port ${PORT} is already in use`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  watchPublic();
  console.log(`Cinema Info → http://127.0.0.1:${PORT}/`);
  console.log(`watching ${ROOT}`);
});
