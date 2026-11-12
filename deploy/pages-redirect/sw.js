/* Cinema Info moved to https://t3lluz.com/CinemaInfo/.
 *
 * Phones that installed the old GitHub Pages copy still run its service
 * worker, which would go on serving the old app from its cache whenever
 * the network is slow or gone. This worker takes its place on their next
 * launch: it empties those caches, sends every open window to the new
 * address and unregisters itself, so nothing of the old copy is left.
 */
const NEW_HOME = "https://t3lluz.com/CinemaInfo/";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      for (const key of await caches.keys()) await caches.delete(key);
      const windows = await self.clients.matchAll({ type: "window" });
      await Promise.all(windows.map((win) => win.navigate(NEW_HOME).catch(() => {})));
      await self.registration.unregister();
    })()
  );
});
