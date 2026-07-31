// End-to-end test for File Vault VIN scanning & grouping.
// Imports text files (VIN in the content, VIN in the filename, no VIN) plus a
// PDF with a VIN in its text layer, runs "Scan files for VINs", and checks the
// sidebar VIN list, the "By VIN" grouped view, the vin: filter, search, the
// detail-drawer VIN field, persistence across a reload, and that a second scan
// skips already-scanned files. The OCR fallback (images / scanned PDFs) needs
// the Tesseract CDN, so it isn't exercised here — offline it must skip those
// files WITHOUT marking them scanned, which is asserted via an image fixture.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser, launchPersistent } from "./e2e-browser.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
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

const VIN_TEXT = "WDD2050091R123456";  // inside a text file's content
const VIN_NAME = "WDB2030461A654321";  // in a filename only
const VIN_PDF = "WDC1660241A555777";   // in a PDF's text layer

// --- Fixtures ---
function buildPdf() {
  const stream = `BT /F1 12 Tf 40 150 Td (This delivery note concerns the vehicle ${VIN_PDF} handed over to the workshop for inspection.) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const off = [];
  objs.forEach((o, i) => { off[i] = pdf.length; pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  off.forEach((o) => { pdf += String(o).padStart(10, "0") + " 00000 n \n"; });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}
const fixDir = path.join(__dirname, "_fixtures");
fs.mkdirSync(fixDir, { recursive: true });
const files = {
  content: path.join(fixDir, "vin-in-content.txt"),
  name: path.join(fixDir, `${VIN_NAME}_invoice.txt`),
  none: path.join(fixDir, "no-vin-here.txt"),
  pdf: path.join(fixDir, "vin-delivery-note.pdf"),
  img: path.join(fixDir, "vin-photo.png"),
};
fs.writeFileSync(files.content, `Repair order 4711\nVehicle ${VIN_TEXT} received with 45,120 km on the clock.\n`);
fs.writeFileSync(files.name, "Invoice total: 1,234.56 EUR\n");
fs.writeFileSync(files.none, "Nothing automotive in this file at all.\n");
fs.writeFileSync(files.pdf, buildPdf());
// 1x1 PNG — an image needs OCR, which is unavailable offline.
fs.writeFileSync(files.img, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 850 } });
const page = await ctx.newPage();
// HANG the Tesseract CDN (hold the request open, never respond) — the worst
// case that used to wedge the scan forever. Short OCR timeouts keep the test
// fast while still exercising the real give-up-and-move-on path.
await page.addInitScript(() => { window.__VIN_OCR_LOAD_MS = 1500; window.__VIN_OCR_RECOGNIZE_MS = 1500; });
await page.route("https://cdn.jsdelivr.net/**", () => { /* never fulfilled */ });
await page.route("https://tessdata.projectnaptha.com/**", () => {});
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
let failures = 0;
const check = (c, l) => { console.log((c ? "  ✓ " : "  ✗ ") + l); if (!c) failures++; };
const toastText = () => page.locator("#toast").textContent().catch(() => "");
async function waitFor(fn, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(200); }
  return fn();
}

await page.goto(base + "vault/index.html", { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// --- Import the fixtures ---
await page.locator("#file-input").setInputFiles([files.content, files.name, files.none, files.pdf, files.img]);
check(await waitFor(async () => (await page.locator("#results .card").count()) === 5), "all 5 fixture files are added");

// --- Run the scan from the ⋮ menu ---
// This is the regression guard: with OCR hung, the scan must still TERMINATE
// (not wedge) within a few seconds and report the OCR-needing file.
const scanStart = Date.now();
await page.locator("#more-btn").click();
await page.locator('#more-menu button[data-action="scan-vins"]').click();
check(await waitFor(async () => /VIN scan finished/.test(await toastText() || ""), 8000), "scan terminates (does not wedge) even with OCR hung");
check(Date.now() - scanStart < 8000, `scan finished promptly instead of hanging (${((Date.now() - scanStart) / 1000).toFixed(1)}s)`);
check(/1 need OCR/.test(await toastText() || ""), "image needing OCR is reported (unavailable, will retry)");
// The app stays usable right after a hung-OCR scan.
await page.locator("#results .card", { hasText: "no-vin-here" }).first().click();
check(await waitFor(async () => !(await page.locator("#detail").isHidden())), "a file still opens right after a hung-OCR scan");
await page.locator("#detail .detail__head [data-close]").click();

// --- Sidebar: VIN list + By VIN count ---
check(await waitFor(async () => !(await page.locator("#vins-section").isHidden())), "sidebar VINs section becomes visible");
const vinButtons = await page.locator("#nav-vins .nav__item").allTextContents();
check(vinButtons.length === 3, `sidebar lists 3 VINs (got ${vinButtons.length})`);
for (const v of [VIN_TEXT, VIN_NAME, VIN_PDF]) {
  check(vinButtons.some((t) => t.includes(v)), `sidebar lists ${v}`);
}
check((await page.locator('[data-count="vins"]').textContent()).trim() === "3", "By VIN nav counts 3 files with a VIN");

// --- Grouped "By VIN" view ---
await page.locator('.nav__item[data-filter="vins"]').click();
check((await page.locator("#view-title").textContent()) === "By VIN", "view title switches to By VIN");
check((await page.locator("#results .group-head").count()) === 3, "grouped view shows 3 VIN group headers");
check((await page.locator("#results .card").count()) === 3, "grouped view shows the 3 matching files");
const heads = await page.locator("#results .group-head .group-head__vin").allTextContents();
check(heads.join(",") === [VIN_NAME, VIN_PDF, VIN_TEXT].sort().join(","), "group headers are the sorted VINs");

// Clicking a group header narrows to that VIN
await page.locator("#results .group-head", { hasText: VIN_PDF }).click();
check((await page.locator("#view-title").textContent()) === VIN_PDF, "clicking a group header filters to that VIN");
check((await page.locator("#results .card").count()) === 1, "vin: filter shows exactly the one matching file");
check((await page.locator("#results .card .card__name").textContent()).includes("vin-delivery-note"), "the matching file is the PDF");

// --- Search finds files by (partial) VIN ---
await page.locator('.nav__item[data-filter="all"]').click();
await page.fill("#search-input", "2050091");
await page.waitForTimeout(350);
check((await page.locator("#results .card").count()) === 1, "search by partial VIN finds the file that contains it");
await page.fill("#search-input", "");
await page.waitForTimeout(350);

// --- Detail drawer shows the detected VIN ---
await page.locator("#results .card", { hasText: "vin-in-content" }).first().click();
check(await waitFor(async () => !(await page.locator("#detail").isHidden())), "detail drawer opens");
check((await page.inputValue("#d-vin")) === VIN_TEXT, "detail drawer VIN field holds the detected VIN");
await page.locator("#detail .detail__head [data-close]").click();

// --- VINs are persisted (survive a reload) ---
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(500);
check(!(await page.locator("#vins-section").isHidden()), "sidebar VINs survive a reload (persisted in IndexedDB)");
check((await page.locator("#nav-vins .nav__item").count()) === 3, "all 3 VINs are still listed after reload");

// --- A second scan only touches what's new (the OCR-skipped image) ---
await page.locator("#more-btn").click();
await page.locator('#more-menu button[data-action="scan-vins"]').click();
check(await waitFor(async () => /VIN scan finished|already been scanned/.test(await toastText() || ""), 8000), "second scan completes");
check(/1 need OCR|already been scanned/.test(await toastText() || ""), "second scan retries only the unscanned (OCR-pending) file");

// --- Stored records carry vins + vinScan ---
const stored = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("file-vault");
  r.onsuccess = () => {
    const c = r.result.transaction("files").objectStore("files").getAll();
    c.onsuccess = () => res(c.result.map((x) => ({ name: x.name, vins: x.vins || [], vinScan: x.vinScan || 0 })));
    c.onerror = () => res([]);
  };
  r.onerror = () => res([]);
}));
const noVin = stored.find((s) => s.name === "no-vin-here.txt");
check(!!noVin && noVin.vinScan > 0 && noVin.vins.length === 0, "no-VIN file is marked scanned with an empty VIN list");
const img = stored.find((s) => s.name === "vin-photo.png");
check(!!img && img.vinScan === 0, "OCR-pending image stays unscanned so a later (online) run retries it");

const realErrors = errors.filter((e) => !/favicon|manifest|the server responded|404|pdf|worker|Warning|Failed to load resource|net::ERR_FAILED|OCR/i.test(e));
console.log(realErrors.length ? "\nConsole errors:\n" + realErrors.join("\n") : "\nNo unexpected console errors.");
check(realErrors.length === 0, "no unexpected console/page errors");

await browser.close();
server.close();
console.log(failures === 0 ? "\nVIN CHECKS PASSED ✅" : `\n${failures} VIN CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
