/* Tombstone service worker.
   The page previously registered a caching SW; combined with Safari's
   unreliable SW update checks it could pin a visitor to a stale deploy
   (stale HTML -> stale unversioned assets -> weeks-old JavaScript), which
   made every bug report undebuggable. The page no longer registers any
   SW; this file stays deployed so every client that still checks the URL
   replaces its old worker with this one, which deletes all caches and
   removes itself. __BUILD__ is stamped by the deploy for byte-freshness. */

/* build __BUILD__ */

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.registration.unregister(); })
      .then(function () { return self.clients.matchAll({ type: "window" }); })
      .then(function (clients) {
        /* controlled pages keep talking to the dead worker until they
           reload; refresh them once so they load straight from network */
        clients.forEach(function (c) {
          if (c.navigate) c.navigate(c.url).catch(function () {});
        });
      })
  );
});
