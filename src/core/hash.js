/*
 * hash.js — SHA-256 of a Blob, ArrayBuffer, typed array or string, as a
 * lower-case hex string.
 *
 * Content-addressed blobs (REWRITE-PLAN.md §4) and backup/migration
 * verification both need a hash of every file's bytes. WebCrypto's
 * subtle.digest is fast but needs the whole input in one ArrayBuffer, so
 * blobs above SUBTLE_MAX are hashed by the streaming pure-JS implementation
 * below, one slice at a time, and a multi-GB video never sits in memory.
 *
 * Classic <script> (window.FDCore.hash) and side-effect import from Node.
 */
(function (global) {
  "use strict";

  var SUBTLE_MAX = 256 * 1024 * 1024;   // one ArrayBuffer at most this big
  var CHUNK = 8 * 1024 * 1024;          // streaming slice size

  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  // Streaming SHA-256: update() with any number of byte arrays, digest() once.
  function Sha256() {
    this.h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    this.buf = new Uint8Array(64);
    this.bufLen = 0;
    this.len = 0;
    this.w = new Int32Array(64);
  }
  Sha256.prototype._block = function (bytes, off) {
    var w = this.w, h = this.h, i;
    for (i = 0; i < 16; i++) {
      w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
    }
    for (i = 16; i < 64; i++) {
      var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (i = 0; i < 64; i++) {
      var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      var ch = (e & f) ^ (~e & g);
      var t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  };
  Sha256.prototype.update = function (bytes) {
    var off = 0, n = bytes.length;
    this.len += n;
    if (this.bufLen) {
      var take = Math.min(64 - this.bufLen, n);
      this.buf.set(bytes.subarray(0, take), this.bufLen);
      this.bufLen += take; off = take;
      if (this.bufLen < 64) return this;
      this._block(this.buf, 0); this.bufLen = 0;
    }
    while (off + 64 <= n) { this._block(bytes, off); off += 64; }
    if (off < n) { this.buf.set(bytes.subarray(off), 0); this.bufLen = n - off; }
    return this;
  };
  Sha256.prototype.digest = function () {
    var len = this.len;
    var pad = new Uint8Array(((this.bufLen + 9 + 63) >> 6) << 6);
    pad.set(this.buf.subarray(0, this.bufLen), 0);
    pad[this.bufLen] = 0x80;
    var bitsHi = Math.floor(len / 0x20000000), bitsLo = (len * 8) >>> 0;
    var dv = new DataView(pad.buffer);
    dv.setUint32(pad.length - 8, bitsHi, false);
    dv.setUint32(pad.length - 4, bitsLo, false);
    this.bufLen = 0;
    for (var off = 0; off < pad.length; off += 64) this._block(pad, off);
    var out = new Uint8Array(32);
    for (var i = 0; i < 8; i++) {
      out[i * 4] = this.h[i] >>> 24; out[i * 4 + 1] = (this.h[i] >>> 16) & 255;
      out[i * 4 + 2] = (this.h[i] >>> 8) & 255; out[i * 4 + 3] = this.h[i] & 255;
    }
    return out;
  };

  function toHex(u8) {
    var s = "";
    for (var i = 0; i < u8.length; i++) s += (u8[i] < 16 ? "0" : "") + u8[i].toString(16);
    return s;
  }
  function toBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (typeof input === "string") return new TextEncoder().encode(input);
    throw new TypeError("sha256: unsupported input");
  }
  function subtleAvailable() {
    try { return !!(global.crypto && global.crypto.subtle && global.crypto.subtle.digest); } catch (e) { return false; }
  }
  function digestBytes(bytes) {
    if (subtleAvailable() && bytes.byteLength <= SUBTLE_MAX) {
      return global.crypto.subtle.digest("SHA-256", bytes).then(function (buf) { return toHex(new Uint8Array(buf)); })
        .catch(function () { return toHex(new Sha256().update(bytes).digest()); });
    }
    return Promise.resolve(toHex(new Sha256().update(bytes).digest()));
  }
  // The streaming path: one slice at a time, never the whole file.
  function digestBlobStreaming(blob) {
    var h = new Sha256(), off = 0;
    function next() {
      if (off >= blob.size) return Promise.resolve(toHex(h.digest()));
      var end = Math.min(off + CHUNK, blob.size);
      return blob.slice(off, end).arrayBuffer().then(function (buf) { h.update(new Uint8Array(buf)); off = end; return next(); });
    }
    return next();
  }

  // sha256(x) -> Promise<hex>. Blobs at or under SUBTLE_MAX go through
  // WebCrypto in one read; larger ones stream through the JS implementation.
  function sha256(input) {
    if (typeof Blob !== "undefined" && input instanceof Blob) {
      if (input.size <= SUBTLE_MAX && subtleAvailable()) return input.arrayBuffer().then(digestBytes);
      return digestBlobStreaming(input);
    }
    return digestBytes(toBytes(input));
  }

  var core = global.FDCore = global.FDCore || {};
  core.hash = { sha256: sha256, Sha256: Sha256, toHex: toHex, SUBTLE_MAX: SUBTLE_MAX, CHUNK: CHUNK };
})(typeof self !== "undefined" ? self : globalThis);
