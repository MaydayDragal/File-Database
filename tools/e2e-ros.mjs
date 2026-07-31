// End-to-end test for the Repair Orders (ROs) tab: create/persist an RO with a
// basic notes box, and — embedded in the shell — attach files that are saved
// into the Vault under the RO's collection, migrate that collection when the RO
// number changes, and open the RO's files in the Vault.
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
fs.writeFileSync(path.join(FIX, "ro-invoice.txt"), "parts invoice for the repair order");

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: "dark" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
let failures = 0;
const check = (c, l) => { console.log((c ? "  ✓ " : "  ✗ ") + l); if (!c) failures++; };
const waitFor = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(150); } return false; };

// ---------- standalone: RO create + notes + persistence ----------
await page.goto(base + "ros/index.html", { waitUntil: "load" });
await page.waitForTimeout(400);
check(await page.locator("#empty-main:not([hidden])").count() === 1, "empty state shows with no repair orders");
await page.click("#new-btn");
await page.waitForTimeout(200);
check(await page.locator("#inner:not([hidden])").count() === 1, "New opens a blank repair order");
await page.fill("#ro-no", "7654321");
await page.fill("#ro-vehicle", "2021 GLC 300");
await page.fill("#notes", "Complaint: brake noise.\nCause: worn pads.\nCorrection: replaced pads + rotors.");
await page.waitForTimeout(700); // autosave
check((await page.locator(".ro-item__no").first().textContent()) === "RO 7654321", "the RO shows in the sidebar by its number");

await page.reload({ waitUntil: "load" });
await page.waitForTimeout(500);
check((await page.inputValue("#ro-no")) === "7654321", "RO number persisted across reload");
check(/brake noise/.test(await page.inputValue("#notes")), "notes persisted across reload");
check((await page.evaluate(() => window.__ros.count())) === 1, "exactly one repair order stored");

// ---------- embedded: files saved into the Vault under the RO's collection ----------
await page.goto(base + "#ros", { waitUntil: "load" });
await page.waitForTimeout(600);
check(await page.locator("#tab-ros.is-active").count() === 1, "deep link #ros activates the Repair Orders tab");
const ro = page.frameLocator("#frame-ros");
await waitFor(async () => (await ro.locator("#ro-no").count()) === 1);
// The persisted RO 7654321 should be open; attach a file to it.
await waitFor(async () => (await ro.locator("#ro-no").inputValue()) === "7654321");
await ro.locator("#file-input").setInputFiles(path.join(FIX, "ro-invoice.txt"));

// It should land in the vault under collection "RO 7654321".
const inVault = await waitFor(async () => {
  const n = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open("file-vault");
    r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (e) {} };
    r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains("files")) { db.close(); return res(0); } const g = db.transaction("files", "readonly").objectStore("files").getAll(); g.onsuccess = () => { db.close(); res(g.result.filter((x) => x.collection === "RO 7654321" && x.name === "ro-invoice.txt").length); }; g.onerror = () => { db.close(); res(0); }; };
    r.onerror = () => res(0);
  }));
  return n === 1;
}, 15000);
check(inVault, "an added file is saved in the Vault under the RO's collection");

// The RO's Files list reflects it.
const shown = await waitFor(async () => (await ro.locator("#files .file").count()) === 1, 8000);
check(shown, "the RO's Files list shows the attached file");

// ---------- renaming the RO number migrates the Vault collection ----------
await ro.locator("#ro-no").fill("7654399");
await page.waitForTimeout(900); // autosave + relayed rename
const migrated = await waitFor(async () => {
  const n = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open("file-vault");
    r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (e) {} };
    r.onsuccess = () => { const db = r.result; const g = db.transaction("files", "readonly").objectStore("files").getAll(); g.onsuccess = () => { db.close(); res(g.result.filter((x) => x.collection === "RO 7654399").length + ":" + g.result.filter((x) => x.collection === "RO 7654321").length); }; g.onerror = () => { db.close(); res("x"); }; };
    r.onerror = () => res("x");
  }));
  return n === "1:0";
}, 12000);
check(migrated, "editing the RO number moves its files to the new collection (none left behind)");

// ---------- open in Vault ----------
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
