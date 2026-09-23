// An out-of-date copy of the app meeting a newer database (the stale offline
// cache that made saves fail with "The requested version (1) is less than the
// existing version (2)"): the page must clear the service worker's app cache
// and reload ONCE to fetch the current code — and, when the code it gets is
// still older (nothing newer to fetch), stop and say so instead of looping.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./e2e-browser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;
console.log("serving", base);

let failures = 0;
const check = (c, l, extra) => { console.log((c ? "  ✓ " : "  ✗ ") + l + (!c && extra !== undefined ? "  → " + JSON.stringify(extra) : "")); if (!c) failures++; };

const browser = await launchBrowser();
const ctx = await browser.newContext({ serviceWorkers: "block" });
const page = await ctx.newPage();

// Same origin, before the app runs: a database already upgraded past this
// code's schema, an app cache the recovery must drop and the OCR runtime
// cache it must keep.
await page.goto(base + "manifest.webmanifest");
await page.evaluate(async () => {
  await new Promise((resolve, reject) => {
    const r = indexedDB.open("file-database-1", 99);
    r.onupgradeneeded = () => r.result.createObjectStore("files", { keyPath: "id" });
    r.onsuccess = () => { r.result.close(); resolve(); };
    r.onerror = () => reject(r.error);
  });
  localStorage.setItem("fdb.generation", "file-database-1");
  await (await caches.open("file-database-v3")).put("/stale.js", new Response("old"));
  await (await caches.open("platform-runtime-v1")).put("/engine.js", new Response("ocr"));
});

let loads = 0;
page.on("load", () => { loads++; });
await page.goto(base + "#vault");
const t0 = Date.now();
while (Date.now() - t0 < 8000 && loads < 2) await page.waitForTimeout(100);
await page.waitForTimeout(3000); // time for a (wrong) further reload
check(loads === 2, "the out-of-date page reloads exactly once to fetch the current code", loads);
const kept = await page.evaluate(async () => (await caches.keys()).sort());
check(!kept.includes("file-database-v3"), "the stale app cache is cleared before the reload", kept);
check(kept.includes("platform-runtime-v1"), "the OCR engine's cache is kept", kept);
const toast = (await page.locator("#shell-toast").textContent()) || "";
check(/older than your data/.test(toast) && /Ctrl\+Shift\+R/.test(toast), "when the reload still finds older code, it says so instead of looping", toast);
const stillThere = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open("file-database-1"); r.onsuccess = () => { const v = r.result.version; r.result.close(); res(v); }; r.onerror = () => res(-1); }));
check(stillThere === 99, "the database is left exactly as it was", stillThere);

await browser.close();
server.close();
console.log(failures === 0 ? "\nOUTDATED-CODE CHECKS PASSED ✅" : `\n${failures} OUTDATED-CODE CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
