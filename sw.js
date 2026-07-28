/* Cinema Info service worker: network-first with cache fallback,
   so the app opens instantly and still works offline with the
   last-seen program. Live DX calls are never cached. */
const CACHE = "cinema-info-v24";
const PRECACHE = [
  "./",
  "./index.html",
  "./styles.css?v=26",
  "./app.js?v=22",
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
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match(event.request, { ignoreSearch: url.pathname.endsWith("program.json") }))
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
