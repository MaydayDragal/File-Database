// End-to-end test for the Repair Orders (ROs) tab:
//  - create/persist an RO with multiple story LINES (Line A, Line B…)
//  - attach files that are saved into the Vault under the RO's collection
//  - importing existing Vault files into an RO
//  - VIN auto-fill: files with no VIN get the RO's VIN stamped on
//  - VIN mismatch prompt: a file whose VIN differs can be Added anyway or Ignored
//  - editing the RO number migrates the collection; open-in-Vault filters Files
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./e2e-browser.mjs";

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

const FIX = path.join(ROOT, "tools", "_fixtures");
fs.mkdirSync(FIX, { recursive: true });
const write = (n, c) => { const p = path.join(FIX, n); fs.writeFileSync(p, c); return p; };

const RO_VIN = "4JGFB4GB9SB387878";      // the RO's VIN (a real MB WMI)
const OTHER_VIN = "WDC1660241A555777";   // a different valid MB VIN (mismatch → add)
const THIRD_VIN = "WDB2030461A654321";   // a different valid MB VIN (mismatch → ignore)

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, colorScheme: "dark" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
let failures = 0;
const check = (c, l) => { console.log((c ? "  ✓ " : "  ✗ ") + l); if (!c) failures++; };
const waitFor = async (fn, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(150); } return false; };

// Read all vault files (id, name, vins, collection) from the page context.
const vaultAll = () => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("file-vault");
  r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (e) {} };
  r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains("files")) { db.close(); return res([]); } const g = db.transaction("files", "readonly").objectStore("files").getAll(); g.onsuccess = () => { db.close(); res(g.result.map((x) => ({ name: x.name, vins: x.vins || [], collection: x.collection || "" }))); }; g.onerror = () => { db.close(); res([]); }; };
  r.onerror = () => res([]);
}));
const fileByName = async (n) => (await vaultAll()).find((f) => f.name === n) || null;

// ---------- Phase A: standalone — RO + multiple story lines ----------
await page.goto(base + "ros/index.html", { waitUntil: "load" });
await page.waitForTimeout(400);
check(await page.locator("#empty-main:not([hidden])").count() === 1, "empty state shows with no repair orders");
await page.click("#new-btn");
await page.waitForTimeout(200);
await page.fill("#ro-no", "7654321");
await page.fill("#ro-vehicle", "2021 GLC 300");
// First line exists by default; fill it, then add a second.
await page.locator("#lines textarea").nth(0).fill("Line A: customer states car makes a noise");
await page.click("#add-line-btn");
await page.waitForTimeout(150);
await page.locator("#lines textarea").nth(1).fill("Line B: customer states car feels weird");
await page.waitForTimeout(700);
check((await page.locator(".line__label").allTextContents()).join("|") === "Line A|Line B", "two story lines labelled A and B");

await page.reload({ waitUntil: "load" });
await page.waitForTimeout(500);
check((await page.inputValue("#ro-no")) === "7654321", "RO number persisted across reload");
const lineTexts = await page.locator("#lines textarea").all( ).then((ts) => Promise.all(ts.map((t) => t.inputValue())));
check(lineTexts.length === 2 && /makes a noise/.test(lineTexts[0]) && /feels weird/.test(lineTexts[1]), "both story lines persisted across reload");
check((await page.evaluate(() => window.__ros.count())) === 1, "exactly one repair order stored");

// ---------- Phase B: embedded — files, VIN auto-fill, import, mismatch ----------
await page.goto(base + "#ros", { waitUntil: "load" });
await page.waitForTimeout(600);
check(await page.locator("#tab-ros.is-active").count() === 1, "deep link #ros activates the Repair Orders tab");
const ro = page.frameLocator("#frame-ros");
await waitFor(async () => (await ro.locator("#ro-no").inputValue().catch(() => "")) === "7654321");
// Give the RO a VIN.
await ro.locator("#ro-vin").fill(RO_VIN);
await page.waitForTimeout(600);

// helper: add a file through the platform front door, then return to the RO tab
async function frontDoor(name, content) {
  await page.click("#tab-vault");
  await page.waitForTimeout(200);
  await page.setInputFiles("#shell-file-input", write(name, content));
  await page.waitForTimeout(300);
  await page.click("#tab-ros");
  await page.waitForTimeout(200);
}

// (1) Upload a no-VIN file directly to the RO → it lands in the collection and
//     gets the RO's VIN stamped on (auto-fill).
await ro.locator("#file-input").setInputFiles(write("ro-invoice.txt", "parts invoice for the repair order"));
const autofilled = await waitFor(async () => {
  const f = await fileByName("ro-invoice.txt");
  return f && f.collection === "RO 7654321" && f.vins.includes(RO_VIN);
}, 15000);
check(autofilled, "an uploaded file with no VIN is saved to the RO and stamped with the RO's VIN");

// (2) Import an EXISTING no-VIN vault file into the RO → assigned + VIN stamped.
await frontDoor("spare-note.txt", "just a spare note, no vehicle number");
await waitFor(async () => !!(await fileByName("spare-note.txt")));
await ro.locator("#import-btn").click();
await page.waitForTimeout(300);
await ro.locator("#pick-search").fill("spare-note");
await page.waitForTimeout(200);
await ro.locator("#pick-list .pick input").first().check();
await ro.locator("#pick-import").click();
const imported = await waitFor(async () => {
  const f = await fileByName("spare-note.txt");
  return f && f.collection === "RO 7654321" && f.vins.includes(RO_VIN);
}, 12000);
check(imported, "importing a no-VIN Vault file assigns it to the RO and stamps the RO VIN");

// (3) Import a file whose VIN DIFFERS → mismatch prompt → Add anyway (keeps its VIN).
await frontDoor("othercar.txt", "inspection for VIN " + OTHER_VIN + " today");
await waitFor(async () => { const f = await fileByName("othercar.txt"); return f && f.vins.includes(OTHER_VIN); });
await ro.locator("#import-btn").click();
await page.waitForTimeout(300);
await ro.locator("#pick-search").fill("othercar");
await page.waitForTimeout(200);
await ro.locator("#pick-list .pick input").first().check();
await ro.locator("#pick-import").click();
check(await waitFor(async () => (await ro.locator("#mm-modal.show").count()) === 1), "a mismatched VIN raises the add-or-ignore prompt");
await ro.locator("#mm-add").click();
const added = await waitFor(async () => {
  const f = await fileByName("othercar.txt");
  return f && f.collection === "RO 7654321" && f.vins.includes(OTHER_VIN) && !f.vins.includes(RO_VIN);
}, 12000);
check(added, "‘Add anyway’ adds the mismatched file, keeping its own VIN (not overwritten)");

// (4) Import another mismatched file → Ignore → NOT added to the RO.
await frontDoor("thirdcar.txt", "notes for VIN " + THIRD_VIN + " elsewhere");
await waitFor(async () => { const f = await fileByName("thirdcar.txt"); return f && f.vins.includes(THIRD_VIN); });
await ro.locator("#import-btn").click();
await page.waitForTimeout(300);
await ro.locator("#pick-search").fill("thirdcar");
await page.waitForTimeout(200);
await ro.locator("#pick-list .pick input").first().check();
await ro.locator("#pick-import").click();
await waitFor(async () => (await ro.locator("#mm-modal.show").count()) === 1);
await ro.locator("#mm-ignore").click();
await page.waitForTimeout(1500);
const ignored = await (async () => { const f = await fileByName("thirdcar.txt"); return f && f.collection !== "RO 7654321"; })();
check(ignored, "‘Ignore’ leaves the mismatched file out of the RO");

// The RO's file list now shows the three kept files (invoice, spare, othercar).
check(await waitFor(async () => (await ro.locator("#files .file").count()) === 3), "the RO lists its three attached files");

// ---------- rename migration + open in Vault ----------
await ro.locator("#ro-no").fill("7654399");
await page.waitForTimeout(1000);
const migrated = await waitFor(async () => {
  const all = await vaultAll();
  return all.filter((f) => f.collection === "RO 7654399").length === 3 && all.filter((f) => f.collection === "RO 7654321").length === 0;
}, 12000);
check(migrated, "editing the RO number moves all its files to the new collection");
await ro.locator("#open-vault-btn").click();
await page.waitForTimeout(700);
check(await page.locator("#tab-vault.is-active").count() === 1, "Open in Vault switches to Files");
const vault = page.frameLocator("#frame-vault");
check(/RO 7654399/.test((await vault.locator("#view-title").textContent()) || ""), "Files is filtered to the RO's collection");

console.log(errors.length ? "\nErrors:\n" + errors.join("\n") : "\nNo page errors.");
check(errors.length === 0, "no page errors");

await browser.close();
server.close();
console.log(failures === 0 ? "\nROS CHECKS PASSED ✅" : `\n${failures} ROS CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
