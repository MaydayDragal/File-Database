/*
 * backup.js — one backup of everything, and restore into a new generation.
 *
 * collect() reads every store — records and the payload stores (blobs,
 * thumbs, photos) — in ONE read-only transaction (a consistent snapshot by
 * IndexedDB's own rules; the Blobs are handles, not copies) and hands it to
 * formats/fdb.js. Because blobs are immutable there is no write pause. Settings whose values are not JSON (folder handles) are skipped
 * and listed in the manifest.
 *
 * restore(file) parses the whole .fdb first (nothing is written for an
 * invalid file), writes it into a NEW generation, verifies counts and every
 * blob's sha256, and only then flips the pointer and deletes the old
 * generation (D8, D2). A failure leaves the live data untouched.
 *
 * Classic <script> (window.FDData.backup) and side-effect import from Node.
 * Requires db.js, repos.js, bus.js, formats/container.js, formats/fdb.js
 * and core/hash.js.
 */
(function (global) {
  "use strict";
  var data = global.FDData, db = data.db, bus = data.bus, repos = data.repos;
  var fdb = global.FDCore.formats.fdb, hash = global.FDCore.hash;

  var RECORD_STORES = fdb.RECORD_STORES;   // files, documents, tools, ros, links, vehicles, settings
  var PAYLOAD_STORES = fdb.PAYLOAD_STORES; // blobs, thumbs, photos
  var BATCH = 100;

  // Plain data only: null, booleans, numbers, strings, arrays and plain
  // objects of the same. A FileSystemHandle is cloneable and stringifies to
  // "{}", so a JSON.stringify check would smuggle an empty object into the
  // backup where a handle used to be.
  function isPlainData(v, depth) {
    depth = depth || 0;
    if (depth > 32) return false;
    if (v === null || typeof v === "boolean" || typeof v === "string") return true;
    if (typeof v === "number") return isFinite(v);
    if (Array.isArray(v)) return v.every(function (x) { return isPlainData(x, depth + 1); });
    if (typeof v === "object") {
      var proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) return false;
      return Object.keys(v).every(function (k) { return isPlainData(v[k], depth + 1); });
    }
    return false;
  }
  function progress(cb, phase, done, total, label) { if (cb) { try { cb({ phase: phase, done: done, total: total, label: label || "" }); } catch (e) {} } }

  // Resolves with the .fdb Blob. opts.generation names a database other
  // than the live one (the migration dialog exports the new generation
  // before the old databases are removed).
  function collect(opts) {
    opts = opts || {};
    var name = opts.generation || db.currentName();
    var meta = { exportedAt: Date.now(), generation: name, records: {}, payloads: [], skippedSettings: [] };
    var payloadBlobs = [];
    var all = RECORD_STORES.concat(PAYLOAD_STORES);
    // ONE read-only transaction over every store: records and payloads come
    // from the same snapshot, so a file deleted or added by another tab
    // while the backup is read can never leave a record without its bytes
    // (or bytes without a record) in the file.
    return db.run(all, "readonly", function (api) {
      return Promise.all(all.map(function (s) { return api.req(api.store(s).getAll()); }));
    }, name).then(function (lists) {
      RECORD_STORES.forEach(function (s, i) { meta.records[s] = lists[i]; });
      meta.records.settings = meta.records.settings.filter(function (r) {
        if (isPlainData(r.value)) return true;
        meta.skippedSettings.push(r.key); return false;
      });
      progress(opts.onProgress, "records", 1, 1);
      PAYLOAD_STORES.forEach(function (s, i) {
        lists[RECORD_STORES.length + i].forEach(function (r) {
          if (!r || !r.blob) return;
          meta.payloads.push({ store: s, id: r.id, len: r.blob.size, type: r.blob.type || "application/octet-stream", sha256: r.sha256 || null });
          payloadBlobs.push(r.blob);
        });
      });
      progress(opts.onProgress, "payloads", payloadBlobs.length, payloadBlobs.length);
      var blob = fdb.build(meta, payloadBlobs);
      return { blob: blob, meta: meta };
    });
  }
  function fileName(prefix) {
    var stamp = new Date().toISOString().slice(0, 10);
    return (prefix || "file-database") + "-" + stamp + ".fdb";
  }

  function writeBatches(name, store, recs, onEach) {
    var chain = Promise.resolve();
    for (var i = 0; i < recs.length; i += BATCH) {
      (function (slice) {
        chain = chain.then(function () {
          return db.run([store], "readwrite", function (api) {
            return Promise.all(slice.map(function (r) { return api.req(api.store(store).put(r)); }));
          }, name).then(function () { if (onEach) onEach(slice.length); });
        });
      })(recs.slice(i, i + BATCH));
    }
    return chain;
  }
  function countsOf(name) {
    var all = RECORD_STORES.concat(PAYLOAD_STORES);
    return db.run(all, "readonly", function (api) {
      return Promise.all(all.map(function (s) { return api.req(api.store(s).count()); }));
    }, name).then(function (ns) { var out = {}; all.forEach(function (s, i) { out[s] = ns[i]; }); return out; });
  }

  // Restore a .fdb into a new generation. Resolves the report; rejects (with
  // the live generation untouched) on an invalid file or a failed verify.
  function restore(file, opts) {
    opts = opts || {};
    var report = { ok: false, generation: null, previous: db.currentName(), counts: {}, expected: {}, warnings: [], error: null };
    var target = db.nextName();
    var parsed;
    return fdb.parse(file).then(function (p) {
      parsed = p;
      report.generation = target;
      return db.deleteDatabase(target).catch(function () {});
    }).then(function () { return db.openNamed(target); }).then(function () {
      var total = 0;
      RECORD_STORES.forEach(function (s) { total += (parsed.meta.records[s] || []).length; });
      total += parsed.payloads.length;
      var done = 0;
      var chain = Promise.resolve();
      RECORD_STORES.forEach(function (s) {
        var recs = parsed.meta.records[s] || [];
        report.expected[s] = recs.length;
        chain = chain.then(function () { return writeBatches(target, s, recs, function (n) { done += n; progress(opts.onProgress, "write", done, total, s); }); });
      });
      var byStore = {};
      parsed.payloads.forEach(function (p) { (byStore[p.store] = byStore[p.store] || []).push(p); });
      PAYLOAD_STORES.forEach(function (s) {
        var list = byStore[s] || [];
        report.expected[s] = list.length;
        // Payloads go a few per transaction: each is a slice of the backup
        // file that the browser reads while committing.
        for (var i = 0; i < list.length; i += 10) {
          (function (slice) {
            chain = chain.then(function () {
              return db.run([s], "readwrite", function (api) {
                return Promise.all(slice.map(function (p) {
                  var rec = { id: p.id, blob: p.blob };
                  if (s === "blobs") { rec.size = p.len; rec.sha256 = p.sha256 || null; }
                  return api.req(api.store(s).put(rec));
                }));
              }, target).then(function () { done += slice.length; progress(opts.onProgress, "write", done, total, s); });
            });
          })(list.slice(i, i + 10));
        }
      });
      return chain;
    }).then(function () {
      // Verify: counts store by store, then every blob's bytes against the
      // manifest's sha256 (thumbnails and photos carry no hash: size only).
      return countsOf(target).then(function (counts) {
        report.counts = counts;
        Object.keys(report.expected).forEach(function (s) {
          if (counts[s] !== report.expected[s]) throw new Error("Verification failed: " + s + " has " + counts[s] + " records, expected " + report.expected[s] + ".");
        });
        // Every file record must have its bytes in the backup.
        var have = {};
        parsed.payloads.forEach(function (p) { if (p.store === "blobs") have[p.id] = true; });
        // (A record that reuses another's bytes names them with blobId.)
        var missing = (parsed.meta.records.files || []).filter(function (f) { return !have[f.blobId || f.id]; });
        if (missing.length) throw new Error("Verification failed: " + missing.length + " file record(s) have no bytes in the backup (" + missing[0].name + ").");
        var hashed = parsed.payloads.filter(function (p) { return p.store === "blobs" && p.sha256; });
        var i = 0;
        function next() {
          if (i >= hashed.length) return Promise.resolve();
          var p = hashed[i++];
          progress(opts.onProgress, "verify", i, hashed.length, p.id);
          return db.run(["blobs"], "readonly", function (api) { return api.req(api.store("blobs").get(p.id)); }, target).then(function (rec) {
            if (!rec || !rec.blob || rec.blob.size !== p.len) throw new Error("Verification failed: blob " + p.id + " is missing or the wrong size.");
            return hash.sha256(rec.blob).then(function (d) { if (d !== p.sha256) throw new Error("Verification failed: blob " + p.id + " does not match its hash."); });
          }).then(next);
        }
        return next();
      });
    }).then(function () {
      if (global.__FDB_RESTORE_FAIL) throw new Error("Verification failed (test hook).");
      return db.run(["settings"], "readwrite", function (api) {
        return api.req(api.store("settings").put({ key: "backup.restored", value: { at: Date.now(), exportedAt: parsed.meta.exportedAt || 0, from: parsed.meta.generation || null }, rev: 1 }));
      }, target);
    }).then(function () {
      // Activate: pointer first, then the superseded generation goes.
      var prev = db.currentName();
      db.setCurrentName(target);
      return db.closeAll().then(function () {
        if (prev && prev !== target) return db.deleteDatabase(prev).catch(function (e) { report.warnings.push("old generation " + prev + " not removed: " + (e && e.message)); });
      });
    }).then(function () {
      report.ok = true;
      bus.emit("db:generation", { name: target, previous: report.previous });
      return report;
    }, function (e) {
      report.error = (e && e.message) || String(e);
      return db.deleteDatabase(target).catch(function () {}).then(function () { throw Object.assign(e || new Error(report.error), { report: report }); });
    });
  }

  data.backup = { RECORD_STORES: RECORD_STORES, PAYLOAD_STORES: PAYLOAD_STORES, collect: collect, restore: restore, fileName: fileName, countsOf: countsOf };
})(typeof self !== "undefined" ? self : globalThis);
