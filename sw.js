/* File Database platform shell service worker — offline shell + toolbox.
   The vault, LI and inventory apps register their own service workers for
   their own folders; this one deliberately skips their paths. */
const CACHE = "platform-shell-v9";
// The shell can't start without these…
const CORE = [
  "./",
  "./index.html",
  "./shell.css",
  "./shell.js",
];
// …while these are nice-to-have offline (the 2.3 MB toolbox page especially
// must not be able to fail the whole install on a flaky connection).
const EXTRAS = [
  "./bridge.js",
  "./debug.js",
  "./viewer.html",
  "./manifest.webmanifest",
  "./toolbox/index.html",
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
    // Prune our own old caches, plus the legacy root File Vault caches
    // ("file-vault-*") left behind by the pre-platform service worker this one
    // replaces. Doing it here (not in the vault's SW) means the legacy cache
    // is only removed once the new root SW has actually taken over — an
    // existing user offline mid-migration keeps a working old shell.
    // Everything else in CacheStorage belongs to the app SWs — leave it alone.
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => (k.startsWith("platform-shell-") && k !== CACHE) || k.startsWith("file-vault-"))
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // The embedded apps ship their own service workers — leave their assets alone.
  if (url.pathname.includes("/vault/") || url.pathname.includes("/li/") || url.pathname.includes("/inventory/")) return;
  if (req.mode === "navigate") {
    // Network-first; each navigation (shell root, toolbox iframe) is cached
    // under its own URL so one can't clobber the other.
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() =>
        caches.match(req, { ignoreSearch: true }).then((m) => m || caches.match(
          url.pathname.includes("/toolbox/") ? "./toolbox/index.html" : "./index.html"
        ))
      )
    );
    return;
  }
  e.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => cached))
  );
});
