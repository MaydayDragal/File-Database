// End-to-end test for the Repair Orders (ROs) tab:
//  - create/persist an RO with multiple story LINES (Line A, Line B…)
//  - attach files: saved in Files and linked to the RO (ro → file,
//    "attachment") — no collection string (Phase 5)
//  - importing existing Vault files into an RO
//  - VIN auto-fill: files with no VIN get the RO's VIN stamped on
//  - VIN mismatch prompt: a file whose VIN differs can be Added anyway or Ignored
//  - renumbering the RO touches the RO record alone; open-in-Files lists the
//    RO's files by its links
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./e2e-browser.mjs";
import { vaultFiles, fdbAll } from "./e2e-db.mjs";

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
// The VIN-mismatch prompt is a confirm() in the Vault: accept = add anyway, dismiss = ignore.
let nextDialog = null;
page.on("dialog", (d) => { if (nextDialog === "dismiss") d.dismiss(); else d.accept(); nextDialog = null; });

// Read all vault files (id, name, vins, collection) from the page context.
const vaultAll = async () => (await vaultFiles(page)).map((x) => ({ id: x.id, name: x.name, vins: x.vins || [], collection: x.collection || "" }));
const fileByName = async (n) => (await vaultAll()).find((f) => f.name === n) || null;
// The files linked to the open repair order.
const roId = async () => page.evaluate(() => window.__ros.current && window.__ros.current.id);
const attachedIds = async () => { const id = await roId(); return (await fdbAll(page, "links")).filter((l) => l.fromType === "ro" && l.fromId === id && l.kind === "attachment" && l.toType === "file").map((l) => l.toId); };
const isAttached = async (name) => { const f = await fileByName(name); return !!(f && (await attachedIds()).includes(f.id)); };

// ---------- Phase A: standalone — RO + multiple story lines ----------
await page.goto(base + "#ros", { waitUntil: "load" });
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
const ro = page.locator("#view-ros");
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

// (1) Upload a no-VIN file directly to the RO → it is linked to the RO and
//     gets the RO's VIN stamped on (auto-fill). No collection is invented.
await ro.locator("#file-input").setInputFiles(write("ro-invoice.txt", "parts invoice for the repair order"));
const autofilled = await waitFor(async () => {
  const f = await fileByName("ro-invoice.txt");
  return f && f.collection === "" && f.vins.includes(RO_VIN) && (await isAttached("ro-invoice.txt"));
}, 15000);
check(autofilled, "an uploaded file with no VIN is saved to the RO and stamped with the RO's VIN");

// Import happens on the NORMAL Vault screen: the RO's Import button sends us
// there in "select for RO" mode; pick with the Vault's multi-select, then click
// its ➕ Add to RO button.
const vaultF = page.locator("#view-vault");
async function importIntoRO(name, dialog) {
  await ro.locator("#import-btn").click();
  await waitFor(async () => (await page.locator("#tab-vault.is-active").count()) === 1 && (await vaultF.locator("#ro-import-banner:not([hidden])").count()) === 1);
  // Isolate and select the file in the Vault.
  await vaultF.locator("#search-input").fill(name);
  await waitFor(async () => (await vaultF.locator(".card").count()) === 1);
  await vaultF.locator(".card").first().hover();
  await vaultF.locator(".card__select").first().click();
  await waitFor(async () => (await vaultF.locator("#bulk-add-ro:not([hidden])").count()) === 1);
  nextDialog = dialog || null; // arm the mismatch confirm response, if any
  await vaultF.locator("#bulk-add-ro").click();
  // It applies and navigates back to the RO tab.
  await waitFor(async () => (await page.locator("#tab-ros.is-active").count()) === 1, 8000);
}

// (2) Import an EXISTING no-VIN vault file into the RO → assigned + VIN stamped.
await frontDoor("spare-note.txt", "just a spare note, no vehicle number");
await waitFor(async () => !!(await fileByName("spare-note.txt")));
check(await waitFor(async () => (await vaultF.locator("#bulk-add-ro").count()) === 1), "the Vault has an ‘Add to RO’ bulk button");
await importIntoRO("spare-note.txt", null);
const imported = await waitFor(async () => {
  const f = await fileByName("spare-note.txt");
  return f && f.vins.includes(RO_VIN) && (await isAttached("spare-note.txt"));
}, 12000);
check(imported, "selecting a no-VIN file in the Vault and clicking ‘Add to RO’ assigns it and stamps the RO VIN");

// (3) Import a file whose VIN DIFFERS → mismatch confirm → Add anyway (keeps its VIN).
await frontDoor("othercar.txt", "inspection for VIN " + OTHER_VIN + " today");
await waitFor(async () => { const f = await fileByName("othercar.txt"); return f && f.vins.includes(OTHER_VIN); });
await importIntoRO("othercar.txt", "accept");
const added = await waitFor(async () => {
  const f = await fileByName("othercar.txt");
  return f && f.vins.includes(OTHER_VIN) && !f.vins.includes(RO_VIN) && (await isAttached("othercar.txt"));
}, 12000);
check(added, "a mismatched VIN prompts, and ‘Add anyway’ adds it keeping its own VIN");

// (4) Import another mismatched file → Ignore → NOT added to the RO.
await frontDoor("thirdcar.txt", "notes for VIN " + THIRD_VIN + " elsewhere");
await waitFor(async () => { const f = await fileByName("thirdcar.txt"); return f && f.vins.includes(THIRD_VIN); });
await importIntoRO("thirdcar.txt", "dismiss");
await page.waitForTimeout(800);
const ignored = await (async () => { const f = await fileByName("thirdcar.txt"); return f && !(await isAttached("thirdcar.txt")); })();
check(ignored, "choosing ‘Ignore’ (Cancel) leaves the mismatched file out of the RO");

// The RO's file list now shows the three kept files (invoice, spare, othercar).
check(await waitFor(async () => (await ro.locator("#files .file").count()) === 3), "the RO lists its three attached files");

// ---------- renumber (the RO record alone) + open in Files ----------
const before = JSON.stringify((await fdbAll(page, "files")).map((f) => [f.id, f.rev, f.collection, f.updatedAt]).sort());
await ro.locator("#ro-no").fill("7654399");
await page.waitForTimeout(1000);
const renumbered = await waitFor(async () => (await fdbAll(page, "ros")).some((r) => r.ro === "7654399"), 8000);
const after = JSON.stringify((await fdbAll(page, "files")).map((f) => [f.id, f.rev, f.collection, f.updatedAt]).sort());
check(renumbered && before === after, "renumbering the RO writes the RO alone — no file record changes");
check((await attachedIds()).length === 3 && (await ro.locator("#files .file").count()) === 3, "its three files are still attached after the renumber");
await ro.locator("#open-vault-btn").click();
await page.waitForTimeout(700);
check(await page.locator("#tab-vault.is-active").count() === 1, "Open in Files switches to Files");
const vault = page.locator("#view-vault");
check(/RO 7654399/.test((await vault.locator("#view-title").textContent()) || ""), "Files shows the RO's files under its new number");
check(await waitFor(async () => (await vault.locator(".card").count()) === 3), "…exactly the three attached files (by link)");

console.log(errors.length ? "\nErrors:\n" + errors.join("\n") : "\nNo page errors.");
check(errors.length === 0, "no page errors");

await browser.close();
server.close();
console.log(failures === 0 ? "\nROS CHECKS PASSED ✅" : `\n${failures} ROS CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
