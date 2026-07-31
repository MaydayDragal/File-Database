// Verifies VIN vs FIN separation and garbage rejection on a real Mercedes
// XENTRY WIS Datacard. The datacard's text (in a PDF text layer) contains:
//   - VIN   W1KLF4HB1RA068698     (the ISO VIN, labelled "VIN")
//   - Datacard W1K2140471A068698  (the Baumuster/FIN number)
//   - "502 Multi-year free map updates 50A" -> collapses to FREEMAPUPDATES50A
// Expected: VIN grouped as a VIN, FIN kept separate (searchable, amber chip),
// and the FREEMAPUPDATES50A word-string thrown out.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser, launchPersistent } from "./e2e-browser.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".pdf": "application/pdf" };
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

const VIN = "W1KLF4HB1RA068698";
const FIN = "W1K2140471A068698";
const GARBAGE = "FREEMAPUPDATES50A";

// A PDF whose text layer mirrors the real datacard's wording.
function buildPdf(body) {
  const stream = `BT /F1 9 Tf 30 200 Td (${body}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 620 260] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
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
const pdfPath = path.join(fixDir, `${FIN}_datacard.pdf`); // filename carries the FIN, like the user's file
// Includes real OCR-style junk seen in the wild: a word glued by spaces
// (FREEMAPUPDATES50A) and zero-filled blank form fields (000000000000000ER/FR).
fs.writeFileSync(pdfPath, buildPdf(
  `XENTRY WIS Datacard ${FIN} Engine no. 254920 Sales des. E 300 4MATIC VIN ${VIN} Steering 214460 502 Multi-year free map updates 50A field 000000000000000ER 000000000000000FR no designation`
));

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1150, height: 820 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
let failures = 0;
const check = (c, l) => { console.log((c ? "  ✓ " : "  ✗ ") + l); if (!c) failures++; };
const toastText = () => page.locator("#toast").textContent().catch(() => "");
async function waitFor(fn, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(200); } return fn(); }

await page.goto(base + "vault/index.html", { waitUntil: "networkidle" });
await page.waitForTimeout(300);
await page.locator("#file-input").setInputFiles(pdfPath);
check(await waitFor(async () => (await page.locator("#results .card").count()) === 1), "datacard imported");

await page.locator("#more-btn").click();
await page.locator('#more-menu button[data-action="scan-vins"]').click();
check(await waitFor(async () => /VIN scan finished/.test(await toastText() || "")), "scan completes");

const rec = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("file-vault");
  r.onsuccess = () => { const c = r.result.transaction("files").objectStore("files").getAll(); c.onsuccess = () => { const x = c.result[0] || {}; res({ vins: x.vins || [], fins: x.fins || [] }); }; c.onerror = () => res({}); };
  r.onerror = () => res({});
}));
check(rec.vins && rec.vins.length === 1 && rec.vins[0] === VIN, `VIN detected as the VIN (${JSON.stringify(rec.vins)})`);
check(rec.fins && rec.fins.includes(FIN), `FIN detected separately (${JSON.stringify(rec.fins)})`);
check(!rec.vins.includes(FIN), "FIN is NOT grouped as a VIN");
const allIds = (rec.vins || []).concat(rec.fins || []);
check(!allIds.includes(GARBAGE), "FREEMAPUPDATES50A garbage was thrown out");
check(!allIds.some((x) => /^0/.test(x)) && !allIds.includes("000000000000000ER") && !allIds.includes("000000000000000FR"),
  "zero-filled blank fields (000000000000000ER/FR) were thrown out");

// The By-VIN sidebar shows exactly one VIN group — the real VIN.
check(await waitFor(async () => !(await page.locator("#vins-section").isHidden())), "VIN section visible");
const vinItems = await page.locator("#nav-vins .nav__item").allTextContents();
check(vinItems.length === 1 && vinItems[0].includes(VIN), "sidebar lists only the real VIN");

// FIN is still searchable.
await page.fill("#search-input", FIN);
await page.waitForTimeout(350);
check((await page.locator("#results .card").count()) === 1, "searching the FIN still finds the datacard");
await page.fill("#search-input", GARBAGE);
await page.waitForTimeout(350);
check((await page.locator("#results .card").count()) === 0, "searching the garbage string finds nothing");
await page.fill("#search-input", "");
await page.waitForTimeout(200);

// Detail drawer shows VIN and FIN in separate fields.
await page.locator("#results .card").first().click();
check(await waitFor(async () => !(await page.locator("#detail").isHidden())), "detail opens");
check((await page.inputValue("#d-vin")) === VIN, "VIN field holds the VIN");
check(!(await page.locator("#d-fin-field").isHidden()) && (await page.inputValue("#d-fin")) === FIN, "FIN field holds the FIN");

const realErrors = errors.filter((e) => !/favicon|manifest|the server responded|404|pdf|worker|Warning|Failed to load resource/i.test(e));
console.log(realErrors.length ? "\nConsole errors:\n" + realErrors.join("\n") : "\nNo unexpected console errors.");
check(realErrors.length === 0, "no unexpected console/page errors");

await browser.close();
server.close();
console.log(failures === 0 ? "\nVIN-DATACARD CHECKS PASSED ✅" : `\n${failures} VIN-DATACARD CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
