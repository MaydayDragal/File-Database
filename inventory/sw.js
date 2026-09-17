/* Tool Inventory service worker — offline app shell.
   Data is NOT bundled: it loads from a portable .tidb database file. */
const CACHE = "tool-inventory-v11";
const SHELL = [
  "./",
  "./index.html",
  "../debug.js",
  "./styles.css",
  "./app.js",
  "../src/core/text.js",
  "../src/core/ids.js",
  "../src/core/hash.js",
  "../src/core/formats/container.js",
  "../src/core/formats/fdb.js",
  "../src/data/schema.js",
  "../src/data/bus.js",
  "../src/data/db.js",
  "../src/data/repos.js",
  "../src/data/jobs.js",
  "../src/data/intake.js",
  "../src/data/backup.js",
  "../src/data/migrate.js",
  "../src/data/boot.js",
  "../src/ui/migrate-dialog.js",
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
  e.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res && res.status === 200) { const c = res.clone(); caches.open(CACHE).then((k) => k.put(req, c)); }
      return res;
    }).catch(() => cached))
  );
});
