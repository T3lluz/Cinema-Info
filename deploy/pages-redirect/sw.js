/* Cinema Info moved to https://t3lluz.com/CinemaInfo/.
 *
 * Phones that installed the old GitHub Pages copy still run its service
 * worker, which would go on serving the old app from its cache whenever
 * the network is slow or gone. This worker takes its place on their next
 * launch: it empties those caches, reloads every open window onto the
 * page here (which forwards a browser tab and tells a home-screen icon to
 * move) and unregisters itself, so nothing of the old copy is left.
 */

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      for (const key of await caches.keys()) await caches.delete(key);
      const windows = await self.clients.matchAll({ type: "window" });
      await Promise.all(windows.map((win) => win.navigate(win.url).catch(() => {})));
      await self.registration.unregister();
    })()
  );
});
