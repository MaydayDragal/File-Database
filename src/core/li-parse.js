/*
 * li-parse.js — turning an LI document's text layer (or OCR read) into its
 * record: lines from PDF.js items, the title, the labelled fields, and the
 * renamed filename.
 *
 * Moved out of li/index.html unchanged (REWRITE-PLAN.md, Phase 1); PDF.js and
 * OCR stay in the app, this is the pure part they feed. Requires text.js and
 * ids.js. Classic <script> (window.FDCore.li) and side-effect import from Node.
 */
(function (global) {
  "use strict";
  var text = global.FDCore.text, ids = global.FDCore.ids;
  var normText = text.normText, reEsc = text.reEsc, sanitize = text.sanitize, cleanTitle = text.cleanTitle, WIN_RESERVED = text.WIN_RESERVED;
  var DOCNUM = ids.DOCNUM, detectLI = ids.detectLI, detectLIFuzzy = ids.detectLIFuzzy, detectVersion = ids.detectVersion;

  function rlName(d) {
    var li = sanitize(d.li), ver = String(d.ver || "").trim().replace(/[^0-9]/g, ""), title = cleanTitle(d.title);
    var base = (li || "document") + (ver ? "_" + ver : "") + (title ? " " + title : "");
    base = sanitize(base).replace(/[.\s]+$/, "");
    if (base.length > 235) base = base.slice(0, 235).replace(/[.\s]+$/, "");
    if (WIN_RESERVED.test(base)) base = "_" + base;
    return (base || "document") + ".pdf";
  }

  function itemsToLines(items) {
    var rows = {};
    items.forEach(function (it) {
      var s = normText(it.str); if (!s || !s.trim()) return;
      var y = Math.round((it.transform && it.transform[5]) || 0), h = Math.abs((it.transform && it.transform[3]) || 0), key = Math.round(y / 3);
      if (!rows[key]) rows[key] = { y: y, h: h, parts: [] };
      rows[key].parts.push({ x: (it.transform && it.transform[4]) || 0, s: s, w: it.width || 0 });
      if (h > rows[key].h) rows[key].h = h;
    });
    return Object.keys(rows).map(function (k) { return rows[k]; }).sort(function (a, b) { return b.y - a.y; })
      .map(function (r) {
        // join butted items (kerning splits) directly, but insert a space when
        // there's a real horizontal gap (e.g. separate table columns)
        var parts = r.parts.sort(function (a, b) { return a.x - b.x; }), txt = "";
        parts.forEach(function (p, i) {
          if (i > 0 && p.x - (parts[i - 1].x + parts[i - 1].w) > Math.max(1, r.h * 0.25)) txt += " ";
          txt += p.s;
        });
        return { text: txt.replace(/\s+/g, " ").trim(), h: r.h, y: r.y };
      });
  }
  // Join wrapped lines, rejoining a word hyphenated across the break ("ACTI-" +
  // "VE" -> "ACTIVE") but leaving a real trailing hyphen in a code intact
  // (letter-hyphen followed by a letter is a soft wrap; "N10-" + "1" is not).
  function joinHyphen(arr) { var out = ""; arr.forEach(function (t, i) { if (i === 0) { out = t; return; } if (/[A-Za-z][-‐‑]$/.test(out) && /^[A-Za-z]/.test(t)) out = out.replace(/[-‐‑]\s*$/, "") + t; else out += " " + t; }); return out; }
  // "xentry" only as a standalone letterhead ("XENTRY", "XENTRY Tips",
  // "XENTRY Diagnosis") — NOT a real title that merely starts with the word
  // Xentry (e.g. "Xentry Battery Tester results disagree with…").
  var HEADER_RE = /^(xentry(?:\s+(?:tips|diagnosis))?\s*$|wis\b|asra\b|star\s*diagnosis|page\s*\d|seite\s*\d|©|copyright\b|printed\b|https?:|www\.)/i;
  var FIELD_RE = /^\s*(topic\s*number|dokument(nummer|\s*nr)|document\s*number|dok\.?\s*-?\s*nr|order\s*number|auftrag)/i;
  function titleFromStructure(lines, li) {
    if (!lines || !lines.length) return "";
    var idx = -1;
    for (var i = 0; i < lines.length; i++) { var tx = lines[i].text || ""; if ((li && tx.indexOf(li) >= 0) || FIELD_RE.test(tx)) { idx = i; break; } }
    if (idx < 1) return "";
    var picked = [];
    for (var j = 0; j < idx; j++) { var t = (lines[j].text || "").trim(); if (!t || HEADER_RE.test(t)) continue; picked.push(t); }
    return joinHyphen(picked);
  }
  function detectTitle(lines, text, li) {
    var st = titleFromStructure(lines, li); if (st && st.length >= 4) return cleanTitle(st);
    if (lines && lines.length) {
      var maxH = 0; lines.forEach(function (it) { if (it.h > maxH) maxH = it.h; });
      var big = lines.filter(function (it) { return it.h >= maxH - 0.4 && (it.text || "").trim().length > 2 && !DOCNUM.test(it.text) && !HEADER_RE.test(it.text) && !/^(version|revision|seite|page|datum|date|validity|(?:function|design)\s*group)\b/i.test((it.text || "").trim()); });
      var joined = cleanTitle(big.map(function (it) { return (it.text || "").trim(); }).join(" "));
      if (joined.length >= 4) return joined;
    }
    if (li) { var m = text.match(new RegExp(reEsc(li) + "(?:\\s*[_/ ]\\s*\\d{1,3})?\\s+(.{4,120}?)(?:\\r|\\n|$)")); if (m) return cleanTitle(m[1]); }
    return "";
  }
  // Start of any labeled field/section — used to know where a wrapped
  // multi-line field value ends.
  var LABEL_RE = /^(topic\s*number|version\b|(?:function|design)\s*group|date\b|validity\b|reason\s*for\s*change|complaint\b|cause\b|remedy\b|symptoms?\b|attachments?\b|control\s*unit|fault\s*text|operation\s*(numbers?|text)|damage\s*code|parts\b|note\b|work\s*instruction|document\s*number|dokument)/i;
  // A field value must actually look like a date — guards against a wrapped
  // title line that happens to start with the word "date" (e.g. "date, time
  // on the analog clock cannot be altered") being taken as the Date field.
  var DATE_VAL = /\d{1,4}[.\/-]\d{1,2}([.\/-]\d{1,4})?/;
  // Present numeric dates with "/" separators (e.g. 03-17-2015 -> 03/17/2015).
  function normDate(v) { return DATE_VAL.test(v) ? v.replace(/(\d)[-.](?=\d)/g, "$1/") : v; }
  function fieldFromLines(lines, re, multi, valid) {
    for (var i = 0; i < lines.length; i++) {
      if (!re.test(lines[i].text)) continue;
      var v = lines[i].text.replace(re, "").trim();
      if (valid && !valid(v)) continue; // wrong line (e.g. a "date,…" title) — keep scanning
      if (multi) {
        // a long value (e.g. a Validity model list) wraps onto extra lines —
        // append until the next labeled field or header starts
        for (var j = i + 1; j < lines.length && j <= i + 8; j++) {
          var t = (lines[j].text || "").trim();
          if (!t || t === "\f" || LABEL_RE.test(t) || FIELD_RE.test(t) || HEADER_RE.test(t)) break;
          // a word hyphenated across the wrap ("ACTI-" + "VE …") rejoins with
          // no hyphen and no space; but a real trailing hyphen in a code
          // (e.g. "…-P-" then digits) is left intact
          if (/[A-Za-z][-‐‑]$/.test(v) && /^[A-Za-z]/.test(t)) v = v.replace(/[-‐‑]\s*$/, "") + t;
          else v += (v ? " " : "") + t;
          if (v.length > 600) break;
        }
      }
      return v;
    }
    return "";
  }

  // The record a document gets from its text: `flat` is the whole text, `p1`
  // the first page's lines, `all` every page's lines (with "\f" between
  // pages), `ocr` whether the text came from recognition. This was extract()'s
  // finish() in the app.
  function buildRecord(flat, p1, all, ocr, filename, pages) {
    var hay = flat + " " + filename;
    var li = detectLI(hay) || (ocr ? detectLIFuzzy(flat) || detectLIFuzzy(filename) : "");
    var lineText = all.map(function (l) { return l.text; }).join("\n");
    if (lineText.length > 60000) { lineText = lineText.slice(0, 60000); var cut = lineText.lastIndexOf("\n"); if (cut > 0) lineText = lineText.slice(0, cut); }
    return {
      li: li, ver: detectVersion(hay, li), title: detectTitle(p1, flat, li),
      reason: fieldFromLines(p1, /^reason\s*for\s*change\s*/i, true),
      fgroup: fieldFromLines(p1, /^(?:function|design)\s*group\s*/i), date: normDate(fieldFromLines(p1, /^date\s*/i, false, function (v) { return DATE_VAL.test(v); })),
      validity: fieldFromLines(p1, /^validity\s*/i, true), text: lineText, pages: pages, ocr: ocr, noText: false
    };
  }

  global.FDCore.li = {
    HEADER_RE: HEADER_RE, FIELD_RE: FIELD_RE, LABEL_RE: LABEL_RE, DATE_VAL: DATE_VAL,
    rlName: rlName, itemsToLines: itemsToLines, joinHyphen: joinHyphen, titleFromStructure: titleFromStructure,
    detectTitle: detectTitle, normDate: normDate, fieldFromLines: fieldFromLines, buildRecord: buildRecord,
  };
})(typeof self !== "undefined" ? self : globalThis);
