/*
 * blob-integrity.js — full-byte Blob comparison.
 *
 * equalBlobs(source, stored) returns true only when the two Blobs are the same
 * size AND every byte matches. It reads both in fixed-size slices and compares
 * chunk by chunk, stopping at the first difference, so a multi-GB file is never
 * copied into a single ArrayBuffer. This replaces a first-eight-bytes check
 * that treated same-size mid-file corruption as identical.
 *
 * Loads as a classic browser script (window.FileVaultIntegrity) and is also
 * consumable from Node (it attaches to globalThis / self).
 */
(function (root) {
  "use strict";

  async function equalBlobs(source, stored, chunkSize) {
    if (!source || !stored) return false;
    if (source.size !== stored.size) return false;
    if (source.size === 0) return true;
    var step = chunkSize || 1024 * 1024; // 1 MiB
    for (var off = 0; off < source.size; off += step) {
      var end = Math.min(off + step, source.size);
      var a = new Uint8Array(await source.slice(off, end).arrayBuffer());
      var b = new Uint8Array(await stored.slice(off, end).arrayBuffer());
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
      }
    }
    return true;
  }

  root.FileVaultIntegrity = { equalBlobs: equalBlobs };
})(typeof self !== "undefined" ? self : globalThis);
