// LI Documents' text-level extraction, lifted from li/index.html.
//
// The block between the two markers is pure: filename rules, the document-
// number matchers, version detection, line assembly from PDF.js items, title
// and field extraction. PDF.js and OCR sit outside it; the cases feed it the
// text and line arrays those would have produced.
import { lift, evalBlock } from "./lift.mjs";

const NAMES = ["sanitize", "cleanTitle", "rlName", "normChars", "normText", "normLI", "canonLI", "liKey",
  "detectLI", "detectLIFuzzy", "detectVersion", "itemsToLines", "joinHyphen", "titleFromStructure",
  "detectTitle", "normDate", "fieldFromLines", "DATE_VAL"];

let cached = null;
export function loadLi() {
  if (cached) return cached;
  const block = lift("li/index.html", "// ---------- filename rules (Windows-safe) ----------", "// OCR (lazy, from CDN");
  cached = evalBlock("", block, NAMES);
  return cached;
}

// The metadata a document gets from its text — extract()'s finish() in
// li/index.html, with the PDF and File objects replaced by their values.
// Kept verbatim in shape so the golden records what the app stores.
export function metaFromText(flat, p1, all, ocr, filename, pages) {
  const L = loadLi();
  const hay = flat + " " + filename;
  const li = L.detectLI(hay) || (ocr ? L.detectLIFuzzy(flat) || L.detectLIFuzzy(filename) : "");
  let lineText = all.map((l) => l.text).join("\n");
  if (lineText.length > 60000) { lineText = lineText.slice(0, 60000); const cut = lineText.lastIndexOf("\n"); if (cut > 0) lineText = lineText.slice(0, cut); }
  return {
    li, ver: L.detectVersion(hay, li), title: L.detectTitle(p1, flat, li),
    reason: L.fieldFromLines(p1, /^reason\s*for\s*change\s*/i, true),
    fgroup: L.fieldFromLines(p1, /^(?:function|design)\s*group\s*/i),
    date: L.normDate(L.fieldFromLines(p1, /^date\s*/i, false, (v) => L.DATE_VAL.test(v))),
    validity: L.fieldFromLines(p1, /^validity\s*/i, true), text: lineText, pages, ocr, noText: false,
  };
}

// Regular expressions travel through JSON as { $re, flags }.
function revive(v) {
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === "object") {
    if (typeof v.$re === "string") return new RegExp(v.$re, v.flags || "");
    const o = {}; for (const k of Object.keys(v)) o[k] = revive(v[k]); return o;
  }
  return v;
}

export function runLiCase(c) {
  const L = loadLi();
  const args = revive(c.args);
  if (c.fn === "meta") return metaFromText(...args);
  if (c.fn === "fieldFromLines") {
    // The optional `valid` predicate is named, not serialized.
    const [lines, re, multi, valid] = args;
    return L.fieldFromLines(lines, re, multi, valid === "isDate" ? (v) => L.DATE_VAL.test(v) : undefined);
  }
  const f = L[c.fn];
  if (typeof f !== "function") throw new Error("unknown li case " + c.fn);
  return f(...args);
}
