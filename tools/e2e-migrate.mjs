// First-launch migration (REWRITE-PLAN.md §4.1, D2, D8): a profile with data
// in all four legacy databases opens the platform, the dialog copies it into
// one generation, verifies counts and hashes, offers a .fdb backup, and the
// legacy databases are gone afterwards. A migration whose verification is
// made to fail leaves the legacy databases and the pointer untouched.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./e2e-browser.mjs";
import { fdbAll, fdbCount, vaultCount } from "./e2e-db.mjs";

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
let failures = 0;
const check = (c, l, d) => { console.log((c ? "  ✓ " : "  ✗ ") + l + (c || d === undefined ? "" : " — " + JSON.stringify(d))); if (!c) failures++; };
const waitFor = async (page, fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(150); } return false; };

// The four legacy databases, as the pre-Phase-2 apps wrote them.
const SEED = `
  function seed(name, stores, version) {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(name, version || 1);
      r.onupgradeneeded = () => { const db = r.result; for (const s of Object.keys(stores)) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: stores[s].keyPath }); };
      r.onsuccess = () => { const db = r.result; const names = Object.keys(stores); const tx = db.transaction(names, "readwrite"); for (const s of names) for (const rec of stores[s].records) tx.objectStore(s).put(rec); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); }; };
      r.onerror = () => reject(r.error);
    });
  }
  const t = (s, type) => new Blob([s], { type });
  await seed("file-vault", {
    files: { keyPath: "id", records: [
      { id: "v1", name: "invoice.txt", type: "text/plain", kind: "text", size: 6, blob: t("INV001", "text/plain"), thumb: null, tags: ["tax"], collection: "RO 42", note: "", starred: true, createdAt: 1, updatedAt: 2, vins: ["WDD2130461A123456"], fins: [], vinScan: 5 },
      { id: "v2", name: "photo.png", type: "image/png", kind: "image", size: 4, blob: t("PNG!", "image/png"), thumb: t("th", "image/jpeg"), tags: [], collection: "", note: "n", starred: false, createdAt: 3, updatedAt: 4 },
      { id: "v3", name: "manual.pdf", type: "application/pdf", kind: "pdf", size: 8, blob: t("%PDF-1.4", "application/pdf"), thumb: null, tags: [], collection: "", note: "", starred: false, createdAt: 5, updatedAt: 6 },
    ] },
    meta: { keyPath: "key", records: [{ key: "view", value: "list" }, { key: "collections", value: ["RO 42"] }] },
  });
  await seed("LIDocsDB", {
    docs: { keyPath: "id", records: [{ id: "LI54.10-P-070001_3", li: "LI54.10-P-070001", ver: "3", title: "Brakes", fgroup: "54", filename: "LI54.pdf", size: 8, added: 9, star: true, text: "brake pads" }] },
    files: { keyPath: "id", records: [{ id: "LI54.10-P-070001_3", blob: t("%PDF-1.4", "application/pdf") }] },
    settings: { keyPath: "k", records: [{ k: "autoSyncOn", v: true }] },
  }, 2);
  await seed("tool-inventory", {
    tools: { keyPath: "id", records: [{ id: "t1", toolNo: "000 589 01 23 00", desc: "wrench", svcGrp: "54" }, { id: "t2", toolNo: "000 589 99 99 00", desc: "socket", svcGrp: "07" }] },
    photos: { keyPath: "id", records: [{ id: "t1", blob: t("PNG", "image/png") }] },
    meta: { keyPath: "k", records: [{ k: "source", v: { source: "catalog" } }] },
  }, 2);
  await seed("repair-orders", {
    ros: { keyPath: "id", records: [{ id: "r1", ro: "42", vehicle: "GLC", collection: "RO 42", lines: [{ id: "l1", text: "noise", op: "" }], createdAt: 1, updatedAt: 1 }] },
  });
  await seed("vault-bridge", { outbox: { keyPath: "id", records: [{ id: 1, target: "li", status: "pending" }] } }, 2);
`;
const dbExists = (page, name) => page.evaluate((name) => new Promise((res) => {
  let created = false;
  const r = indexedDB.open(name);
  r.onupgradeneeded = () => { created = true; try { r.transaction.abort(); } catch (e) {} };
  r.onsuccess = () => { r.result.close(); res(!created); };
  r.onerror = () => res(false);
  r.onblocked = () => res(true);
}), name);
const LEGACY = ["file-vault", "LIDocsDB", "tool-inventory", "repair-orders", "vault-bridge"];

// ---------- 1. A seeded profile migrates on first launch ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  // Seed from a blank same-origin page so no app has opened anything yet.
  await page.goto(base + "icons/", { waitUntil: "load" }).catch(() => {});
  await page.goto(base + "manifest.webmanifest", { waitUntil: "load" });
  await page.evaluate(new Function("return (async () => {" + SEED + "})()"));
  check(await dbExists(page, "file-vault") && await dbExists(page, "repair-orders"), "legacy databases seeded");

  await page.goto(base, { waitUntil: "load" });
  check(await waitFor(page, async () => (await page.locator("#fdb-migrate").count()) === 1, 10000), "the migration dialog shows on first launch");
  check(await page.evaluate(() => !document.querySelector("#view-vault").shadowRoot), "no feature is mounted while the dialog is up");
  const listed = await page.locator("#fdb-migrate li").allTextContents();
  check(listed.join("|") === "3 files|1 LI document|2 tools|1 repair order", "the dialog lists what will be migrated", listed);
  await page.click("#fdb-migrate-start");
  check(await waitFor(page, async () => (await page.locator("#fdb-migrate-export").count()) === 1, 20000), "the copy verifies and offers a backup before deleting anything");
  check(/Verified ✓/.test(await page.locator("#fdb-migrate .fdb-migrate__label").textContent()), "the label reports the verified counts");
  for (const n of ["file-vault", "LIDocsDB"]) check(await dbExists(page, n), n + " still present until Continue");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.click("#fdb-migrate-export")]);
  check(/^file-database-migrated-.*\.fdb$/.test(dl.suggestedFilename()), "the backup downloads as .fdb (" + dl.suggestedFilename() + ")");
  const saved = path.join(ROOT, "tools", "_fixtures", "migrated.fdb");
  await dl.saveAs(saved);
  const head = fs.readFileSync(saved).subarray(0, 4).toString("ascii");
  check(head === "FDBK", "the backup starts with the FDBK magic");
  await page.click("#fdb-migrate-continue");
  check(await waitFor(page, async () => (await page.locator("#fdb-migrate-done").count()) === 1, 15000), "the migration completes");
  await page.click("#fdb-migrate-done");
  check(await waitFor(page, async () => (await page.locator("#fdb-migrate").count()) === 0), "the dialog closes");
  check(await waitFor(page, async () => page.evaluate(() => !!document.querySelector("#view-vault").shadowRoot), 10000), "the shell mounts the features afterwards");

  for (const n of LEGACY) check(!(await dbExists(page, n)), n + " deleted after the verified migration");
  check(await page.evaluate(() => localStorage.getItem("fdb.generation")) === "file-database-1", "the pointer names generation 1");
  check(await vaultCount(page) === 3, "3 Files records (the LI PDF is hidden from Files)");
  check(await fdbCount(page, "files") === 4, "4 file records in all");
  check(await fdbCount(page, "blobs") === 4, "4 blobs");
  check(await fdbCount(page, "thumbs") === 1, "1 thumbnail");
  check(await fdbCount(page, "documents") === 1 && await fdbCount(page, "tools") === 2 && await fdbCount(page, "photos") === 1 && await fdbCount(page, "ros") === 1, "documents, tools, photos and repair orders copied");
  const links = await fdbAll(page, "links");
  check(links.length === 1 && links[0].fromId === "r1" && links[0].toId === "v1" && links[0].kind === "attachment", "the RO's collection became an attachment link", links);
  const settings = await fdbAll(page, "settings");
  const keyed = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  check(keyed["vault.view"] === "list" && keyed["li.autoSyncOn"] === true && keyed["inventory.source"]?.source === "catalog", "settings namespaced per app", Object.keys(keyed));
  check(keyed.migration && keyed.migration.counts.files === 4, "the migration is recorded in settings");
  const blobs = await fdbAll(page, "blobs");
  check(blobs.every((b) => typeof b.sha256 === "string" && b.sha256.length === 64), "every blob carries its sha256");

  // The apps see the data.
  const vault = page.locator("#view-vault");
  check(await waitFor(page, async () => (await vault.locator(".card, .row").count()) === 3, 10000), "the Files app lists the 3 migrated files (in the migrated list view)");
  check(await waitFor(page, async () => (await page.locator('[data-count="vault"]').textContent()) === "3"), "the Files badge shows 3");
  await page.click("#tab-li");
  const li = page.locator("#view-li");
  check(await waitFor(page, async () => (await li.locator("#rows tr").count()) === 1, 10000), "LI Documents lists the migrated document");
  await page.click("#tab-inventory");
  const inv = page.locator("#view-inventory");
  check(await waitFor(page, async () => (await inv.locator("#tbody tr").count()) === 2, 10000), "Tool Inventory lists the 2 migrated tools");
  await page.click("#tab-ros");
  const ros = page.locator("#view-ros");
  check(await waitFor(page, async () => (await ros.locator("#ro-no").inputValue()) === "42", 10000), "Repair Orders opens RO 42");
  check(await waitFor(page, async () => (await ros.locator("#files .file").count()) === 1, 10000), "RO 42 shows its attached file through the link");

  // A reload does not ask again.
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(800);
  check((await page.locator("#fdb-migrate").count()) === 0, "no dialog on the next launch");
  const realErrors = errors.filter((e) => !/favicon|manifest|the server responded|404|pdf|worker|invalid|structure|xref|tesseract|fetch/i.test(e));
  console.log(realErrors.length ? "\nErrors:\n" + realErrors.join("\n") : "\nNo unexpected console errors.");
  check(realErrors.length === 0, "no unexpected console/page errors");
  await ctx.close();
}

// ---------- 2. A failed verification changes nothing ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const page = await ctx.newPage();
  await page.goto(base + "manifest.webmanifest", { waitUntil: "load" });
  await page.evaluate(new Function("return (async () => {" + SEED + "})()"));
  await page.addInitScript(() => { window.__FDB_MIGRATION_FAIL = true; });
  await page.goto(base, { waitUntil: "load" });
  check(await waitFor(page, async () => (await page.locator("#fdb-migrate-start").count()) === 1, 10000), "the dialog shows");
  await page.click("#fdb-migrate-start");
  check(await waitFor(page, async () => (await page.locator("#fdb-migrate-retry").count()) === 1, 20000), "a failed verification is reported with a retry");
  check(/Verification failed/.test(await page.locator("#fdb-migrate .error").textContent()), "the reason is shown");
  for (const n of ["file-vault", "LIDocsDB", "tool-inventory", "repair-orders"]) check(await dbExists(page, n), n + " kept after the failed migration");
  check(await page.evaluate(() => localStorage.getItem("fdb.generation")) === null, "the pointer is untouched");
  check(!(await dbExists(page, "file-database-1")), "the half-written generation was removed");
  // Retry without the hook: it succeeds.
  await page.evaluate(() => { window.__FDB_MIGRATION_FAIL = false; });
  await page.click("#fdb-migrate-retry");
  check(await waitFor(page, async () => (await page.locator("#fdb-migrate-continue").count()) === 1, 20000), "a retry verifies");
  await page.click("#fdb-migrate-continue");
  check(await waitFor(page, async () => (await page.locator("#fdb-migrate-done").count()) === 1, 15000), "and completes");
  await page.click("#fdb-migrate-done");
  check(await waitFor(page, async () => page.evaluate(() => !!document.querySelector("#view-vault").shadowRoot), 10000), "the shell mounts");
  check(!(await dbExists(page, "file-vault")), "legacy databases deleted after the successful retry");
  await ctx.close();
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} MIGRATION CHECK(S) FAILED ❌` : "\nMIGRATION CHECKS PASSED ✅");
process.exit(failures ? 1 : 0);
