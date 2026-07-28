// End-to-end test for the cross-app integration layer:
//   - record-level deep links (#li/…, #inventory/group/…, #vault/vin/…)
//   - cross-app jumps (LI ⇄ Tool Inventory, vault By-VIN series chips)
//   - auto VIN detection on the unified intake
//   - Ctrl+K quick-open ID router
//   - one-click "Back up everything"
//   - toast relay from background tabs
//   - the standalone builds' "Load the built-in catalog" offer
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".tidb": "application/octet-stream" };
const CATALOG = path.join(ROOT, "dist-db", "FileInventory.tidb");
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  // The standalone/USB builds ship the catalog at app/data/ — emulate that.
  if (p === "/data/FileInventory.tidb" && fs.existsSync(CATALOG)) {
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    fs.createReadStream(CATALOG).pipe(res);
    return;
  }
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

if (!fs.existsSync(CATALOG)) {
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, [path.join(ROOT, "tools", "build-inventory-db.mjs")], { stdio: "inherit" });
}

const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1320, height: 860 }, colorScheme: "dark" });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
let failures = 0;
const check = (c, l) => { console.log((c ? "  ✓ " : "  ✗ ") + l); if (!c) failures++; };
const waitFor = async (fn, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(200); } return false; };

// ---------- 1. Standalone-build catalog offer: empty inventory offers a one-click load ----------
await page.goto(base + "#inventory", { waitUntil: "networkidle" });
const inv = page.frameLocator("#frame-inventory");
await inv.locator("#empty").waitFor({ timeout: 15000 });
const offerShown = await waitFor(async () => (await inv.locator("#loadBuiltinBtn").count()) > 0, 10000);
check(offerShown, "empty inventory offers 'Load the built-in tool catalog' (bundled with the standalone app)");
await inv.locator("#loadBuiltinBtn").click();
const catalogLoaded = await waitFor(async () => (await inv.locator("#tbody tr").count()) > 1000, 30000);
check(catalogLoaded, "one click loads the full catalog (1,688 tools)");

// ---------- 2. Deep links ----------
await page.goto(base + "#inventory/group/54", { waitUntil: "networkidle" });
await page.waitForTimeout(700);
check(await page.locator("#tab-inventory.is-active").count() === 1, "#inventory/group/54 activates the Tool Inventory");
const chipTxt = ((await inv.locator("#modelChip").textContent()) || "").trim();
check(await inv.locator("#modelChip").isVisible() && /Group 54/.test(chipTxt), `group deep link shows the cross-filter chip ('${chipTxt}')`);
const grpRows = await inv.locator("#tbody tr").count();
check(grpRows > 0 && grpRows < 1688, `group 54 filter narrows the catalog (${grpRows} tools)`);
// clear the chip
await inv.locator("#modelChip").click();
await page.waitForTimeout(300);
check((await inv.locator("#tbody tr").count()) > 1000, "clicking the chip clears the cross-filter");

await page.goto(base + "#li/group/54", { waitUntil: "networkidle" });
await page.waitForTimeout(700);
const li = page.frameLocator("#frame-li");
check(await page.locator("#tab-li.is-active").count() === 1, "#li/group/54 activates LI Documents");
// dismiss LI's auto-open import prompt if it appeared
if (await li.locator("#importOverlay.show").count()) { await li.locator("#importOverlay .x[data-close]").click().catch(() => {}); }
check((await li.locator("#search").inputValue()) === "LI54.", "LI group deep link pre-fills the precise 'LI54.' search");

await page.evaluate(() => { location.hash = "#li/LI54.10-P-070001"; });
await page.waitForTimeout(700);
check((await li.locator("#search").inputValue()).toUpperCase().includes("LI54.10-P-070001"), "#li/<LI number> lands on that document (search fallback when not in library)");

// ---------- 3. Unified intake + auto VIN detection ----------
const FIX = path.join(ROOT, "tools", "_fixtures");
fs.mkdirSync(FIX, { recursive: true });
const vinName = "Datacard WDD2130461A123456.txt";
fs.writeFileSync(path.join(FIX, vinName), "Vehicle datacard for VIN WDD2130461A123456 — model 213");
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
await page.setInputFiles("#shell-file-input", path.join(FIX, vinName));
const vinDetected = await waitFor(async () => {
  // Guarded read-only peek (same pattern as the shell's badges): must NEVER
  // create the app's database before the app itself does.
  const vins = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open("file-vault");
    r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (e) {} };
    r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains("files")) { db.close(); return res([]); } const g = db.transaction("files", "readonly").objectStore("files").getAll(); g.onsuccess = () => { db.close(); res(g.result.flatMap((x) => x.vins || [])); }; g.onerror = () => { db.close(); res([]); }; };
    r.onerror = () => res([]);
    r.onblocked = () => res([]);
  }));
  return vins.includes("WDD2130461A123456");
});
check(vinDetected, "a file added through the front door is auto-read for its VIN (no OCR, no clicks)");

// ---------- 4. By-VIN series chips → cross-app jump ----------
const vault = page.frameLocator("#frame-vault");
await page.goto(base + "#vault", { waitUntil: "networkidle" });
await page.waitForTimeout(500);
await vault.locator('#nav-filters .nav__item[data-filter="vins"], [data-filter="vins"]').first().click();
await page.waitForTimeout(400);
check((await vault.locator(".group-head").count()) === 1, "By-VIN view groups the file under its vehicle");
const liChip = vault.locator(".group-head__link[data-series-li]");
check(await liChip.count() === 1 && (await liChip.textContent()).includes("213"), "vehicle header derives model series 213 from the VIN");
await vault.locator(".group-head__link[data-series-tools]").click();
await page.waitForTimeout(700);
check(await page.locator("#tab-inventory.is-active").count() === 1, "clicking '🔧 Tools 213' jumps to the Tool Inventory");
const chip2 = ((await inv.locator("#modelChip").textContent()) || "").trim();
check(/Model 213/.test(chip2), `inventory arrives pre-filtered (${chip2})`);
const toolsFor213 = await inv.locator("#tbody tr").count();
check(toolsFor213 > 0, `tools valid for model 213 listed (${toolsFor213})`);
await inv.locator("#modelChip").click();

// ---------- 5. LI ⇄ Inventory bridges from the tool detail ----------
await page.waitForTimeout(300);
await inv.locator("#tbody tr").first().click();
await page.waitForTimeout(300);
check(await inv.locator("#dLiGroup").isVisible(), "tool detail offers '🗄️ LI docs · grp NN'");
const toolNo = (await inv.locator("#dTitle").textContent()).trim();
await inv.locator("#dLiFind").click();
await page.waitForTimeout(700);
check(await page.locator("#tab-li.is-active").count() === 1, "'Find in LI docs' switches to LI Documents");
check((await li.locator("#search").inputValue()) === toolNo, "LI search box carries the tool number (full-text search)");

// ---------- 6. Ctrl+K quick-open ----------
// Close the tool detail still open from step 5, then quick-open a canonical
// tool number (the catalog's standard 3-3-2-2-2 format).
await page.click("#tab-inventory");
await page.waitForTimeout(300);
await inv.locator("#detail .x[data-close]").click();
await page.waitForTimeout(200);
await page.keyboard.press("Control+k");
await page.waitForTimeout(300);
check(await page.locator("#quickopen:not([hidden])").count() === 1, "Ctrl+K opens quick-open (even with an iframe focused)");
const knownTool = "000 589 01 10 00";
await page.fill("#qo-input", knownTool);
await page.waitForTimeout(200);
const firstRow = (await page.locator("#qo-results .qo-row").first().textContent()) || "";
check(firstRow.includes("Open tool"), `quick-open recognizes a tool number ('${firstRow.trim()}')`);
await page.keyboard.press("Enter");
await page.waitForTimeout(700);
check(await page.locator("#tab-inventory.is-active").count() === 1, "Enter jumps straight to the Tool Inventory");
check((await inv.locator("#dTitle").textContent()).trim() === knownTool, "…and opens that exact tool's detail");
await inv.locator("#detail .x[data-close]").click();

await page.keyboard.press("Control+k");
await page.fill("#qo-input", "WDD2130461A123456");
await page.waitForTimeout(200);
const vinRow = (await page.locator("#qo-results .qo-row").first().textContent()) || "";
check(vinRow.includes("Files for vehicle"), "quick-open recognizes a VIN");
await page.keyboard.press("Escape");
check(await page.locator("#quickopen[hidden]").count() === 1, "Escape closes quick-open");

// ---------- 7. One-click Back up everything ----------
const downloads = [];
page.on("download", (d) => downloads.push(d.suggestedFilename()));
await page.click("#backup-all-btn");
await waitFor(async () => downloads.length >= 2, 20000);
await page.waitForTimeout(1500);
check(downloads.some((n) => /\.fvault$/.test(n)), `backup-all produced a vault backup (${downloads.join(", ")})`);
check(downloads.some((n) => /\.tidb$/.test(n)), "backup-all produced an inventory backup");
// LI is empty, so it reports rather than downloads — that's the contract.

// ---------- 8. Toast relay from a background tab ----------
// Stay on the inventory tab; drop a MIXED batch (so the shell stays put — a
// single-target batch would switch tabs, where no relay is needed). Both the
// vault and LI ingest in BACKGROUND tabs; their toasts must surface through
// the shell with an app prefix.
await page.click("#tab-inventory");
await page.waitForTimeout(400);
fs.writeFileSync(path.join(FIX, "LI54.10-P-070001.pdf"), "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
fs.writeFileSync(path.join(FIX, "note-for-relay.txt"), "just a note");
await page.setInputFiles("#shell-file-input", [path.join(FIX, "LI54.10-P-070001.pdf"), path.join(FIX, "note-for-relay.txt")]);
const relayed = await waitFor(async () => {
  const t = (await page.locator("#toast").textContent()) || "";
  return /(Files|LI Documents):/.test(t);
}, 25000);
check(relayed, "a background app's toast surfaces through the shell relay (app-prefixed)");

// ---------- 9. Alt+2 switches apps from inside an iframe ----------
await inv.locator("#search").click().catch(() => {});
await page.keyboard.press("Alt+2");
await page.waitForTimeout(500);
check(await page.locator("#tab-li.is-active").count() === 1, "Alt+2 pressed inside an iframe switches to LI Documents");

// ---------- 10. Pinned Active Vehicle ----------
// Pin the datacard's VIN via quick-open; every data tab scopes to the car.
await page.keyboard.press("Control+k");
await page.fill("#qo-input", "WDD2130461A123456");
await page.waitForTimeout(250);
const pinRow = page.locator("#qo-results .qo-row", { hasText: "Pin WDD2130461A123456" });
check(await pinRow.count() === 1, "quick-open offers 'Pin as the active vehicle' for a VIN");
await pinRow.click();
await page.waitForTimeout(400);
check(await page.locator("#vehicle-chip:not([hidden])").count() === 1, "the vehicle chip appears in the top bar");
check((await page.locator("#vehicle-chip-main").textContent()).includes("123456"), "chip shows the VIN tail");

// Inventory (already loaded) is re-scoped to the vehicle's model series.
await page.click("#tab-inventory");
await page.waitForTimeout(500);
const pinChip = ((await inv.locator("#modelChip").textContent()) || "").trim();
check(/Model 213/.test(pinChip), `pin scoped the Tool Inventory to model 213 (${pinChip})`);

// Vault: chip click jumps to the vehicle's files (vin: filter → just its file).
await page.click("#vehicle-chip-main");
await page.waitForTimeout(500);
check(await page.locator("#tab-vault.is-active").count() === 1, "clicking the chip opens Files");
const vaultCards = await vault.locator(".card").count();
check(vaultCards === 1, `Files is filtered to the pinned vehicle (${vaultCards} card)`);

// While pinned, a front-door file with NO VIN of its own is tagged with the car.
fs.writeFileSync(path.join(FIX, "receipt-no-vin.txt"), "parts receipt, no vehicle number here");
await page.setInputFiles("#shell-file-input", path.join(FIX, "receipt-no-vin.txt"));
const taggedWithPin = await waitFor(async () => {
  const rec = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open("file-vault");
    r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (e) {} };
    r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains("files")) { db.close(); return res(null); } const g = db.transaction("files", "readonly").objectStore("files").getAll(); g.onsuccess = () => { db.close(); res(g.result.find((x) => x.name === "receipt-no-vin.txt") || null); }; g.onerror = () => { db.close(); res(null); }; };
    r.onerror = () => res(null);
  }));
  return !!(rec && rec.vins && rec.vins.includes("WDD2130461A123456"));
});
check(taggedWithPin, "a front-door file with no VIN of its own is tagged with the pinned vehicle");

// Unpin clears the chip and the scopes.
await page.click("#vehicle-chip-unpin");
await page.waitForTimeout(500);
check(await page.locator("#vehicle-chip[hidden]").count() === 1, "unpin hides the chip");
await page.click("#tab-inventory");
await page.waitForTimeout(400);
check(await inv.locator("#modelChip").isHidden(), "unpin cleared the inventory's model scope");
const pinSurvives = await page.evaluate(() => localStorage.getItem("fd-vehicle"));
check(pinSurvives === null, "unpin also clears the persisted pin");

// ---------- 11. Manual VIN scan must not wipe intake-tagged VINs ----------
// The receipt got its VIN from the pin (not from its contents) and carries no
// vinScan stamp, so the manual scan processes it, finds nothing in the text,
// and must UNION (keep the tag) rather than overwrite with the empty result.
await page.click("#tab-vault");
await page.waitForTimeout(400);
await vault.locator("#more-btn").click();
await vault.locator('[data-action="scan-vins"]').click();
await page.waitForTimeout(3000);
const tagSurvivedScan = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("file-vault");
  r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (e) {} };
  r.onsuccess = () => { const db = r.result; const g = db.transaction("files", "readonly").objectStore("files").getAll(); g.onsuccess = () => { db.close(); const rec = g.result.find((x) => x.name === "receipt-no-vin.txt"); res(!!(rec && (rec.vins || []).includes("WDD2130461A123456"))); }; g.onerror = () => { db.close(); res(false); }; };
  r.onerror = () => res(false);
}));
check(tagSurvivedScan, "manual 'Scan files for VINs' preserves the intake-tagged VIN (union, not clobber)");

// ---------- 12. PDF preview survives the post-add auto-detect render ----------
// Regression: the preview's blob URL used to sit in the per-render objectUrls
// set, so the render() fired by auto VIN detect ~seconds after an add revoked
// it while the PDF viewer was still streaming → "Failed to load PDF document."
// Repro: add a PDF through the front door, open its detail IMMEDIATELY, let
// the detect finish, then verify the iframe's URL still serves the bytes.
const VALID_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 40>>stream
BT /F1 24 Tf 50 100 Td (Hi) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`;
fs.writeFileSync(path.join(FIX, "scco WDD2130461A123456.pdf"), VALID_PDF);
await page.click("#tab-vault");
await page.waitForTimeout(300);
await page.setInputFiles("#shell-file-input", path.join(FIX, "scco WDD2130461A123456.pdf"));
await vault.locator(".card", { hasText: "scco" }).first().click({ timeout: 8000 });
await vault.locator("#d-preview iframe").waitFor({ timeout: 8000 });
// Force list re-renders while the viewer streams — auto VIN detect after an
// add, a search keystroke, a sync import all do this in real use.
await vault.locator("#search-input").fill("s");
await page.waitForTimeout(400);
await vault.locator("#search-input").fill("");
await page.waitForTimeout(4000); // also lets the auto VIN detect render land
const previewState = await page.frames().find((f) => f.url().includes("/vault/")).evaluate(async () => {
  const f = document.querySelector("#d-preview iframe");
  if (!f) return "no-iframe";
  try { const r = await fetch(f.src); const b = await r.blob(); return b.size > 100 ? "ok" : "empty"; }
  catch (e) { return "revoked"; }
});
check(previewState === "ok", `PDF preview URL still serves the document after list re-renders (${previewState})`);

await page.screenshot({ path: path.join(ROOT, "tools", "shot-integration.png") });

const realErrors = errors.filter((e) => !/favicon|manifest|the server responded|404|pdf|worker|invalid|structure|xref|tesseract|fetch/i.test(e));
console.log(realErrors.length ? "\nErrors:\n" + realErrors.join("\n") : "\nNo unexpected console errors.");
check(realErrors.length === 0, "no unexpected console/page errors");

await browser.close();
server.close();
console.log(failures === 0 ? "\nINTEGRATION CHECKS PASSED ✅" : `\n${failures} INTEGRATION CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
