/*
 * container.js — the shape every File Database backup shares: a 4-byte
 * magic, a little-endian uint32 version, a uint32 metadata length, that many
 * bytes of UTF-8 JSON, then the payload bytes the metadata describes.
 * .fvault ("FVLT"), .tidb ("TIDB") and .fdb ("FDBK") are all this; .lidb is a ZIP.
 *
 * Moved out of vault/backup-format.js and viewer.html (REWRITE-PLAN.md
 * Phase 1). Classic <script> (window.FDCore.formats) and side-effect import
 * from Node.
 */
(function (global) {
  "use strict";

  function BackupFormatError(code, message) {
    this.name = "BackupFormatError";
    this.code = code;
    this.message = message || code;
  }
  BackupFormatError.prototype = Object.create(Error.prototype);
  BackupFormatError.prototype.constructor = BackupFormatError;

  // Which kind of backup is this? Decided from the first four bytes only, the
  // way the Extract page always has: the extension is not consulted.
  function sniff(file) {
    return file.slice(0, 4).arrayBuffer().then(function (buf) {
      var b = new Uint8Array(buf);
      var magic = String.fromCharCode.apply(null, b);
      if (magic === "FVLT") return "fvault";
      if (magic === "TIDB") return "tidb";
      if (magic === "FDBK") return "fdb";
      if (b[0] === 0x50 && b[1] === 0x4b) return "zip";      // "PK" — .lidb
      if (b[0] === 0x7b || b[0] === 0xef) return "json";     // "{" or BOM — legacy JSON backup
      return null;
    });
  }

  // The header and metadata, read the permissive way the Extract page does:
  // the version field is reported, not enforced.
  function readHeader(file, magic) {
    return file.slice(0, 12).arrayBuffer().then(function (buf) {
      var dv = new DataView(buf);
      var got = String.fromCharCode.apply(null, new Uint8Array(buf, 0, Math.min(4, buf.byteLength)));
      if (magic && got !== magic) throw new BackupFormatError("BAD_MAGIC", "Not a " + magic + " file.");
      var version = buf.byteLength >= 8 ? dv.getUint32(4, true) : 0;
      var metaLen = buf.byteLength >= 12 ? dv.getUint32(8, true) : 0;
      return file.slice(12, 12 + metaLen).text().then(function (txt) {
        return { magic: got, version: version, metaLen: metaLen, meta: JSON.parse(txt), payloadOffset: 12 + metaLen };
      });
    });
  }

  // Build the 12-byte header for a container about to be written.
  function header(magic, version, metaBytes) {
    var buf = new ArrayBuffer(12), dv = new DataView(buf);
    for (var i = 0; i < 4; i++) dv.setUint8(i, magic.charCodeAt(i));
    dv.setUint32(4, version, true);
    dv.setUint32(8, metaBytes.length, true);
    return buf;
  }

  var core = global.FDCore = global.FDCore || {};
  core.formats = core.formats || {};
  core.formats.BackupFormatError = BackupFormatError;
  core.formats.sniff = sniff;
  core.formats.readHeader = readHeader;
  core.formats.header = header;
})(typeof self !== "undefined" ? self : globalThis);
