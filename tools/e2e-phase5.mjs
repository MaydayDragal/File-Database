// Phase 5 — the unified model in use, end to end on the one page:
//  - Files: delete goes to the trash; restore; delete forever; a file a
//    repair order still uses is refused
//  - exact-duplicate review on intake (reuse bytes / skip)
//  - one file on two repair orders (a skipped duplicate is attached as the
//    stored file); deleting an RO asks keep / unlink / trash; RO trash
//  - an RO pins an exact LI version and a tool; a newer import is flagged
//  - the vehicle record: check digit, technician confirmation, #vehicle/<VIN>
//  - Ctrl+K finds records in every store
//  - ONE backup download, restored into a new generation with ROs, links,
//    vehicles and the trash intact
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./e2e-browser.mjs";
import { fdbAll } from "./e2e-db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
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

const FIX = path.join(ROOT, "tools", "_fixtures", "phase5");
fs.mkdirSync(FIX, { recursive: true });
const write = (n, c) => { const p = path.join(FIX, n); fs.writeFileSync(p, c); return p; };

const VIN = "W1K2140471A068698"; // passes its check digit; model series 214

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, acceptDownloads: true, serviceWorkers: "block" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
let failures = 0;
const check = (c, l, extra) => { console.log((c ? "  ✓ " : "  ✗ ") + l + (!c && extra !== undefined ? "  → " + JSON.stringify(extra) : "")); if (!c) failures++; };
const waitFor = async (fn, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(150); } return false; };
let dialogAnswer = "accept";
page.on("dialog", (d) => { if (dialogAnswer === "dismiss") d.dismiss(); else d.accept(); });
const files = async () => fdbAll(page, "files");
const fileNamed = async (n) => (await files()).find((f) => f.name === n) || null;
const toastText = async () => (await page.locator("#shell-toast").textContent().catch(() => "")) || "";

await page.goto(base + "#vault", { waitUntil: "load" });
const vault = page.locator("#view-vault");
await vault.locator("#empty").waitFor({ timeout: 10000 });

// ---------- 1. Files: trash, restore, delete forever ----------
await page.setInputFiles("#shell-file-input", [write("keep-me.txt", "a file to keep"), write("brake-caliper-photo.txt", "brake caliper, front left")]);
check(await waitFor(async () => (await vault.locator(".card").count()) === 2), "two files added");
await vault.locator(".card", { hasText: "keep-me.txt" }).click();
await vault.locator("#detail:not([hidden])").waitFor();
await vault.locator("#d-delete").click();
check(await waitFor(async () => !!((await fileNamed("keep-me.txt")) || {}).deletedAt), "Delete moves the file to the trash (deletedAt set, record kept)");
check(await waitFor(async () => (await vault.locator(".card").count()) === 1), "the trashed file leaves the list");
check(((await vault.locator('[data-count="trash"]').textContent()) || "").trim() === "1", "the Trash entry counts it");
await vault.locator('#nav-filters [data-filter="trash"]').click();
check(await waitFor(async () => (await vault.locator(".card").count()) === 1 && /Trash/.test(await vault.locator("#view-title").textContent())), "the Trash view lists it");
await vault.locator(".card").first().click();
await vault.locator("#d-restore:not([hidden])").waitFor();
check(((await vault.locator("#d-delete").textContent()) || "").includes("forever"), "in the trash, the drawer offers Delete forever");
await vault.locator("#d-restore").click();
check(await waitFor(async () => { const f = await fileNamed("keep-me.txt"); return f && !f.deletedAt; }), "Restore takes it out of the trash");
await vault.locator('#nav-filters [data-filter="all"]').click();
check(await waitFor(async () => (await vault.locator(".card").count()) === 2), "…and it is back in All files");
// Trash it again, then delete it for good from the Trash view (bulk).
await vault.locator(".card", { hasText: "keep-me.txt" }).click();
await vault.locator("#d-delete").click();
await vault.locator('#nav-filters [data-filter="trash"]').click();
await waitFor(async () => (await vault.locator(".card").count()) === 1);
await vault.locator(".card").first().hover();
await vault.locator(".card__select").first().click();
await vault.locator("#bulk-purge").waitFor({ state: "visible" });
check(await vault.locator("#bulk-delete").isHidden(), "the Trash view's bulk bar swaps Delete for Restore / Delete forever");
await vault.locator("#bulk-purge").click();
check(await waitFor(async () => !(await fileNamed("keep-me.txt"))), "Delete forever removes the record for good");

// ---------- 2. Exact duplicates are reviewed before anything is written ----------
await vault.locator('#nav-filters [data-filter="all"]').click();
await page.setInputFiles("#shell-file-input", write("brake-copy.txt", "brake caliper, front left"));
check(await waitFor(async () => (await page.locator("#fd-dup").count()) === 1), "re-adding the same bytes opens the duplicate review");
check(/brake-caliper-photo\.txt/.test(await page.locator("#fd-dup").textContent()), "it names the stored file it matches");
await page.click("#fd-dup-apply"); // default: reuse the stored bytes
const copy = await (async () => { await waitFor(async () => !!(await fileNamed("brake-copy.txt"))); return fileNamed("brake-copy.txt"); })();
const orig = await fileNamed("brake-caliper-photo.txt");
check(!!copy && copy.blobId === orig.id, "Reuse stores a new record that shares the stored bytes (blobId)", copy);
check((await fdbAll(page, "blobs")).length === 1, "no second copy of the bytes");
await page.setInputFiles("#shell-file-input", write("brake-again.txt", "brake caliper, front left"));
await page.locator("#fd-dup").waitFor();
await page.click("#fd-dup-skip-all");
await page.waitForTimeout(800);
check(!(await fileNamed("brake-again.txt")), "Skip stores nothing");

// ---------- 3. Repair orders: one file on two ROs, delete choices, RO trash ----------
await page.click("#tab-ros");
const ro = page.locator("#view-ros");
await ro.locator("#new-btn").click();
await ro.locator("#ro-no").fill("5001");
await ro.locator("#ro-vehicle").fill("2022 C 300");
await ro.locator("#ro-vin").fill(VIN);
await ro.locator("#lines textarea").first().fill("Customer states brake squeal at low speed");
await page.waitForTimeout(800);
await ro.locator("#file-input").setInputFiles(write("ro-5001-invoice.txt", "invoice for 5001"));
check(await waitFor(async () => (await ro.locator("#files .file").count()) === 1), "RO 5001 has its file");
const ro1 = await page.evaluate(() => window.__ros.current.id);
// The VIN line: check digit verdict, then a technician's confirmation.
check(await waitFor(async () => /Check digit OK/.test((await ro.locator("#vin-status").textContent()) || "")), "the VIN line reports the check digit");
await ro.locator("#vin-confirm").click();
check(await waitFor(async () => ((await fdbAll(page, "vehicles")).find((v) => v.vin === VIN) || {}).status === "confirmed"), "✓ Confirm VIN records the confirmation on the vehicle");
check(((await fdbAll(page, "vehicles")).find((v) => v.vin === VIN) || {}).sources.includes("ro"), "saving the RO recorded the vehicle (source ro)");

await ro.locator("#new-btn").click();
await ro.locator("#ro-no").fill("5002");
await page.waitForTimeout(700);
const ro2 = await page.evaluate(() => window.__ros.current.id);
// The same invoice again, on the second RO: already stored, not on THIS RO → review; Skip attaches the stored file.
await ro.locator("#file-input").setInputFiles(write("invoice-again.txt", "invoice for 5001"));
await page.locator("#fd-dup").waitFor();
await page.click("#fd-dup-skip-all");
const shared = await fileNamed("ro-5001-invoice.txt");
const linksTo = async (fid) => (await fdbAll(page, "links")).filter((l) => l.toId === fid && l.kind === "attachment").map((l) => l.fromId).sort();
check(await waitFor(async () => JSON.stringify(await linksTo(shared.id)) === JSON.stringify([ro1, ro2].sort())), "one file sits on two repair orders (a skipped duplicate is attached as the stored file)");
check(!(await fileNamed("invoice-again.txt")), "…without a second record");
// Adding the same bytes to an RO that already has them asks nothing.
await ro.locator("#file-input").setInputFiles(write("invoice-third.txt", "invoice for 5001"));
await page.waitForTimeout(1200);
check((await page.locator("#fd-dup").count()) === 0 && !(await fileNamed("invoice-third.txt")), "bytes already on this RO are skipped without a prompt");

// Delete RO 5002 → the dialog → Unlink.
await ro.locator("#delete-btn").click();
await ro.locator("#del-modal.show").waitFor();
check(/1 file/.test(await ro.locator("#del-note").textContent()), "the delete dialog says how many files are attached");
await ro.locator('input[name="del-files"][value="unlink"]').check();
await ro.locator("#del-ok").click();
check(await waitFor(async () => !!((await fdbAll(page, "ros")).find((r) => r.id === ro2) || {}).deletedAt), "Delete moves the RO to the trash");
check(await waitFor(async () => JSON.stringify(await linksTo(shared.id)) === JSON.stringify([ro1])), "Unlink drops only that RO's attachment; the other RO keeps the file");
check(!((await fileNamed("ro-5001-invoice.txt")) || {}).deletedAt, "the file itself stays in Files");
await ro.locator("#trash-toggle").click();
check(await waitFor(async () => (await ro.locator("#list .ro-item.trashed").count()) === 1), "the RO trash lists it");
await ro.locator(`[data-restore="${ro2}"]`).click();
check(await waitFor(async () => !((await fdbAll(page, "ros")).find((r) => r.id === ro2) || {}).deletedAt), "Restore brings the RO back");

// Purge is refused while a repair order uses the file.
await page.click("#tab-vault");
await vault.locator(".card", { hasText: "ro-5001-invoice.txt" }).click();
await vault.locator("#d-delete").click();
await vault.locator('#nav-filters [data-filter="trash"]').click();
await waitFor(async () => (await vault.locator(".card").count()) === 1);
await vault.locator(".card").first().click();
await vault.locator("#d-delete").click(); // Delete forever
check(await waitFor(async () => /still used by a repair order/.test(await vault.locator("#toast").textContent().catch(() => "") || "")), "Delete forever is refused for a file a repair order still uses");
check(!!(await fileNamed("ro-5001-invoice.txt")), "…and the file stays (in the trash)");
await vault.locator(".card").first().click();
await vault.locator("#d-restore").click();
await vault.locator('#nav-filters [data-filter="all"]').click();

// ---------- 4. Pinned LI version and tool; a newer import is flagged ----------
await page.evaluate(async () => {
  const R = window.FDData.repos;
  await R.documents.put({ id: "LI42.10-P-000777_1", li: "LI42.10-P-000777", ver: "1", title: "Brake fluid bleeding", validity: "Model 214" });
  await R.tools.put({ id: "tp1", toolNo: "000 589 01 23 00", desc: "Brake piston reset tool", validities: ["213, 214"] });
});
await page.click("#tab-ros");
await ro.locator(".ro-item", { hasText: "RO 5001" }).click();
await ro.locator("#ref-input").fill("LI42.10-P-000777");
await ro.locator("#ref-add").click();
check(await waitFor(async () => (await ro.locator('#refs .ref[data-kind="document"]').count()) === 1), "an LI number pins that document's current version");
await ro.locator("#ref-input").fill("000 589 01 23 00");
await ro.locator("#ref-input").press("Enter");
check(await waitFor(async () => (await ro.locator('#refs .ref[data-kind="tool"]').count()) === 1), "a tool number pins the tool");
check(/v1/.test(await ro.locator('#refs .ref[data-kind="document"]').textContent()), "the pin shows the version used (v1)");
await page.evaluate(async () => { await window.FDData.repos.documents.put({ id: "LI42.10-P-000777_2", li: "LI42.10-P-000777", ver: "2", title: "Brake fluid bleeding", validity: "Model 214" }); });
check(await waitFor(async () => /newer version exists \(v2\)/.test((await ro.locator("#refs").textContent()) || "")), "a later import of v2 shows 'newer version exists (v2)'");
check(/v1/.test(await ro.locator('#refs .ref[data-kind="document"] .ref__main').textContent()), "…while the RO keeps the v1 it used");

// ---------- 5. The vehicle view ----------
await ro.locator("#vin-open").click();
await page.locator("#vehicle-view:not([hidden])").waitFor();
check(/#vehicle\/W1K2140471A068698$/.test(page.url()), "the vehicle view has its own route (#vehicle/<VIN>)");
const vv = page.locator("#vehicle-view");
check(/Confirmed by a technician/.test(await vv.textContent()), "it shows the technician's confirmation");
check(/Check digit OK/.test(await vv.textContent()), "…and the check-digit verdict");
const secCount = async (title) => ((await vv.locator(".vv-sec", { hasText: title }).locator(".vv-count").textContent()) || "").trim();
check((await secCount("Repair orders")) === "1", "one repair order for the car", await secCount("Repair orders"));
check((await secCount("LI documents")) === "2", "LI documents for model 214 are counted", await secCount("LI documents"));
check((await secCount("Special tools")) === "1", "special tools for model 214 are counted", await secCount("Special tools"));
check((await secCount("Files")) === "1", "its files are counted (the RO stamped its VIN on the invoice)", await secCount("Files"));
await page.keyboard.press("Escape");
check(await waitFor(async () => (await page.locator("#vehicle-view[hidden]").count()) === 1), "Escape closes it");
// Deep link straight to it.
await page.goto(base + "#vehicle/" + VIN, { waitUntil: "load" });
check(await waitFor(async () => (await page.locator("#vehicle-view:not([hidden])").count()) === 1), "#vehicle/<VIN> opens the vehicle view on load");
await page.locator("#vehicle-view .vv-close").click();

// ---------- 6. Quick-open finds records in every store ----------
await page.keyboard.press("Control+k");
await page.fill("#qo-input", "brake");
check(await waitFor(async () => (await page.locator("#qo-found .qo-group").count()) >= 4), "Ctrl+K lists matches from several stores");
const groups = await page.locator("#qo-found .qo-group").allTextContents();
check(["Files", "LI Documents", "Tool Inventory", "Repair Orders"].every((g) => groups.includes(g)), "…Files, LI Documents, Tool Inventory and Repair Orders", groups);
await page.locator("#qo-found .qo-row", { hasText: "RO 5001" }).click();
check(await waitFor(async () => (await page.locator("#tab-ros.is-active").count()) === 1 && (await page.evaluate(() => window.__ros.current && window.__ros.current.ro)) === "5001"), "choosing the RO result opens that repair order");

// ---------- 7. One backup, one restore ----------
const dl = [];
page.on("download", (d) => dl.push(d));
await page.click("#backup-all-btn");
await waitFor(async () => dl.length >= 1, 20000);
await page.waitForTimeout(2500);
check(dl.length === 1 && /\.fdb$/.test(dl[0].suggestedFilename()), "Back up everything is ONE .fdb download", dl.map((d) => d.suggestedFilename()));
const fdbPath = path.join(FIX, "everything.fdb");
await dl[0].saveAs(fdbPath);
const snapshot = async () => ({
  ros: (await fdbAll(page, "ros")).length, links: (await fdbAll(page, "links")).length, vehicles: (await fdbAll(page, "vehicles")).length,
  files: (await fdbAll(page, "files")).length, trashRos: (await fdbAll(page, "ros")).filter((r) => r.deletedAt).length,
});
const beforeRestore = await snapshot();
// Change things after the backup: a new file, and RO 5002 to the trash.
await page.setInputFiles("#shell-file-input", write("after-backup.txt", "made after the backup"));
await waitFor(async () => !!(await fileNamed("after-backup.txt")));
const genBefore = await page.evaluate(() => localStorage.getItem("fdb.generation"));
dialogAnswer = "accept";
await page.setInputFiles("#shell-file-input", fdbPath);
await page.waitForEvent("load", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1500);
const genAfter = await page.evaluate(() => localStorage.getItem("fdb.generation"));
check(genAfter && genAfter !== genBefore, "restore activates a NEW database generation", [genBefore, genAfter]);
const afterRestore = await snapshot();
check(JSON.stringify(afterRestore) === JSON.stringify(beforeRestore), "repair orders, links, vehicles and files are exactly as backed up", { beforeRestore, afterRestore });
check(!(await fileNamed("after-backup.txt")), "a file made after the backup is gone");
const pins = (await fdbAll(page, "links")).filter((l) => l.kind === "reference" || l.kind === "required-tool").length;
check(pins === 2, "the RO's pinned LI version and tool survived the restore", pins);
check(((await fdbAll(page, "vehicles")).find((v) => v.vin === VIN) || {}).status === "confirmed", "the vehicle's confirmation survived the restore");

const real = errors.filter((e) => !/favicon|404|Failed to load resource|tesseract|cdn/i.test(e));
console.log(real.length ? "\nErrors:\n" + real.join("\n") : "\nNo page errors.");
check(real.length === 0, "no page errors");

await browser.close();
server.close();
console.log(failures === 0 ? "\nPHASE-5 CHECKS PASSED ✅" : `\n${failures} PHASE-5 CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
