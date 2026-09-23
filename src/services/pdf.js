/*
 * src/services/pdf.js — the one PDF.js for every page.
 *
 * PDF.js is ~1.5 MB (main bundle + worker), so it is loaded the first time a
 * page needs it — a Vault with no PDFs, an LI tab that was only opened to
 * search, never pay for it. `load()` injects `vendor/pdf.min.js` once, waits
 * for the v4 bundle's readiness promise (it finishes initializing in a
 * microtask), points it at `vendor/pdf.worker.min.js`, and resolves with the
 * library; every caller shares that one promise. A failed load is forgotten
 * so a later call can retry.
 *
 *   FDServices.pdf.load()   → Promise<pdfjsLib>
 *   FDServices.pdf.lib      the library once loaded, else null
 *   FDServices.pdf.attachments(blob, { maxPages })
 *                           → Promise<[{ name, description, size, type,
 *                             page, blob }]>: the files embedded in a PDF —
 *                             the document's attachments (EmbeddedFiles) and
 *                             paperclip annotations on its pages (page > 0)
 *
 * `window.__PDFJS_SRC` / `window.__PDFJS_WORKER` override the file locations
 * (tests). Callers still pass `isEvalSupported: false` to getDocument — the
 * static policy check (tools/test-static.mjs) insists on it at every call.
 */
(function (global) {
  "use strict";
  var V = global.FDServices.vendor;
  var SRC = global.__PDFJS_SRC || V.url("pdf.min.js");
  var WORKER = global.__PDFJS_WORKER || V.url("pdf.worker.min.js");
  var libP = null;

  function load() {
    if (libP) return libP;
    libP = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = SRC;
      s.onload = function () {
        Promise.resolve(global.pdfjsLibPromise || global.pdfjsLib).then(function (lib) {
          lib = lib || global.pdfjsLib;
          if (!lib) throw new Error("The PDF reader didn't start.");
          try { lib.GlobalWorkerOptions.workerSrc = WORKER; } catch (e) {}
          return lib;
        }).then(res, function (e) { libP = null; rej(e); });
      };
      s.onerror = function () { libP = null; rej(new Error("Couldn't load the PDF reader.")); };
      document.head.appendChild(s);
    });
    return libP;
  }

  // A type for an embedded file from its name (PDFs rarely record one).
  var MIME = {
    txt: "text/plain", log: "text/plain", csv: "text/csv", tsv: "text/tab-separated-values", md: "text/markdown",
    json: "application/json", xml: "application/xml", html: "text/html", htm: "text/html",
    pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml", tif: "image/tiff", tiff: "image/tiff",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
    zip: "application/zip", "7z": "application/x-7z-compressed",
    doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  function mimeOf(name) {
    var ext = String(name || "").toLowerCase().split(".").pop();
    return MIME[ext] || "application/octet-stream";
  }
  function baseName(n) { return String(n || "").split(/[\\/]/).pop() || "attachment"; }

  // Every file embedded in the PDF: the catalogue's attachments first, then
  // each page's FileAttachment annotations (up to opts.maxPages pages), the
  // same bytes listed once. The PDF itself is parsed in PDF.js's worker.
  function attachments(blob, opts) {
    opts = opts || {};
    var maxPages = opts.maxPages || 300;
    return load().then(function (lib) {
      return blob.arrayBuffer().then(function (buf) {
        return lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
      });
    }).then(function (doc) {
      var out = [], seen = {};
      // description: PDF.js 4.2 passes a file spec's name and bytes but not
      // its /Desc, so a catalogue attachment has none; a paperclip
      // annotation's note (its Contents) is used for its file.
      // The same file (name and bytes) listed by the catalogue and by a
      // paperclip is shown once; an equal name and size is only a hint, the
      // bytes decide. An empty file is still a file.
      function same(a, b) {
        for (var j = 0; j < a.length; j++) if (a[j] !== b[j]) return false;
        return true;
      }
      function add(f, page, note) {
        if (!f || !f.content) return;
        var name = baseName(f.filename);
        var key = name + ":" + f.content.length;
        var prior = seen[key] || (seen[key] = []);
        if (prior.some(function (c) { return same(c, f.content); })) return;
        prior.push(f.content);
        var type = mimeOf(name);
        out.push({ name: name, description: f.description || note || "", size: f.content.length, type: type, page: page || 0, blob: new Blob([f.content], { type: type }) });
      }
      var n = Math.min(doc.numPages || 0, maxPages), i = 1;
      function pages() {
        if (i > n) return Promise.resolve();
        var p = i++;
        return doc.getPage(p).then(function (pg) { return pg.getAnnotations({ intent: "display" }); }).then(function (an) {
          (an || []).forEach(function (a) {
            if (a && a.subtype === "FileAttachment" && a.file) add(a.file, p, (a.contentsObj && a.contentsObj.str) || "");
          });
        }, function () {}).then(pages);
      }
      return Promise.resolve(doc.getAttachments()).then(function (att) {
        Object.keys(att || {}).forEach(function (k) { add(att[k], 0); });
      }, function () {}).then(pages).then(function () {
        try { doc.destroy(); } catch (e) {}
        return out;
      }, function (e) { try { doc.destroy(); } catch (x) {} throw e; });
    });
  }

  global.FDServices.pdf = {
    attachments: attachments,
    mimeOf: mimeOf,
    load: load,
    SRC: SRC,
    WORKER: WORKER,
    get lib() { return global.pdfjsLib || null; },
  };
})(typeof self !== "undefined" ? self : globalThis);
