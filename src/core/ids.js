/*
 * ids.js — the platform's shared identifiers: Mercedes LI document numbers,
 * special-tool numbers, VIN shape and model series.
 *
 * Moved out of li/index.html unchanged (REWRITE-PLAN.md, Phase 1). Before
 * this file the LI document-number matcher existed five times (li, toolbox,
 * shell ×2, vault); this is the one copy. Requires text.js to be loaded first.
 *
 * Classic <script> (window.FDCore.ids) and side-effect import from Node.
 */
(function (global) {
  "use strict";
  var text = global.FDCore.text;
  var normText = text.normText, normLI = text.normLI, reEsc = text.reEsc;

  // ---------- LI document numbers ----------
  var DOCNUM = /\b([A-Z]{2}\d{2}\.\d{2}-[A-Z]-\d{5,7})\b/;
  // A whole string that IS a document number (a tag, a quick-open query).
  var DOCNUM_EXACT = /^[A-Z]{2}\d{2}\.\d{2}-[A-Z]-\d{5,7}$/i;
  // Canonical form of a document number, and the key that decides which
  // version rows belong to the same document. XENTRY's newer PDFs spell the
  // number with U+2011 hyphens and U+00A0 spaces, which render identically to
  // ASCII — so a number pasted out of one into the Document number field
  // produced a string that LOOKED like the others but was not equal to them,
  // and that document's versions split into a second row. Stray whitespace and
  // a lowercase prefix did the same. Group on the folded, trimmed, upper-cased
  // form so those all land in one group.
  function canonLI(s) { var v = normLI(s).replace(/\s+/g, " ").trim(); return DOCNUM.test(v.toUpperCase()) ? v.toUpperCase() : v; }
  function liKey(li) { return "li:" + canonLI(li).toUpperCase(); }
  function detectLI(hay) { var m = normLI(hay).match(DOCNUM); return m ? m[1] : ""; }
  // A fresh global matcher for scanning a text for EVERY document number in
  // it (a shared /g regex would carry lastIndex from one call into the next).
  function docnumGlobal() { return new RegExp(DOCNUM.source, "g"); }
  // Does this string (a filename, a pasted tag) carry a document number anywhere?
  function hasLiNumber(s) { return DOCNUM.test(normLI(s).toUpperCase()); }
  // Is this whole string a document number (case-insensitive, punctuation folded)?
  function isLiNumber(s) { return DOCNUM_EXACT.test(normLI(s).trim()); }
  var FUZZY = /([A-Za-z0-9]{2})\s?([0-9OoIlSsBbGgZ]{2})[.,]([0-9OoIlSsBbGgZ]{2})\s?[-–—~]\s?([A-Za-z0-9])\s?[-–—~]\s?([0-9OoIlSsBbGgZ]{5,7})/;
  function toDigits(s) { return s.replace(/[OoQ]/g, "0").replace(/[Il]/g, "1").replace(/[Ss]/g, "5").replace(/[Bb]/g, "8").replace(/Z/g, "2").replace(/[Gg]/g, "6"); }
  function toAlpha(s) { return s.replace(/0/g, "O").replace(/1/g, "I").replace(/5/g, "S").replace(/8/g, "B").replace(/6/g, "G").replace(/2/g, "Z").toUpperCase(); }
  function detectLIFuzzy(hay) { var f = normLI(hay).match(FUZZY); if (!f || !/[A-Za-z]/.test(f[1])) return ""; var o = toAlpha(f[1]) + toDigits(f[2]) + "." + toDigits(f[3]) + "-" + toAlpha(f[4]) + "-" + toDigits(f[5]); return DOCNUM.test(o) ? o : ""; }
  function detectVersion(hay, li) {
    hay = normText(hay);
    var pats = [];
    if (li) pats.push(new RegExp(reEsc(li) + "\\s*[_/ ]\\s*(?:V|Ver\\.?|Version|Rev\\.?|Revision)?\\s*(\\d{1,3})\\b(?![.\\-\\/]?\\d)", "i"));
    pats.push(/\b(?:Version|Revision|Rev\.?|Stand|Ausgabe)\s*[:.]?\s*(\d{1,3})\b(?![.\-\/]?\d)/i);
    for (var i = 0; i < pats.length; i++) { var m = hay.match(pats[i]); if (m) return m[1]; }
    return "";
  }

  // ---------- special-tool numbers ----------
  // "000 589 01 23 00", with or without the spaces.
  var TOOL_NO = /^(\d{3})\s*(\d{3})\s*(\d{2})\s*(\d{2})\s*(\d{2})$/;
  function normToolNo(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
  // The five groups joined with single spaces, or "" when it is not a tool number.
  function canonToolNo(s) { var m = String(s || "").trim().match(TOOL_NO); return m ? [m[1], m[2], m[3], m[4], m[5]].join(" ") : ""; }

  // ---------- VIN shape and model series ----------
  // The SHAPE of a VIN only (17 characters, no I/O/Q); whether it is a real
  // Mercedes VIN is vin.js's business.
  var VIN_SHAPE = /^[A-HJ-NPR-Z0-9]{17}$/i;
  // The model series is the VIN/FIN's Baumuster digits (chars 4-6) when they
  // are all digits; many VINs, North American ones included, carry letters
  // there and have no series to give.
  function seriesOfVin(vin) {
    var s = String(vin || "").toUpperCase();
    return s.length === 17 && /^\d{3}$/.test(s.slice(3, 6)) ? s.slice(3, 6) : "";
  }

  // The model series an LI document's validity text names ("Model 214",
  // "model series 213", or a bare "213, 214" list) — the rule LI Documents
  // filters by, shared so a vehicle summary counts the same documents.
  function modelsOfValidity(s) {
    s = String(s || "");
    var seen = {}, out = [], m;
    function add(k) { if (/^\d{3}$/.test(k) && !seen[k]) { seen[k] = 1; out.push(k); } }
    var re1 = /model(?:\s+series)?\s+(\d{3})\b/gi; while ((m = re1.exec(s))) add(m[1]);
    var re2 = /(?:^|,)\s*(\d{3})\s*(?=,|$)/g; while ((m = re2.exec(s))) add(m[1]);
    return out;
  }
  // Does a special tool fit a model series? The Tool Inventory's rule: the
  // series appears as a word in one of the tool's validity strings.
  function toolFitsModel(tool, series) {
    if (!/^\d{3}$/.test(String(series || ""))) return false;
    var re = new RegExp("\\b" + series + "\\b");
    return ((tool && tool.validities) || []).some(function (v) { return re.test(String(v)); });
  }

  global.FDCore.ids = {
    modelsOfValidity: modelsOfValidity, toolFitsModel: toolFitsModel,
    DOCNUM: DOCNUM, DOCNUM_EXACT: DOCNUM_EXACT, FUZZY: FUZZY,
    canonLI: canonLI, liKey: liKey, detectLI: detectLI, docnumGlobal: docnumGlobal, detectLIFuzzy: detectLIFuzzy, detectVersion: detectVersion,
    hasLiNumber: hasLiNumber, isLiNumber: isLiNumber, toDigits: toDigits, toAlpha: toAlpha,
    TOOL_NO: TOOL_NO, normToolNo: normToolNo, canonToolNo: canonToolNo,
    VIN_SHAPE: VIN_SHAPE, seriesOfVin: seriesOfVin,
  };
})(typeof self !== "undefined" ? self : globalThis);
