/*
 * sw.js — Service worker for File Vault.
 *
 * Caches the app shell so it launches and works fully offline. User file data
 * is NOT handled here — that lives in IndexedDB and never touches the cache
 * or the network.
 */
const CACHE = "vault-app-v25";
// Required for the app to boot offline — the install fails (and retries) if
// any of these can't be cached.
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./db.js",
  "./backup-format.js",
  "./blob-integrity.js",
  "./app.js",
];
// Nice-to-have — cached tolerantly so a single hiccup (a momentarily
// unreachable icon, a proxy blip) can NEVER fail the install and strand the
// user on a stale, un-updatable service worker.
const EXTRAS = [
  "../bridge.js",
  "../debug.js",
  "./manifest.webmanifest",
  "./icons/favicon-64.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(CORE).then(() => Promise.all(EXTRAS.map((u) => c.add(u).catch(() => {})))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      // Only prune OUR OWN old caches — CacheStorage is shared across the whole
      // origin, so a blanket delete would wipe the LI / Tool Inventory caches.
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("vault-app-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // only handle same-origin
  // Embedded apps under /li/ and /inventory/ ship their own service workers —
  // leave their requests alone so we never serve File Vault's shell for them.
  if (url.pathname.includes("/li/") || url.pathname.includes("/inventory/")) return;

  // Network-first for navigations so updates are picked up when online,
  // falling back to the cached shell when offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put("./index.html", copy));
        return res;
      }).catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Cache-first for static assets.
  e.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => cached))
  );
});
