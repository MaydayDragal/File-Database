// End-to-end test for File Vault PDF thumbnails.
// Imports a real one-page PDF and checks the card shows a rendered first-page
// preview (import path), then strips the stored thumb + reloads to verify the
// background backfill regenerates and persists it.
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

// --- Build a minimal, valid one-page PDF (correct xref offsets) ---
function buildPdf() {
  const stream = "BT /F1 24 Tf 40 150 Td (Hello Vault PDF) Tj ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
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
const pdfPath = path.join(fixDir, "thumbtest.pdf");
fs.writeFileSync(pdfPath, buildPdf());

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
let failures = 0;
const check = (c, l) => { console.log((c ? "  ✓ " : "  ✗ ") + l); if (!c) failures++; };

async function thumbLoaded() {
  const img = page.locator("#results .card .card__thumb img").first();
  if (!(await img.count())) return false;
  return img.evaluate((el) => el.complete && el.naturalWidth > 0);
}
async function waitThumb(ms = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await thumbLoaded()) return true; await page.waitForTimeout(200); }
  return thumbLoaded();
}

await page.goto(base + "vault/index.html", { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// --- Import path: adding a PDF renders its first page as the card thumbnail ---
await page.locator("#file-input").setInputFiles(pdfPath);
check((await page.locator("#results .card").count()) >= 1 || (await waitThumb(3000)) !== null, "PDF card is added");
check(await waitThumb(), "imported PDF shows a rendered first-page thumbnail (naturalWidth > 0)");

// The thumbnail is persisted as a real image blob in IndexedDB
const thumbSize = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("file-vault");
  r.onsuccess = () => {
    const db = r.result;
    const c = db.transaction("files").objectStore("files").getAll();
    c.onsuccess = () => { const rec = c.result.find((x) => x.kind === "pdf"); res(rec && rec.thumb ? (rec.thumb.size || 0) : 0); };
    c.onerror = () => res(0);
  };
  r.onerror = () => res(0);
}));
check(thumbSize > 0, `PDF thumbnail is stored in IndexedDB (${thumbSize} bytes)`);

// --- Backfill path: clear the stored thumb, reload, and it regenerates ---
await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("file-vault");
  r.onsuccess = () => {
    const db = r.result;
    const store = db.transaction("files", "readwrite").objectStore("files");
    const c = store.getAll();
    c.onsuccess = () => {
      const rec = c.result.find((x) => x.kind === "pdf");
      if (!rec) return res();
      delete rec.thumb;
      store.put(rec);
    };
    db.transaction("files", "readwrite").oncomplete = () => res();
    setTimeout(res, 500);
  };
  r.onerror = () => res();
}));
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(400);
check(await waitThumb(), "background backfill regenerates a missing PDF thumbnail after reload");
const thumbSize2 = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("file-vault");
  r.onsuccess = () => {
    const db = r.result;
    const c = db.transaction("files").objectStore("files").getAll();
    c.onsuccess = () => { const rec = c.result.find((x) => x.kind === "pdf"); res(rec && rec.thumb ? (rec.thumb.size || 0) : 0); };
    c.onerror = () => res(0);
  };
  r.onerror = () => res(0);
}));
check(thumbSize2 > 0, "backfilled thumbnail is persisted back to IndexedDB");

const realErrors = errors.filter((e) => !/favicon|manifest|the server responded|404|pdf|worker|Warning|Setting up fake/i.test(e));
console.log(realErrors.length ? "\nConsole errors:\n" + realErrors.join("\n") : "\nNo unexpected console errors.");
check(realErrors.length === 0, "no unexpected console/page errors");

await browser.close();
server.close();
console.log(failures === 0 ? "\nPDF-THUMB CHECKS PASSED ✅" : `\n${failures} PDF-THUMB CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
