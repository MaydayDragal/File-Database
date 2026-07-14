/*
 * db.js — IndexedDB storage layer for File Vault.
 *
 * All data (file blobs + metadata) lives on this device inside the browser's
 * IndexedDB. Nothing is uploaded anywhere. This module exposes a small async
 * API used by app.js.
 */
(function (global) {
  "use strict";

  const DB_NAME = "file-vault";
  const DB_VERSION = 1;
  const STORE = "files";
  const META = "meta";

  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: "id" });
          os.createIndex("kind", "kind", { unique: false });
          os.createIndex("collection", "collection", { unique: false });
          os.createIndex("starred", "starred", { unique: false });
          os.createIndex("updatedAt", "updatedAt", { unique: false });
          os.createIndex("tags", "tags", { unique: false, multiEntry: true });
        }
        if (!db.objectStoreNames.contains(META)) {
          db.createObjectStore(META, { keyPath: "key" });
        }
      };
      req.onsuccess = () => {
        _db = req.result;
        _db.onversionchange = () => { _db.close(); _db = null; };
        resolve(_db);
      };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(mode, storeName) {
    return open().then((db) => {
      const t = db.transaction(storeName || STORE, mode);
      return t.objectStore(storeName || STORE);
    });
  }

  function reqAsPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  const DB = {
    /** Persist a full record (creates or replaces by id). */
    async put(record) {
      const store = await tx("readwrite");
      await reqAsPromise(store.put(record));
      return record;
    },

    /** Fetch one record (including blob) by id. */
    async get(id) {
      const store = await tx("readonly");
      return reqAsPromise(store.get(id));
    },

    /** Delete a record by id. */
    async remove(id) {
      const store = await tx("readwrite");
      return reqAsPromise(store.delete(id));
    },

    /**
     * Return lightweight metadata for every file (no blob payloads) so the
     * grid stays fast even with large collections. Blobs are loaded on demand.
     */
    async listMeta() {
      const store = await tx("readonly");
      return new Promise((resolve, reject) => {
        const out = [];
        const cursorReq = store.openCursor();
        cursorReq.onerror = () => reject(cursorReq.error);
        cursorReq.onsuccess = (e) => {
          const cur = e.target.result;
          if (!cur) return resolve(out);
          const v = cur.value;
          out.push({
            id: v.id,
            name: v.name,
            type: v.type,
            kind: v.kind,
            size: v.size,
            tags: v.tags || [],
            collection: v.collection || "",
            note: v.note || "",
            starred: !!v.starred,
            createdAt: v.createdAt,
            updatedAt: v.updatedAt,
            thumb: v.thumb || null, // small Blob or null
            srcMtime: v.srcMtime,   // folder-sync source mtime (if imported by sync)
            vins: v.vins || [],     // VINs detected in the file (VIN scan)
            fins: v.fins || [],     // FIN / datacard numbers detected (kept apart from VINs)
            vinScan: v.vinScan || 0,// when the file was last scanned for VINs (0 = never)
          });
          cur.continue();
        };
      });
    },

    /** Merge partial metadata changes into an existing record. */
    async update(id, patch) {
      const store = await tx("readwrite");
      const existing = await reqAsPromise(store.get(id));
      if (!existing) throw new Error("Not found: " + id);
      const merged = Object.assign(existing, patch, { updatedAt: Date.now() });
      merged.searchText = DB.buildSearchText(merged);
      await reqAsPromise(store.put(merged));
      return merged;
    },

    buildSearchText(r) {
      return [r.name, r.collection, r.note, (r.tags || []).join(" "), (r.vins || []).join(" "), (r.fins || []).join(" ")]
        .join(" ")
        .toLowerCase();
    },

    async count() {
      const store = await tx("readonly");
      return reqAsPromise(store.count());
    },

    async clearAll() {
      const store = await tx("readwrite");
      return reqAsPromise(store.clear());
    },

    /** Iterate every full record (with blobs) — used for export/backup. */
    async each(cb) {
      const store = await tx("readonly");
      return new Promise((resolve, reject) => {
        const cursorReq = store.openCursor();
        cursorReq.onerror = () => reject(cursorReq.error);
        cursorReq.onsuccess = (e) => {
          const cur = e.target.result;
          if (!cur) return resolve();
          cb(cur.value);
          cur.continue();
        };
      });
    },

    async getMeta(key, fallback) {
      const store = await tx("readonly", META);
      const v = await reqAsPromise(store.get(key));
      return v ? v.value : fallback;
    },

    async setMeta(key, value) {
      const store = await tx("readwrite", META);
      return reqAsPromise(store.put({ key, value }));
    },
  };

  global.VaultDB = DB;
})(window);
