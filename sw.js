/* Service worker: instant repeat visits and offline viewing.
   Cache-first for /static/ (renders never change under the same name within
   a deploy; the cache name carries the build id, so a new deploy starts a
   fresh cache and the old one is deleted). Navigations are network-first
   with the cached page as offline fallback. __BUILD__ is replaced with the
   commit SHA by the deploy workflow; "dev" builds cache under one name. */

var CACHE = "sad-page-__BUILD__";

self.addEventListener("install", function (e) {
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf("sad-page-") === 0 && k !== CACHE;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
        return res;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }

  if (url.pathname.indexOf("/static/") !== -1) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res.ok) {
            var copy = res.clone();
            /* videos are large: ignore quota errors, the network still works */
            caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
          }
          return res;
        });
      })
    );
  }
});
