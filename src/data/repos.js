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
 * Phase 5: delete is trash first (files and ros carry `deletedAt`; purge is
 * separate and refuses anything a link or a document still references); a
 * file may reuse another record's bytes (`blobId`, after a duplicate review),
 * so a blobs row goes only when no file names it; a repair order's files,
 * pinned LI versions and required tools are links; vehicles is one record
 * per VIN, and summary(vin) answers "everything about this car" in one read.
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
    var def = global.FDSchema && global.FDSchema.STORES[store];
    this.key = (def && typeof def.keyPath === "string") ? def.keyPath : "id";
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
    var self = this, s = this.store, k = this.key;
    // A record may arrive without its key (links derive it, others get a
    // uid): let prepare() assign it before the existing row is looked up.
    // prepare() is idempotent, so it runs again with the existing record.
    if (rec[k] == null && self.prepare) self.prepare(rec, null);
    if (rec[k] == null) rec[k] = uid(s.charAt(0));
    return api.req(api.store(s).get(rec[k])).then(function (existing) {
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
      emit(self.topic, { ids: out.map(function (r) { return r && r[self.key]; }), op: "put" });
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
    if (!r.deletedAt) delete r.deletedAt;
    if (r.blobId == null || r.blobId === r.id) delete r.blobId;
    r.createdAt = r.createdAt || (existing && existing.createdAt) || now();
    r.updatedAt = r.updatedAt || now();
    r.searchText = files.buildSearchText(r);
    delete r.blob; delete r.thumb; delete r.sha256; // never in this store
  };
  // The blobs row that holds a record's bytes: its own, or the record whose
  // bytes it reuses.
  files.blobKey = function (f) { return (f && f.blobId) || (f && f.id); };
  files.isTrashed = function (f) { return !!(f && f.deletedAt); };
  function trashFilter(opts) {
    var t = opts && opts.trash;
    if (t === "only") return function (f) { return !!f.deletedAt; };
    if (t === "with" || t === true) return function () { return true; };
    return function (f) { return !f.deletedAt; };
  }
  // Metadata for a list: every record (opts.inFiles filters to 1 or 0) with
  // its thumbnail Blob attached as `thumb` (null when there is none). The
  // trash is left out unless opts.trash is "with" (both) or "only".
  files.listMeta = function (opts) {
    var want = opts && opts.inFiles != null ? (opts.inFiles ? 1 : 0) : null;
    var keep = trashFilter(opts);
    return db.run(["files", "thumbs"], "readonly", function (api) {
      return Promise.all([api.req(api.store("files").getAll()), api.req(api.store("thumbs").getAll())]);
    }).then(function (r) {
      var th = {}; r[1].forEach(function (t) { th[t.id] = t.blob; });
      return r[0].filter(function (f) { return (want == null || (f.inFiles ? 1 : 0) === want) && keep(f); })
        .map(function (f) { f.thumb = th[f.id] || null; return f; });
    });
  };
  files.getFull = function (id) {
    return db.run(["files", "blobs", "thumbs"], "readonly", function (api) {
      return api.req(api.store("files").get(id)).then(function (f) {
        if (!f) return null;
        return Promise.all([api.req(api.store("blobs").get(files.blobKey(f))), api.req(api.store("thumbs").get(id))]).then(function (r) {
          f.blob = r[0] ? r[0].blob : null;
          f.sha256 = r[0] ? r[0].sha256 : null;
          f.thumb = r[1] ? r[1].blob : null;
          return f;
        });
      });
    });
  };
  // The blobs row for a FILE id (following blobId).
  files.getBlobRecord = function (id) {
    return db.run(["files", "blobs"], "readonly", function (api) {
      return api.req(api.store("files").get(id)).then(function (f) {
        return api.req(api.store("blobs").get(f ? files.blobKey(f) : id));
      });
    });
  };
  files.getBlob = function (id) {
    return files.getBlobRecord(id).then(function (b) { return b ? b.blob : null; });
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
  // compares their hash, removing the record on a mismatch. opts.reuse names
  // an existing file whose bytes this record shares instead (a duplicate
  // review's "reuse bytes"): no blob is written, the record gets blobId.
  files.putFull = function (rec, opts) {
    opts = opts || {};
    var blob = rec.blob, thumb = rec.thumb, hasThumb = Object.prototype.hasOwnProperty.call(rec, "thumb");
    var meta = Object.assign({}, rec);
    delete meta.blob; delete meta.thumb;
    if (opts.reuse) return putReusing(meta, opts.reuse, hasThumb ? thumb : undefined, hasThumb, opts);
    var shaP = blob ? (opts.sha256 ? Promise.resolve(opts.sha256) : sha(blob)) : Promise.resolve(null);
    return shaP.then(function (digest) {
      if (blob) meta.size = blob.size;
      return db.run(["files", "blobs", "thumbs"], "readwrite", function (api) {
        // New bytes: the record's own blobs row from now on (a record that
        // used to share another's bytes stops doing so).
        if (blob) delete meta.blobId;
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
  function putReusing(meta, otherId, thumb, hasThumb, opts) {
    var digest = null;
    return db.run(["files", "blobs", "thumbs"], "readwrite", function (api) {
      return api.req(api.store("files").get(otherId)).then(function (other) {
        var key = other ? files.blobKey(other) : otherId;
        return api.req(api.store("blobs").get(key)).then(function (b) {
          if (!b) { api.abort(new Error("The file to reuse no longer has its bytes.")); return null; }
          digest = b.sha256 || null;
          meta.blobId = key; meta.size = b.size || (b.blob && b.blob.size) || 0;
          return files._write(api, meta, opts).then(function (written) {
            if (!written || !hasThumb) return written;
            return api.req(thumb ? api.store("thumbs").put({ id: meta.id, blob: thumb }) : api.store("thumbs").delete(meta.id)).then(function () { return written; });
          });
        });
      });
    }).then(function (written) {
      if (written) { written.sha256 = digest; emit("files:changed", { ids: [written.id], op: "put" }); }
      return written;
    });
  }
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
  // Inside an open files/blobs/thumbs/links transaction: delete file
  // records with their previews and every link naming them, and each blobs
  // row that no remaining record uses (a row another record reuses stays).
  // Pushes the removed link ids onto linkIds.
  function dropFiles(api, ids, linkIds) {
    var gone = {}; ids.forEach(function (id) { gone[id] = true; });
    var keys = {};
    var fs = api.store("files"), ls = api.store("links");
    return Promise.all(ids.map(function (id) {
      return api.req(fs.get(id)).then(function (f) {
        keys[f ? files.blobKey(f) : id] = true;
        return Promise.all([api.req(ls.index("to").getAll(["file", id])), api.req(ls.index("from").getAll(["file", id]))]);
      }).then(function (r) {
        var all = r[0].concat(r[1]);
        all.forEach(function (l) { linkIds.push(l.id); });
        return Promise.all(all.map(function (l) { return api.req(ls.delete(l.id)); }).concat([
          api.req(fs.delete(id)), api.req(api.store("thumbs").delete(id)),
        ]));
      });
    })).then(function () {
      return Promise.all(Object.keys(keys).map(function (key) {
        return Promise.all([api.req(fs.get(key)), api.req(fs.index("blobId").getAll(key))]).then(function (r) {
          var holder = r[0] && !gone[r[0].id];
          var sharers = r[1].filter(function (f) { return !gone[f.id]; });
          if (holder || sharers.length) return null;
          return api.req(api.store("blobs").delete(key));
        });
      }));
    });
  }
  files._dropIn = dropFiles;
  // Remove a file for good: its bytes (unless another record reuses them),
  // preview and every link that names it. The UI goes through trash() and
  // purge(); this is the unconditional primitive under them.
  files.removeFull = function (id) { return files.removeManyFull([id]); };
  files.removeManyFull = function (ids) {
    ids = ids || [];
    if (!ids.length) return Promise.resolve();
    var linkIds = [];
    return db.run(["files", "blobs", "thumbs", "links"], "readwrite", function (api) {
      return dropFiles(api, ids, linkIds);
    }).then(function () {
      emit("files:changed", { ids: ids, op: "remove" });
      if (linkIds.length) emit("links:changed", { ids: linkIds, op: "remove" });
    });
  };
  // ---- trash ----
  function setDeleted(ids, when) {
    ids = ids || [];
    if (!ids.length) return Promise.resolve([]);
    var done = [];
    return db.run(["files"], "readwrite", function (api) {
      var chain = Promise.resolve();
      ids.forEach(function (id) {
        chain = chain.then(function () {
          return api.req(api.store("files").get(id)).then(function (f) {
            if (!f) return null;
            if (when) { if (f.deletedAt) return null; f.deletedAt = when; } else { if (!f.deletedAt) return null; delete f.deletedAt; }
            done.push(id);
            return files._write(api, f);
          });
        });
      });
      return chain;
    }).then(function () { if (done.length) emit("files:changed", { ids: done, op: when ? "trash" : "restore" }); return done; });
  }
  // Move to the trash: hidden from every list, bytes kept, links kept (so a
  // restore brings a file back onto its repair orders).
  files.trash = function (ids) { return setDeleted(ids, now()); };
  files.restore = function (ids) { return setDeleted(ids, 0); };
  files.listTrash = function () { return files.listMeta({ trash: "only" }); };
  // What still references a file: links in either direction (a repair
  // order's attachment, a reference) and an LI document that owns it.
  function blockersIn(api, id) {
    var ls = api.store("links");
    return Promise.all([api.req(api.store("files").get(id)), api.req(ls.index("to").getAll(["file", id])), api.req(ls.index("from").getAll(["file", id]))]).then(function (r) {
      var why = [];
      if (r[0] && r[0].docId) why.push({ type: "document", id: r[0].docId });
      r[1].concat(r[2]).forEach(function (l) { why.push(l.toType === "file" && l.toId === id ? { type: l.fromType, id: l.fromId, kind: l.kind } : { type: l.toType, id: l.toId, kind: l.kind }); });
      return why;
    });
  }
  files.referencesOf = function (id) {
    return db.run(["files", "links"], "readonly", function (api) { return blockersIn(api, id); });
  };
  // Delete for good what nothing references. Resolves { purged: [ids],
  // blocked: [{ id, name, refs }] } — a referenced record stays in the trash.
  files.purge = function (ids) {
    ids = ids || [];
    var purged = [], blocked = [], linkIds = [];
    if (!ids.length) return Promise.resolve({ purged: purged, blocked: blocked });
    return db.run(["files", "blobs", "thumbs", "links"], "readwrite", function (api) {
      return Promise.all(ids.map(function (id) {
        return blockersIn(api, id).then(function (refs) {
          if (refs.length) return api.req(api.store("files").get(id)).then(function (f) { blocked.push({ id: id, name: f ? f.name : id, refs: refs }); });
          purged.push(id);
          return null;
        });
      })).then(function () { return dropFiles(api, purged, linkIds); });
    }).then(function () {
      if (purged.length) emit("files:changed", { ids: purged, op: "remove" });
      return { purged: purged, blocked: blocked };
    });
  };
  files.emptyTrash = function () {
    return files.listBy("deletedAt").then(function (list) { return files.purge(list.map(function (f) { return f.id; })); });
  };
  // Every record joined with its blob and thumb (for a backup/export).
  files.eachFull = function (cb, opts) {
    var want = opts && opts.inFiles != null ? (opts.inFiles ? 1 : 0) : null;
    var keep = trashFilter(opts);
    return db.run(["files", "blobs", "thumbs"], "readonly", function (api) {
      return Promise.all([api.req(api.store("files").getAll()), api.req(api.store("blobs").getAll()), api.req(api.store("thumbs").getAll())]);
    }).then(function (r) {
      var bl = {}, th = {};
      r[1].forEach(function (b) { bl[b.id] = b; });
      r[2].forEach(function (t) { th[t.id] = t.blob; });
      var chain = Promise.resolve();
      r[0].forEach(function (f) {
        if (want != null && (f.inFiles ? 1 : 0) !== want) return;
        if (!keep(f)) return;
        var b = bl[files.blobKey(f)];
        f.blob = b ? b.blob : null;
        f.sha256 = b ? b.sha256 : null;
        f.thumb = th[f.id] || null;
        chain = chain.then(function () { return cb(f); });
      });
      return chain;
    });
  };
  // ---- exact duplicates (by content) ----
  // Every file record whose bytes hash to `digest` (trash included, flagged
  // by deletedAt), following reused bytes.
  files.bySha256 = function (digest) {
    if (!digest) return Promise.resolve([]);
    return db.run(["files", "blobs"], "readonly", function (api) {
      return api.req(api.store("blobs").index("sha256").getAll(digest)).then(function (rows) {
        return Promise.all(rows.map(function (b) {
          return Promise.all([api.req(api.store("files").get(b.id)), api.req(api.store("files").index("blobId").getAll(b.id))]).then(function (r) {
            return (r[0] ? [r[0]] : []).concat(r[1]);
          });
        }));
      });
    }).then(function (lists) {
      var seen = {}, out = [];
      lists.forEach(function (l) { l.forEach(function (f) { if (!seen[f.id]) { seen[f.id] = 1; out.push(f); } }); });
      return out;
    });
  };
  // For a batch about to be stored: [{ index, sha256, matches: [records] }]
  // for each entry whose bytes are already in the database.
  files.findDuplicates = function (blobs) {
    var out = [];
    var chain = Promise.resolve();
    (blobs || []).forEach(function (b, i) {
      chain = chain.then(function () {
        if (!b) return null;
        return sha(b).then(function (d) {
          return files.bySha256(d).then(function (m) { if (m.length) out.push({ index: i, sha256: d, matches: m }); });
        });
      });
    });
    return chain.then(function () { return out; });
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
  // Store new files: entries [{ blob, name, type, meta, reuse?, sha256? }]
  // where meta holds any file fields (collection, tags, vins, note, inFiles,
  // docId…) and reuse names an existing file whose bytes to share. Each
  // file is hashed, written with verification, and reported individually —
  // a failed file is never acknowledged as stored. Resolves
  // [{ name, id, ok, error, reused }].
  files.ingest = function (entries, opts) {
    opts = opts || {};
    var results = [];
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
        return files.putFull(rec, { verify: opts.verify !== false, reuse: en.reuse || null, sha256: en.sha256 || null }).then(function (w) {
          results.push({ name: rec.name, id: w.id, ok: true, kind: w.kind, error: null, reused: !!en.reuse });
        }, function (e) {
          results.push({ name: rec.name, id: null, ok: false, error: (e && e.message) || String(e), quota: !!(e && e.name === "QuotaExceededError") });
        });
      });
    });
    return chain.then(function () { return results; });
  };
  // Records shown in the Files app (the tab badge): not owned by another
  // feature, not in the trash.
  files.countInFiles = function () {
    return files.listBy("inFiles", 1).then(function (l) { return l.filter(function (f) { return !f.deletedAt; }).length; });
  };

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
              delete f.blobId; // new bytes are this record's own
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
    return db.run(["documents", "files", "blobs"], "readonly", function (api) {
      return api.req(api.store("documents").get(id)).then(function (d) {
        if (!d || !d.fileId) return null;
        return api.req(api.store("files").get(d.fileId)).then(function (f) {
          return api.req(api.store("blobs").get(f ? files.blobKey(f) : d.fileId));
        });
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
            return null;
          });
        });
      })).then(function () { return dropFiles(api, removedFiles, linkIds); });
    }).then(function () {
      emit("documents:changed", { ids: ids, op: "remove" });
      if (removedFiles.length) emit("files:changed", { ids: removedFiles, op: "remove" });
      if (keptFiles.length) emit("files:changed", { ids: keptFiles, op: "put" });
      if (linkIds.length) emit("links:changed", { ids: linkIds, op: "remove" });
    });
  };
  documents.byLi = function (li) { return documents.listBy("li", li); };
  function verNum(d) { return parseFloat(d && d.ver) || 0; }
  documents.verNum = verNum;
  // The newest stored version of an LI number (null when none).
  documents.latestOf = function (li) {
    return documents.byLi(li).then(function (l) {
      return l.reduce(function (best, d) { return !best || verNum(d) > verNum(best) ? d : best; }, null);
    });
  };

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
    if (!r.deletedAt) delete r.deletedAt;
    var k = ros.canon(r.ro);
    if (k) r.roKey = k; else delete r.roKey;
  };
  // D7: one repair order per number. The unique index would reject the put
  // with a ConstraintError; checking first turns that into a RoConflict that
  // names the other record, so the UI can link to it. A repair order in the
  // trash keeps its number (a restore must not collide); the conflict says
  // so through other.deletedAt.
  ros.validate = function (rec, existing, api) {
    if (!rec.roKey) return null;
    return api.req(api.store("ros").index("roKey").get(rec.roKey)).then(function (other) {
      if (other && other.id !== rec.id) api.abort(new RoConflict(other));
    });
  };
  ros.byNumber = function (no) { var k = ros.canon(no); return k ? ros.listBy("roKey", k).then(function (l) { return l[0] || null; }) : Promise.resolve(null); };
  ros.byVin = function (v) { return ros.listBy("vin", String(v || "").toUpperCase()); };
  // The repair orders on screen (trash left out) and the trash.
  ros.live = function () { return ros.list().then(function (l) { return l.filter(function (r) { return !r.deletedAt; }); }); };
  ros.listTrash = function () { return ros.listBy("deletedAt"); };

  // ---- attachments: ro → file, kind "attachment" (D9) ----
  // A file can sit on any number of repair orders; renaming or renumbering
  // an RO touches the RO record alone.
  ros.attach = function (roId, fileIds, extra) {
    return links.linkMany((fileIds || []).map(function (fid) { return Object.assign({ fromType: "ro", fromId: roId, toType: "file", toId: fid, kind: "attachment" }, extra || {}); }));
  };
  ros.detach = function (roId, fileIds) {
    var ids = (fileIds || []).map(function (fid) { return links.idOf("ro", roId, "file", fid, "attachment"); });
    return links.removeMany(ids);
  };
  // The attached file records (metadata only). opts.trash as files.listMeta.
  ros.attachments = function (roId, opts) {
    var keep = trashFilter(opts);
    return links.from("ro", roId, "attachment").then(function (ls) {
      return files.getMany(ls.map(function (l) { return l.toId; }));
    }).then(function (recs) { return recs.filter(function (f) { return f && keep(f); }); });
  };
  // The live repair orders a file is attached to.
  ros.ofFile = function (fileId) {
    return links.to("file", fileId, "attachment").then(function (ls) {
      return ros.getMany(ls.filter(function (l) { return l.fromType === "ro"; }).map(function (l) { return l.fromId; }));
    }).then(function (l) { return l.filter(function (r) { return r && !r.deletedAt; }); });
  };

  // ---- references: the exact LI version and the tools a job used ----
  // ro → document ("reference", pinned to that LI+version record) and
  // ro → tool ("required-tool"). A later import of the same LI number is a
  // new document record, so what the RO used never changes underneath it;
  // references() reports the newer version beside the pinned one.
  // doc: the document record (its li/ver are kept on the link as a snapshot).
  ros.pinDocument = function (roId, doc) { return links.link("ro", roId, "document", doc.id, "reference", { li: doc.li || "", ver: doc.ver || "" }); };
  ros.unpinDocument = function (roId, docId) { return links.unlink("ro", roId, "document", docId, "reference"); };
  ros.pinTool = function (roId, toolId) { return links.link("ro", roId, "tool", toolId, "required-tool"); };
  ros.unpinTool = function (roId, toolId) { return links.unlink("ro", roId, "tool", toolId, "required-tool"); };
  // Resolves { documents: [{ link, doc, latest, newer }], tools: [{ link, tool }] }.
  // doc is null when the pinned version has since been deleted (the link
  // keeps its li/ver snapshot so the RO still says what was used).
  ros.references = function (roId) {
    return db.run(["links", "documents", "tools"], "readonly", function (api) {
      return api.req(api.store("links").index("from").getAll(["ro", roId])).then(function (ls) {
        var dl = ls.filter(function (l) { return l.kind === "reference" && l.toType === "document"; });
        var tl = ls.filter(function (l) { return l.kind === "required-tool" && l.toType === "tool"; });
        var docsP = Promise.all(dl.map(function (l) {
          return api.req(api.store("documents").get(l.toId)).then(function (doc) {
            var li = (doc && doc.li) || l.li || "";
            if (!li) return { link: l, doc: doc || null, latest: doc || null, newer: false };
            return api.req(api.store("documents").index("li").getAll(li)).then(function (vers) {
              var latest = vers.reduce(function (best, d) { return !best || verNum(d) > verNum(best) ? d : best; }, null);
              var pinned = doc ? verNum(doc) : (parseFloat(l.ver) || 0);
              return { link: l, doc: doc || null, latest: latest, newer: !!(latest && verNum(latest) > pinned) };
            });
          });
        }));
        var toolsP = Promise.all(tl.map(function (l) {
          return api.req(api.store("tools").get(l.toId)).then(function (t) { return { link: l, tool: t || null }; });
        }));
        return Promise.all([docsP, toolsP]).then(function (r) { return { documents: r[0], tools: r[1] }; });
      });
    });
  };

  // ---- trash ----
  // Delete a repair order = move it to the trash. opts.attachments decides
  // what happens to its files:
  //   "keep"   (default) files and links stay, so a restore brings them back
  //   "unlink" the attachment links go; the files stay in Files
  //   "trash"  the files go to the trash too, except one still attached to
  //            another live repair order (reported in `kept`)
  // Resolves { trashed: [fileIds], unlinked: n, kept: [fileIds] }.
  ros.trash = function (id, opts) {
    var mode = (opts && opts.attachments) || "keep";
    var out = { trashed: [], unlinked: 0, kept: [] };
    var linkIds = [], fileIds = [];
    var t = now();
    return db.run(["ros", "links", "files"], "readwrite", function (api) {
      return api.req(api.store("ros").get(id)).then(function (r) {
        if (!r) throw new Error("Not found: " + id);
        r.deletedAt = r.deletedAt || t;
        return ros._write(api, r);
      }).then(function () {
        return api.req(api.store("links").index("from").getAll(["ro", id]));
      }).then(function (ls) {
        var att = ls.filter(function (l) { return l.kind === "attachment" && l.toType === "file"; });
        if (mode === "unlink") {
          out.unlinked = att.length;
          return Promise.all(att.map(function (l) { linkIds.push(l.id); return api.req(api.store("links").delete(l.id)); }));
        }
        if (mode !== "trash") return null;
        var chain = Promise.resolve();
        att.forEach(function (l) {
          chain = chain.then(function () {
            return api.req(api.store("links").index("to").getAll(["file", l.toId])).then(function (others) {
              var otherRos = others.filter(function (o) { return o.fromType === "ro" && o.fromId !== id && o.kind === "attachment"; }).map(function (o) { return o.fromId; });
              return Promise.all(otherRos.map(function (rid) { return api.req(api.store("ros").get(rid)); })).then(function (rs) {
                if (rs.some(function (x) { return x && !x.deletedAt; })) { out.kept.push(l.toId); return null; }
                return api.req(api.store("files").get(l.toId)).then(function (f) {
                  if (!f || f.deletedAt) return null;
                  f.deletedAt = t; fileIds.push(f.id); out.trashed.push(f.id);
                  return files._write(api, f);
                });
              });
            });
          });
        });
        return chain;
      });
    }).then(function () {
      emit("ros:changed", { ids: [id], op: "trash" });
      if (linkIds.length) emit("links:changed", { ids: linkIds, op: "remove" });
      if (fileIds.length) emit("files:changed", { ids: fileIds, op: "trash" });
      return out;
    });
  };
  // Bring a repair order back (its files stay wherever they are — a file
  // trashed with it is restored too when opts.files is true).
  ros.restore = function (id, opts) {
    var fileIds = [];
    return db.run(["ros", "links", "files"], "readwrite", function (api) {
      return api.req(api.store("ros").get(id)).then(function (r) {
        if (!r) throw new Error("Not found: " + id);
        if (!r.deletedAt) return null;
        delete r.deletedAt;
        return ros._write(api, r).then(function () {
          if (!(opts && opts.files)) return null;
          return api.req(api.store("links").index("from").getAll(["ro", id])).then(function (ls) {
            return Promise.all(ls.filter(function (l) { return l.kind === "attachment"; }).map(function (l) {
              return api.req(api.store("files").get(l.toId)).then(function (f) {
                if (!f || !f.deletedAt) return null;
                delete f.deletedAt; fileIds.push(f.id);
                return files._write(api, f);
              });
            }));
          });
        });
      });
    }).then(function () {
      emit("ros:changed", { ids: [id], op: "restore" });
      if (fileIds.length) emit("files:changed", { ids: fileIds, op: "restore" });
    });
  };
  // Delete for good. Refused (resolves { purged: false, refs }) while
  // anything links TO the repair order; its own links (attachments,
  // references) go with it — the files themselves stay.
  ros.purge = function (id) {
    var linkIds = [], refs = [];
    return db.run(["ros", "links"], "readwrite", function (api) {
      var ls = api.store("links");
      return Promise.all([api.req(ls.index("to").getAll(["ro", id])), api.req(ls.index("from").getAll(["ro", id]))]).then(function (r) {
        if (r[0].length) { refs = r[0].map(function (l) { return { type: l.fromType, id: l.fromId, kind: l.kind }; }); return null; }
        return Promise.all(r[1].map(function (l) { linkIds.push(l.id); return api.req(ls.delete(l.id)); }).concat([api.req(api.store("ros").delete(id))]));
      });
    }).then(function () {
      if (refs.length) return { purged: false, refs: refs };
      emit("ros:changed", { ids: [id], op: "remove" });
      if (linkIds.length) emit("links:changed", { ids: linkIds, op: "remove" });
      return { purged: true, refs: [] };
    });
  };

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

  // ---------- vehicles ----------
  // One record per VIN: { vin, fin?, series, model?, checkDigit (true/false),
  // status: "extracted" | "check-digit-ok" | "confirmed", confirmedAt?,
  // sources[], notes }. A VIN is recorded when the RO scanner reads one or a
  // technician saves an RO with it; only a person confirms it.
  var vehicles = new Repo("vehicles");
  function vinOk(v) { var c = global.FDCore && global.FDCore.vin; return !!(c && c.vinCheckOk && c.vinCheckOk(v)); }
  function seriesOf(v) { var i = global.FDCore && global.FDCore.ids; return i && i.seriesOfVin ? i.seriesOfVin(v) : ""; }
  vehicles.canon = function (v) { return String(v || "").replace(/\s+/g, "").toUpperCase(); };
  vehicles.prepare = function (v, existing) {
    v.vin = vehicles.canon(v.vin);
    v.checkDigit = vinOk(v.vin);
    v.series = v.series || seriesOf(v.vin) || "";
    v.status = v.confirmedAt ? "confirmed" : (v.checkDigit ? "check-digit-ok" : "extracted");
    v.sources = Array.isArray(v.sources) ? v.sources : [];
    v.notes = v.notes || "";
    v.createdAt = v.createdAt || (existing && existing.createdAt) || now();
    v.updatedAt = now();
  };
  vehicles.validate = function (v, existing, api) {
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(v.vin)) api.abort(new Error("Not a VIN: " + v.vin));
    return null;
  };
  // Record that a VIN was seen (source: "ro-scan", "ro", "files"…), keeping
  // what is already known (a confirmation, notes, a FIN) — upsert, never a
  // downgrade. Resolves the record.
  vehicles.note = function (vin, info) {
    vin = vehicles.canon(vin);
    info = info || {};
    return db.run(["vehicles"], "readwrite", function (api) {
      return api.req(api.store("vehicles").get(vin)).then(function (cur) {
        var rec = Object.assign({}, cur || { vin: vin });
        if (info.fin && !rec.fin) rec.fin = String(info.fin).toUpperCase();
        if (info.model && !rec.model) rec.model = info.model;
        rec.sources = (rec.sources || []).slice();
        if (info.source && rec.sources.indexOf(info.source) === -1) rec.sources.push(info.source);
        return vehicles._write(api, rec);
      });
    }).then(function (r) { if (r) emit("vehicles:changed", { ids: [r.vin], op: "put" }); return r; });
  };
  // A technician confirms (or withdraws a confirmation of) the VIN.
  vehicles.confirm = function (vin, yes) {
    vin = vehicles.canon(vin);
    return db.run(["vehicles"], "readwrite", function (api) {
      return api.req(api.store("vehicles").get(vin)).then(function (cur) {
        var rec = Object.assign({}, cur || { vin: vin, sources: ["user"] });
        if (yes === false) delete rec.confirmedAt; else rec.confirmedAt = now();
        return vehicles._write(api, rec);
      });
    }).then(function (r) { if (r) emit("vehicles:changed", { ids: [r.vin], op: "put" }); return r; });
  };
  // Everything about one car from ONE read: its record (null when never
  // recorded), its live files and repair orders, and the LI documents and
  // tools that fit its model series (counts, plus the first few).
  vehicles.summary = function (vin, opts) {
    vin = vehicles.canon(vin);
    var max = (opts && opts.max) || 8;
    var ids = global.FDCore && global.FDCore.ids;
    var series = seriesOf(vin);
    return db.run(["vehicles", "files", "ros", "documents", "tools"], "readonly", function (api) {
      return Promise.all([
        api.req(api.store("vehicles").get(vin)),
        api.req(api.store("files").index("vins").getAll(vin)),
        api.req(api.store("ros").index("vin").getAll(vin)),
        series ? api.req(api.store("documents").getAll()) : Promise.resolve([]),
        series ? api.req(api.store("tools").getAll()) : Promise.resolve([]),
      ]);
    }).then(function (r) {
      var v = r[0] || null;
      var s = (v && v.series) || series;
      var fl = r[1].filter(function (f) { return !f.deletedAt && f.inFiles; }).sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
      var rl = r[2].filter(function (x) { return !x.deletedAt; }).sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
      var docs = s && ids ? r[3].filter(function (d) { return ids.modelsOfValidity(d.validity).indexOf(s) !== -1; }) : [];
      var tl = s && ids ? r[4].filter(function (t) { return ids.toolFitsModel(t, s); }) : [];
      return {
        vin: vin, series: s || "", vehicle: v, checkDigit: vinOk(vin),
        files: { count: fl.length, items: fl.slice(0, max) },
        ros: { count: rl.length, items: rl.slice(0, max) },
        documents: { count: docs.length, items: docs.slice(0, max) },
        tools: { count: tl.length, items: tl.slice(0, max) },
      };
    });
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
    files: files, documents: documents, tools: tools, photos: photos, ros: ros, links: links, vehicles: vehicles, jobs: jobs, settings: settings, log: log,
    Repo: Repo, RevConflict: RevConflict, RoConflict: RoConflict, uid: uid, LI_COLLECTION: LI_COLLECTION,
  };
  data.uid = uid;
})(typeof self !== "undefined" ? self : globalThis);
