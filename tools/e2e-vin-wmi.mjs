// Verifies WMI validation: only strings beginning with a real Mercedes-Benz
// World Manufacturer Identifier are accepted as VINs. From a file containing
// the real VIN 4JGFB4GB9SB387878 (WMI 4JG, MB US) and the engine number
// 112600009311006RE (WMI "112" — not a manufacturer), only the VIN is tagged.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain" };
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

const VIN = "4JGFB4GB9SB387878";       // real — WMI 4JG (Mercedes US, Alabama)
const ENGINE = "112600009311006RE";    // engine number — WMI "112" is not a manufacturer
const NONMB = "1HGCM82633A004352";     // a real-format Honda VIN — not Mercedes, so ignored here

const fixDir = path.join(__dirname, "_fixtures");
fs.mkdirSync(fixDir, { recursive: true });
const txt = path.join(fixDir, "wmi-records.txt");
fs.writeFileSync(txt, `Vehicle ${VIN} fitted with engine number ${ENGINE}. Ref ${NONMB}.\n`);

const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
let failures = 0;
const check = (c, l) => { console.log((c ? "  ✓ " : "  ✗ ") + l); if (!c) failures++; };
const toastText = () => page.locator("#toast").textContent().catch(() => "");
async function waitFor(fn, ms = 12000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(200); } return fn(); }

await page.goto(base + "vault/index.html", { waitUntil: "networkidle" });
await page.waitForTimeout(300);
await page.locator("#file-input").setInputFiles(txt);
check(await waitFor(async () => (await page.locator("#results .card").count()) === 1), "file imported");

await page.locator("#more-btn").click();
await page.locator('#more-menu button[data-action="scan-vins"]').click();
check(await waitFor(async () => /VIN scan finished/.test(await toastText() || "")), "scan completes");

const rec = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("file-vault");
  r.onsuccess = () => { const c = r.result.transaction("files").objectStore("files").getAll(); c.onsuccess = () => { const x = c.result[0] || {}; res({ vins: x.vins || [], fins: x.fins || [] }); }; c.onerror = () => res({}); };
  r.onerror = () => res({});
}));
const all = (rec.vins || []).concat(rec.fins || []);
check(rec.vins.length === 1 && rec.vins[0] === VIN, `real VIN detected (${JSON.stringify(rec.vins)})`);
check(!all.includes(ENGINE), "engine number 112600009311006RE was NOT tagged (invalid WMI)");
check(!all.includes(NONMB), "non-Mercedes VIN was ignored (WMI not in the MB set)");

// By-VIN sidebar has exactly the one real VIN.
check(await waitFor(async () => !(await page.locator("#vins-section").isHidden())), "VIN section visible");
const items = await page.locator("#nav-vins .nav__item").allTextContents();
check(items.length === 1 && items[0].includes(VIN), "sidebar lists only the real VIN");

// Searching the engine number finds nothing.
await page.fill("#search-input", ENGINE);
await page.waitForTimeout(350);
check((await page.locator("#results .card").count()) === 0, "searching the engine number finds nothing");

const realErrors = errors.filter((e) => !/favicon|manifest|the server responded|404|pdf|worker|Warning|Failed to load resource/i.test(e));
console.log(realErrors.length ? "\nConsole errors:\n" + realErrors.join("\n") : "\nNo unexpected console errors.");
check(realErrors.length === 0, "no unexpected console/page errors");

await browser.close();
server.close();
console.log(failures === 0 ? "\nVIN-WMI CHECKS PASSED ✅" : `\n${failures} VIN-WMI CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
