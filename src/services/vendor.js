/*
 * src/services/vendor.js — where the vendored libraries live, and one way to
 * load one on demand.
 *
 * Every third-party runtime the platform ships is a real file under
 * `vendor/` at the repository root (PDF.js main + worker, JSZip, pdf-lib):
 * one copy each, never inlined into a page (REWRITE-PLAN.md §3.4, Phase 3).
 * Pages sit at different depths (`/`, `li/`, `toolbox/`, …), so the root is
 * taken from this script's own <script src> rather than hard-coded.
 *
 *   FDServices.vendor.root         "…/File-Database/" (ends with a slash)
 *   FDServices.vendor.url(file)    "…/vendor/<file>"
 *   FDServices.vendor.load(file, ready)
 *       Injects <script src="…/vendor/<file>"> once and resolves with
 *       ready() — the global the library defines. The promise is cached, so
 *       every caller shares one load; a failed load is forgotten so the next
 *       call can retry (offline once is not offline forever).
 */
(function (global) {
  "use strict";
  var doc = global.document;
  var root = "./";
  try {
    var here = doc && doc.currentScript && doc.currentScript.src;
    var u = new URL(here || "src/services/vendor.js", global.location.href);
    root = u.href.replace(/src\/services\/vendor\.js(\?.*)?$/, "");
  } catch (e) { /* no document (tests) — relative root */ }

  var loads = {};
  function url(file) { return root + "vendor/" + file; }
  function load(file, ready) {
    if (loads[file]) return loads[file];
    loads[file] = new Promise(function (res, rej) {
      var have = ready ? ready() : null;
      if (have) { res(have); return; }
      var s = doc.createElement("script");
      s.src = url(file);
      s.onload = function () {
        var v = ready ? ready() : true;
        if (v) res(v);
        else { delete loads[file]; rej(new Error(file + " did not initialize")); }
      };
      s.onerror = function () { delete loads[file]; rej(new Error("Couldn't load " + file)); };
      doc.head.appendChild(s);
    });
    return loads[file];
  }

  global.FDServices = global.FDServices || {};
  global.FDServices.vendor = { root: root, url: url, load: load };
})(typeof self !== "undefined" ? self : globalThis);
