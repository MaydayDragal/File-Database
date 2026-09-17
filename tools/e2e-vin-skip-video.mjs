// Verifies the VIN scan SKIPS videos entirely: a video is never scanned, its
// blob isn't touched, its filename VIN is never matched, and the detail drawer
// hides the "Detect" button for it. A text file alongside it is still scanned.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser, launchPersistent } from "./e2e-browser.mjs";
import { fdbSeed, vaultFiles } from "./e2e-db.mjs";

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

const VIN_TEXT = "WDD2050091R123456";   // in a text file's content — should be found
const VIN_VIDEO = "WDB2030461A654321";  // in a video's FILENAME — must NOT be found (skipped)

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
const page = await ctx.newPage();
page.on("dialog", (d) => d.accept());
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
let failures = 0;
const check = (c, l) => { console.log((c ? "  ✓ " : "  ✗ ") + l); if (!c) failures++; };
const toastText = () => page.locator("#toast").textContent().catch(() => "");
async function waitFor(fn, ms = 10000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(200); } return fn(); }

await page.goto(base + "#vault", { waitUntil: "networkidle" });

// Seed a video record (VIN in its filename) + a text record (VIN in content),
// straight into the shared database, then reload so the app loads them into its list.
await fdbSeed(page, {
  files: [
    { id: "vid1", name: `dashcam-${VIN_VIDEO}.mp4`, type: "video/mp4", kind: "video", size: 999999999 },
    { id: "txt1", name: "repair-order.txt", type: "text/plain", kind: "text", size: 40 },
  ],
  blobs: [
    { id: "vid1", text: "not-a-real-video", type: "video/mp4" },
    { id: "txt1", text: `Vehicle ${VIN_TEXT} received.`, type: "text/plain" },
  ],
});

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(400);
check(await waitFor(async () => (await page.locator("#results .card").count()) === 2), "video + text file both loaded");

// Run the scan.
await page.locator("#more-btn").click();
await page.locator('#more-menu button[data-action="scan-vins"]').click();
check(await waitFor(async () => /VIN scan finished/.test(await toastText() || "")), "scan completes");

// The text file's VIN is found; the video's filename VIN is NOT.
check(await waitFor(async () => !(await page.locator("#vins-section").isHidden())), "a VIN was detected");
const vinList = (await page.locator("#nav-vins .nav__item").allTextContents()).join(" ");
check(vinList.includes(VIN_TEXT), "the text file's VIN is listed");
check(!vinList.includes(VIN_VIDEO), "the video's filename VIN is NOT listed (video skipped)");
check((await page.locator("#nav-vins .nav__item").count()) === 1, "exactly one VIN group (only the text file)");

// The stored video record was never scanned (vinScan stays 0, no vins).
const rec = await (async () => {
  const all = await vaultFiles(page);
  const v = all.find((x) => x.id === "vid1"), t = all.find((x) => x.id === "txt1");
  return { vidScan: v ? (v.vinScan || 0) : -1, vidVins: v ? (v.vins || []).length : -1, txtScan: t ? (t.vinScan || 0) : -1 };
})();
check(rec && rec.vidScan === 0 && rec.vidVins === 0, "video record was never scanned (vinScan=0, no vins)");
check(rec && rec.txtScan > 0, "text record WAS scanned");

// The detail drawer hides "Detect" for a video.
await page.locator("#results .card", { hasText: "dashcam" }).first().click();
check(await waitFor(async () => !(await page.locator("#detail").isHidden())), "video detail opens");
check(await page.locator("#d-scan-vin").isHidden(), "the 'Detect' VIN button is hidden for videos");

const realErrors = errors.filter((e) => !/favicon|manifest|the server responded|404|pdf|worker|Warning|Failed to load resource|media|video/i.test(e));
console.log(realErrors.length ? "\nConsole errors:\n" + realErrors.join("\n") : "\nNo unexpected console errors.");
check(realErrors.length === 0, "no unexpected console/page errors");

await browser.close();
server.close();
console.log(failures === 0 ? "\nVIN-SKIP-VIDEO CHECKS PASSED ✅" : `\n${failures} VIN-SKIP-VIDEO CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
