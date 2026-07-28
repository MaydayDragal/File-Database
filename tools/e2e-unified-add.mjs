// End-to-end test for the platform's unified "Add files" front door.
// One control in the shell top bar takes a mixed batch and files each item
// automatically: PDFs whose name carries a Mercedes LI document number go to
// the LI Database, everything else to the File Vault — silently, no prompt.
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

const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1320, height: 860 }, colorScheme: "dark" });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
let failures = 0;
const check = (c, l) => { console.log((c ? "  ✓ " : "  ✗ ") + l); if (!c) failures++; };

// Read a sibling app's IndexedDB count from the shell page (same origin).
const dbCount = (dbName, store) => page.evaluate(({ dbName, store }) => new Promise((resolve) => {
  const r = indexedDB.open(dbName);
  r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains(store)) return resolve(0); const c = db.transaction(store, "readonly").objectStore(store).count(); c.onsuccess = () => resolve(c.result); c.onerror = () => resolve(-1); };
  r.onerror = () => resolve(-1);
}), { dbName, store });
const vaultCollections = () => page.evaluate(() => new Promise((resolve) => {
  const r = indexedDB.open("file-vault");
  r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains("files")) return resolve([]); const g = db.transaction("files", "readonly").objectStore("files").getAll(); g.onsuccess = () => resolve(g.result.map((x) => ({ name: x.name, collection: x.collection }))); g.onerror = () => resolve([]); };
  r.onerror = () => resolve([]);
}));
const waitFor = async (fn, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(200); } return false; };

// ---------- fixtures: a mixed batch ----------
const FIX = path.join(ROOT, "tools", "_fixtures");
fs.mkdirSync(FIX, { recursive: true });
const fakePdf = "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF";
fs.writeFileSync(path.join(FIX, "meeting-notes.txt"), "just a plain note, belongs in the Vault");
fs.writeFileSync(path.join(FIX, "quarterly-report.pdf"), fakePdf);           // generic PDF → Vault
fs.writeFileSync(path.join(FIX, "LI54.10-P-070001.pdf"), fakePdf);           // LI doc number → LI
fs.writeFileSync(path.join(FIX, "GF26.10-P-054321-02.pdf"), fakePdf);        // LI doc number → LI
const batch = ["meeting-notes.txt", "quarterly-report.pdf", "LI54.10-P-070001.pdf", "GF26.10-P-054321-02.pdf"].map((n) => path.join(FIX, n));

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// ---------- the single front door lives in the shell top bar ----------
check(await page.locator("#add-btn").isVisible(), "shell top bar has one global 'Add files' button");
check((await page.locator("#shell-file-input").count()) === 1, "shell owns a single hidden file input");
check((await page.locator("#shell-drop").count()) === 1, "shell has a full-window drop zone");
// The default (Files) app no longer shows its own redundant Add button.
const vault = page.frameLocator("#frame-vault");
await vault.locator("#empty").waitFor({ timeout: 8000 });
check(await vault.locator("#add-btn").isHidden(), "embedded Vault hides its own 'Add files' button (shell owns it)");

// ---------- add a mixed batch through the one uploader ----------
await page.setInputFiles("#shell-file-input", batch);

// Generic files (note + generic PDF) route to the Vault; the two LI-numbered
// PDFs route to the LI Database — all from a single drop, no prompt.
const vaultOk = await waitFor(async () => (await dbCount("file-vault", "files")) >= 2);
const liOk = await waitFor(async () => (await dbCount("LIDocsDB", "docs")) >= 2);
const vaultN = await dbCount("file-vault", "files");
const liN = await dbCount("LIDocsDB", "docs");
check(vaultOk && vaultN === 2, `generic files routed to the Vault (${vaultN} of 2)`);
check(liOk && liN === 2, `LI-numbered PDFs routed to the LI Database (${liN} of 2)`);

// The generic files must NOT be dumped into the "LI Documents" collection
// (regression: the shell hands them over as generic, not LI, files).
const cols = await vaultCollections();
check(cols.length === 2, `Vault holds exactly the 2 generic files (${cols.map((c) => c.name).join(", ")})`);
check(cols.every((c) => c.collection !== "LI Documents"), "generic files are NOT forced into the 'LI Documents' collection");
check(cols.some((c) => c.name === "meeting-notes.txt") && cols.some((c) => c.name === "quarterly-report.pdf"), "the right two files landed in the Vault");

// ---------- a single-target batch surfaces that app ----------
await page.click("#tab-inventory");            // move away first
await page.waitForTimeout(300);
fs.writeFileSync(path.join(FIX, "LI99.99-P-000111.pdf"), fakePdf);
await page.setInputFiles("#shell-file-input", [path.join(FIX, "LI99.99-P-000111.pdf")]);
const switched = await waitFor(async () => (await page.locator("#tab-li.is-active").count()) === 1, 6000);
check(switched, "an all-LI batch surfaces the LI Documents tab");
check(await waitFor(async () => (await dbCount("LIDocsDB", "docs")) >= 3), "the extra LI PDF was stored (3 total)");

// ---------- the LI app's own import button is gone when embedded ----------
const li = page.frameLocator("#frame-li");
await li.locator("header.topbar").waitFor({ timeout: 8000 });
check(await li.locator("#importBtn").isHidden(), "embedded LI hides its own 'Import PDFs' button");

await page.screenshot({ path: path.join(ROOT, "tools", "shot-unified-add.png") });

// pdf.js chokes on the tiny fake PDFs — that noise is expected and irrelevant here.
const realErrors = errors.filter((e) => !/favicon|manifest|the server responded|404|pdf|worker|invalid|structure|xref|tesseract|fetch/i.test(e));
console.log(realErrors.length ? "\nErrors:\n" + realErrors.join("\n") : "\nNo unexpected console errors.");
check(realErrors.length === 0, "no unexpected console/page errors");

await browser.close();
server.close();
console.log(failures === 0 ? "\nUNIFIED-ADD CHECKS PASSED ✅" : `\n${failures} UNIFIED-ADD CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
