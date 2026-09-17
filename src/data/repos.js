/*
 * repos.js — the typed front doors to every store (REWRITE-PLAN.md §4).
 *
 * A repo exposes the same verbs everywhere — get/getMany/list/listBy/count/
 * each/put/putMany/remove/removeMany/clear — and enforces the rules no
 * feature has to remember: every write bumps `rev`; a write that passes
 * `expectedRev` is refused (RevConflict, carrying the current record) when
 * someone else wrote first; commit is the transaction's completion; and
 * after each commit the bus announces "<store>:changed" with the ids.
 *
 * files/blobs/thumbs are kept apart so a list never reads file bytes:
 * blobs are immutable and carry their sha256 (content-addressed); getFull()
 * joins the three for a detail view, putFull() splits a record that arrives
 * with `blob`/`thumb` attached. documents own their PDF as a `files` record
 * (inFiles 0 until copied to the Files app). ros has the unique RO number
 * (D7, RoConflict). links is the typed relation store (D9).
 *
 * Classic <script> (window.FDData.repos) and side-effect import from Node.
 * Requires db.js, bus.js and src/core/hash.js.
 */
(function (global) {
  "use strict";
  var data = global.FDData;
  var db = data.db, bus = data.bus;
  var hash = global.FDCore && global.FDCore.hash;

  var LI_COLLECTION = "LI Documents";

  function RevConflict(current) { this.name = "RevConflict"; this.message = "The record was changed by someone else."; this.current = current || null; }
  RevConflict.prototype = Object.create(Error.prototype); RevConflict.prototype.constructor = RevConflict;
  function RoConflict(other) { this.name = "RoConflict"; this.message = "That RO number is already used by another repair order."; this.other = other || null; }
  RoConflict.prototype = Object.create(Error.prototype); RoConflict.prototype.constructor = RoConflict;

  function uid(prefix) { return (prefix || "f") + Date.now().toString(36) + Math.random().toString(36).slice(2, 9); }
  function now() { return Date.now(); }
  function emit(topic, detail) { if (bus) bus.emit(topic, detail); }
  function sha(blob) { return hash.sha256(blob); }

  // ---------- generic repo ----------
  function Repo(store) {
    this.store = store;
    this.topic = store + ":changed";
    this.prepare = null;   // (rec, existing) -> void, sync; normalises before a write
    this.validate = null;  // (rec, existing, api) -> void | Promise, may api.abort(err)
  }
  Repo.prototype.get = function (id) {
    var s = this.store;
    return db.run([s], "readonly", function (api) { return api.req(api.store(s).get(id)); });
  };
  Repo.prototype.getMany = function (ids) {
    var s = this.store;
    return db.run([s], "readonly", function (api) { return Promise.all((ids || []).map(function (id) { return api.req(api.store(s).get(id)); })); });
  };
  Repo.prototype.list = function () {
    var s = this.store;
    return db.run([s], "readonly", function (api) { return api.req(api.store(s).getAll()); });
  };
  Repo.prototype.listBy = function (index, value) {
    var s = this.store;
    return db.run([s], "readonly", function (api) { return api.req(api.store(s).index(index).getAll(value)); });
  };
  Repo.prototype.keys = function () {
    var s = this.store;
    return db.run([s], "readonly", function (api) { return api.req(api.store(s).getAllKeys()); });
  };
  Repo.prototype.count = function (index, value) {
    var s = this.store;
    return db.run([s], "readonly", function (api) {
      var os = api.store(s);
      return api.req(index ? os.index(index).count(value) : os.count());
    });
  };
  Repo.prototype.each = function (cb) {
    var s = this.store;
    return db.run([s], "readonly", function (api) {
      return new Promise(function (resolve, reject) {
        var cur = api.store(s).openCursor();
        cur.onerror = function () { reject(cur.error); };
        cur.onsuccess = function (e) { var c = e.target.result; if (!c) { resolve(); return; } cb(c.value); c.continue(); };
      });
    });
  };
  // Write one record inside an open transaction: rev check + bump, prepare,
  // validate, put. Used by putMany and by the composite writers below.
  Repo.prototype._write = function (api, rec, opts) {
    var self = this, s = this.store;
    // A record may arrive without its key (links derive it, others get a
    // uid): let prepare() assign it before the existing row is looked up.
    // prepare() is idempotent, so it runs again with the existing record.
    if (rec.id == null && self.prepare) self.prepare(rec, null);
    if (rec.id == null) rec.id = uid(s.charAt(0));
    return api.req(api.store(s).get(rec.id)).then(function (existing) {
      if (api.aborted) return null;
      var have = existing && existing.rev ? existing.rev : 0;
      if (opts && opts.expectedRev != null && have !== opts.expectedRev) { api.abort(new RevConflict(existing || null)); return null; }
      if (self.prepare) self.prepare(rec, existing || null);
      rec.rev = have + 1;
      return Promise.resolve(self.validate ? self.validate(rec, existing || null, api) : null).then(function () {
        if (api.aborted) return null;
        return api.req(api.store(s).put(rec)).then(function () { return rec; });
      });
    });
  };
  Repo.prototype.put = function (rec, opts) {
    return this.putMany([rec], opts).then(function (r) { return r[0]; });
  };
  Repo.prototype.putMany = function (recs, opts) {
    var self = this, s = this.store;
    recs = recs || [];
    if (!recs.length) return Promise.resolve([]);
    var stores = [s].concat((opts && opts.stores) || []);
    return db.run(stores, "readwrite", function (api) {
      var out = [];
      var chain = Promise.resolve();
      recs.forEach(function (rec) { chain = chain.then(function () { return self._write(api, rec, opts).then(function (r) { out.push(r); }); }); });
      return chain.then(function () { return out; });
    }).then(function (out) {
      emit(self.topic, { ids: out.map(function (r) { return r && r.id; }), op: "put" });
      return out;
    });
  };
  Repo.prototype.remove = function (id) { return this.removeMany([id]); };
  Repo.prototype.removeMany = function (ids) {
    var self = this, s = this.store;
    ids = ids || [];
    if (!ids.length) return Promise.resolve();
    return db.run([s], "readwrite", function (api) {
      return Promise.all(ids.map(function (id) { return api.req(api.store(s).delete(id)); }));
    }).then(function () { emit(self.topic, { ids: ids, op: "remove" }); });
  };
  Repo.prototype.clear = function () {
    var self = this, s = this.store;
    return db.run([s], "readwrite", function (api) { return api.req(api.store(s).clear()); })
      .then(function () { emit(self.topic, { ids: [], op: "clear" }); });
  };

  // ---------- files (+ blobs, thumbs) ----------
  var files = new Repo("files");
  files.LI_COLLECTION = LI_COLLECTION;
  files.classify = function (file) {
    var type = String((file && file.type) || "").toLowerCase();
    var name = String((file && file.name) || "").toLowerCase();
    var ext = name.indexOf(".") !== -1 ? name.split(".").pop() : "";
    if (type.indexOf("image/") === 0) return "image";
    if (type.indexOf("video/") === 0) return "video";
    if (type.indexOf("audio/") === 0) return "audio";
    if (type === "application/pdf" || ext === "pdf") return "pdf";
    if (["zip", "rar", "7z", "gz", "tar", "bz2", "xz"].indexOf(ext) !== -1 || type.indexOf("zip") !== -1 || type.indexOf("compressed") !== -1) return "archive";
    if (["doc", "docx", "odt", "rtf", "pages"].indexOf(ext) !== -1 || type.indexOf("word") !== -1 || type.indexOf("opendocument.text") !== -1) return "document";
    if (["xls", "xlsx", "ods", "csv", "numbers"].indexOf(ext) !== -1 || type.indexOf("sheet") !== -1 || type.indexOf("excel") !== -1) return "spreadsheet";
    if (["ppt", "pptx", "odp", "key"].indexOf(ext) !== -1 || type.indexOf("presentation") !== -1 || type.indexOf("powerpoint") !== -1) return "presentation";
    if (type.indexOf("text/") === 0 ||
        ["txt", "md", "markdown", "json", "xml", "yml", "yaml", "js", "ts", "jsx", "tsx", "py", "rb", "go", "rs",
         "c", "cpp", "h", "java", "cs", "php", "sh", "css", "html", "htm", "sql", "log", "ini", "conf", "toml", "env"].indexOf(ext) !== -1) return "text";
    return "other";
  };
  files.buildSearchText = function (r) {
    return [r.name, r.collection, r.note, (r.tags || []).join(" "), (r.vins || []).join(" "), (r.fins || []).join(" ")].join(" ").toLowerCase();
  };
  files.prepare = function (r, existing) {
    if (!r.id) r.id = uid("f");
    r.name = r.name || "Untitled";
    r.type = r.type || "application/octet-stream";
    r.kind = r.kind || files.classify(r);
    r.size = r.size || 0;
    r.tags = Array.isArray(r.tags) ? r.tags : [];
    r.vins = Array.isArray(r.vins) ? r.vins : [];
    r.fins = Array.isArray(r.fins) ? r.fins : [];
    r.collection = r.collection || "";
    r.note = r.note || "";
    r.starred = !!r.starred;
    r.vinScan = r.vinScan || 0;
    r.inFiles = (r.inFiles === 0 || r.inFiles === false) ? 0 : 1;
    if (r.docId == null) delete r.docId;
    r.createdAt = r.createdAt || (existing && existing.createdAt) || now();
    r.updatedAt = r.updatedAt || now();
    r.searchText = files.buildSearchText(r);
    delete r.blob; delete r.thumb; delete r.sha256; // never in this store
  };
  // Metadata for a list: every record (opts.inFiles filters to 1 or 0) with
  // its thumbnail Blob attached as `thumb` (null when there is none).
  files.listMeta = function (opts) {
    var want = opts && opts.inFiles != null ? (opts.inFiles ? 1 : 0) : null;
    return db.run(["files", "thumbs"], "readonly", function (api) {
      return Promise.all([api.req(api.store("files").getAll()), api.req(api.store("thumbs").getAll())]);
    }).then(function (r) {
      var th = {}; r[1].forEach(function (t) { th[t.id] = t.blob; });
      return r[0].filter(function (f) { return want == null || (f.inFiles ? 1 : 0) === want; })
        .map(function (f) { f.thumb = th[f.id] || null; return f; });
    });
  };
  files.getFull = function (id) {
    return db.run(["files", "blobs", "thumbs"], "readonly", function (api) {
      return Promise.all([api.req(api.store("files").get(id)), api.req(api.store("blobs").get(id)), api.req(api.store("thumbs").get(id))]);
    }).then(function (r) {
      var f = r[0];
      if (!f) return null;
      f.blob = r[1] ? r[1].blob : null;
      f.sha256 = r[1] ? r[1].sha256 : null;
      f.thumb = r[2] ? r[2].blob : null;
      return f;
    });
  };
  files.getBlob = function (id) {
    return db.run(["blobs"], "readonly", function (api) { return api.req(api.store("blobs").get(id)); }).then(function (b) { return b ? b.blob : null; });
  };
  files.getBlobRecord = function (id) {
    return db.run(["blobs"], "readonly", function (api) { return api.req(api.store("blobs").get(id)); });
  };
  files.getThumb = function (id) {
    return db.run(["thumbs"], "readonly", function (api) { return api.req(api.store("thumbs").get(id)); }).then(function (t) { return t ? t.blob : null; });
  };
  // A thumbnail is a derived preview: setting one does not bump the file's
  // rev or updatedAt (nothing jumps in "Recent").
  files.setThumb = function (id, blob) {
    return db.run(["thumbs"], "readwrite", function (api) {
      return api.req(blob ? api.store("thumbs").put({ id: id, blob: blob }) : api.store("thumbs").delete(id));
    }).then(function () { emit("files:changed", { ids: [id], op: "thumb" }); });
  };
  // Write a record that carries `blob` (and optionally `thumb`). The blob is
  // hashed first (outside the transaction), then files/blobs/thumbs are
  // written in ONE transaction. opts.verify re-reads the stored bytes and
  // compares their hash, removing the record on a mismatch.
  files.putFull = function (rec, opts) {
    opts = opts || {};
    var blob = rec.blob, thumb = rec.thumb, hasThumb = Object.prototype.hasOwnProperty.call(rec, "thumb");
    var meta = Object.assign({}, rec);
    delete meta.blob; delete meta.thumb;
    var shaP = blob ? (opts.sha256 ? Promise.resolve(opts.sha256) : sha(blob)) : Promise.resolve(null);
    return shaP.then(function (digest) {
      if (blob) meta.size = blob.size;
      return db.run(["files", "blobs", "thumbs"], "readwrite", function (api) {
        return files._write(api, meta, opts).then(function (written) {
          if (!written) return null;
          var ops = [];
          if (blob) ops.push(api.req(api.store("blobs").put({ id: meta.id, blob: blob, size: blob.size, sha256: digest })));
          if (hasThumb) ops.push(api.req(thumb ? api.store("thumbs").put({ id: meta.id, blob: thumb }) : api.store("thumbs").delete(meta.id)));
          return Promise.all(ops).then(function () { return written; });
        });
      });
    }).then(function (written) {
      if (!written) return null;
      return shaP.then(function (digest) {
        written.sha256 = digest;
        if (!opts.verify || !blob) return written;
        return files.getBlob(meta.id).then(function (stored) {
          return (stored && stored.size === blob.size) ? sha(stored) : Promise.resolve(null);
        }).then(function (d2) {
          if (d2 === digest) return written;
          return files.removeFull(meta.id).then(function () { throw new Error("The file didn't store correctly and was removed."); });
        });
      });
    }).then(function (written) {
      if (written) emit("files:changed", { ids: [written.id], op: "put" });
      return written;
    });
  };
  // Metadata-only merge: never touches the blob.
  files.update = function (id, patch, opts) {
    return db.run(["files"], "readwrite", function (api) {
      return api.req(api.store("files").get(id)).then(function (existing) {
        if (!existing) throw new Error("Not found: " + id);
        var merged = Object.assign(existing, patch, { updatedAt: now() });
        return files._write(api, merged, opts);
      });
    }).then(function (r) { if (r) emit("files:changed", { ids: [id], op: "put" }); return r; });
  };
  // Remove a file with its bytes, preview and every link that names it.
  files.removeFull = function (id) { return files.removeManyFull([id]); };
  files.removeManyFull = function (ids) {
    ids = ids || [];
    if (!ids.length) return Promise.resolve();
    var linkIds = [];
    return db.run(["files", "blobs", "thumbs", "links"], "readwrite", function (api) {
      return Promise.all(ids.map(function (id) {
        var ls = api.store("links");
        return Promise.all([api.req(ls.index("to").getAll(["file", id])), api.req(ls.index("from").getAll(["file", id]))]).then(function (r) {
          var all = r[0].concat(r[1]);
          all.forEach(function (l) { linkIds.push(l.id); });
          return Promise.all(all.map(function (l) { return api.req(ls.delete(l.id)); }).concat([
            api.req(api.store("files").delete(id)), api.req(api.store("blobs").delete(id)), api.req(api.store("thumbs").delete(id)),
          ]));
        });
      }));
    }).then(function () {
      emit("files:changed", { ids: ids, op: "remove" });
      if (linkIds.length) emit("links:changed", { ids: linkIds, op: "remove" });
    });
  };
  // Every record joined with its blob and thumb (for a backup/export).
  files.eachFull = function (cb, opts) {
    var want = opts && opts.inFiles != null ? (opts.inFiles ? 1 : 0) : null;
    return db.run(["files", "blobs", "thumbs"], "readonly", function (api) {
      return Promise.all([api.req(api.store("files").getAll()), api.req(api.store("blobs").getAll()), api.req(api.store("thumbs").getAll())]);
    }).then(function (r) {
      var bl = {}, th = {};
      r[1].forEach(function (b) { bl[b.id] = b; });
      r[2].forEach(function (t) { th[t.id] = t.blob; });
      var chain = Promise.resolve();
      r[0].forEach(function (f) {
        if (want != null && (f.inFiles ? 1 : 0) !== want) return;
        f.blob = bl[f.id] ? bl[f.id].blob : null;
        f.sha256 = bl[f.id] ? bl[f.id].sha256 : null;
        f.thumb = th[f.id] || null;
        chain = chain.then(function () { return cb(f); });
      });
      return chain;
    });
  };
  files.byCollection = function (c) { return files.listBy("collection", c); };
  files.byVin = function (v) { return files.listBy("vins", String(v || "").toUpperCase()); };
  files.byDocId = function (d) { return files.listBy("docId", d); };
  files.renameCollection = function (from, to) {
    if (!from || from === to) return Promise.resolve(0);
    var ids = [];
    return db.run(["files"], "readwrite", function (api) {
      return api.req(api.store("files").index("collection").getAll(from)).then(function (list) {
        var chain = Promise.resolve();
        list.forEach(function (f) { chain = chain.then(function () { f.collection = to; f.updatedAt = now(); ids.push(f.id); return files._write(api, f); }); });
        return chain.then(function () { return list.length; });
      });
    }).then(function (n) { if (ids.length) emit("files:changed", { ids: ids, op: "put" }); return n; });
  };
  // Store new files: entries [{ blob, name, type, meta }] where meta holds
  // any file fields (collection, tags, vins, note, inFiles, docId…). Each
  // file is hashed, written with verification, and reported individually —
  // a failed file is never acknowledged as stored. Resolves
  // [{ name, id, ok, error }].
  files.ingest = function (entries, opts) {
    opts = opts || {};
    var results = [], ids = [];
    var chain = Promise.resolve();
    (entries || []).forEach(function (en) {
      chain = chain.then(function () {
        var blob = en.blob;
        if (!blob) { results.push({ name: en.name, id: null, ok: false, error: "no bytes" }); return; }
        var t = now();
        var rec = Object.assign({
          id: uid("f"), name: en.name || (blob.name) || "Untitled", type: en.type || blob.type || "application/octet-stream",
          createdAt: t, updatedAt: t, tags: [], vins: [], fins: [], collection: "", note: "", starred: false, inFiles: 1,
        }, en.meta || {});
        rec.kind = rec.kind || files.classify({ name: rec.name, type: rec.type });
        rec.blob = blob;
        if (Object.prototype.hasOwnProperty.call(en, "thumb")) rec.thumb = en.thumb;
        return files.putFull(rec, { verify: opts.verify !== false }).then(function (w) {
          results.push({ name: rec.name, id: w.id, ok: true, kind: w.kind, error: null }); ids.push(w.id);
        }, function (e) {
          results.push({ name: rec.name, id: null, ok: false, error: (e && e.message) || String(e), quota: !!(e && e.name === "QuotaExceededError") });
        });
      });
    });
    return chain.then(function () { return results; });
  };
  files.countInFiles = function () { return files.count("inFiles", 1); };

  // ---------- documents (LI) ----------
  var documents = new Repo("documents");
  documents.prepare = function (d) {
    if (!d.id) d.id = d.li ? (d.li + "_" + (d.ver || "0")) : uid("d");
    d.added = d.added || now();
    d.star = !!d.star;
    d.pages = d.pages || 0;
  };
  // Write a document and, when `blob` is given, its PDF as a file record
  // (kind pdf, collection "LI Documents", inFiles 0, docId) in one
  // transaction. opts.oldId re-keys a document (a corrected LI/version):
  // the old record goes in the same transaction so nothing is orphaned.
  documents.putWithFile = function (doc, blob, opts) {
    opts = opts || {};
    var shaP = blob ? sha(blob) : Promise.resolve(null);
    var touchedFiles = [];
    return shaP.then(function (digest) {
      return db.run(["documents", "files", "blobs"], "readwrite", function (api) {
        var oldP = (opts.oldId && opts.oldId !== doc.id) ? api.req(api.store("documents").get(opts.oldId)) : Promise.resolve(null);
        return oldP.then(function (old) {
          var fileId = doc.fileId || (old && old.fileId) || null;
          var fileP = Promise.resolve(null);
          if (blob) {
            if (!fileId) fileId = uid("f");
            fileP = api.req(api.store("files").get(fileId)).then(function (f) {
              f = f || { id: fileId, createdAt: now(), inFiles: 0, tags: [], vins: [], fins: [], collection: LI_COLLECTION, starred: false, note: "" };
              f.name = doc.filename || ((doc.li || doc.id) + ".pdf");
              f.type = "application/pdf"; f.kind = "pdf"; f.size = blob.size; f.docId = doc.id; f.updatedAt = now();
              touchedFiles.push(fileId);
              return files._write(api, f).then(function () {
                return api.req(api.store("blobs").put({ id: fileId, blob: blob, size: blob.size, sha256: digest }));
              });
            });
          } else if (fileId) {
            fileP = api.req(api.store("files").get(fileId)).then(function (f) {
              if (!f || f.docId === doc.id) return null;
              f.docId = doc.id; f.updatedAt = now(); touchedFiles.push(fileId);
              return files._write(api, f);
            });
          }
          return fileP.then(function () {
            doc.fileId = fileId;
            return documents._write(api, doc, opts);
          }).then(function (written) {
            if (!written) return null;
            if (old) return api.req(api.store("documents").delete(old.id)).then(function () { return written; });
            return written;
          });
        });
      });
    }).then(function (written) {
      if (!written) return null;
      var ids = [written.id]; if (opts.oldId && opts.oldId !== written.id) ids.push(opts.oldId);
      emit("documents:changed", { ids: ids, op: "put" });
      if (touchedFiles.length) emit("files:changed", { ids: touchedFiles, op: "put" });
      return written;
    });
  };
  documents.getBlob = function (id) {
    return db.run(["documents", "blobs"], "readonly", function (api) {
      return api.req(api.store("documents").get(id)).then(function (d) {
        if (!d || !d.fileId) return null;
        return api.req(api.store("blobs").get(d.fileId));
      });
    }).then(function (b) { return b ? b.blob : null; });
  };
  // Delete a document. Its PDF goes too unless it was copied to Files
  // (inFiles 1), in which case the file simply stops pointing at a document.
  documents.removeWithFile = function (id) { return documents.removeManyWithFile([id]); };
  documents.removeManyWithFile = function (ids) {
    ids = ids || [];
    if (!ids.length) return Promise.resolve();
    var removedFiles = [], keptFiles = [], linkIds = [];
    return db.run(["documents", "files", "blobs", "thumbs", "links"], "readwrite", function (api) {
      return Promise.all(ids.map(function (id) {
        return api.req(api.store("documents").get(id)).then(function (d) {
          var del = api.req(api.store("documents").delete(id));
          if (!d || !d.fileId) return del;
          return del.then(function () { return api.req(api.store("files").get(d.fileId)); }).then(function (f) {
            if (!f) return null;
            if (f.inFiles) { delete f.docId; f.updatedAt = now(); keptFiles.push(f.id); return files._write(api, f); }
            removedFiles.push(f.id);
            var ls = api.store("links");
            return Promise.all([api.req(ls.index("to").getAll(["file", f.id])), api.req(ls.index("from").getAll(["file", f.id]))]).then(function (r) {
              var all = r[0].concat(r[1]);
              all.forEach(function (l) { linkIds.push(l.id); });
              return Promise.all(all.map(function (l) { return api.req(ls.delete(l.id)); }).concat([
                api.req(api.store("files").delete(f.id)), api.req(api.store("blobs").delete(f.id)), api.req(api.store("thumbs").delete(f.id)),
              ]));
            });
          });
        });
      }));
    }).then(function () {
      emit("documents:changed", { ids: ids, op: "remove" });
      if (removedFiles.length) emit("files:changed", { ids: removedFiles, op: "remove" });
      if (keptFiles.length) emit("files:changed", { ids: keptFiles, op: "put" });
      if (linkIds.length) emit("links:changed", { ids: linkIds, op: "remove" });
    });
  };
  documents.byLi = function (li) { return documents.listBy("li", li); };

  // ---------- tools, photos (Inventory) ----------
  var tools = new Repo("tools");
  tools.prepare = function (t) { if (!t.id) t.id = uid("t"); };
  var photos = new Repo("photos");

  // ---------- ros (Repair Orders) ----------
  var ros = new Repo("ros");
  ros.canon = function (no) { return String(no || "").trim().replace(/\s+/g, "").toUpperCase(); };
  ros.prepare = function (r) {
    if (!r.id) r.id = uid("r");
    r.lines = Array.isArray(r.lines) ? r.lines : [];
    r.createdAt = r.createdAt || now();
    r.updatedAt = r.updatedAt || now();
    var k = ros.canon(r.ro);
    if (k) r.roKey = k; else delete r.roKey;
  };
  // D7: one repair order per number. The unique index would reject the put
  // with a ConstraintError; checking first turns that into a RoConflict that
  // names the other record, so the UI can link to it.
  ros.validate = function (rec, existing, api) {
    if (!rec.roKey) return null;
    return api.req(api.store("ros").index("roKey").get(rec.roKey)).then(function (other) {
      if (other && other.id !== rec.id) api.abort(new RoConflict(other));
    });
  };
  ros.byNumber = function (no) { var k = ros.canon(no); return k ? ros.listBy("roKey", k).then(function (l) { return l[0] || null; }) : Promise.resolve(null); };
  ros.byVin = function (v) { return ros.listBy("vin", String(v || "").toUpperCase()); };

  // ---------- links ----------
  var links = new Repo("links");
  links.idOf = function (fromType, fromId, toType, toId, kind) { return fromType + ":" + fromId + ">" + toType + ":" + toId + "#" + kind; };
  links.prepare = function (l) {
    l.id = links.idOf(l.fromType, l.fromId, l.toType, l.toId, l.kind);
    l.createdAt = l.createdAt || now();
    l.source = l.source || "user";
  };
  links.link = function (fromType, fromId, toType, toId, kind, extra) {
    return links.put(Object.assign({ fromType: fromType, fromId: fromId, toType: toType, toId: toId, kind: kind }, extra || {}));
  };
  links.linkMany = function (list) {
    return links.putMany((list || []).map(function (l) { return Object.assign({}, l); }));
  };
  links.unlink = function (fromType, fromId, toType, toId, kind) { return links.remove(links.idOf(fromType, fromId, toType, toId, kind)); };
  links.from = function (type, id, kind) {
    return links.listBy("from", [type, id]).then(function (l) { return kind ? l.filter(function (x) { return x.kind === kind; }) : l; });
  };
  links.to = function (type, id, kind) {
    return links.listBy("to", [type, id]).then(function (l) { return kind ? l.filter(function (x) { return x.kind === kind; }) : l; });
  };
  // Every link that names this record, in either direction.
  links.removeFor = function (type, id) {
    var ids = [];
    return db.run(["links"], "readwrite", function (api) {
      var ls = api.store("links");
      return Promise.all([api.req(ls.index("from").getAll([type, id])), api.req(ls.index("to").getAll([type, id]))]).then(function (r) {
        var all = r[0].concat(r[1]);
        return Promise.all(all.map(function (l) { ids.push(l.id); return api.req(ls.delete(l.id)); }));
      });
    }).then(function () { if (ids.length) emit("links:changed", { ids: ids, op: "remove" }); return ids.length; });
  };

  // ---------- jobs ----------
  var jobs = new Repo("jobs");
  jobs.prepare = function (j) { if (!j.id) j.id = uid("j"); j.updatedAt = now(); };
  jobs.byState = function (state) { return jobs.listBy("state", state); };

  // ---------- settings ----------
  var settings = new Repo("settings");
  settings.getValue = function (key, fallback) {
    return settings.get(key).then(function (r) { return r ? r.value : fallback; });
  };
  settings.setValue = function (key, value) { return settings.put({ key: key, value: value }); };
  settings.removeKey = function (key) { return settings.remove(key); };
  settings.listPrefix = function (prefix) {
    return settings.list().then(function (l) { return l.filter(function (r) { return String(r.key).indexOf(prefix) === 0; }); });
  };

  // ---------- log ----------
  var log = new Repo("log");
  log.prepare = function (e) { e.t = e.t || now(); };

  data.repos = {
    files: files, documents: documents, tools: tools, photos: photos, ros: ros, links: links, jobs: jobs, settings: settings, log: log,
    Repo: Repo, RevConflict: RevConflict, RoConflict: RoConflict, uid: uid, LI_COLLECTION: LI_COLLECTION,
  };
  data.uid = uid;
})(typeof self !== "undefined" ? self : globalThis);
