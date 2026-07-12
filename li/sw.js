/* Service worker for LI Document Database.
   Precaches the app shell so the app opens with no network at all;
   runtime-caches the OCR engine (tesseract.js from CDN) after first use. */
"use strict";

var SHELL_CACHE = "li-db-shell-v1";
var RUNTIME_CACHE = "li-db-runtime-v1";

var SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png"
];

/* Hosts the OCR engine is fetched from (see loadTess() in index.html).
   Their files are versioned/immutable, so cache-first is safe. */
var RUNTIME_HOSTS = ["cdn.jsdelivr.net", "tessdata.projectnaptha.com"];

// Store a response in a cache, ignoring failures (a detached put must never
// produce an unhandled rejection, e.g. on a 206 range response or quota error).
function cachePut(cacheName, req, res) {
  caches.open(cacheName).then(function (c) { return c.put(req, res); }).catch(function () {});
}

self.addEventListener("install", function (e) {
  // Cache each shell asset individually and tolerate an individual failure, so
  // one missing/renamed asset can't fail the whole install (which would leave
  // the app with no offline support at all). The core page must succeed.
  e.waitUntil(
    caches.open(SHELL_CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== SHELL_CACHE && k !== RUNTIME_CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);

  // App shell navigations: network-first so updates arrive, cache fallback for
  // offline. Only cache a successful (2xx) response — never overwrite the
  // precached shell with a transient 5xx/maintenance page.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) cachePut(SHELL_CACHE, req, res.clone());
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match("./");
        });
      })
    );
    return;
  }

  // OCR engine from CDN: cache-first (files are versioned, they never change).
  // Opaque cross-origin responses can't be inspected, so we can't tell a good
  // one from an error page — cache them (to keep OCR working offline after the
  // first use) but revalidate in the background so a bad one can't stick.
  if (RUNTIME_HOSTS.indexOf(url.hostname) !== -1) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res && (res.ok || res.type === "opaque")) cachePut(RUNTIME_CACHE, req, res.clone());
          return res;
        });
        if (hit) { net.catch(function () {}); return hit; }
        return net;
      })
    );
    return;
  }

  // Same-origin static assets (icons, manifest): stale-while-revalidate — serve
  // the cached copy instantly, but refresh it in the background so an updated
  // icon/manifest is picked up without needing the service worker to change.
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res && res.ok) cachePut(SHELL_CACHE, req, res.clone());
          return res;
        });
        if (hit) { net.catch(function () {}); return hit; }
        return net;
      })
    );
  }
});
