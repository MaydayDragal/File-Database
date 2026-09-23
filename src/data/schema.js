/*
 * schema.js — the one IndexedDB schema of the platform (REWRITE-PLAN.md §4).
 *
 * A "generation" is one database named file-database-<n>; every generation
 * has exactly this shape. The definition lives apart from db.js so the
 * browser suites can seed a database with the real stores and indexes
 * without loading the whole data layer.
 *
 * Keys that IndexedDB can index are strings, numbers, dates and arrays —
 * never booleans — so flags that are queried (files.inFiles) are stored as
 * 1 / 0. Classic <script> (window.FDSchema) and side-effect import from Node.
 */
(function (global) {
  "use strict";

  var NAME_PREFIX = "file-database";
  // 2 (Phase 5): vehicles; ros.deletedAt (trash); files.blobId (a record
  // that reuses another record's bytes after a duplicate review).
  var VERSION = 2;

  var STORES = {
    // Metadata only — bytes live in blobs/, previews in thumbs/. inFiles 1 =
    // shown in the Files app; 0 = owned by another feature (an LI document's
    // PDF, a transient Toolbox hand-off) until "copied to Files".
    // deletedAt set = in the trash (hidden everywhere but the Trash view).
    // blobId set = the bytes are another record's blobs row (reused after a
    // duplicate review); unset = blobs[id].
    files: { keyPath: "id", indexes: { kind: {}, collection: {}, updatedAt: {}, tags: { multiEntry: true }, vins: { multiEntry: true }, docId: {}, deletedAt: {}, inFiles: {}, blobId: {} } },
    // Immutable, content-addressed: { id (= the file id that stored it), blob, size, sha256 }.
    blobs: { keyPath: "id", indexes: { sha256: {} } },
    thumbs: { keyPath: "id" },
    documents: { keyPath: "id", indexes: { li: {}, fgroup: {}, added: {}, fileId: {} } },
    tools: { keyPath: "id", indexes: { toolNo: {}, svcGrp: {} } },
    photos: { keyPath: "id" },
    // roKey is the canonical RO number, unset while the number is blank, so
    // the unique index enforces D7 without colliding on empty drafts.
    ros: { keyPath: "id", indexes: { roKey: { unique: true }, vin: {}, updatedAt: {}, deletedAt: {} } },
    // One record per VIN (Phase 5): what the platform knows about the car —
    // FIN, model series, whether the VIN passed its check digit and whether
    // a technician confirmed it. Files, ROs, LI and tools are joined to it
    // by their own indexes, never copied here.
    vehicles: { keyPath: "vin", indexes: { series: {}, updatedAt: {} } },
    links: { keyPath: "id", indexes: { from: { keyPath: ["fromType", "fromId"] }, to: { keyPath: ["toType", "toId"] }, kind: {} } },
    jobs: { keyPath: "id", indexes: { state: {}, type: {}, createdAt: {} } },
    settings: { keyPath: "key" },
    log: { keyPath: "id", autoIncrement: true, indexes: { t: {} } },
  };
  var STORE_NAMES = Object.keys(STORES);

  // Create whatever is missing. Safe to call for a brand-new database and for
  // a later version bump alike.
  function upgrade(db, tx) {
    STORE_NAMES.forEach(function (name) {
      var def = STORES[name], os;
      if (!db.objectStoreNames.contains(name)) {
        os = db.createObjectStore(name, { keyPath: def.keyPath, autoIncrement: !!def.autoIncrement });
      } else {
        os = tx.objectStore(name);
      }
      Object.keys(def.indexes || {}).forEach(function (ix) {
        if (os.indexNames.contains(ix)) return;
        var d = def.indexes[ix];
        os.createIndex(ix, d.keyPath || ix, { unique: !!d.unique, multiEntry: !!d.multiEntry });
      });
    });
  }

  global.FDSchema = { NAME_PREFIX: NAME_PREFIX, VERSION: VERSION, STORES: STORES, STORE_NAMES: STORE_NAMES, upgrade: upgrade };
})(typeof self !== "undefined" ? self : globalThis);
