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
 *   FDServices.pdf.contents(blob, { maxPages })
 *                           → Promise<{ files, links }>:
 *                             files — [{ name, description, size, type, page,
 *                             blob }], the files embedded in a PDF: the
 *                             document's attachments (EmbeddedFiles) and
 *                             paperclip annotations on its pages (page > 0);
 *                             links — [{ name, url, target, host, page }],
 *                             links on its pages that point at a file kept
 *                             somewhere else (a web page saved as PDF lists
 *                             its attachments this way). url is set only for
 *                             an http(s) link; target is what the PDF says.
 *   FDServices.pdf.attachments(blob, opts) → Promise<files> (the above's files)
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

  // A link counts as a file when its text or its path names one, or its URL
  // is a download/attachment endpoint (XENTRY's attachment service is
  // .../attachment/v1/read/download/redirect?readKey=…).
  var FILE_NAME = /\.(pdf|docx?|xlsx?|xlsm|pptx?|csv|tsv|txt|log|rtf|odt|ods|zip|7z|rar|png|jpe?g|gif|bmp|webp|tiff?|heic|mp4|mov|avi|webm|mp3|wav|xml|json|html?)$/i;
  var FILE_URL = /(^|[\/?&=_-])(attachments?|download)([\/?&=_.-]|$)/i;
  function linkText(items, r) {
    var x1 = Math.min(r[0], r[2]) - 2, x2 = Math.max(r[0], r[2]) + 2, y1 = Math.min(r[1], r[3]) - 2, y2 = Math.max(r[1], r[3]) + 2;
    return items.filter(function (it) {
      var t = it.transform || [], w = it.width || 0, h = it.height || Math.abs(t[3] || 0);
      var cx = t[4] + w / 2, cy = t[5] + h / 2;
      return typeof it.str === "string" && cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2;
    }).map(function (it) { return it.str; }).join("").replace(/\s+/g, " ").trim();
  }
  function fileLink(a, items, page) {
    var target = String(a.unsafeUrl || a.url || "");
    if (!target || /^(mailto|tel|javascript):/i.test(target)) return null;
    var url = /^https?:\/\//i.test(a.url || "") ? a.url : "";
    var text = items ? linkText(items, a.rect || []) : "";
    var path = target, host = "";
    try { var u = new URL(url || target); path = decodeURIComponent(u.pathname); host = url ? u.host : ""; } catch (e) {}
    var fromPath = baseName(path.replace(/[?#].*$/, ""));
    if (!FILE_NAME.test(text) && !FILE_NAME.test(fromPath) && !FILE_URL.test(target)) return null;
    var name = FILE_NAME.test(text) ? text : FILE_NAME.test(fromPath) ? fromPath : (text || fromPath || target);
    return { name: name, url: url, target: target, host: host, page: page };
  }

  // Every file embedded in the PDF: the catalogue's attachments first, then
  // each page's FileAttachment annotations (up to opts.maxPages pages), the
  // same bytes listed once; and every link to a file kept elsewhere. The PDF
  // itself is parsed in PDF.js's worker.
  function attachments(blob, opts) {
    return contents(blob, opts).then(function (c) { return c.files; });
  }
  function contents(blob, opts) {
    opts = opts || {};
    var maxPages = opts.maxPages || 300;
    return load().then(function (lib) {
      return blob.arrayBuffer().then(function (buf) {
        return lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
      });
    }).then(function (doc) {
      var out = [], seen = {}, links = [], seenLink = {};
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
        return doc.getPage(p).then(function (pg) {
          return pg.getAnnotations({ intent: "display" }).then(function (an) {
            an = an || [];
            an.forEach(function (a) {
              if (a && a.subtype === "FileAttachment" && a.file) add(a.file, p, (a.contentsObj && a.contentsObj.str) || "");
            });
            // Links out of the document (not a jump within it, and not a
            // GoToE into one of its own attachments — those are listed above).
            var out_ = an.filter(function (a) { return a && a.subtype === "Link" && !a.attachment && (a.url || a.unsafeUrl); });
            if (!out_.length) return;
            return pg.getTextContent().then(function (tc) { return tc.items; }, function () { return null; }).then(function (items) {
              out_.forEach(function (a) {
                var l = fileLink(a, items, p);
                if (!l || seenLink[l.target + "\0" + l.name]) return;
                seenLink[l.target + "\0" + l.name] = 1;
                links.push(l);
              });
            });
          });
        }).then(null, function () {}).then(pages);
      }
      return Promise.resolve(doc.getAttachments()).then(function (att) {
        Object.keys(att || {}).forEach(function (k) { add(att[k], 0); });
      }, function () {}).then(pages).then(function () {
        try { doc.destroy(); } catch (e) {}
        return { files: out, links: links };
      }, function (e) { try { doc.destroy(); } catch (x) {} throw e; });
    });
  }

  global.FDServices.pdf = {
    attachments: attachments,
    contents: contents,
    mimeOf: mimeOf,
    load: load,
    SRC: SRC,
    WORKER: WORKER,
    get lib() { return global.pdfjsLib || null; },
  };
})(typeof self !== "undefined" ? self : globalThis);
