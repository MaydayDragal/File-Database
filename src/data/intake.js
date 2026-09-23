/*
 * intake.js — the one front door for files (REWRITE-PLAN.md §3.2).
 *
 * ingest(target, files, opts) reads each file's bytes NOW (a dropped File is
 * a lazy handle — a OneDrive placeholder or a locked file can read as
 * garbage later), stores them through repos.files.ingest() and queues the
 * follow-up work as jobs the owning app runs:
 *   "vault"   → a Files record (inFiles 1) + "thumb" and "vin-detect" jobs;
 *               with opts.roId, an attachment link to that repair order
 *   "li"      → a hidden PDF record (inFiles 0, "LI Documents") + "li-import"
 *   "toolbox" → a transient record (inFiles 0) + "toolbox-intake" {tab}
 * It resolves with per-file results: a file that failed to read or store is
 * never reported as delivered (the old mailbox acknowledged LI batches that
 * had failures).
 *
 * Exact duplicates (Phase 5): for "vault", when opts.reviewDuplicates is
 * given, every file whose bytes are already stored (blobs.sha256) is put to
 * it BEFORE anything is written — reviewDuplicates([{ index, name, sha256,
 * matches }]) resolves one decision per entry, { index, action: "reuse" |
 * "keep" | "skip", reuse?: fileId }. "reuse" stores a new record sharing
 * the bytes, "keep" stores a second copy, "skip" stores nothing (reported
 * as { skipped: true, duplicateOf }) — and when the stored file standing
 * for it is in the trash, takes it out: adding the file again means it is
 * wanted. Without a reviewer both are kept: nothing is ever dropped on a
 * match.
 *
 * Classic <script> (window.FDData.intake) and side-effect import from Node.
 * Requires repos.js, jobs.js and src/core/ids.js.
 */
(function (global) {
  "use strict";
  var data = global.FDData, repos = data.repos, jobs = data.jobs;
  var core = global.FDCore;

  var MATERIALIZE_MAX = 256 * 1024 * 1024; // beyond this, keep the handle (memory)
  var THUMB_KINDS = { image: 1, video: 1, pdf: 1 };
  var VIN_SKIP_KIND = { video: 1 };

  function isPdf(f) { return /pdf/i.test((f && f.type) || "") || /\.pdf$/i.test((f && f.name) || ""); }
  // The platform's routing rule: a PDF whose name carries a Mercedes
  // document number is an LI document; everything else is a file.
  function looksLikeLI(f) { return isPdf(f) && core && core.ids && core.ids.hasLiNumber(f.name || ""); }
  // Where a dropped file goes. The platform's own database files open in
  // their app instead of being stored as opaque blobs.
  function classifyTarget(f) {
    var n = String((f && f.name) || "").toLowerCase();
    if (/\.tidb$/.test(n)) return "inventory-import";
    if (/\.fvault$/.test(n)) return "vault-restore";
    if (/\.lidb$/.test(n)) return "li-restore";
    if (/\.fdb$/.test(n)) return "platform-restore";
    return looksLikeLI(f) ? "li" : "vault";
  }
  function materialize(f) {
    if (!f) return Promise.reject(new Error("no file"));
    if (f.size > MATERIALIZE_MAX) return Promise.resolve(f);
    return f.arrayBuffer().then(function (buf) {
      if (f.size && !buf.byteLength) throw new Error("empty read");
      return new Blob([buf], { type: f.type || "application/octet-stream" });
    });
  }
  function metaFor(target, f, opts) {
    var m = Object.assign({}, opts.meta || {});
    if (target === "vault") {
      m.inFiles = 1;
      if (opts.collection) m.collection = opts.collection;
      if (opts.vin) m.vins = Array.from(new Set([String(opts.vin).toUpperCase()].concat(m.vins || [])));
    } else if (target === "li") {
      m.inFiles = 0; m.collection = repos.LI_COLLECTION; m.kind = "pdf";
    } else if (target === "toolbox") {
      m.inFiles = 0; m.transient = 1; m.collection = "";
    }
    return m;
  }

  function ingest(target, list, opts) {
    opts = opts || {};
    var files = Array.prototype.slice.call(list || []).filter(Boolean);
    var entries = [], results = [];
    var chain = Promise.resolve();
    files.forEach(function (f) {
      chain = chain.then(function () {
        return materialize(f).then(function (blob) {
          entries.push({ blob: blob, name: f.name || "Untitled", type: f.type || blob.type || "application/octet-stream", meta: metaFor(target, f, opts) });
        }, function (e) {
          results.push({ name: f.name || "Untitled", id: null, ok: false, error: "read: " + ((e && e.message) || e) });
        });
      });
    });
    return chain.then(function () {
      if (target !== "vault" || typeof opts.reviewDuplicates !== "function" || !entries.length) return null;
      return reviewDuplicates(entries, opts.reviewDuplicates, results);
    }).then(function () {
      entries = entries.filter(function (en) { return !en.skip; });
      return repos.files.ingest(entries, { verify: opts.verify !== false });
    }).then(function (stored) {
      results = results.concat(stored);
      var ok = stored.filter(function (r) { return r.ok; });
      var ids = ok.map(function (r) { return r.id; });
      var queued = [];
      var after = Promise.resolve();
      if (!ids.length && !(opts.roId && results.some(function (r) { return r.skipped && r.duplicateOf; }))) return { results: results, ids: ids, jobs: queued };
      if (target === "vault") {
        var thumbIds = ok.filter(function (r) { return THUMB_KINDS[r.kind]; }).map(function (r) { return r.id; });
        var vinIds = ok.filter(function (r) { return !VIN_SKIP_KIND[r.kind]; }).map(function (r) { return r.id; });
        if (opts.roId) {
          // A duplicate the reviewer skipped is attached as the file already
          // stored: the repair order still gets the evidence, once.
          var onRo = ids.concat(results.filter(function (r) { return r.skipped && r.duplicateOf; }).map(function (r) { return r.duplicateOf; }));
          after = after.then(function () {
            return repos.links.linkMany(onRo.map(function (id) { return { fromType: "ro", fromId: opts.roId, toType: "file", toId: id, kind: "attachment", source: opts.source || "user" }; }));
          });
        }
        if (thumbIds.length) after = after.then(function () { return jobs.enqueue("thumb", thumbIds).then(function (j) { queued.push({ id: j.id, type: "thumb" }); }); });
        if (vinIds.length && opts.vinDetect !== false) after = after.then(function () { return jobs.enqueue("vin-detect", vinIds, { quiet: vinIds.length > 3 }).then(function (j) { queued.push({ id: j.id, type: "vin-detect" }); }); });
      } else if (target === "li") {
        after = after.then(function () { return jobs.enqueue("li-import", ids, { source: opts.source || "intake" }).then(function (j) { queued.push({ id: j.id, type: "li-import" }); }); });
      } else if (target === "toolbox") {
        after = after.then(function () { return jobs.enqueue("toolbox-intake", ids, { tab: opts.tab || null }).then(function (j) { queued.push({ id: j.id, type: "toolbox-intake" }); }); });
      }
      return after.then(function () { return { results: results, ids: ids, jobs: queued }; });
    });
  }

  // Ask the reviewer about entries whose bytes are already stored and apply
  // its decisions to the entries (reuse → entry.reuse, skip → entry.skip).
  function reviewDuplicates(entries, reviewer, results) {
    return repos.files.findDuplicates(entries.map(function (en) { return en.blob; })).then(function (dups) {
      if (!dups.length) return null;
      var asked = dups.map(function (d) {
        var en = entries[d.index];
        en.sha256 = d.sha256;
        return {
          index: d.index, name: en.name, size: en.blob.size, sha256: d.sha256,
          matches: d.matches.map(function (m) { return { id: m.id, name: m.name, collection: m.collection || "", inFiles: m.inFiles, deletedAt: m.deletedAt || 0, docId: m.docId || null }; }),
        };
      });
      var revive = [];
      return Promise.resolve(reviewer(asked)).then(function (decisions) {
        (decisions || []).forEach(function (dec) {
          var en = dec && entries[dec.index];
          var d = dec && asked.filter(function (a) { return a.index === dec.index; })[0];
          if (!en || !d) return;
          var named = dec.reuse && d.matches.some(function (m) { return m.id === dec.reuse; }) ? dec.reuse : null;
          if (dec.action === "skip") {
            en.skip = true;
            // duplicateOf: the stored record that stands for it (the one the
            // reviewer named, else the first match).
            var stand = named || (d.matches.filter(function (m) { return !m.deletedAt; })[0] || d.matches[0] || {}).id;
            var sm = d.matches.filter(function (m) { return m.id === stand; })[0];
            if (sm && sm.deletedAt) revive.push(stand);
            results.push({ name: en.name, id: null, ok: false, skipped: true, duplicateOf: stand || null, restored: !!(sm && sm.deletedAt), error: "already stored" });
          } else if (dec.action === "reuse") {
            var target = named || (d.matches[0] && d.matches[0].id);
            if (target) en.reuse = target;
          }
        });
        return revive.length ? repos.files.restore(revive) : null;
      });
    });
  }

  data.intake = { MATERIALIZE_MAX: MATERIALIZE_MAX, THUMB_KINDS: THUMB_KINDS, VIN_SKIP_KIND: VIN_SKIP_KIND, isPdf: isPdf, looksLikeLI: looksLikeLI, classifyTarget: classifyTarget, materialize: materialize, ingest: ingest };
})(typeof self !== "undefined" ? self : globalThis);
