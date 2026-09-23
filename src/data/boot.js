/*
 * boot.js — FDData.boot(): the one call every page makes before touching
 * the database. It decides, under a cross-tab lock, whether the legacy
 * databases still need migrating (then runs the migration — with the dialog
 * from src/ui/migrate-dialog.js when the page has one — before anything
 * opens the live generation), cleans up leftovers, opens the database,
 * requeues jobs a dead page left running, and reloads the page when
 * another tab replaces the live generation — or when this page's code turns
 * out to be older than the database (a stale offline copy of the app), after
 * clearing the offline cache so the reload fetches the current code.
 *
 * Classic <script> (window.FDData.boot) and side-effect import from Node.
 * Requires db.js, bus.js, repos.js, jobs.js and migrate.js.
 */
(function (global) {
  "use strict";
  var data = global.FDData, db = data.db, bus = data.bus, migrate = data.migrate, jobs = data.jobs;
  var booted = null;
  var reloadWired = false;

  function withLock(name, fn) {
    var locks = null;
    try { locks = global.navigator && global.navigator.locks; } catch (e) {}
    if (locks && locks.request) return locks.request(name, fn);
    return fn();
  }
  // The page's code is older than the database it found (VersionError): a
  // stale offline copy is running. Drop the service worker's app cache, ask
  // for the latest worker, and reload once — so the reload fetches current
  // code. At most once a minute per tab: if the reload still finds old code
  // (the server itself serves it), the error is reported instead of looping.
  var RECOVER_KEY = "fdb.outdatedReload";
  function recoverOutdated() {
    var loc = global.location;
    if (!loc || typeof loc.reload !== "function") return false;
    var ss = null;
    try { ss = global.sessionStorage; } catch (e) {}
    try {
      var last = ss ? +(ss.getItem(RECOVER_KEY) || 0) : 0;
      if (last && Date.now() - last < 60000) return false;
      if (ss) ss.setItem(RECOVER_KEY, String(Date.now()));
    } catch (e) {}
    var cs = null;
    try { cs = global.caches; } catch (e) {}
    var clear = cs && cs.keys ? cs.keys().then(function (ks) {
      return Promise.all(ks.filter(function (k) { return /^file-database-/.test(k); }).map(function (k) { return cs.delete(k); }));
    }).catch(function () {}) : Promise.resolve();
    var sw = null;
    try { sw = global.navigator && global.navigator.serviceWorker; } catch (e) {}
    var update = sw && sw.getRegistration ? sw.getRegistration().then(function (r) { return r && r.update(); }).catch(function () {}) : Promise.resolve();
    data.outdatedRecovering = true;
    Promise.all([clear, update]).then(function () { try { loc.reload(); } catch (e) {} });
    return true;
  }
  data.recoverOutdated = recoverOutdated;

  function wireReload() {
    if (reloadWired) return;
    reloadWired = true;
    bus.on("db:outdated", function () { recoverOutdated(); });
    // Our connection was closed because another context is upgrading or
    // deleting that generation: reload onto whatever is live now. (The
    // context doing a restore closes its own connections first, so it never
    // reloads itself mid-dialog.)
    bus.on("db:versionchange", function () {
      if (global.location && typeof global.location.reload === "function") {
        try { data.onGenerationReplaced && data.onGenerationReplaced(); } catch (e) {}
        setTimeout(function () { try { global.location.reload(); } catch (e) {} }, 50);
      }
    });
  }

  // opts.ui: false → migrate without a dialog (tests, headless);
  // opts.dialog: a function(status) → Promise that runs the migration with
  // its own UI (the default is FDData.ui.migrateDialog when loaded).
  function boot(opts) {
    if (booted) return booted;
    opts = opts || {};
    wireReload();
    booted = withLock("fdb-boot", function () {
      return migrate.status().then(function (st) {
        if (st.state === "cleanup") return migrate.deleteLegacy().catch(function () {});
        if (st.state !== "needed") return null;
        var dialog = opts.dialog || (opts.ui !== false && data.ui && data.ui.migrateDialog ? data.ui.migrateDialog : null);
        if (dialog) return dialog(st);
        return migrate.run({ onProgress: opts.onProgress });
      });
    }).then(function () { return db.open(); }).then(function (conn) {
      return jobs.requeueStale().catch(function () {}).then(function () { return conn; });
    });
    booted.catch(function () { booted = null; });
    return booted;
  }
  function reset() { booted = null; }

  data.boot = boot;
  data.bootReset = reset;
})(typeof self !== "undefined" ? self : globalThis);
