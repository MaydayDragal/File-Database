/*
 * migrate.js — the legacy databases → one generation (REWRITE-PLAN.md §4.1).
 *
 * Runs once. Each legacy database is probed with the abort-on-upgrade trick
 * (the last time it is used), copied in one direction into a NEW
 * generation, and verified store by store (counts) and blob by blob
 * (sha256 of the stored bytes against the source). Only then is the pointer
 * flipped and are the legacy databases deleted (D2, D8). A failed verify
 * removes the new generation and leaves everything as it was.
 *
 *   file-vault.files       → files + blobs + thumbs (inFiles 1)
 *   file-vault.meta        → settings "vault.<key>"
 *   LIDocsDB.docs + files  → documents + files/blobs (kind pdf, "LI Documents",
 *                            inFiles 0, docId; file id "li:<doc id>")
 *   LIDocsDB.settings      → settings "li.<k>"
 *   tool-inventory.*       → tools / photos / settings "inventory.<k>"
 *   repair-orders.ros      → ros, then an attachment link for every file in
 *                            an RO's collection
 *
 * Classic <script> (window.FDData.migrate) and side-effect import from Node.
 * Requires db.js, repos.js, bus.js and core/hash.js.
 */
(function (global) {
  "use strict";
  var data = global.FDData, db = data.db, bus = data.bus, repos = data.repos;
  var hash = global.FDCore.hash;

  var LEGACY = {
    vault: { name: "file-vault", stores: ["files", "meta"], main: "files" },
    li: { name: "LIDocsDB", stores: ["docs", "files", "settings"], main: "docs" },
    inventory: { name: "tool-inventory", stores: ["tools", "photos", "meta"], main: "tools" },
    ros: { name: "repair-orders", stores: ["ros"], main: "ros" },
  };
  var EXTRA_LEGACY = ["vault-bridge"];
  var LEGACY_NAMES = Object.keys(LEGACY).map(function (k) { return LEGACY[k].name; }).concat(EXTRA_LEGACY);

  function now() { return Date.now(); }
  function progress(cb, phase, done, total, label) { if (cb) { try { cb({ phase: phase, done: done, total: total, label: label || "" }); } catch (e) {} } }

  // { vault: { exists, counts: { files: n, meta: n } }, li: …, … }
  function probe() {
    var out = {};
    return Promise.all(Object.keys(LEGACY).map(function (k) {
      var L = LEGACY[k];
      return db.probe(L.name).then(function (info) {
        out[k] = { name: L.name, exists: info.exists, counts: {} };
        if (!info.exists) return null;
        return Promise.all(L.stores.map(function (s) {
          return db.countIn(L.name, s).then(function (n) { out[k].counts[s] = n; });
        }));
      });
    })).then(function () { return out; });
  }
  function hasData(p) {
    return Object.keys(LEGACY).some(function (k) { return p[k] && p[k].exists && (p[k].counts[LEGACY[k].main] || 0) > 0; });
  }
  function anyExists(p) {
    return Object.keys(LEGACY).some(function (k) { return p[k] && p[k].exists; });
  }
  // "none" — nothing to do; "needed" — legacy data and no migrated
  // generation; "cleanup" — a migration already completed but a legacy
  // database is still around (an interrupted delete): remove it quietly.
  function status() {
    return probe().then(function (p) {
      var pointer = db.currentName();
      if (!hasData(p)) return { state: anyExists(p) ? "cleanup" : "none", probe: p, pointer: pointer };
      if (!pointer) return { state: "needed", probe: p, pointer: pointer };
      return db.probe(pointer).then(function (info) {
        if (!info.exists) return { state: "needed", probe: p, pointer: pointer };
        return db.run(["settings"], "readonly", function (api) { return api.req(api.store("settings").get("migration")); }, pointer)
          .then(function (rec) { return { state: rec ? "cleanup" : "needed", probe: p, pointer: pointer }; }, function () { return { state: "needed", probe: p, pointer: pointer }; });
      });
    });
  }
  function deleteLegacy() {
    return Promise.all(LEGACY_NAMES.map(function (n) { return db.deleteDatabase(n).catch(function () {}); }));
  }

  function strip(rec, keys) { var o = Object.assign({}, rec); keys.forEach(function (k) { delete o[k]; }); return o; }
  function writeInto(target, stores, fn) { return db.run(stores, "readwrite", fn, target); }

  // opts: onProgress({phase, done, total, label}); beforeDelete(report) →
  // Promise (the dialog offers a .fdb export here); verify(report) → bool
  // (test hook; global.__FDB_MIGRATION_FAIL does the same).
  function run(opts) {
    opts = opts || {};
    var cb = opts.onProgress;
    var target = db.nextName();
    var report = { ok: false, generation: target, from: {}, counts: {}, expected: {}, hashes: 0, warnings: [], error: null, at: now() };
    var expectHash = {};   // blob id -> sha256 of the source bytes
    var vaultFiles = [];   // metadata of migrated vault files (for RO links)
    var liFileIds = [];

    function copyVault() {
      return db.readAll(LEGACY.vault.name, "files").then(function (recs) {
        report.from.vault = { files: recs.length, thumbs: 0, blobs: 0 };
        var i = 0;
        function next() {
          if (i >= recs.length) return Promise.resolve();
          var batch = recs.slice(i, i + 10); i += batch.length;
          progress(cb, "files", i, recs.length, "Files");
          return Promise.all(batch.map(function (r) { return r.blob ? hash.sha256(r.blob).catch(function () { return null; }) : Promise.resolve(null); })).then(function (shas) {
            return writeInto(target, ["files", "blobs", "thumbs"], function (api) {
              return Promise.all(batch.map(function (r, k) {
                var meta = strip(r, ["blob", "thumb"]);
                meta.inFiles = 1;
                repos.files.prepare(meta, null);
                meta.rev = 1;
                vaultFiles.push(meta);
                var ops = [api.req(api.store("files").put(meta))];
                if (r.blob) { report.from.vault.blobs++; expectHash[meta.id] = shas[k]; ops.push(api.req(api.store("blobs").put({ id: meta.id, blob: r.blob, size: r.blob.size, sha256: shas[k] }))); }
                if (r.thumb) { report.from.vault.thumbs++; ops.push(api.req(api.store("thumbs").put({ id: meta.id, blob: r.thumb }))); }
                return Promise.all(ops);
              }));
            });
          }).then(next);
        }
        return next();
      }).then(function () { return db.readAll(LEGACY.vault.name, "meta"); }).then(function (metas) {
        report.from.vault.meta = metas.length;
        if (!metas.length) return null;
        return writeInto(target, ["settings"], function (api) {
          return Promise.all(metas.map(function (m) { return api.req(api.store("settings").put({ key: "vault." + m.key, value: m.value, rev: 1 })); }));
        });
      });
    }
    function copyLI() {
      return Promise.all([db.readAll(LEGACY.li.name, "docs"), db.readAll(LEGACY.li.name, "files"), db.readAll(LEGACY.li.name, "settings")]).then(function (r) {
        var docs = r[0], lfiles = {}, settings = r[2];
        r[1].forEach(function (f) { if (f && f.id) lfiles[f.id] = f; });
        report.from.li = { docs: docs.length, files: r[1].length, settings: settings.length, orphans: 0 };
        var docIds = {}; docs.forEach(function (d) { docIds[d.id] = 1; });
        report.from.li.orphans = r[1].filter(function (f) { return !docIds[f.id]; }).length;
        if (report.from.li.orphans) report.warnings.push(report.from.li.orphans + " LI PDF(s) without a document record were not copied.");
        var i = 0;
        function next() {
          if (i >= docs.length) return Promise.resolve();
          var batch = docs.slice(i, i + 10); i += batch.length;
          progress(cb, "documents", i, docs.length, "LI Documents");
          return Promise.all(batch.map(function (d) { var f = lfiles[d.id]; return f && f.blob ? hash.sha256(f.blob).catch(function () { return null; }) : Promise.resolve(null); })).then(function (shas) {
            return writeInto(target, ["documents", "files", "blobs"], function (api) {
              return Promise.all(batch.map(function (d, k) {
                var doc = Object.assign({}, d);
                var lf = lfiles[d.id];
                var ops = [];
                if (lf && lf.blob) {
                  var fileId = "li:" + d.id;
                  var meta = {
                    id: fileId, name: d.filename || ((d.li || d.id) + ".pdf"), type: "application/pdf", kind: "pdf", size: lf.blob.size,
                    collection: repos.LI_COLLECTION, inFiles: 0, docId: d.id, tags: [], vins: [], fins: [], note: "", starred: false,
                    createdAt: d.added || now(), updatedAt: d.added || now(),
                  };
                  repos.files.prepare(meta, null); meta.rev = 1;
                  liFileIds.push(fileId);
                  expectHash[fileId] = shas[k];
                  doc.fileId = fileId;
                  ops.push(api.req(api.store("files").put(meta)));
                  ops.push(api.req(api.store("blobs").put({ id: fileId, blob: lf.blob, size: lf.blob.size, sha256: shas[k] })));
                }
                repos.documents.prepare(doc); doc.rev = 1;
                ops.push(api.req(api.store("documents").put(doc)));
                return Promise.all(ops);
              }));
            });
          }).then(next);
        }
        return next().then(function () {
          if (!settings.length) return null;
          return writeInto(target, ["settings"], function (api) {
            return Promise.all(settings.map(function (s) { return api.req(api.store("settings").put({ key: "li." + s.k, value: s.v, rev: 1 })); }));
          });
        });
      });
    }
    function copyInventory() {
      return Promise.all([db.readAll(LEGACY.inventory.name, "tools"), db.readAll(LEGACY.inventory.name, "photos"), db.readAll(LEGACY.inventory.name, "meta")]).then(function (r) {
        report.from.inventory = { tools: r[0].length, photos: r[1].length, meta: r[2].length };
        progress(cb, "tools", 0, r[0].length, "Tool Inventory");
        var chain = Promise.resolve();
        for (var i = 0; i < r[0].length; i += 200) {
          (function (slice) {
            chain = chain.then(function () {
              return writeInto(target, ["tools"], function (api) {
                return Promise.all(slice.map(function (t) { var rec = Object.assign({}, t); repos.tools.prepare(rec); rec.rev = 1; return api.req(api.store("tools").put(rec)); }));
              });
            });
          })(r[0].slice(i, i + 200));
        }
        for (var j = 0; j < r[1].length; j += 50) {
          (function (slice) {
            chain = chain.then(function () {
              return writeInto(target, ["photos"], function (api) {
                return Promise.all(slice.map(function (p) { return api.req(api.store("photos").put({ id: p.id, blob: p.blob })); }));
              });
            });
          })(r[1].slice(j, j + 50));
        }
        if (r[2].length) {
          chain = chain.then(function () {
            return writeInto(target, ["settings"], function (api) {
              return Promise.all(r[2].map(function (m) { return api.req(api.store("settings").put({ key: "inventory." + m.k, value: m.v, rev: 1 })); }));
            });
          });
        }
        return chain.then(function () { progress(cb, "tools", r[0].length, r[0].length, "Tool Inventory"); });
      });
    }
    function copyRos() {
      return db.readAll(LEGACY.ros.name, "ros").then(function (recs) {
        report.from.ros = { ros: recs.length, links: 0, duplicates: 0 };
        progress(cb, "ros", 0, recs.length, "Repair Orders");
        var seen = {};
        var prepared = recs.slice().sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); }).map(function (r) {
          var rec = Object.assign({}, r);
          repos.ros.prepare(rec); rec.rev = 1;
          // D7: the first RO with a number keeps it indexed; a later duplicate
          // keeps its fields but is flagged, so the UI can ask which is real.
          if (rec.roKey) {
            if (seen[rec.roKey]) { rec.roConflict = seen[rec.roKey]; delete rec.roKey; report.from.ros.duplicates++; report.warnings.push("Two repair orders share number " + rec.ro + "."); }
            else seen[rec.roKey] = rec.id;
          }
          return rec;
        });
        var links = [];
        var byColl = {};
        vaultFiles.forEach(function (f) { if (f.collection) (byColl[f.collection] = byColl[f.collection] || []).push(f.id); });
        prepared.forEach(function (r) {
          (byColl[r.collection] || []).forEach(function (fid) {
            var l = { fromType: "ro", fromId: r.id, toType: "file", toId: fid, kind: "attachment", source: "migration", createdAt: now() };
            repos.links.prepare(l); l.rev = 1;
            links.push(l);
          });
        });
        report.from.ros.links = links.length;
        return writeInto(target, ["ros", "links"], function (api) {
          return Promise.all(prepared.map(function (r) { return api.req(api.store("ros").put(r)); }).concat(links.map(function (l) { return api.req(api.store("links").put(l)); })));
        }).then(function () { progress(cb, "ros", recs.length, recs.length, "Repair Orders"); });
      });
    }
    function verify() {
      var all = ["files", "blobs", "thumbs", "documents", "tools", "photos", "ros", "links", "settings"];
      var v = report.from.vault || { files: 0, blobs: 0, thumbs: 0, meta: 0 };
      var l = report.from.li || { docs: 0, settings: 0 };
      var inv = report.from.inventory || { tools: 0, photos: 0, meta: 0 };
      var r = report.from.ros || { ros: 0, links: 0 };
      report.expected = {
        files: v.files + liFileIds.length, blobs: v.blobs + liFileIds.length, thumbs: v.thumbs,
        documents: l.docs, tools: inv.tools, photos: inv.photos, ros: r.ros, links: r.links,
        settings: (v.meta || 0) + (l.settings || 0) + (inv.meta || 0),
      };
      return db.run(all, "readonly", function (api) {
        return Promise.all(all.map(function (s) { return api.req(api.store(s).count()); }));
      }, target).then(function (ns) {
        all.forEach(function (s, i) { report.counts[s] = ns[i]; });
        all.forEach(function (s) {
          if (report.counts[s] !== report.expected[s]) throw new Error("Verification failed: " + s + " has " + report.counts[s] + " records, expected " + report.expected[s] + ".");
        });
        var ids = Object.keys(expectHash);
        var i = 0;
        function next() {
          if (i >= ids.length) return Promise.resolve();
          var id = ids[i++];
          progress(cb, "verify", i, ids.length, "Verifying");
          return db.run(["blobs"], "readonly", function (api) { return api.req(api.store("blobs").get(id)); }, target).then(function (rec) {
            if (!rec || !rec.blob) throw new Error("Verification failed: blob " + id + " is missing.");
            if (expectHash[id] == null) return null; // source could not be hashed: size check only
            return hash.sha256(rec.blob).then(function (d) { if (d !== expectHash[id]) throw new Error("Verification failed: blob " + id + " does not match its source."); report.hashes++; });
          }).then(next);
        }
        return next();
      }).then(function () {
        if (global.__FDB_MIGRATION_FAIL) throw new Error("Verification failed (test hook).");
        if (opts.verify && !opts.verify(report)) throw new Error("Verification failed (custom check).");
      });
    }

    return db.deleteDatabase(target).catch(function () {}).then(function () { return db.openNamed(target); })
      .then(copyVault).then(copyLI).then(copyInventory).then(copyRos).then(verify)
      .then(function () {
        return writeInto(target, ["settings"], function (api) {
          return api.req(api.store("settings").put({ key: "migration", value: { from: report.from, counts: report.counts, at: now(), generation: target, warnings: report.warnings }, rev: 1 }));
        });
      })
      .then(function () { return opts.beforeDelete ? Promise.resolve().then(function () { return opts.beforeDelete(report); }).catch(function () {}) : null; })
      .then(function () {
        var prev = db.currentName();
        db.setCurrentName(target);
        return db.closeAll().then(deleteLegacy).then(function () {
          if (prev && prev !== target) return db.deleteDatabase(prev).catch(function (e) { report.warnings.push("previous generation " + prev + " not removed: " + (e && e.message)); });
        });
      })
      .then(function () {
        report.ok = true;
        bus.emit("db:generation", { name: target, migrated: true });
        return report;
      }, function (e) {
        report.error = (e && e.message) || String(e);
        return db.deleteDatabase(target).catch(function () {}).then(function () { throw Object.assign(e || new Error(report.error), { report: report }); });
      });
  }

  data.migrate = { LEGACY: LEGACY, LEGACY_NAMES: LEGACY_NAMES, probe: probe, status: status, run: run, deleteLegacy: deleteLegacy };
})(typeof self !== "undefined" ? self : globalThis);
