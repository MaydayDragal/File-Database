// A VIN scan must not miss a photo that was taken (or scanned) sideways.
//
// The engine does not fail on a rotated page — it returns a few scraps — so the
// Vault reads the page as it came in and, only when no VIN came out of it,
// works out which way up it is and reads it again. This drives that path with a
// scripted engine: the plain read yields nothing, the probe reads well at 270°,
// and the re-read carries the VIN. The matching "a read that already found a
// VIN never pays for a probe" case is asserted in e2e-vin-recall.mjs.
import http from "node:http";
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./e2e-browser.mjs";
import { vaultFiles } from "./e2e-db.mjs";

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

const VIN = "W1KLF4HB1RA068698";

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function buildPng(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h, 0xff);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const FIX = path.join(__dirname, "_fixtures");
fs.mkdirSync(FIX, { recursive: true });
const photo = path.join(FIX, "datacard-sideways.png");
fs.writeFileSync(photo, buildPng(1200, 800));

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1150, height: 820 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
let failures = 0;
const check = (c, l, extra) => { console.log((c ? "  ✓ " : "  ✗ ") + l + (c || extra === undefined ? "" : " — got " + JSON.stringify(extra))); if (!c) failures++; };
const waitFor = async (fn, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(200); } return fn(); };

// A scripted engine playing a sideways datacard.
await page.addInitScript((vin) => {
  window.__ocr = [];
  const words = (n, conf) => Array.from({ length: n }, (_, i) => ({ text: "w" + i, confidence: conf }));
  window.Tesseract = {
    createWorker: async () => {
      let psm = null;
      return {
        setParameters: async (p) => { psm = String(p.tessedit_pageseg_mode); },
        recognize: async (canvas) => {
          const probe = psm === "6";
          const probeIndex = probe ? window.__ocr.filter((c) => c.probe).length + 1 : 0;
          const reads = window.__ocr.filter((c) => !c.probe).length;
          window.__ocr.push({ psm, probe, probeIndex, w: canvas.width, h: canvas.height });
          if (probe) {
            const hit = probeIndex === 3;                       // only 270° reads
            return { data: { text: "", confidence: hit ? 88 : 20, words: words(hit ? 60 : 1, 60) } };
          }
          // The first read is the page as it arrived: scraps, no VIN. The read
          // after the probe is the same page turned upright.
          const text = reads === 0 ? "sideways scraps nothing here" : `DATACARD VIN ${vin} model 214`;
          return { data: { text, confidence: 90, words: words(40, 80) } };
        },
        terminate: () => {},
      };
    },
  };
}, VIN);

await page.goto(base + "vault/index.html", { waitUntil: "load" });
await page.waitForTimeout(400);
check(await page.evaluate(() => typeof window.OcrOrient === "object"), "the Vault loads the shared OCR helper");

await page.locator("#file-input").setInputFiles([photo]);
check(await waitFor(async () => (await page.locator("#results .card").count()) === 1), "the photo is imported");

await page.locator("#more-btn").click();
await page.locator('#more-menu button[data-action="scan-vins"]').click();

const record = async () => (await vaultFiles(page))[0] || null;
check(await waitFor(async () => { const r = await record(); return r && r.vinScan; }, 60000), "the scan finishes");

const rec = await record();
check(!!rec && (rec.vins || []).includes(VIN), "the VIN is found on a photo that had to be turned first", rec && rec.vins);

const calls = await page.evaluate(() => window.__ocr);
check(calls.filter((c) => !c.probe).length === 2, "the page is read once as it arrived, then once turned", calls.map((c) => c.psm));
check(calls.filter((c) => c.probe).length === 3, "probing stopped as soon as a rotation read well", calls.filter((c) => c.probe).length);
check(calls[0].psm === "3", "reads ask for document mode, not the engine's one-block default", calls[0]);
const turned = calls[calls.length - 1];
check(turned.h > turned.w, "the re-read is of the turned page", { w: turned.w, h: turned.h });

console.log(errors.length ? "\nErrors:\n" + errors.join("\n") : "\nNo page errors.");
check(errors.length === 0, "no page errors");

await browser.close();
server.close();
console.log(failures === 0 ? "\nVIN ORIENTATION CHECKS PASSED ✅" : `\n${failures} VIN ORIENTATION CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
