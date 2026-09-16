/*
 * zip.js — the minimal ZIP the Extract page needs: read a classic (32-bit)
 * archive's entries by its central directory, inflate STORE or DEFLATE
 * entries, and write a STORE archive with CRC-32s.
 *
 * Moved verbatim out of viewer.html (REWRITE-PLAN.md Phase 1). Not ZIP64:
 * sizes and offsets are 32-bit and the entry count 16-bit, so output tops
 * out around 4 GiB. Classic <script> (window.FDCore.formats.zip) and
 * side-effect import from Node.
 */
(function (global) {
  "use strict";

  // Find the End Of Central Directory record in the last 64 KB + 22 bytes,
  // list the entries, and resolve each one's data range via its local header.
  function readEntries(file) {
    var tailLen = Math.min(file.size, 65558);
    return file.slice(file.size - tailLen).arrayBuffer().then(function (tail) {
      var t = new Uint8Array(tail), eocd = -1;
      for (var i = t.length - 22; i >= 0; i--) {
        if (t[i] === 0x50 && t[i + 1] === 0x4b && t[i + 2] === 0x05 && t[i + 3] === 0x06) { eocd = i; break; }
      }
      if (eocd < 0) throw new Error("Damaged ZIP (no directory found).");
      var dv = new DataView(tail, eocd);
      var count = dv.getUint16(10, true);
      var cdSize = dv.getUint32(12, true);
      var cdOff = dv.getUint32(16, true);
      return file.slice(cdOff, cdOff + cdSize).arrayBuffer().then(function (cd) {
        var c = new DataView(cd), u8 = new Uint8Array(cd), pos = 0, list = [];
        var td = new TextDecoder();
        for (var n = 0; n < count; n++) {
          if (c.getUint32(pos, true) !== 0x02014b50) break;
          var method = c.getUint16(pos + 10, true);
          var compSize = c.getUint32(pos + 20, true);
          var nameLen = c.getUint16(pos + 28, true);
          var extraLen = c.getUint16(pos + 30, true);
          var cmtLen = c.getUint16(pos + 32, true);
          var lho = c.getUint32(pos + 42, true);
          var name = td.decode(u8.subarray(pos + 46, pos + 46 + nameLen));
          list.push({ name: name, method: method, compSize: compSize, lho: lho });
          pos += 46 + nameLen + extraLen + cmtLen;
        }
        // Resolve each entry's data offset via its local header (variable-size).
        return Promise.all(list.map(function (en) {
          return file.slice(en.lho, en.lho + 30).arrayBuffer().then(function (lh) {
            var l = new DataView(lh);
            var dataOff = en.lho + 30 + l.getUint16(26, true) + l.getUint16(28, true);
            en.data = file.slice(dataOff, dataOff + en.compSize);
            return en;
          });
        }));
      });
    });
  }
  function inflateEntry(en, type) {
    if (en.method === 0) return Promise.resolve(en.data.slice(0, en.data.size, type));
    if (en.method === 8 && typeof DecompressionStream !== "undefined") {
      var ds = new DecompressionStream("deflate-raw");
      return new Response(en.data.stream().pipeThrough(ds)).blob().then(function (b) { return b.slice(0, b.size, type); });
    }
    return Promise.reject(new Error("Unsupported compression in ZIP."));
  }

  // ---------- writer (STORE — the contents are already-compressed formats) ----------
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8, crc) {
    crc = (crc == null ? 0xffffffff : crc) >>> 0;
    for (var i = 0; i < u8.length; i++) crc = CRC_TABLE[(crc ^ u8[i]) & 0xff] ^ (crc >>> 8);
    return crc >>> 0;
  }
  // entries: [{ path, blob }]. onProgress(index1, total, path) is called before
  // each entry is read. One file at a time is held in memory for its CRC; the
  // Blob reference (not a copy) then goes into the output parts.
  async function build(entries, onProgress) {
    var enc = new TextEncoder();
    var parts = [], central = [], offset = 0;
    var now = new Date();
    var dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
    var dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
    for (var i = 0; i < entries.length; i++) {
      var en = entries[i];
      if (onProgress) onProgress(i + 1, entries.length, en.path);
      var buf = new Uint8Array(await en.blob.arrayBuffer());
      var crc = (crc32(buf) ^ 0xffffffff) >>> 0;
      var nameBytes = enc.encode(en.path);
      var lh = new ArrayBuffer(30); var v = new DataView(lh);
      v.setUint32(0, 0x04034b50, true);
      v.setUint16(4, 20, true);          // version needed
      v.setUint16(6, 0x0800, true);      // UTF-8 names
      v.setUint16(8, 0, true);           // method: store
      v.setUint16(10, dosTime, true); v.setUint16(12, dosDate, true);
      v.setUint32(14, crc, true);
      v.setUint32(18, buf.length, true); v.setUint32(22, buf.length, true);
      v.setUint16(26, nameBytes.length, true); v.setUint16(28, 0, true);
      parts.push(lh, nameBytes, en.blob);
      central.push({ name: nameBytes, crc: crc, size: buf.length, offset: offset });
      offset += 30 + nameBytes.length + buf.length;
      buf = null;
    }
    var cdStart = offset, cdSize = 0;
    central.forEach(function (c) {
      var ch = new ArrayBuffer(46); var v = new DataView(ch);
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, 20, true); v.setUint16(6, 20, true);
      v.setUint16(8, 0x0800, true); v.setUint16(10, 0, true);
      v.setUint16(12, dosTime, true); v.setUint16(14, dosDate, true);
      v.setUint32(16, c.crc, true);
      v.setUint32(20, c.size, true); v.setUint32(24, c.size, true);
      v.setUint16(28, c.name.length, true);
      v.setUint32(42, c.offset, true);
      parts.push(ch, c.name);
      cdSize += 46 + c.name.length;
    });
    var eocd = new ArrayBuffer(22); var e = new DataView(eocd);
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, central.length, true); e.setUint16(10, central.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, cdStart, true);
    parts.push(eocd);
    return new Blob(parts, { type: "application/zip" });
  }

  var core = global.FDCore = global.FDCore || {};
  core.formats = core.formats || {};
  core.formats.zip = { readEntries: readEntries, inflateEntry: inflateEntry, crc32: crc32, build: build, MAX_STORE_BYTES: 0xFFFF0000 };
})(typeof self !== "undefined" ? self : globalThis);
