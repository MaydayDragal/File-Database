/*
 * db.js — the File Vault's storage API (window.VaultDB), now an adapter over
 * the platform data layer (REWRITE-PLAN.md Phase 2).
 *
 * app.js keeps calling put/get/remove/listMeta/update/each/getMeta/setMeta
 * exactly as before; underneath, records live in the unified database:
 * metadata in `files`, bytes in `blobs` (content-addressed, immutable) and
 * previews in `thumbs`. A record handed out by get() carries the stored Blob
 * objects; putting it back with the same Blob writes metadata only (no
 * re-hash, no re-copy), while a new Blob is hashed, stored and verified.
 */
(function (global) {
  "use strict";

  const PREFIX = "vault.";
  const knownBlobs = new WeakMap();  // Blob -> file id it was read for
  const knownThumbs = new WeakMap(); // Blob -> file id it was read for

  function repos() { return global.FDData.repos; }
  function remember(rec) {
    if (rec && rec.blob instanceof Blob) knownBlobs.set(rec.blob, rec.id);
    if (rec && rec.thumb instanceof Blob) knownThumbs.set(rec.thumb, rec.id);
    return rec;
  }

  const DB = {
    /** Persist a full record (creates or replaces by id). */
    async put(record) {
      const files = repos().files;
      const isStoredBlob = record.blob instanceof Blob && knownBlobs.get(record.blob) === record.id;
      if (record.blob instanceof Blob && !isStoredBlob) {
        await files.putFull(record, { verify: true });
        remember(record);
        return record;
      }
      const { blob, thumb, ...meta } = record;
      await files.put(meta);
      if (thumb instanceof Blob && knownThumbs.get(thumb) !== record.id) {
        await files.setThumb(record.id, thumb);
        knownThumbs.set(thumb, record.id);
      }
      return record;
    },

    /** Fetch one record (including blob and thumb) by id. */
    async get(id) { return remember(await repos().files.getFull(id)); },

    /** Delete a record with its bytes, preview and links. */
    async remove(id) { return repos().files.removeFull(id); },

    /** Lightweight metadata for every Files record (thumbs attached, no bytes). */
    async listMeta() {
      const list = await repos().files.listMeta({ inFiles: 1 });
      list.forEach(remember);
      return list;
    },

    /** Merge partial metadata changes into an existing record. */
    async update(id, patch) { return repos().files.update(id, patch); },

    buildSearchText(r) { return repos().files.buildSearchText(r); },

    async count() { return repos().files.countInFiles(); },

    async clearAll() {
      const ids = (await repos().files.listMeta({ inFiles: 1 })).map((r) => r.id);
      return repos().files.removeManyFull(ids);
    },

    /** Iterate every full record (with blobs) — used for export/backup. */
    async each(cb) { return repos().files.eachFull((r) => cb(remember(r)), { inFiles: 1 }); },

    async getMeta(key, fallback) { return repos().settings.getValue(PREFIX + key, fallback); },
    async setMeta(key, value) { return repos().settings.setValue(PREFIX + key, value); },
  };

  global.VaultDB = DB;
})(window);
