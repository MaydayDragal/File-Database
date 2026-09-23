/*
 * db.js — the only code that opens the platform's IndexedDB.
 *
 * Generations (D8): the live database is file-database-<n>; a pointer in
 * localStorage (fdb.generation) names it. Migration and restore write a NEW
 * generation and flip the pointer only once it verifies, so an interrupted
 * run never leaves live data half-written; the superseded generation is
 * deleted once the new one has opened (D2).
 *
 * run(stores, mode, fn) is the commit boundary every repo uses: the promise
 * settles on the transaction's complete/abort, never on a request's success
 * (a later abort — quota — would otherwise be reported as a save). Inside fn,
 * await only IndexedDB requests (api.req): awaiting anything else lets the
 * transaction auto-commit underneath you.
 *
 * Classic <script> (window.FDData.db) and side-effect import from Node
 * (fake-indexeddb, no localStorage → an in-memory pointer). Requires
 * schema.js and bus.js.
 */
(function (global) {
  "use strict";
  var data = global.FDData = global.FDData || {};
  var schema = global.FDSchema;

  var GEN_KEY = "fdb.generation";
  var mem = {};
  function storage() {
    try { if (global.localStorage) return global.localStorage; } catch (e) {}
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); },
      removeItem: function (k) { delete mem[k]; },
    };
  }
  function idb() { return global.indexedDB; }
  function currentName() { try { return storage().getItem(GEN_KEY) || null; } catch (e) { return null; } }
  function setCurrentName(name) { try { if (name) storage().setItem(GEN_KEY, name); else storage().removeItem(GEN_KEY); } catch (e) {} }
  function generationOf(name) { var m = /-(\d+)$/.exec(name || ""); return m ? +m[1] : 0; }
  function firstName() { return schema.NAME_PREFIX + "-1"; }
  function nextName() { return schema.NAME_PREFIX + "-" + (generationOf(currentName()) + 1); }
  function isGeneration(name) { return typeof name === "string" && name.indexOf(schema.NAME_PREFIX + "-") === 0 && generationOf(name) > 0; }

  var conns = {}; // name -> Promise<IDBDatabase>

  function openNamed(name) {
    if (conns[name]) return conns[name];
    conns[name] = new Promise(function (resolve, reject) {
      var req;
      try { req = idb().open(name, schema.VERSION); } catch (e) { delete conns[name]; reject(e); return; }
      req.onupgradeneeded = function (e) {
        try { schema.upgrade(req.result, req.transaction, e.oldVersion); }
        catch (err) { try { req.transaction.abort(); } catch (x) {} }
      };
      req.onsuccess = function () {
        var db = req.result;
        // Another context is upgrading or deleting this generation: let go of
        // it at once (a held connection would block them forever) and tell
        // the page, which reloads onto the new generation.
        db.onversionchange = function () {
          try { db.close(); } catch (e) {}
          if (conns[name]) delete conns[name];
          if (data.bus) data.bus.emit("db:versionchange", { name: name }, { local: true });
        };
        db.onclose = function () { if (conns[name]) delete conns[name]; };
        resolve(db);
      };
      req.onerror = function () {
        delete conns[name];
        var err = req.error || new Error("Could not open " + name);
        // VersionError: the database is NEWER than this code's schema — the
        // page is running an out-of-date copy of the app (a stale offline
        // cache). Every call would fail the same way; boot.js recovers.
        if (err && err.name === "VersionError" && data.bus) data.bus.emit("db:outdated", { name: name, version: schema.VERSION }, { local: true });
        reject(err);
      };
      req.onblocked = function () { if (data.bus) data.bus.emit("db:blocked", { name: name }, { local: true }); };
    });
    return conns[name];
  }
  // The live generation. With no pointer yet (a fresh profile with nothing to
  // migrate — boot() has checked), generation 1 is created and pointed at.
  function open() {
    var name = currentName();
    if (!name) { name = firstName(); setCurrentName(name); }
    return openNamed(name);
  }

  function reqP(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error("request failed")); };
    });
  }

  // One transaction, settled on complete/abort. fn(api) may return a value
  // or a promise of one (built only from api.req(...) awaits); that value is
  // what run() resolves with after the commit. api.abort(err) rolls back and
  // rejects with err.
  function run(stores, mode, fn, name) {
    return (name ? openNamed(name) : open()).then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        try { tx = db.transaction(stores, mode || "readonly"); } catch (e) { reject(e); return; }
        var result, failed = null, settled = false;
        tx.oncomplete = function () { settled = true; if (failed) reject(failed); else resolve(result); };
        tx.onerror = function (ev) { failed = failed || (ev && ev.target && ev.target.error) || tx.error || new Error("transaction error"); };
        tx.onabort = function () { settled = true; reject(failed || tx.error || new Error("transaction aborted")); };
        var api = {
          tx: tx,
          db: db,
          aborted: false,
          store: function (n) { return tx.objectStore(n); },
          req: reqP,
          abort: function (err) { api.aborted = true; failed = failed || err || new Error("aborted"); try { tx.abort(); } catch (e) {} },
        };
        Promise.resolve().then(function () { return fn(api); }).then(function (v) { result = v; }, function (e) {
          if (settled) return;
          failed = failed || e;
          try { tx.abort(); } catch (x) {}
        });
      });
    });
  }

  function close(name) {
    var p = conns[name];
    delete conns[name];
    if (!p) return Promise.resolve();
    return p.then(function (db) { try { db.close(); } catch (e) {} }, function () {});
  }
  function closeAll() { return Promise.all(Object.keys(conns).map(close)); }
  function deleteDatabase(name) {
    return close(name).then(function () {
      return new Promise(function (resolve, reject) {
        var r;
        try { r = idb().deleteDatabase(name); } catch (e) { reject(e); return; }
        r.onsuccess = function () { resolve(true); };
        r.onerror = function () { reject(r.error || new Error("delete failed")); };
        // Blocked = another context still holds it; its versionchange handler
        // closes the connection and success follows.
        r.onblocked = function () { if (data.bus) data.bus.emit("db:delete-blocked", { name: name }, { local: true }); };
      });
    });
  }

  // Does a database exist? Opens WITHOUT a version and aborts any upgrade,
  // so probing never creates the database it asks about (the peek trick the
  // shell badges used). Resolves { exists, version, stores }.
  function probe(name) {
    return new Promise(function (resolve) {
      var req, created = false;
      try { req = idb().open(name); } catch (e) { resolve({ exists: false, version: 0, stores: [] }); return; }
      req.onupgradeneeded = function () { created = true; try { req.transaction.abort(); } catch (e) {} };
      req.onsuccess = function () {
        var db = req.result;
        var info = { exists: !created, version: db.version, stores: Array.prototype.slice.call(db.objectStoreNames) };
        try { db.close(); } catch (e) {}
        resolve(info);
      };
      req.onerror = function () { resolve({ exists: false, version: 0, stores: [] }); };
      req.onblocked = function () { resolve({ exists: true, version: 0, stores: [], blocked: true }); };
    });
  }
  // Read an existing (legacy) database without creating it: fn(db) runs with
  // an open connection, which is closed afterwards.
  function withExisting(name, fn) {
    return new Promise(function (resolve, reject) {
      var req, created = false;
      try { req = idb().open(name); } catch (e) { resolve(null); return; }
      req.onupgradeneeded = function () { created = true; try { req.transaction.abort(); } catch (e) {} };
      req.onsuccess = function () {
        var db = req.result;
        if (created) { try { db.close(); } catch (e) {} resolve(null); return; }
        Promise.resolve().then(function () { return fn(db); }).then(
          function (v) { try { db.close(); } catch (e) {} resolve(v); },
          function (e) { try { db.close(); } catch (x) {} reject(e); });
      };
      req.onerror = function () { resolve(null); };
      req.onblocked = function () { resolve(null); };
    });
  }
  function readAll(name, store) {
    return withExisting(name, function (db) {
      if (!db.objectStoreNames.contains(store)) return [];
      return reqP(db.transaction(store, "readonly").objectStore(store).getAll());
    }).then(function (v) { return v || []; });
  }
  function countIn(name, store) {
    return withExisting(name, function (db) {
      if (!db.objectStoreNames.contains(store)) return 0;
      return reqP(db.transaction(store, "readonly").objectStore(store).count());
    }).then(function (v) { return v || 0; });
  }

  data.db = {
    GEN_KEY: GEN_KEY, VERSION: schema.VERSION, NAME_PREFIX: schema.NAME_PREFIX,
    currentName: currentName, setCurrentName: setCurrentName, generationOf: generationOf, firstName: firstName, nextName: nextName, isGeneration: isGeneration,
    open: open, openNamed: openNamed, run: run, reqP: reqP, close: close, closeAll: closeAll, deleteDatabase: deleteDatabase,
    probe: probe, withExisting: withExisting, readAll: readAll, countIn: countIn,
  };
})(typeof self !== "undefined" ? self : globalThis);
