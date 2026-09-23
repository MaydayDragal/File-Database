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

  global.FDServices.pdf = {
    load: load,
    SRC: SRC,
    WORKER: WORKER,
    get lib() { return global.pdfjsLib || null; },
  };
})(typeof self !== "undefined" ? self : globalThis);
