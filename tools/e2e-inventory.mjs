// End-to-end test for the Tool Inventory app + its File Database shell embedding.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";           // directory index (/, /vault/, /li/, …)
  let file = path.join(ROOT, p);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;
console.log("serving", base);

const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1320, height: 860 }, colorScheme: "dark" });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
let failures = 0;
const check = (c, l) => { console.log((c ? "  ✓ " : "  ✗ ") + l); if (!c) failures++; };

// ---------- Standalone app ----------
await page.goto(base + "inventory/index.html", { waitUntil: "networkidle" });
await page.waitForTimeout(700);
const rowCount = await page.locator("#tbody tr").count();
check(rowCount > 1400, `rows render from the bundled seed (got ${rowCount})`);
check((await page.locator("#sub").textContent()).includes("offered"), "header shows offered/photo counts");
const totalTxt = await page.locator("#count").textContent();
check(/tools?/.test(totalTxt), `count reads '${totalTxt.trim()}'`);
check(await page.locator("#backBtn").isVisible(), "standalone inventory shows the '⌂ File Database' link");

// --- Part photos appear in the list and actually load ---
const thumbCount = await page.locator("#tbody .thumb").count();
check(thumbCount > 0, `part photos render as thumbnails in the list (${thumbCount} visible)`);
const firstThumbLoaded = await page.locator("#tbody .thumb").first().evaluate((img) => new Promise((res) => {
  if (img.complete) return res(img.naturalWidth > 0);
  img.onload = () => res(img.naturalWidth > 0); img.onerror = () => res(false);
}));
check(firstThumbLoaded, "a part photo actually loads (naturalWidth > 0)");

// Search narrows results
const before = await page.locator("#tbody tr").count();
await page.fill("#search", "torque wrench");
await page.waitForTimeout(300);
const after = await page.locator("#tbody tr").count();
check(after > 0 && after < before, `search 'torque wrench' narrows ${before}→${after}`);
// No-matches state shows a real message, not the stale "Loading…" placeholder
await page.fill("#search", "zzz-no-such-tool");
await page.waitForTimeout(300);
const emptyTxt = (await page.locator("#empty").textContent()).trim();
check(await page.locator("#empty").isVisible() && /no tools match/i.test(emptyTxt), `no-matches shows a proper message ('${emptyTxt}')`);
await page.fill("#search", "");
await page.waitForTimeout(250);

// Filter by service group (pick the 2nd option)
const grpVal = await page.locator("#fGrp option").nth(1).getAttribute("value");
await page.selectOption("#fGrp", grpVal);
await page.waitForTimeout(250);
const grpRows = await page.locator("#tbody tr").count();
check(grpRows > 0, `service-group filter '${grpVal}' shows ${grpRows} tools`);
// every visible row's Svc Grp cell equals the filter (col index 4: photo,star,toolNo,desc,svcGrp)
const allMatch = await page.evaluate((g) => Array.from(document.querySelectorAll("#tbody tr")).every((tr) => tr.children[4].textContent.trim() === g), grpVal);
check(allMatch, "filtered rows all belong to that service group");
await page.selectOption("#fGrp", "");
await page.waitForTimeout(200);

// --- 'Offered' filter shows only catalog tools ---
await page.click("#offeredFilter");
await page.waitForTimeout(250);
const offRows = await page.locator("#tbody tr").count();
check(offRows > 0 && offRows < rowCount, `offered filter narrows ${rowCount}→${offRows}`);
const allOffered = await page.evaluate(() => Array.from(document.querySelectorAll("#tbody tr")).every((tr) => tr.querySelector(".badge-offer")));
check(allOffered, "every offered-filtered row is marked 'offered'");
await page.click("#offeredFilter");
await page.waitForTimeout(200);

// --- Detail view shows the part photo + catalog description ---
await page.fill("#search", "eyelets");
await page.waitForTimeout(300);
await page.locator("#tbody tr").first().click();
await page.waitForTimeout(250);
check(await page.locator("#dPhoto img").isVisible(), "detail view shows the part photo");
const detailPhotoLoaded = await page.locator("#dPhoto img").evaluate((img) => img.complete && img.naturalWidth > 0);
check(detailPhotoLoaded, "detail photo loads");
check((await page.locator("#dExtra").textContent()).length > 20, "detail view shows catalog description / validities");
await page.click("[data-close]");
await page.fill("#search", "");
await page.waitForTimeout(200);

// Sort by Dealer Net (click header twice → descending, top row is the max)
await page.click('#thead th[data-sort="price"]');
await page.click('#thead th[data-sort="price"]');
await page.waitForTimeout(250);
check(await page.locator('#thead th[data-sort="price"]').getAttribute("class") === "num desc" || (await page.locator('#thead th[data-sort="price"]').getAttribute("class")).includes("desc"), "price column sorts descending");

// Open a detail, star it, edit location, save
await page.locator("#tbody tr").first().click();
await page.waitForTimeout(200);
check(await page.locator("#detail.show").count() > 0, "detail modal opens");
check((await page.locator("#dTitle").textContent()).trim().length > 0, "detail shows a tool number");
await page.click("#dStar");
await page.fill("#eLoc", "TEST-BIN-9");
await page.click("#dSave");
await page.waitForTimeout(250);
// Star filter now shows exactly the starred tool
await page.click("#starFilter");
await page.waitForTimeout(200);
check((await page.locator("#tbody tr").count()) === 1, "star filter shows the one starred tool");
await page.locator("#tbody tr").first().click();
await page.waitForTimeout(200);
check((await page.locator("#eLoc").inputValue()) === "TEST-BIN-9", "edited location persisted");
await page.click("[data-close]");
await page.click("#starFilter");
await page.waitForTimeout(150);

// Persistence across reload (IndexedDB seed loaded once)
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(500);
check((await page.locator("#tbody tr").count()) > 0, "data persists after reload");
const starredStill = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("tool-inventory");
  r.onsuccess = () => { const db = r.result; const c = db.transaction("tools").objectStore("tools").getAll(); c.onsuccess = () => res(c.result.filter((t) => t.star).length); c.onerror = () => res(-1); };
  r.onerror = () => res(-1);
}));
check(starredStill === 1, `starred flag persisted in IndexedDB (${starredStill})`);

// --- Seed upgrade preserves stars + edits (simulate an older seedVersion) ---
const starredTool = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("tool-inventory");
  r.onsuccess = () => { const db = r.result; const c = db.transaction("tools").objectStore("tools").getAll(); c.onsuccess = () => { const s = c.result.find((t) => t.star); res(s ? { toolNo: s.toolNo, location: s.location } : null); }; };
}));
check(!!starredTool, "found the starred+edited tool before upgrade");
// Force the stored seedVersion back to 1 so boot() runs upgradeSeed() on reload.
await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("tool-inventory");
  r.onsuccess = () => { const db = r.result; const t = db.transaction("meta", "readwrite"); t.objectStore("meta").put({ k: "seedVersion", v: 1 }); t.oncomplete = () => res(1); };
}));
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(700);
check((await page.locator("#tbody tr").count()) > 1400, "catalog still present after upgrade");
const afterUpgrade = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("tool-inventory");
  r.onsuccess = () => { const db = r.result; const c = db.transaction("tools").objectStore("tools").getAll(); c.onsuccess = () => { const st = c.result.filter((t) => t.star); res({ starred: st.length, locs: st.map((t) => t.location) }); }; };
}));
check(afterUpgrade.starred === 1, `upgrade preserved the star (${afterUpgrade.starred})`);
check(afterUpgrade.locs.includes("TEST-BIN-9"), `upgrade preserved the edited location (${JSON.stringify(afterUpgrade.locs)})`);
const verNow = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("tool-inventory");
  r.onsuccess = () => { const db = r.result; const g = db.transaction("meta").objectStore("meta").get("seedVersion"); g.onsuccess = () => res(g.result && g.result.v); };
}));
check(verNow === 4, `seedVersion now matches the code constant (${verNow}) — no re-seed loop`);

// Export CSV downloads
const [dl] = await Promise.all([
  page.waitForEvent("download"),
  page.click("#menuBtn").then(() => page.click("#exportCsvBtn")),
]);
const csvPath = path.join(ROOT, "tools", "_fixtures", "inv.csv");
fs.mkdirSync(path.dirname(csvPath), { recursive: true });
await dl.saveAs(csvPath);
const csv = fs.readFileSync(csvPath, "utf8");
check(csv.split("\n")[0].includes("Tool Number"), "exported CSV has a header row");
check(csv.split("\n").length > 100, "exported CSV has many rows");

await page.screenshot({ path: path.join(ROOT, "tools", "shot-inventory.png") });

// ---------- Platform shell embedding ----------
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(400);
check(await page.locator("#tab-inventory").isVisible(), "shell shows a 'Tool Inventory' tab");
await page.click("#tab-inventory");
await page.waitForTimeout(300);
check(await page.locator("#view-inventory:not([hidden])").count() === 1, "clicking it opens the embedded inventory");
check(await page.locator("#tab-inventory.is-active").count() === 1, "Tool Inventory tab is active");
const invFrame = page.frameLocator("#frame-inventory");
await invFrame.locator("#tbody tr").first().waitFor({ timeout: 15000 });
check(await invFrame.locator("#tbody tr").first().isVisible(), "embedded inventory renders its table");
check(await invFrame.locator("#backBtn").isHidden(), "embedded inventory hides the standalone '⌂ File Database' link");
// Switching to LI Documents hides the inventory panel (only one app at a time)
await page.click("#tab-li");
await page.waitForTimeout(300);
check(await page.locator("#view-inventory[hidden]").count() === 1, "switching apps hides the inventory panel");
check(await page.locator("#view-li:not([hidden])").count() === 1, "LI panel now visible");
await page.click("#tab-inventory");
await page.waitForTimeout(300);
const visiblePanels = await page.evaluate(() =>
  Array.from(document.querySelectorAll(".app-panel")).filter((el) => !el.hidden).map((el) => el.id));
check(visiblePanels.length === 1 && visiblePanels[0] === "view-inventory", `only one panel visible at a time (${visiblePanels.join(", ")})`);

const realErrors = errors.filter((e) => !/favicon|manifest|the server responded|404/i.test(e));
console.log(realErrors.length ? "\nErrors:\n" + realErrors.join("\n") : "\nNo unexpected console errors.");
check(realErrors.length === 0, "no unexpected console/page errors");

// --- Fresh profile: opening the shell (vault first) must not break the inventory app ---
// (regression for the bug where the hub's count-peek pre-created the inventory
//  IndexedDB empty at v1, blocking the app from creating its stores — the peek
//  now lives in the shell's tab badges and must stay non-destructive)
const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 820 }, colorScheme: "dark" });
const p2 = await ctx2.newPage();
const err2 = [];
p2.on("pageerror", (e) => err2.push(String(e.message)));
await p2.goto(base, { waitUntil: "networkidle" });   // shell boots the vault + badge peek first
await p2.waitForTimeout(600);
await p2.click("#tab-inventory");
const inv2 = p2.frameLocator("#frame-inventory");
await inv2.locator("#tbody tr").first().waitFor({ timeout: 20000 }).catch(() => {});
let rows2 = 0;
for (let i = 0; i < 40; i++) {           // fresh profile seeds ~1500 rows — poll
  rows2 = await inv2.locator("#tbody tr").count();
  if (rows2 > 1400) break;
  await p2.waitForTimeout(250);
}
check(rows2 > 1400, `inventory still loads after the shell opened first (rows=${rows2})`);
const invBroken = await inv2.locator("#empty").evaluate((el) => el.offsetParent !== null && /couldn't load/i.test(el.textContent)).catch(() => false);
check(!invBroken, "inventory did not show the 'Couldn't load' error");
await ctx2.close();

await browser.close();
server.close();
console.log(failures === 0 ? "\nINVENTORY CHECKS PASSED ✅" : `\n${failures} INVENTORY CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
