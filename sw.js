/* File Database — the one service worker (REWRITE-PLAN.md Phase 4, §3.5).
   One page, one cache, one precache list: everything the platform needs to
   open and run with no network. User data lives in IndexedDB and never
   touches this cache. `tools/sw-manifest.mjs --check` verifies the list is
   complete against the tree. */
const CACHE = "file-database-v4";
// The text-recognition engine the scanners download on first use.
const RUNTIME_CACHE = "platform-runtime-v1";
// Hosts that engine comes from (see src/services/ocr.js). Their files are
// versioned and immutable, so cache-first is safe.
const RUNTIME_HOSTS = ["cdn.jsdelivr.net", "tessdata.projectnaptha.com"];
// The page can't start without these…
const CORE = [
  "./",
  "./index.html",
  "./src/styles/tokens.css",
  "./src/styles/shell.css",
  "./src/main.js",
  "./src/shell/index.js",
  "./src/features/index.js",
  "./src/features/mount.js",
  "./src/shell/vehicle.js",
  "./src/ui/duplicates.js",
];
// …while these are cached tolerantly: a single hiccup (a proxy blip, one
// unreachable icon) must never fail the whole install and strand the user on
// a stale, un-updatable worker. Everything is fetched on use anyway.
const EXTRAS = [
  "./src/core/formats/container.js",
  "./src/core/formats/fdb.js",
  "./src/core/formats/fvault.js",
  "./src/core/formats/lidb.js",
  "./src/core/formats/tidb.js",
  "./src/core/formats/zip.js",
  "./src/core/hash.js",
  "./src/core/ids.js",
  "./src/core/index.js",
  "./src/core/li-parse.js",
  "./src/core/ro-parse.js",
  "./src/core/text.js",
  "./src/core/vin.js",
  "./src/data/backup.js",
  "./src/data/boot.js",
  "./src/data/bus.js",
  "./src/data/db.js",
  "./src/data/index.js",
  "./src/data/intake.js",
  "./src/data/jobs.js",
  "./src/data/migrate.js",
  "./src/data/repos.js",
  "./src/data/schema.js",
  "./src/features/documents/app.js",
  "./src/features/documents/index.js",
  "./src/features/documents/markup.js",
  "./src/features/documents/search.js",
  "./src/features/documents/styles.css",
  "./src/features/extract/app.js",
  "./src/features/extract/index.js",
  "./src/features/extract/markup.js",
  "./src/features/extract/styles.css",
  "./src/features/files/app.js",
  "./src/features/files/blob-integrity.js",
  "./src/features/files/db.js",
  "./src/features/files/index.js",
  "./src/features/files/markup.js",
  "./src/features/files/search.js",
  "./src/features/files/styles.css",
  "./src/features/inventory/app.js",
  "./src/features/inventory/index.js",
  "./src/features/inventory/markup.js",
  "./src/features/inventory/search.js",
  "./src/features/inventory/styles.css",
  "./src/features/ros/app.js",
  "./src/features/ros/index.js",
  "./src/features/ros/markup.js",
  "./src/features/ros/search.js",
  "./src/features/ros/styles.css",
  "./src/features/search-util.js",
  "./src/features/toolbox/app.js",
  "./src/features/toolbox/index.js",
  "./src/features/toolbox/markup.js",
  "./src/features/toolbox/styles.css",
  "./src/features/toolbox/tools/calc.js",
  "./src/features/toolbox/tools/convert.js",
  "./src/features/toolbox/tools/csv.js",
  "./src/features/toolbox/tools/elec.js",
  "./src/features/toolbox/tools/img.js",
  "./src/features/toolbox/tools/media.js",
  "./src/features/toolbox/tools/ocr.js",
  "./src/features/toolbox/tools/pdf.js",
  "./src/features/toolbox/tools/text.js",
  "./src/features/toolbox/tools/zip.js",
  "./src/services/folder-sync.js",
  "./src/services/index.js",
  "./src/services/ocr.js",
  "./src/services/pdf.js",
  "./src/services/thumbs.js",
  "./src/services/vendor.js",
  "./src/ui/migrate-dialog.js",
  "./debug.js",
  "./ocr.js",
  "./vendor/jszip.min.js",
  "./vendor/pdf-lib.min.js",
  "./vendor/pdf.min.js",
  "./vendor/pdf.worker.min.js",
  "./viewer.html",
  "./viewer.js",
  "./manifest.webmanifest",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-64.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

// Every file is fetched from the SERVER on install ({cache: "reload"}),
// never from the browser's HTTP cache: a host that lets browsers reuse files
// for a while (GitHub Pages: max-age=600) would otherwise hand a new worker
// yesterday's copy of one file beside today's copy of another, and cache-first
// would serve that mixed app until the next release.
const fresh = (u) => new Request(u, { cache: "reload" });
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(CORE.map(fresh)).then(() => Promise.all(EXTRAS.map((u) => c.add(fresh(u)).catch(() => {})))))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    // Prune our own old caches and everything the pre-Phase-4 workers left
    // behind: the platform shell's, the standalone Vault's, LI's and the
    // Inventory's. (Their registrations at /vault/, /li/ and /inventory/ are
    // harmless — those pages are gone, D1.)
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k !== CACHE && k !== RUNTIME_CACHE)
        .filter((k) => /^(file-database-|platform-shell-|file-vault-|vault-app-|li-db-|tool-inventory-)/.test(k))
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Keep the OCR engine once it has been fetched, so scanning keeps working
  // with no connection. An opaque cross-origin response can't be inspected,
  // so cache it but revalidate in the background — a bad one that slipped in
  // can never stick.
  if (RUNTIME_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req).then((res) => {
          if (res && (res.ok || res.type === "opaque")) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        });
        if (hit) { net.catch(() => {}); return hit; }
        return net;
      })
    );
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    // Network-first; the page is cached under its own URL so a reload offline
    // still opens (the hash route is client-side).
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() =>
        caches.match(req, { ignoreSearch: true }).then((m) => m || caches.match(
          url.pathname.endsWith("/viewer.html") ? "./viewer.html" : "./index.html"
        ))
      )
    );
    return;
  }
  // A file this worker doesn't hold yet is revalidated with the server
  // ({cache: "no-cache"}, a cheap 304 when unchanged) before it is cached.
  e.respondWith(
    caches.match(req).then((cached) => cached || fetch(new Request(req, { cache: "no-cache" })).then((res) => {
      if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => cached))
  );
});
