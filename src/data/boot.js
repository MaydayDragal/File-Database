/*
 * boot.js — FDData.boot(): the one call every page makes before touching
 * the database. It decides, under a cross-tab lock, whether the legacy
 * databases still need migrating (then runs the migration — with the dialog
 * from src/ui/migrate-dialog.js when the page has one — before anything
 * opens the live generation), cleans up leftovers, opens the database,
 * requeues jobs a dead page left running, and reloads the page when
 * another tab replaces the live generation.
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
  function wireReload() {
    if (reloadWired) return;
    reloadWired = true;
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
