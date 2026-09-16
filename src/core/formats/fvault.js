/*
 * fvault.js — the File Vault backup: binary v2 ("FVLT" + u32 version + u32
 * metaLen + JSON + each file's blob bytes then thumbnail bytes, back to
 * back) and the older JSON form with base64 blobs.
 *
 * Two readers, both moved verbatim (REWRITE-PLAN.md Phase 1), because they
 * serve different jobs: parseBinary() (from vault/backup-format.js) validates
 * the ENTIRE file before returning any entry, so a truncated / overrun /
 * trailing-garbage backup is rejected up front and a restore leaves the
 * database untouched; readLoose() (from viewer.html) trusts the metadata and
 * slices what it describes, which is what recovering files from a backup
 * wants. Requires container.js. Classic <script> — defines
 * window.FDCore.formats.fvault and, for the Vault's restore, the old
 * window.FileVaultBackup — and side-effect import from Node.
 */
(function (global) {
  "use strict";
  var formats = global.FDCore.formats;
  var BackupFormatError = formats.BackupFormatError;

  var MAGIC = [0x46, 0x56, 0x4c, 0x54]; // "FVLT"

  function isNonNegInt(n) { return typeof n === "number" && isFinite(n) && n >= 0 && Math.floor(n) === n; }

  // file: a Blob/File. Returns { meta, entries:[{meta,blob,thumb,blobOffset,thumbOffset}] }.
  async function parseBinary(file) {
    var total = file.size;
    if (total < 12) throw new BackupFormatError("BAD_MAGIC", "File is too small to be a backup.");
    var head = new DataView(await file.slice(0, 12).arrayBuffer());
    for (var i = 0; i < 4; i++) {
      if (head.getUint8(i) !== MAGIC[i]) throw new BackupFormatError("BAD_MAGIC", "Not a File Vault backup (bad signature).");
    }
    var version = head.getUint32(4, true);
    if (version !== 2) throw new BackupFormatError("BAD_VERSION", "Unsupported backup version " + version + ".");
    var metaLen = head.getUint32(8, true);
    if (!isNonNegInt(metaLen) || 12 + metaLen > total) {
      throw new BackupFormatError("BAD_METADATA_LENGTH", "Metadata length runs past the end of the file.");
    }
    var meta;
    try {
      meta = JSON.parse(await file.slice(12, 12 + metaLen).text());
    } catch (e) {
      throw new BackupFormatError("BAD_METADATA", "Backup metadata is not valid JSON.");
    }
    if (!meta || meta.format !== "file-vault" || !Array.isArray(meta.files)) {
      throw new BackupFormatError("BAD_METADATA", "That doesn't look like a File Vault backup.");
    }

    var off = 12 + metaLen;
    var entries = [];
    for (var j = 0; j < meta.files.length; j++) {
      var f = meta.files[j];
      var blobLen = f.blobLen || 0;
      var thumbLen = f.thumbLen || 0;
      if (!isNonNegInt(blobLen)) throw new BackupFormatError("TRUNCATED_BLOB", "Record " + j + " has an invalid blob length.");
      if (!isNonNegInt(thumbLen)) throw new BackupFormatError("TRUNCATED_THUMB", "Record " + j + " has an invalid thumbnail length.");
      if (off + blobLen > total) throw new BackupFormatError("TRUNCATED_BLOB", "Record " + j + " (" + (f.name || "?") + ") blob runs past the end of the file.");
      var blobOffset = off;
      var blob = file.slice(off, off + blobLen, f.blobType || f.type || "application/octet-stream");
      off += blobLen;
      if (off + thumbLen > total) throw new BackupFormatError("TRUNCATED_THUMB", "Record " + j + " (" + (f.name || "?") + ") thumbnail runs past the end of the file.");
      var thumbOffset = off;
      var thumb = thumbLen ? file.slice(off, off + thumbLen, f.thumbType || "image/jpeg") : null;
      off += thumbLen;
      // Declared file size (when present) must match the stored blob length,
      // so a doctored header can't smuggle a smaller/larger payload.
      if (f.size != null && f.size !== blobLen) {
        throw new BackupFormatError("SIZE_MISMATCH", "Record " + j + " (" + (f.name || "?") + ") declares size " + f.size + " but stores " + blobLen + " bytes.");
      }
      entries.push({ meta: f, blob: blob, thumb: thumb, blobOffset: blobOffset, thumbOffset: thumbOffset });
    }
    // No payload bytes may be left over (or missing): the last offset must land
    // exactly on the end of the file, or something is truncated/appended.
    if (off !== total) {
      throw new BackupFormatError("TRAILING_BYTES", "Backup has " + (total - off) + " unexpected trailing byte(s).");
    }
    return { meta: meta, entries: entries };
  }

  // The Extract page's read: trust the metadata, slice each file's bytes out
  // (Blob.slice references the on-disk region — nothing is copied), skip the
  // thumbnails. Returns { meta, entries:[{meta, blob}] }.
  function readLoose(file) {
    return formats.readHeader(file).then(function (h) {
      var meta = h.meta;
      if (!meta || meta.format !== "file-vault" || !Array.isArray(meta.files)) throw new Error("Not a File Vault backup.");
      var off = h.payloadOffset, entries = [];
      meta.files.forEach(function (f) {
        var bl = f.blobLen || 0, tl = f.thumbLen || 0;
        var blob = file.slice(off, off + bl, f.blobType || f.type || "application/octet-stream");
        off += bl + tl; // skip the thumbnail (an internal preview, not user data)
        entries.push({ meta: f, blob: blob });
      });
      return { meta: meta, entries: entries };
    });
  }

  // The legacy JSON backup: base64 blobs inline. Records without a blob are
  // skipped, as they always were. Returns { meta, entries:[{meta, blob}] }.
  function readLegacyJson(file) {
    return file.text().then(function (txt) {
      var meta = JSON.parse(txt);
      if (!meta || meta.format !== "file-vault" || !Array.isArray(meta.files)) throw new Error("Not a File Vault backup.");
      var entries = [];
      meta.files.forEach(function (f) {
        if (!f.blob) return;
        var bin = atob(f.blob), u = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        entries.push({ meta: f, blob: new Blob([u], { type: f.blobType || f.type || "application/octet-stream" }) });
      });
      return { meta: meta, entries: entries };
    });
  }

  formats.fvault = { MAGIC: MAGIC, parseBinary: parseBinary, readLoose: readLoose, readLegacyJson: readLegacyJson, BackupFormatError: BackupFormatError };
  // The name the Vault's restore has always used.
  global.FileVaultBackup = { parseBinary: parseBinary, BackupFormatError: BackupFormatError };
})(typeof self !== "undefined" ? self : globalThis);
