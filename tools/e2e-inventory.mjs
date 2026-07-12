// End-to-end test for the Tool Inventory app + its File Vault hub embedding.
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
  if (p === "/") p = "/index.html";
  const file = path.join(ROOT, p);
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
check(rowCount > 0, `rows render from the bundled seed (got ${rowCount})`);
check((await page.locator("#sub").textContent()).includes("tools"), "header shows the tool count");
const totalTxt = await page.locator("#count").textContent();
check(/tools?/.test(totalTxt), `count reads '${totalTxt.trim()}'`);

// Search narrows results
const before = await page.locator("#tbody tr").count();
await page.fill("#search", "torque wrench");
await page.waitForTimeout(300);
const after = await page.locator("#tbody tr").count();
check(after > 0 && after < before, `search 'torque wrench' narrows ${before}→${after}`);
await page.fill("#search", "");
await page.waitForTimeout(250);

// Filter by service group (pick the 2nd option)
const grpVal = await page.locator("#fGrp option").nth(1).getAttribute("value");
await page.selectOption("#fGrp", grpVal);
await page.waitForTimeout(250);
const grpRows = await page.locator("#tbody tr").count();
check(grpRows > 0, `service-group filter '${grpVal}' shows ${grpRows} tools`);
// every visible row's Svc Grp cell equals the filter
const allMatch = await page.evaluate((g) => Array.from(document.querySelectorAll("#tbody tr")).every((tr) => tr.children[3].textContent.trim() === g), grpVal);
check(allMatch, "filtered rows all belong to that service group");
await page.selectOption("#fGrp", "");
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

// ---------- Hub embedding ----------
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(400);
check(await page.locator("#nav-inventory").isVisible(), "File Vault sidebar shows 'Tool Inventory'");
await page.locator("#nav-inventory").click();
await page.waitForTimeout(300);
check(await page.locator("#inventory-view").isVisible(), "clicking it opens the embedded inventory");
check((await page.locator("#view-title").textContent()).includes("Tool Inventory"), "title switches to Tool Inventory");
const invFrame = page.frameLocator("#inventory-frame");
await page.waitForTimeout(900);
check(await invFrame.locator("#tbody tr").first().isVisible(), "embedded inventory renders its table");
check(await invFrame.locator("#backBtn").isVisible(), "embedded inventory shows a '← Files' link");
// Switching to LI Documents hides the inventory view (only one app at a time)
await page.locator("#nav-li").click();
await page.waitForTimeout(300);
check(!(await page.locator("#inventory-view").isVisible()), "switching apps hides the inventory view");
check(await page.locator("#li-view").isVisible(), "LI view now visible");
// Back link from inventory returns to files
await page.locator("#nav-inventory").click();
await page.waitForTimeout(400);
await invFrame.locator("#backBtn").click();
await page.waitForTimeout(400);
check(!(await page.locator("#inventory-view").isVisible()), "inventory back link returns to the file list");

const realErrors = errors.filter((e) => !/favicon|manifest|the server responded|404/i.test(e));
console.log(realErrors.length ? "\nErrors:\n" + realErrors.join("\n") : "\nNo unexpected console errors.");
check(realErrors.length === 0, "no unexpected console/page errors");

await browser.close();
server.close();
console.log(failures === 0 ? "\nINVENTORY CHECKS PASSED ✅" : `\n${failures} INVENTORY CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
