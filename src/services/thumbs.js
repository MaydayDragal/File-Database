/*
 * src/services/thumbs.js — preview images for stored files.
 *
 * Moved out of the Files app (REWRITE-PLAN.md Phase 3) unchanged: a canvas
 * re-encode for images, a frame grab for videos, the first page rendered
 * through the shared PDF.js (src/services/pdf.js) for PDFs. Every maker
 * resolves with a JPEG Blob, or null when the file can't be drawn
 * (encrypted, broken, unsupported) — the caller keeps the type icon.
 *
 *   FDServices.thumbs.make(file, kind)   kind: "image" | "video" | "pdf"
 *   FDServices.thumbs.image / video / pdf
 */
(function (global) {
  "use strict";
  var MAX = 360;

  function image(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var scale = Math.min(1, MAX / Math.max(img.width, img.height));
          var w = Math.max(1, Math.round(img.width * scale));
          var h = Math.max(1, Math.round(img.height * scale));
          var canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          canvas.toBlob(function (b) { URL.revokeObjectURL(url); resolve(b); }, "image/jpeg", 0.78);
        } catch (e) { URL.revokeObjectURL(url); resolve(null); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  function video(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var v = document.createElement("video");
      v.muted = true; v.preload = "metadata"; v.src = url;
      var done = false;
      var finish = function (blob) { if (done) return; done = true; URL.revokeObjectURL(url); resolve(blob); };
      v.onloadeddata = function () {
        try { v.currentTime = Math.min(1, (v.duration || 2) / 2); } catch (e) { finish(null); }
      };
      v.onseeked = function () {
        try {
          var scale = Math.min(1, MAX / Math.max(v.videoWidth || 1, v.videoHeight || 1));
          var canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round((v.videoWidth || 320) * scale));
          canvas.height = Math.max(1, Math.round((v.videoHeight || 180) * scale));
          canvas.getContext("2d").drawImage(v, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(function (b) { finish(b); }, "image/jpeg", 0.72);
        } catch (e) { finish(null); }
      };
      v.onerror = function () { finish(null); };
      setTimeout(function () { finish(null); }, 6000); // safety timeout
    });
  }

  async function pdf(file) {
    var lib = await global.FDServices.pdf.load();
    var buf = await file.arrayBuffer();
    var doc = await lib.getDocument({ data: buf, isEvalSupported: false, disableAutoFetch: true, disableStream: true }).promise;
    try {
      var page = await doc.getPage(1);
      var unit = page.getViewport({ scale: 1 });
      var scale = Math.min(2, MAX / Math.max(unit.width, unit.height) || 1);
      var vp = page.getViewport({ scale: scale });
      var canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(vp.width));
      canvas.height = Math.max(1, Math.ceil(vp.height));
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); // PDFs are transparent
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      return await new Promise(function (res) { canvas.toBlob(function (b) { res(b); }, "image/jpeg", 0.75); });
    } finally {
      try { doc.destroy(); } catch (e) {}
    }
  }

  async function make(file, kind) {
    try {
      if (kind === "image") return await image(file);
      if (kind === "video") return await video(file);
      if (kind === "pdf") return await pdf(file);
    } catch (e) { /* ignore */ }
    return null;
  }

  global.FDServices = global.FDServices || {};
  global.FDServices.thumbs = { make: make, image: image, video: video, pdf: pdf, MAX: MAX };
})(typeof self !== "undefined" ? self : globalThis);
