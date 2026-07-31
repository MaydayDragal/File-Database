// End-to-end test for the vault's multi-select + bulk actions:
// selection mechanics (checkbox, range, select-all, Esc), bulk collection /
// tags / VIN / star / delete, and bulk send-to-Toolbox arriving as ONE
// multi-file batch in the target tool.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser, launchPersistent } from "./e2e-browser.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png" };
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
const names = ["bulk-a.txt", "bulk-b.txt", "bulk-c.txt", "bulk-d.txt"];
names.forEach((n, i) => fs.writeFileSync(path.join(FIX, n), "bulk test file " + i));

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1320, height: 860 }, colorScheme: "dark" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
let failures = 0;
const check = (c, l) => { console.log((c ? "  ✓ " : "  ✗ ") + l); if (!c) failures++; };
const waitFor = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(150); } return false; };

// dialogs: prompt()/confirm() answered per queued script
let dialogAnswers = [];
page.on("dialog", (d) => {
  const a = dialogAnswers.shift();
  if (d.type() === "prompt") d.accept(a != null ? a : "");
  else d.accept();
});

// Standalone vault (selection is app-level, shell not required)
await page.goto(base + "vault/index.html", { waitUntil: "networkidle" });
await page.waitForTimeout(500);
await page.setInputFiles("#file-input", names.map((n) => path.join(FIX, n)));
await waitFor(async () => (await page.locator(".card").count()) === 4);
check((await page.locator(".card").count()) === 4, "four files added");

// ---------- selection mechanics ----------
await page.locator(".card").nth(0).hover();
await page.locator(".card__select").nth(0).click();
check(await waitFor(async () => (await page.locator("#bulkbar:not([hidden])").count()) === 1), "selecting a file shows the bulk bar");
check((await page.locator("#bulk-count").textContent()) === "1 selected", "count reads 1 selected");
// Shift+click range on the checkbox of the 3rd card selects 1..3
await page.locator(".card__select").nth(2).click({ modifiers: ["Shift"] });
check(await waitFor(async () => (await page.locator("#bulk-count").textContent()) === "3 selected"), "Shift+click selects the range (3 selected)");
// With a selection active, a plain card click toggles instead of opening detail
await page.locator(".card").nth(3).click();
check((await page.locator("#bulk-count").textContent()) === "4 selected", "plain click extends the selection while active");
check(await page.locator("#detail").isHidden(), "detail drawer stayed closed during selection");
// Esc clears
await page.keyboard.press("Escape");
check(await waitFor(async () => (await page.locator("#bulkbar[hidden]").count()) === 1), "Esc clears the selection");
// Ctrl+A selects all visible
await page.keyboard.press("Control+a");
check(await waitFor(async () => (await page.locator("#bulk-count").textContent()) === "4 selected"), "Ctrl+A selects all visible");

// ---------- bulk collection ----------
dialogAnswers = ["Bulk Jobs"];
await page.click("#bulk-collection");
await page.waitForTimeout(500);
const colls = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("file-vault");
  r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (e) {} };
  r.onsuccess = () => { const db = r.result; const g = db.transaction("files", "readonly").objectStore("files").getAll(); g.onsuccess = () => { db.close(); res(g.result.map((x) => x.collection)); }; g.onerror = () => { db.close(); res([]); }; };
  r.onerror = () => res([]);
}));
check(colls.length === 4 && colls.every((c) => c === "Bulk Jobs"), "bulk collection applied to all 4 files");

// ---------- bulk VIN ----------
await page.keyboard.press("Control+a");
dialogAnswers = ["W1K2140471A068698"];
await page.click("#bulk-vin");
await page.waitForTimeout(500);
const vinned = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("file-vault");
  r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (e) {} };
  r.onsuccess = () => { const db = r.result; const g = db.transaction("files", "readonly").objectStore("files").getAll(); g.onsuccess = () => { db.close(); res(g.result.filter((x) => (x.vins || []).includes("W1K2140471A068698")).length); }; g.onerror = () => { db.close(); res(0); }; };
  r.onerror = () => res(0);
}));
check(vinned === 4, `bulk VIN tagged all files (${vinned}/4) — they join the By VIN group`);

// ---------- bulk tags + star ----------
await page.keyboard.press("Control+a");
dialogAnswers = ["audit, q3"];
await page.click("#bulk-tags");
await page.waitForTimeout(400);
await page.keyboard.press("Control+a");
await page.click("#bulk-star");
await page.waitForTimeout(400);
const meta = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("file-vault");
  r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (e) {} };
  r.onsuccess = () => { const db = r.result; const g = db.transaction("files", "readonly").objectStore("files").getAll(); g.onsuccess = () => { db.close(); res({ tagged: g.result.filter((x) => (x.tags || []).includes("audit") && (x.tags || []).includes("q3")).length, starred: g.result.filter((x) => x.starred).length }); }; g.onerror = () => { db.close(); res({}); }; };
  r.onerror = () => res({});
}));
check(meta.tagged === 4, "bulk tags applied");
check(meta.starred === 4, "bulk star applied");
check(await waitFor(async () => (await page.locator("#bulk-star").textContent()) === "☆ Unstar"), "star button flips to Unstar when all selected are starred");

// ---------- bulk download into a picked folder (verified writes) ----------
await page.keyboard.press("Control+a");
await page.evaluate(() => {
  window.__saved = {};
  window.showDirectoryPicker = async () => ({
    getFileHandle: async (name) => ({
      createWritable: async () => {
        const parts = [];
        return { write: async (b) => { parts.push(b); }, close: async () => { window.__saved[name] = new Blob(parts); } };
      },
      getFile: async () => window.__saved[name] || new Blob([]),
    }),
  });
});
await page.click("#bulk-download");
const saved = await waitFor(async () => {
  const s = await page.evaluate(async () => {
    const out = {};
    for (const [n, b] of Object.entries(window.__saved || {})) out[n] = await b.text();
    return out;
  });
  return Object.keys(s).length === 4 ? s : false;
}, 10000) && await page.evaluate(async () => {
  const out = {};
  for (const [n, b] of Object.entries(window.__saved || {})) out[n] = await b.text();
  return out;
});
check(saved && Object.keys(saved).length === 4, "bulk download wrote all 4 selected files to the folder");
check(saved && names.every((n, i) => saved[n] === "bulk test file " + i), "every downloaded file's bytes match the stored file");

// ---------- bulk delete (subset) ----------
await page.keyboard.press("Escape");
await page.locator(".card").nth(0).hover();
await page.locator(".card__select").nth(0).click();
await page.locator(".card__select").nth(1).click();
dialogAnswers = []; // confirm() auto-accepted
await page.click("#bulk-delete");
check(await waitFor(async () => (await page.locator(".card").count()) === 2), "bulk delete removed the 2 selected files");

// ---------- bulk send to Toolbox arrives as ONE multi-file batch ----------
await page.goto(base + "#vault", { waitUntil: "networkidle" });
const vault = page.frameLocator("#frame-vault");
await waitFor(async () => (await vault.locator(".card").count()) === 2);
// select both remaining files (txt → no toolbox tool; add two images instead)
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
fs.writeFileSync(path.join(FIX, "bulk-1.png"), png);
fs.writeFileSync(path.join(FIX, "bulk-2.png"), png);
await page.setInputFiles("#shell-file-input", [path.join(FIX, "bulk-1.png"), path.join(FIX, "bulk-2.png")]);
await waitFor(async () => (await vault.locator(".card").count()) === 4);
// select the two PNGs via their checkboxes (they render newest-first)
const pngIdx = [];
const cardNames = await vault.locator(".card .card__name").allTextContents();
cardNames.forEach((n, i) => { if (n.endsWith(".png")) pngIdx.push(i); });
check(pngIdx.length === 2, `found the two images (${cardNames.join(", ")})`);
await vault.locator(".card").nth(pngIdx[0]).hover();
await vault.locator(".card__select").nth(pngIdx[0]).click();
await vault.locator(".card__select").nth(pngIdx[1]).click();
await vault.locator("#bulk-send-toolbox").click();
await page.waitForTimeout(1500);
check(await page.locator("#tab-toolbox.is-active").count() === 1, "bulk send switches to the Toolbox");
const toolboxFrame = page.frames().find((f) => f.url().includes("/toolbox/"));
// The media tool must actually CONSUME both: first file loaded, second queued.
const loaded = await waitFor(async () => {
  const s = await toolboxFrame.evaluate(() => ({
    name: document.getElementById("m-fileName").textContent,
    queueShown: document.getElementById("m-queueBar").classList.contains("show"),
    queueInfo: document.getElementById("m-queueInfo").textContent,
  }));
  return /bulk-[12]\.png/.test(s.name) && s.queueShown && /1 more file waiting/.test(s.queueInfo);
}, 10000);
check(loaded, "media tool loaded the first picture and queued the second");
const firstName = await toolboxFrame.evaluate(() => document.getElementById("m-fileName").textContent);
await toolboxFrame.evaluate(() => document.getElementById("m-queueNext").click());
const advanced = await waitFor(async () => {
  const s = await toolboxFrame.evaluate(() => ({
    name: document.getElementById("m-fileName").textContent,
    queueShown: document.getElementById("m-queueBar").classList.contains("show"),
  }));
  return s.name !== firstName && /bulk-[12]\.png/.test(s.name) && !s.queueShown;
}, 5000);
check(advanced, "Next ▸ advances to the second picture and the queue empties");

console.log(errors.length ? "\nErrors:\n" + errors.join("\n") : "\nNo page errors.");
check(errors.length === 0, "no page errors");

await browser.close();
server.close();
console.log(failures === 0 ? "\nBULK CHECKS PASSED ✅" : `\n${failures} BULK CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
