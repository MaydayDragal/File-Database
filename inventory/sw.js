/* Tool Inventory service worker — offline app shell + seed data. */
const CACHE = "tool-inventory-v5";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./tools.json",
  "./manifest.webmanifest",
  "./icons/favicon-64.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    // Only prune OUR OWN old caches (CacheStorage is shared across the origin).
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("tool-inventory-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((res) => { const c = res.clone(); caches.open(CACHE).then((k) => k.put("./index.html", c)); return res; })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }
  // Network-first for the seed data so a refreshed catalog shows up without
  // waiting for a cache-version bump; fall back to cache when offline.
  if (url.pathname.endsWith("/tools.json")) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200) { const c = res.clone(); caches.open(CACHE).then((k) => k.put(req, c)); }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res && res.status === 200) { const c = res.clone(); caches.open(CACHE).then((k) => k.put(req, c)); }
      return res;
    }).catch(() => cached))
  );
});
