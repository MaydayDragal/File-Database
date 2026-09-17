// LI document-number extraction checks.
//
// XENTRY's newer Tips/LI exports typeset the document number with NON-BREAKING
// punctuation — a U+2011 non-breaking hyphen between the groups and U+00A0
// no-break spaces around the field labels — so the text layer reads
// "Topic number LI83.70‑P‑080411", not "LI83.70-P-080411".
// The extractors fold those to ASCII before matching; without that fold the
// LI number came back empty for every document in that format.
//
// The matcher used to exist in the LI app, the Toolbox importer and the shell's
// intake router; since REWRITE-PLAN.md Phase 1 it is src/core/ids.js, which
// all three load. The core is a classic script that attaches to
// globalThis.FDCore, so it is imported here for its side effect.
import "../src/core/text.js";
import "../src/core/ids.js";
import "../src/core/li-parse.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const check = (ok, label, detail) => {
  console.log((ok ? "  ✓ " : "  ✗ ") + label + (ok || !detail ? "" : " — " + detail));
  if (!ok) failures++;
};
const eq = (got, want, label) => check(got === want, label, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const NB = "‑";    // non-breaking hyphen (what the new exports use)
const NBSP = " ";  // no-break space
const EN = "–";

// Lift a source region out of an app script and evaluate it in isolation.
function lift(file, startMark, endMark) {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const a = src.indexOf(startMark);
  const b = src.indexOf(endMark, a);
  if (a < 0 || b < 0) throw new Error(`${file}: could not locate ${a < 0 ? startMark : endMark}`);
  return src.slice(a, b);
}

// The extraction block leans on a couple of helpers defined elsewhere in the
// app; stub the ones it touches so the block can run headless.
const PRELUDE = `
  function sanitize(s) { return String(s || "").replace(/[\\x00-\\x1f\\x7f]/g, "").replace(/[\\\\/:*?"<>|]/g, " ").replace(/\\s+/g, " ").trim(); }
  function cleanTitle(s) { return sanitize(s).replace(/[.\\s]+$/, "").trim(); }
  var window = {}, navigator = { hardwareConcurrency: 4 }, document = { createElement: () => ({}), head: { appendChild() {} } };
`;

{
  console.log("\nsrc/core/ids.js (shared by li, toolbox, shell, vault)");
  const { detectLI, detectLIFuzzy, detectVersion } = globalThis.FDCore.ids;
  const { normText } = globalThis.FDCore.text;

  // The new format — the case that used to come back empty.
  eq(detectLI(`Topic${NBSP}number LI83.70${NB}P${NB}080411`), "LI83.70-P-080411",
    "non-breaking hyphen in the text layer is still read as an LI number");
  eq(detectLI(`LI83.70${NB}P${NB}080411.pdf`), "LI83.70-P-080411",
    "non-breaking hyphen in the FILENAME is still read as an LI number");
  eq(detectVersion(`LI83.70${NB}P${NB}080411 Version${NBSP}2 Function${NBSP}group`, "LI83.70-P-080411"), "2",
    "the version reads through no-break spaces");
  eq(detectLI(`LI83.70${EN}P${EN}080411`), "LI83.70-P-080411",
    "an en dash in the number is accepted too");

  // The older ASCII format must keep working exactly as before.
  eq(detectLI("Dokument LI54.21-P-053110 Version 3"), "LI54.21-P-053110", "plain ASCII number still matches");
  eq(detectLI("AR83.70-P-0804112"), "AR83.70-P-0804112", "a 7-digit tail still matches");
  eq(detectVersion("LI54.21-P-053110 / 4 ", "LI54.21-P-053110"), "4", "plain ASCII version still reads");
  eq(detectLI("just some prose with 12.34 numbers"), "", "prose is not mistaken for a document number");

  // OCR fallback.
  eq(detectLIFuzzy(`LI83.7O${NB}P${NB}O8O411`), "LI83.70-P-080411", "the OCR fuzzy path folds the new punctuation too");

  // The fold is deliberately narrow: hyphen-shaped characters only, so real
  // prose keeps its typography in the stored, searchable text.
  eq(normText(`an em — dash and a${NBSP}space`), "an em — dash and a space", "em dashes survive normalization");

  // The app pages and the Toolbox must all load the shared file, not a copy.
  for (const page of ["li/index.html", "toolbox/index.html", "index.html", "vault/index.html", "inventory/index.html", "ros/index.html"]) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    check(/src\/core\/ids\.js/.test(html), `${page} loads src/core/ids.js`);
  }
  const literal = /\\b\[A-Z\]\{2\}\\d\{2\}\\\.\\d\{2\}-\[A-Z\]-\\d\{5,7\}/;
  for (const f of ["shell.js", "vault/app.js", "li/app.js", "toolbox/tools/pdf.js", "toolbox/app.js"]) {
    check(!literal.test(fs.readFileSync(path.join(ROOT, f), "utf8")), `${f} carries no private copy of the document-number pattern`);
  }
}

// ---------- version grouping ----------
// A document's versions are one row, keyed by its number. The key used to be
// the raw stored string, so a number pasted out of a new-format PDF (U+2011
// hyphens, which render identically to ASCII) — or carrying stray whitespace,
// or typed lowercase — keyed its own group and split the document into two
// rows. The key is canonicalized now.
{
  console.log("\nversion grouping (li/app.js)");
  const html = fs.readFileSync(path.join(ROOT, "li/app.js"), "utf8");
  const block = lift("li/app.js", "// ---------- LI extraction", "// OCR runs automatically");
  const groupDocs = new Function(PRELUDE + block +
    /function verNum\([\s\S]*?\n/.exec(html)[0] +
    /  function groupDocs\(list\) \{[\s\S]*?\n  \}/.exec(html)[0] +
    "; return groupDocs;")();

  const LI = "LI54.21-P-080326";
  const rows = groupDocs([
    { id: "a5", li: `LI54.21${NB}P${NB}080326`, ver: "5" }, // pasted from a new-format PDF
    { id: "a4", li: LI, ver: "4" },
    { id: "a3", li: LI, ver: "3" },
    { id: "a2", li: `  ${LI} `, ver: "2" },                 // stray whitespace
    { id: "a1", li: LI.toLowerCase(), ver: "1" },           // typed lowercase
  ]);
  check(rows.length === 1, "all five versions group into one row", `got ${rows.length} rows`);
  eq(rows[0].versions.length, 5, "the row carries every version");
  eq(rows[0].key, "li:" + LI, "the group key is the canonical number");

  // Different documents must still be different rows.
  const two = groupDocs([{ id: "x", li: LI, ver: "1" }, { id: "y", li: "LI54.21-P-080327", ver: "1" }]);
  eq(two.length, 2, "two different numbers stay two rows");
  // A document with no number falls back to its own id, as before.
  const none = groupDocs([{ id: "p", li: "", ver: "" }, { id: "q", li: "", ver: "" }]);
  eq(none.length, 2, "documents with no number are not lumped together");
}

// ---------- version diff: words broken across a line break ----------
// A reissued document rewraps its text, so the same sentence breaks in a
// different place. Fragments of one word must rejoin before the two versions
// are compared, or unchanged text reads as a deletion plus an insertion.
{
  console.log("\nversion diff (li/app.js)");
  const html = fs.readFileSync(path.join(ROOT, "li/app.js"), "utf8");
  const grab = (re) => re.exec(html)[0];
  const F = new Function(
    grab(/  var WRAP_HYPHEN[\s\S]*?\n  \}\n(?=  function paintWords)/) +
    grab(/  function isStampLine\(txt\) \{[\s\S]*?\n  \}/) +
    grab(/  function furnSigs\(list\) \{[\s\S]*?\n  \}/) +
    grab(/  function isFurn\(furn, w\) \{[\s\S]*?\n  \}/) +
    "; return { mergeHyphens, furnSigs, isFurn, isStampLine };")();
  const W = (w, pg, lk, x = 0, ry = 0.5) => ({ w, pg, lk, x, ry });
  const toks = (list) => F.mergeHyphens(list).map((t) => t.w);

  // Verbatim from page 3 of LI83.70-P-080411, as PDF.js reads it:
  //   lk=99  "…does it extend the vehicle’"
  //   lk=90  "s warranty in any way."
  eq(toks([W("the", 3, 99), W("vehicle\u2019", 3, 99), W("s", 3, 90), W("warranty", 3, 90)]).join(" "),
    "the vehicle\u2019s warranty", "a word wrapped after an apostrophe rejoins");
  eq(toks([W("the", 3, 99), W("vehicle\u2019s", 3, 99), W("warranty", 3, 99)]).join(" "),
    "the vehicle\u2019s warranty", "the version that did not wrap yields the same tokens (so: no diff)");
  eq(toks([W("don\u2019", 1, 9), W("t", 1, 5)]).join(" "), "don\u2019t", "contractions rejoin too");
  eq(toks([W("Mercedes-", 2, 34), W("Benz", 2, 30)]).join(" "), "Mercedes-Benz", "hyphen wraps still rejoin");

  // The rejoin must stay narrow — these are not broken words.
  eq(toks([W("\u2018go\u2019", 1, 9), W("now", 1, 5)]).join(" "), "\u2018go\u2019 now", "a closing quote before an ordinary word is left alone");
  eq(toks([W("vehicle\u2019", 1, 9), W("s", 1, 9)]).join(" "), "vehicle\u2019 s", "fragments on the same line are not merged");
  eq(toks([W("owners\u2019", 1, 9), W("manual", 1, 5)]).join(" "), "owners\u2019 manual", "a plural possessive before a real word stays split");

  // The export timestamp differs between any two versions, so the footer line
  // carrying it has to be recognized as page furniture despite having no
  // letters to build a signature from.
  check(F.isStampLine("09-09-2026 22:30:49"), "a date+time line is recognized as a print stamp");
  check(F.isStampLine("9/8/26 10:14 PM"), "so is a 12-hour stamp");
  check(!F.isStampLine("167 290 465"), "a row of numbers is not a print stamp");
  check(!F.isStampLine("D7MASALL Page 1 / 3"), "a footer with text is not a print stamp");

  const footer = [];
  for (const pg of [1, 2, 3]) {
    footer.push(W("09-09-2026", pg, 10, 0, 0.95), W("22:30:49", pg, 10, 60, 0.95));
    footer.push(W("167", pg, 14, 0, 0.6), W("290", pg, 14, 40, 0.6), W("465", pg, 14, 80, 0.6));
  }
  const furn = F.furnSigs(footer);
  check(F.isFurn(furn, footer[0]), "the repeating print stamp sits out the diff");
  check(!F.isFurn(furn, footer[2]), "a repeating row of numbers still takes part in the diff");
}

// ---------- the shell's intake router ----------
{
  console.log("\nshell.js (routes through FDCore.ids.hasLiNumber)");
  const { hasLiNumber } = globalThis.FDCore.ids;
  check(hasLiNumber(`LI83.70${NB}P${NB}080411.pdf`),
    "a dropped file named with non-breaking hyphens routes to the LI Database");
  check(hasLiNumber("LI54.10-P-070001.pdf"), "a plain ASCII name still routes to the LI Database");
  check(!hasLiNumber("quarterly-report.pdf"), "an ordinary PDF name does not route to the LI Database");
}

console.log(failures === 0 ? "\nLI NUMBER CHECKS PASSED ✅" : `\n${failures} LI NUMBER CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
