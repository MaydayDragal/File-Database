/*
 * src/services/ocr.js — the text-recognition engine, loaded once, and a pool
 * of its workers.
 *
 * Tesseract.js is the one optional network dependency: the engine, its
 * worker/WASM runtime and the language data come from a CDN the first time a
 * page needs them (the service workers keep them afterwards). Four apps used
 * to carry the same loader; this is that loader, once.
 *
 *   FDServices.tess.LIB / WORK / CORE / LANG   the resource URLs
 *       (window.__TESS_LIB / __TESS_WORK / __TESS_CORE / __TESS_LANG override
 *       them — tests stub the engine that way)
 *   FDServices.tess.load()                     → Promise<Tesseract>
 *   FDServices.tess.createWorker(lang, opts)   → Promise<worker>, with the
 *       worker/core/language paths filled in; `opts` (e.g. a `logger`) is
 *       merged on top.
 *
 * The pool is the LI app's: workers are memory-heavy, so they are created on
 * demand up to a cap, reused across files, and lent out one at a time so
 * several scanned PDFs recognize on different cores while text PDFs never
 * spin one up.
 *
 *   var pool = FDServices.ocrPool.create({ max, lang });
 *   pool.acquire()   → Promise<worker>   waits for a free worker when all are busy
 *   pool.release(w)                       hand it back (or to the next waiter)
 *   pool.freeAll()                        terminate every worker, reject waiters
 *
 * acquire() is gated on load() FIRST: if the engine can't load (offline),
 * every request rejects promptly instead of some of them queuing as waiters
 * that would never be resolved — which once hung an import of more scanned
 * files than there are worker slots.
 */
(function (global) {
  "use strict";
  var CDN = "https://cdn.jsdelivr.net/npm", V = "5.1.1", CV = "5.1.0";
  var LIB = global.__TESS_LIB || (CDN + "/tesseract.js@" + V + "/dist/tesseract.min.js");
  var WORK = global.__TESS_WORK || (CDN + "/tesseract.js@" + V + "/dist/worker.min.js");
  var CORE = global.__TESS_CORE || (CDN + "/tesseract.js-core@" + CV + "/tesseract-core-simd.wasm.js");
  var LANG = global.__TESS_LANG || "https://tessdata.projectnaptha.com/4.0.0";

  var libP = null;
  function load() {
    if (global.Tesseract) return Promise.resolve(global.Tesseract);
    if (libP) return libP;
    libP = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = LIB;
      s.onload = function () {
        if (global.Tesseract) res(global.Tesseract);
        else { libP = null; rej(new Error("The text-recognition engine didn't start.")); }
      };
      s.onerror = function () {
        libP = null;
        rej(new Error("Couldn't download the text-recognition engine — it needs an internet connection the first time."));
      };
      document.head.appendChild(s);
    });
    return libP;
  }
  function createWorker(lang, opts) {
    return load().then(function (T) {
      return T.createWorker(lang || "eng", 1, Object.assign({ workerPath: WORK, corePath: CORE, langPath: LANG }, opts || {}));
    });
  }

  function defaultMax() { return Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, 4)); }
  function createPool(opts) {
    opts = opts || {};
    var max = opts.max || defaultMax(), lang = opts.lang || "eng";
    var all = [], idle = [], waiters = [], reserved = 0;
    function acquire() {
      if (idle.length) return Promise.resolve(idle.pop());
      return load().then(function () {
        if (idle.length) return idle.pop();
        if (reserved < max) {
          reserved++;
          return createWorker(lang)
            .then(function (w) { all.push(w); return w; }, function (e) { reserved--; wakeSlot(); throw e; });
        }
        return new Promise(function (res, rej) { waiters.push({ res: res, rej: rej }); });
      });
    }
    function release(w) { if (!w) return; var f = waiters.shift(); if (f) f.res(w); else idle.push(w); }
    // A reserved slot was freed without producing a worker — let a waiter retry it.
    function wakeSlot() { var f = waiters.shift(); if (f) acquire().then(f.res, f.rej); }
    function freeAll() {
      var ws = waiters; waiters = [];
      ws.forEach(function (f) { try { f.rej(new Error("OCR cancelled")); } catch (e) {} });
      var workers = all; all = []; idle = []; reserved = 0;
      workers.forEach(function (w) { try { w.terminate(); } catch (e) {} });
    }
    return { acquire: acquire, release: release, freeAll: freeAll, get size() { return all.length; }, max: max };
  }

  global.FDServices = global.FDServices || {};
  global.FDServices.tess = { LIB: LIB, WORK: WORK, CORE: CORE, LANG: LANG, load: load, createWorker: createWorker };
  global.FDServices.ocrPool = { create: createPool, defaultMax: defaultMax };
})(typeof self !== "undefined" ? self : globalThis);
