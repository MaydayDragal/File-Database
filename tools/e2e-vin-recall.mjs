// Verifies the VIN-recall improvements:
//  1. A VIN split by spaces in extracted text (e.g. "W1K LF4HB1 RA068698") is
//     still detected.
//  2. If a PDF's text layer already exposes a VIN, OCR is NOT run.
//  3. If a PDF has a text layer but NO VIN in it, OCR is used as a fallback and
//     recovers the VIN (which may live in a scanned image/stamp).
// A fake OCR engine records how many times it actually ran.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".pdf": "application/pdf", ".txt": "text/plain" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  let file = path.join(ROOT, p);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;
console.log("serving", base);

const VIN_SPLIT = "W1KLF4HB1RA068698";  // appears space-split in a text file
const VIN_PDFTEXT = "WDC1660241A555777"; // in a PDF text layer (should skip OCR)
const VIN_OCR = "WDB2030461A654321";     // only OCR (fake engine) provides this

// Build a 1-page PDF whose text layer is `body`. If `body` contains "\n" it is
// laid out over multiple positioned lines so pdf.js extracts every character
// (a single very long line gets clipped/under-extracted in this minimal PDF).
function buildPdf(body) {
  let inner;
  if (body.includes("\n")) {
    inner = body.split("\n").map((ln, i) => `1 0 0 1 30 ${230 - i * 16} Tm (${ln}) Tj`).join(" ");
  } else {
    inner = `40 150 Td (${body}) Tj`;
  }
  const stream = `BT /F1 10 Tf ${inner} ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 250] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n"; const off = [];
  objs.forEach((o, i) => { off[i] = pdf.length; pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  off.forEach((o) => { pdf += String(o).padStart(10, "0") + " 00000 n \n"; });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}
const fixDir = path.join(__dirname, "_fixtures");
fs.mkdirSync(fixDir, { recursive: true });
const fSplit = path.join(fixDir, "recall-split.txt");
const fHasVin = path.join(fixDir, "recall-hasvin.pdf");
const fNoVin = path.join(fixDir, "recall-novin.pdf");
const fRich = path.join(fixDir, "recall-richnovin.pdf");
fs.writeFileSync(fSplit, `Repair order. Vehicle W1K LF4HB1 RA068698 booked in for service today.\n`);
fs.writeFileSync(fHasVin, buildPdf(`Delivery note - vehicle identification number ${VIN_PDFTEXT} on file.`));
fs.writeFileSync(fNoVin, buildPdf("This paperwork lists absolutely no vehicle numbers in its text at all."));
// A datasheet-style PDF: a RICH text layer (>=400 chars) with NO VIN. It must
// NOT be OCR'd (OCR of prose only manufactures VIN-shaped noise like
// "DRIVE APPLICATIONS" -> DR1VEAPPL1CAT10NS).
fs.writeFileSync(fRich, buildPdf([
  "Power MOSFET datasheet - Strong FET Power MOSFET device",
  "Drive applications without limitation of the product",
  "Notes on repetitive current rising from zero to eighty",
  "Continuous source of compliance with its stated ratings",
  "Product of Infineon - application note and conditions",
  "Half bridge and full bridge topologies are supported",
  "Synchronous rectifier applications and resonant mode",
  "Absolute maximum ratings and thermal resistance data",
  "Gate charge total and junction to case measurements",
].join("\n")));

const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1150, height: 820 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
let failures = 0;
const check = (c, l) => { console.log((c ? "  ✓ " : "  ✗ ") + l); if (!c) failures++; };
const toastText = () => page.locator("#toast").textContent().catch(() => "");
async function waitFor(fn, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(200); } return fn(); }

// Fake OCR engine: counts calls, returns a page containing VIN_OCR.
await page.addInitScript((vinOcr) => {
  window.__ocrCalls = 0;
  window.Tesseract = {
    createWorker: async () => ({
      recognize: async () => { window.__ocrCalls++; await new Promise((r) => setTimeout(r, 50)); return { data: { text: `Scanned stamp VIN ${vinOcr}` } }; },
      terminate: () => {},
    }),
  };
}, VIN_OCR);

await page.goto(base + "vault/index.html", { waitUntil: "networkidle" });
await page.waitForTimeout(300);
await page.locator("#file-input").setInputFiles([fSplit, fHasVin, fNoVin, fRich]);
check(await waitFor(async () => (await page.locator("#results .card").count()) === 4), "4 fixtures imported");

await page.locator("#more-btn").click();
await page.locator('#more-menu button[data-action="scan-vins"]').click();
check(await waitFor(async () => /VIN scan finished/.test(await toastText() || "")), "scan completes");

const vinList = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("file-vault");
  r.onsuccess = () => { const c = r.result.transaction("files").objectStore("files").getAll(); c.onsuccess = () => res(c.result.map((x) => ({ name: x.name, vins: x.vins || [] }))); c.onerror = () => res([]); };
  r.onerror = () => res([]);
}));
const vinsOf = (frag) => (vinList.find((x) => x.name.includes(frag)) || { vins: [] }).vins;

check(vinsOf("recall-split").includes(VIN_SPLIT), `space-split VIN recovered from text (${VIN_SPLIT})`);
check(vinsOf("recall-hasvin").includes(VIN_PDFTEXT), `PDF text-layer VIN detected (${VIN_PDFTEXT})`);
check(vinsOf("recall-novin").includes(VIN_OCR), `sparse no-VIN PDF fell back to OCR and found ${VIN_OCR}`);
check(vinsOf("recall-richnovin").length === 0, "rich-text no-VIN datasheet yields NO VIN (not OCR-fabricated)");

const ocrCalls = await page.evaluate(() => window.__ocrCalls);
check(ocrCalls === 1, `OCR ran ONLY for the sparse no-VIN PDF — not the text-VIN one nor the rich datasheet (recognize calls = ${ocrCalls})`);

const realErrors = errors.filter((e) => !/favicon|manifest|the server responded|404|pdf|worker|Warning|Failed to load resource/i.test(e));
console.log(realErrors.length ? "\nConsole errors:\n" + realErrors.join("\n") : "\nNo unexpected console errors.");
check(realErrors.length === 0, "no unexpected console/page errors");

await browser.close();
server.close();
console.log(failures === 0 ? "\nVIN-RECALL CHECKS PASSED ✅" : `\n${failures} VIN-RECALL CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
