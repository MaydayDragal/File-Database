// LI Documents' text-level extraction, lifted from li/index.html.
//
// The block between the two markers is pure: filename rules, the document-
// number matchers, version detection, line assembly from PDF.js items, title
// and field extraction. PDF.js and OCR sit outside it; the cases feed it the
// text and line arrays those would have produced.
import fs from "node:fs";
import path from "node:path";
import { ROOT, lift, evalBlock } from "./lift.mjs";

const NAMES = ["sanitize", "cleanTitle", "rlName", "normChars", "normText", "normLI", "canonLI", "liKey",
  "detectLI", "detectLIFuzzy", "detectVersion", "itemsToLines", "joinHyphen", "titleFromStructure",
  "detectTitle", "normDate", "fieldFromLines", "DATE_VAL"];

// extract()'s finish() is the function that turns text and lines into the
// stored record. It is nested inside extract() and closes over the File and
// the PDF.js document (for file.name and doc.numPages), so it is lifted as
// source text and re-bound with those two supplied as parameters. Nothing is
// re-implemented here: a change to finish() in the app changes what this
// harness runs.
const FINISH_RE = /        function finish\(flat, p1, all, ocr\) \{[\s\S]*?\n        \}\n/;

let cached = null;
export function loadLi() {
  if (cached) return cached;
  const block = lift("li/index.html", "// ---------- filename rules (Windows-safe) ----------", "// OCR (lazy, from CDN");
  const m = FINISH_RE.exec(fs.readFileSync(path.join(ROOT, "li/index.html"), "utf8"));
  if (!m) throw new Error("li/index.html: could not locate extract()'s finish() — update FINISH_RE in tests/unit/harness/li.mjs");
  const bound = "\nfunction __finishFor(file, doc) {\n" + m[0] + "\n  return finish;\n}";
  cached = evalBlock("", block + bound, NAMES.concat(["__finishFor"]));
  return cached;
}

// The metadata a document gets from its text, as the app stores it.
export function metaFromText(flat, p1, all, ocr, filename, pages) {
  const L = loadLi();
  return L.__finishFor({ name: filename }, { numPages: pages })(flat, p1, all, ocr);
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
