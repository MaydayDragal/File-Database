/*
 * fdb.js — the File Database backup: ONE file for everything the platform
 * stores (files, LI documents, tools, repair orders, links, vehicles, settings) plus
 * every stored blob, thumbnail and photo.
 *
 * Layout is the shared container (container.js): "FDBK" + u32 version (1) +
 * u32 metaLen + JSON + payload bytes back to back. The JSON is
 *   { format: "file-database", version: 1, exportedAt, generation,
 *     records: { files:[…], documents:[…], tools:[…], ros:[…], links:[…], vehicles:[…], settings:[…] },
 *     payloads: [ { store: "blobs"|"thumbs"|"photos", id, len, type, sha256? }, … ] }
 * and the payload bytes follow in the order of `payloads`. Like the .fvault
 * validator (fvault.js parseBinary), parse() checks the WHOLE file before
 * returning a single entry, so a truncated / overrun / trailing-garbage
 * backup is rejected up front and a restore never half-writes a database.
 *
 * Requires container.js. Classic <script> (window.FDCore.formats.fdb) and
 * side-effect import from Node.
 */
(function (global) {
  "use strict";
  var formats = global.FDCore.formats;
  var BackupFormatError = formats.BackupFormatError;

  var MAGIC = "FDBK";
  var VERSION = 1;
  var FORMAT = "file-database";
  // vehicles joined in Phase 5; a backup made before then simply has none.
  var RECORD_STORES = ["files", "documents", "tools", "ros", "links", "vehicles", "settings"];
  var PAYLOAD_STORES = ["blobs", "thumbs", "photos"];

  function isNonNegInt(n) { return typeof n === "number" && isFinite(n) && n >= 0 && Math.floor(n) === n; }

  // meta: the JSON block (payloads[] describing each blob in order);
  // payloadBlobs: the Blobs in the same order. Returns the backup Blob,
  // assembled from parts by reference so nothing is copied into memory.
  function build(meta, payloadBlobs) {
    var m = Object.assign({}, meta, { format: FORMAT, version: VERSION });
    var payloads = m.payloads || [];
    if (payloads.length !== (payloadBlobs || []).length) throw new Error("fdb.build: payloads and blobs differ in length");
    for (var i = 0; i < payloads.length; i++) payloads[i].len = payloadBlobs[i].size;
    var metaBytes = new TextEncoder().encode(JSON.stringify(m));
    var parts = [formats.header(MAGIC, VERSION, metaBytes), metaBytes].concat(payloadBlobs || []);
    return new Blob(parts, { type: "application/octet-stream" });
  }

  // Strict reader: every check passes or a BackupFormatError names the reason.
  // Returns { meta, payloads: [{ store, id, type, sha256, len, blob }] } where
  // each blob is a slice of the file (nothing is read into memory here).
  function parse(file) {
    var total = file.size;
    if (total < 12) return Promise.reject(new BackupFormatError("BAD_MAGIC", "File is too small to be a backup."));
    return file.slice(0, 12).arrayBuffer().then(function (buf) {
      var dv = new DataView(buf);
      var magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
      if (magic !== MAGIC) throw new BackupFormatError("BAD_MAGIC", "Not a File Database backup (bad signature).");
      var version = dv.getUint32(4, true);
      if (version !== VERSION) throw new BackupFormatError("BAD_VERSION", "Unsupported backup version " + version + ".");
      var metaLen = dv.getUint32(8, true);
      if (!isNonNegInt(metaLen) || 12 + metaLen > total) throw new BackupFormatError("BAD_METADATA_LENGTH", "Metadata length runs past the end of the file.");
      return file.slice(12, 12 + metaLen).text().then(function (txt) {
        var meta;
        try { meta = JSON.parse(txt); } catch (e) { throw new BackupFormatError("BAD_METADATA", "Backup metadata is not valid JSON."); }
        if (!meta || meta.format !== FORMAT || !meta.records || typeof meta.records !== "object" || !Array.isArray(meta.payloads)) {
          throw new BackupFormatError("BAD_METADATA", "That doesn't look like a File Database backup.");
        }
        RECORD_STORES.forEach(function (s) {
          if (meta.records[s] != null && !Array.isArray(meta.records[s])) throw new BackupFormatError("BAD_METADATA", "Record list '" + s + "' is not an array.");
        });
        var off = 12 + metaLen, out = [];
        for (var j = 0; j < meta.payloads.length; j++) {
          var p = meta.payloads[j];
          if (!p || PAYLOAD_STORES.indexOf(p.store) === -1 || typeof p.id !== "string" || !p.id) {
            throw new BackupFormatError("BAD_METADATA", "Payload " + j + " has no valid store/id.");
          }
          if (!isNonNegInt(p.len)) throw new BackupFormatError("TRUNCATED_PAYLOAD", "Payload " + j + " has an invalid length.");
          if (off + p.len > total) throw new BackupFormatError("TRUNCATED_PAYLOAD", "Payload " + j + " (" + p.store + " " + p.id + ") runs past the end of the file.");
          out.push({ store: p.store, id: p.id, type: p.type || "application/octet-stream", sha256: p.sha256 || null, len: p.len, offset: off, blob: file.slice(off, off + p.len, p.type || "application/octet-stream") });
          off += p.len;
        }
        if (off !== total) throw new BackupFormatError("TRAILING_BYTES", "Backup has " + (total - off) + " unexpected trailing byte(s).");
        return { meta: meta, payloads: out };
      });
    });
  }

  formats.fdb = { MAGIC: MAGIC, VERSION: VERSION, FORMAT: FORMAT, RECORD_STORES: RECORD_STORES, PAYLOAD_STORES: PAYLOAD_STORES, build: build, parse: parse, BackupFormatError: BackupFormatError };
})(typeof self !== "undefined" ? self : globalThis);
