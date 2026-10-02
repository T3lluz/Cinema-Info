/* Cinema Info service worker.
 *
 * App files: network first, falling back to the cache, so a deploy is
 * picked up on the next launch and the app still opens offline with the
 * last-seen programme. Posters: cache first, they never change for a
 * given URL. Live DX and bridge calls are never cached.
 *
 * Every `?v=dev` below (and in index.html and js/*.js) is replaced with
 * the commit SHA on deploy by scripts/stamp-version.mjs, so a new
 * version always lands as a fresh cache instead of a stale one.
 */
const CACHE = "cinema-info-vdev";
const PRECACHE = [
  "./",
  "./index.html",
  "./css/styles.css?v=dev",
  "./js/app.js?v=dev",
  "./js/core.js?v=dev",
  "./js/i18n.js?v=dev",
  "./js/data.js?v=dev",
  "./js/ui.js?v=dev",
  "./js/seats.js?v=dev",
  "./js/day.js?v=dev",
  "./js/movies.js?v=dev",
  "./js/stats.js?v=dev",
  "./js/settings.js?v=dev",
  "./js/sheet.js?v=dev",
  "./js/ripple.js?v=dev",
  "./data/program.json",
  "./assets/favicon.svg",
  "./assets/apple-touch-icon.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/maskable-192.png",
  "./assets/icons/maskable-512.png",
  "./manifest.webmanifest",
];

/** Hosts whose answers are live and must never come from a cache. */
const LIVE_HOSTS = ["api.dx.no", "public.dx.no", "login.dx.no", "app.dx.no"];

/** Poster CDNs: immutable per URL. Capped so the cache cannot grow forever. */
const POSTER_HOSTS = ["cdn.sanity.io", "m.media-amazon.com"];
const POSTER_CACHE = "cinema-info-posters";
const POSTER_MAX = 150;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE && k !== POSTER_CACHE).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function trimPosters() {
  const cache = await caches.open(POSTER_CACHE);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - POSTER_MAX; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (
    LIVE_HOSTS.includes(url.hostname) ||
    url.hostname.endsWith(".supabase.co") ||
    url.hostname.endsWith(".ts.net") ||
    url.hostname.endsWith(".deno.dev")
  ) {
    return;
  }

  if (url.origin === self.location.origin) {
    // The app cache-busts the programme snapshot on every read, so it is
    // stored under its plain path — one copy, not one per request.
    const isProgram = url.pathname.endsWith("program.json");
    const key = isProgram ? new Request(url.origin + url.pathname) : req;
    // A navigation (launching the installed app) always resolves to the
    // shell, whatever query string a shortcut put on it.
    const isNav = req.mode === "navigate";
    event.respondWith(
      fetch(req)
        .then(async (res) => {
          // Never let an error page overwrite the last good copy.
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(isNav ? "./index.html" : key, copy));
            return res;
          }
          return (await caches.match(key, { ignoreSearch: isProgram })) || res;
        })
        .catch(async () => {
          if (isNav) return (await caches.match("./index.html")) || (await caches.match("./"));
          return caches.match(key, { ignoreSearch: isProgram });
        })
    );
    return;
  }

  if (POSTER_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(POSTER_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        // Opaque (no-cors) responses are fine to keep for <img>.
        if (res.ok || res.type === "opaque") {
          cache.put(req, res.clone()).then(trimPosters);
        }
        return res;
      })
    );
  }
});
