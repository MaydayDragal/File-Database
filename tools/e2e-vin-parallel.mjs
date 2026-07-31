// Proves the VIN scan OCRs files in PARALLEL across multiple workers (cores).
// A fake Tesseract engine is injected before load; its recognize() records how
// many calls run at once. With the worker pool forced to 3, importing 6 images
// must reach 3 concurrent recognitions (not 1) and finish in ~2 waves, not 6.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser, launchPersistent } from "./e2e-browser.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
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

const WORKERS = 3, IMAGES = 6, OCR_MS = 300;
const fixDir = path.join(__dirname, "_fixtures");
fs.mkdirSync(fixDir, { recursive: true });
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const imgs = [];
for (let i = 0; i < IMAGES; i++) { const p = path.join(fixDir, `par-${i}.png`); fs.writeFileSync(p, png); imgs.push(p); }

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
let failures = 0;
const check = (c, l) => { console.log((c ? "  ✓ " : "  ✗ ") + l); if (!c) failures++; };

// Inject a fake OCR engine + force the pool size, BEFORE the app loads.
await page.addInitScript(({ workers, ocrMs }) => {
  window.__VIN_OCR_WORKERS = workers;
  window.__ocr = { cur: 0, max: 0, calls: 0 };
  window.Tesseract = {
    createWorker: async () => ({
      recognize: async () => {
        const s = window.__ocr; s.cur++; s.calls++; s.max = Math.max(s.max, s.cur);
        await new Promise((r) => setTimeout(r, ocrMs));
        s.cur--;
        return { data: { text: "Vehicle WDD2050091R123456 recognized." } };
      },
      terminate: () => {},
    }),
  };
}, { workers: WORKERS, ocrMs: OCR_MS });

await page.goto(base + "vault/index.html", { waitUntil: "networkidle" });
await page.waitForTimeout(300);
await page.locator("#file-input").setInputFiles(imgs);
await page.waitForFunction((n) => document.querySelectorAll("#results .card").length === n, IMAGES);

const t0 = Date.now();
await page.locator("#more-btn").click();
await page.locator('#more-menu button[data-action="scan-vins"]').click();
await page.waitForFunction(() => /VIN scan finished/.test(document.querySelector("#toast")?.textContent || ""), { timeout: 15000 });
const elapsed = Date.now() - t0;

const ocr = await page.evaluate(() => window.__ocr);
check(ocr.calls === IMAGES, `all ${IMAGES} images were OCR'd (got ${ocr.calls})`);
check(ocr.max === WORKERS, `OCR ran ${WORKERS} at a time in parallel (peak concurrency = ${ocr.max})`);
check(ocr.max > 1, "more than one core is used (not serial)");
// 6 images / 3 workers = 2 waves ≈ 600ms of OCR; serial would be ~1800ms.
check(elapsed < OCR_MS * IMAGES, `finished in ~waves, not serially (${elapsed}ms < ${OCR_MS * IMAGES}ms)`);

// The detected VIN is grouped as usual.
check((await page.locator('[data-count="vins"]').textContent()).trim() === String(IMAGES), "every image is filed under its VIN");

const realErrors = errors.filter((e) => !/favicon|manifest|the server responded|404|pdf|worker|Warning|Failed to load resource/i.test(e));
console.log(realErrors.length ? "\nConsole errors:\n" + realErrors.join("\n") : "\nNo unexpected console errors.");
check(realErrors.length === 0, "no unexpected console/page errors");

await browser.close();
server.close();
console.log(failures === 0 ? "\nVIN-PARALLEL CHECKS PASSED ✅" : `\n${failures} VIN-PARALLEL CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
