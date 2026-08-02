/* Cinema Info service worker: network-first with cache fallback,
   so the app opens instantly and still works offline with the
   last-seen program. Live DX calls are never cached. */
const CACHE = "cinema-info-v49";
const PRECACHE = [
  "./",
  "./index.html",
  "./styles.css?v=51",
  "./app.js?v=39",
  "./favicon.svg",
  "./apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-192.png",
  "./icons/maskable-512.png",
  "./manifest.webmanifest",
];

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
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache live ticket data or the DX login proxy.
  if (
    url.hostname === "api.dx.no" ||
    url.hostname === "public.dx.no" ||
    url.hostname === "login.dx.no" ||
    url.hostname.endsWith(".supabase.co")
  ) {
    return;
  }
  if (event.request.method !== "GET") return;

  // Same-origin app files + data: network first, fall back to cache.
  if (url.origin === self.location.origin) {
    // The app cache-busts the program snapshot on every read, so it is
    // stored under its plain path — otherwise a tab left open all day
    // would file away a copy per request and never hit any of them.
    const isProgram = url.pathname.endsWith("program.json");
    const key = isProgram ? url.origin + url.pathname : event.request;
    event.respondWith(
      fetch(event.request)
        .then(async (res) => {
          // Never let an error page overwrite the last good copy, and
          // answer with that copy instead when the server is unhappy —
          // a 500 from Pages should read like being offline, not like an
          // empty programme.
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(key, copy));
            return res;
          }
          return (await caches.match(key, { ignoreSearch: isProgram })) || res;
        })
        .catch(() => caches.match(key, { ignoreSearch: isProgram }))
    );
    return;
  }

  // Posters (CDN): cache first, they never change for a given URL.
  if (url.hostname === "cdn.sanity.io") {
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ||
          fetch(event.request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
            return res;
          })
      )
    );
  }
});
