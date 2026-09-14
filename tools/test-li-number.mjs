// LI document-number extraction checks.
//
// XENTRY's newer Tips/LI exports typeset the document number with NON-BREAKING
// punctuation — a U+2011 non-breaking hyphen between the groups and U+00A0
// no-break spaces around the field labels — so the text layer reads
// "Topic number LI83.70‑P‑080411", not "LI83.70-P-080411".
// The extractors fold those to ASCII before matching; without that fold the
// LI number came back empty for every document in that format.
//
// The LI app, the standalone toolbox importer and the shell's intake router
// each carry their own copy of the matcher, so all three are checked here.
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

// Lift a source region out of a single-file app and evaluate it in isolation.
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

function loadExtractors(file, startMark, endMark) {
  const body = PRELUDE + lift(file, startMark, endMark) +
    "\n; return { detectLI: detectLI, detectLIFuzzy: detectLIFuzzy, detectVersion: detectVersion, normText: normText };";
  return new Function(body)();
}

const copies = [
  ["li/index.html", "// ---------- LI extraction", "// OCR (lazy, from CDN"],
  ["toolbox/index.html", "  var DOCNUM = /\\b([A-Z]{2}", "  function itemsToLines(items) {"],
];

for (const [file, a, b] of copies) {
  console.log(`\n${file}`);
  const { detectLI, detectLIFuzzy, detectVersion, normText } = loadExtractors(file, a, b);

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
}

// ---------- the shell's intake router ----------
{
  console.log("\nshell.js");
  const src = fs.readFileSync(path.join(ROOT, "shell.js"), "utf8");
  const liNorm = new Function("return " + /function liNorm\([\s\S]*?\n/.exec(src)[0])();
  const LI_DOCNUM = /\b[A-Z]{2}\d{2}\.\d{2}-[A-Z]-\d{5,7}\b/i;
  check(LI_DOCNUM.test(liNorm(`LI83.70${NB}P${NB}080411.pdf`)),
    "a dropped file named with non-breaking hyphens routes to the LI Database");
  check(LI_DOCNUM.test(liNorm("LI54.10-P-070001.pdf")), "a plain ASCII name still routes to the LI Database");
  check(!LI_DOCNUM.test(liNorm("quarterly-report.pdf")), "an ordinary PDF name does not route to the LI Database");
}

console.log(failures === 0 ? "\nLI NUMBER CHECKS PASSED ✅" : `\n${failures} LI NUMBER CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
