// End-to-end test for File Vault folder sync + auto-sync.
// The File System Access API can't be driven headlessly, so we inject a fake
// window.showDirectoryPicker backed by a mutable in-page virtual folder and
// exercise the real scan / import / dedup / auto-poll code paths.
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

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
let failures = 0;
const check = (c, l) => { console.log((c ? "  ✓ " : "  ✗ ") + l); if (!c) failures++; };

// Inject a fake File System Access folder picker before any page script runs.
await page.addInitScript(() => {
  window.__folder = [
    { name: "alpha.txt", type: "text/plain", text: "alpha", lastModified: 1000 },
    { name: "beta.txt", type: "text/plain", text: "beta-body", lastModified: 2000 },
  ];
  window.__setFolder = (arr) => { window.__folder = arr; };
  const fileHandle = (spec) => ({
    kind: "file", name: spec.name,
    async getFile() { return new File([spec.text], spec.name, { type: spec.type, lastModified: spec.lastModified }); },
  });
  const makeDir = (name) => ({
    kind: "directory", name,
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
    values() {
      const list = window.__folder.map(fileHandle);
      let i = 0;
      return { [Symbol.asyncIterator]() { return this; }, async next() { return i < list.length ? { value: list[i++], done: false } : { value: undefined, done: true }; } };
    },
  });
  window.showDirectoryPicker = async () => makeDir("Inbox");
});

const cards = () => page.locator("#results .card").count();
async function waitCards(n, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if ((await cards()) === n) return true; await page.waitForTimeout(120); }
  return (await cards()) === n;
}
async function clickMenu(action) {
  await page.click("#more-btn");
  await page.click(`#more-menu [data-action="${action}"]`);
}

await page.goto(base + "vault/index.html", { waitUntil: "networkidle" });
await page.waitForTimeout(400);
check((await cards()) === 0, "vault starts empty");

// 1. Link the folder + first scan imports both files
await clickMenu("sync-folder");
check(await waitCards(2), `linking a folder imports its files (got ${await cards()})`);
check((await page.locator("#nav-collections").textContent()).includes("Inbox"), "synced files are filed under an 'Inbox' collection (named after the folder)");

// 2. Re-scan with no changes imports nothing (dedup by name+size+mtime)
await clickMenu("sync-folder");
await page.waitForTimeout(800);
check((await cards()) === 2, "re-scanning an unchanged folder imports nothing");

// 3. A new file in the folder is picked up
await page.evaluate(() => window.__setFolder(window.__folder.concat([{ name: "gamma.txt", type: "text/plain", text: "gamma", lastModified: 3000 }])));
await clickMenu("sync-folder");
check(await waitCards(3), `a newly added file is imported on the next scan (got ${await cards()})`);

// 4. A changed file (new size + mtime) re-imports
await page.evaluate(() => {
  const f = window.__folder.slice();
  f[1] = { name: "beta.txt", type: "text/plain", text: "beta-body-CHANGED-LONGER", lastModified: 9000 };
  window.__setFolder(f);
});
await clickMenu("sync-folder");
check(await waitCards(4), `a modified file is re-imported (got ${await cards()})`);

// 5. Auto-sync toggle persists + imports without a manual click
await page.evaluate(() => window.__setFolder(window.__folder.concat([{ name: "delta.txt", type: "text/plain", text: "delta", lastModified: 4000 }])));
await clickMenu("auto-sync");                       // turn Auto-sync on (folder already linked)
await page.click("#more-btn");                      // reopen to read the label
check((await page.locator('#more-menu [data-action="auto-sync"]').textContent()).includes("on"), "Auto-sync toggles to 'on'");
await page.keyboard.press("Escape");
check(await waitCards(5, 5000), `auto-sync imports the new file on its own within a few seconds (got ${await cards()})`);
const autoPersisted = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("file-vault");
  r.onsuccess = () => { const db = r.result; const g = db.transaction("meta").objectStore("meta").get("syncAuto"); g.onsuccess = () => res(!!(g.result && g.result.value)); g.onerror = () => res(false); };
  r.onerror = () => res(false);
}));
check(autoPersisted, "auto-sync preference is persisted in IndexedDB");

// 6. Turning auto-sync off stops it
await clickMenu("auto-sync");
await page.click("#more-btn");
check((await page.locator('#more-menu [data-action="auto-sync"]').textContent()).includes("off"), "Auto-sync toggles back to 'off'");
await page.keyboard.press("Escape");

const realErrors = errors.filter((e) => !/favicon|manifest|the server responded|404/i.test(e));
console.log(realErrors.length ? "\nConsole errors:\n" + realErrors.join("\n") : "\nNo unexpected console errors.");
check(realErrors.length === 0, "no unexpected console/page errors");

await browser.close();
server.close();
console.log(failures === 0 ? "\nSYNC CHECKS PASSED ✅" : `\n${failures} SYNC CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
