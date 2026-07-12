// End-to-end smoke test for File Vault using the pre-installed Chromium.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".svg": "image/svg+xml",
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end("nf"); return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `http://localhost:${port}/`;
console.log("serving", base);

const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

let failures = 0;
const check = (cond, label) => { console.log((cond ? "  ✓ " : "  ✗ ") + label); if (!cond) failures++; };

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// Empty state
check(await page.locator("#empty").isVisible(), "empty state shows on first load");

// --- Add files via the hidden input ---
const tmp = path.join(ROOT, "tools", "_fixtures");
fs.mkdirSync(tmp, { recursive: true });
// a tiny valid PNG (1x1)
const png = Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001080600000" +
  "01f15c4890000000d49444154789c6360000002000154a24f5f0000000049454e44ae426082", "hex");
fs.writeFileSync(path.join(tmp, "photo.png"), png);
fs.writeFileSync(path.join(tmp, "notes.txt"), "Quarterly report draft.\nRevenue up 12%.\nFollow up with finance.");
fs.writeFileSync(path.join(tmp, "contract.pdf"), "%PDF-1.4\n% test pdf\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

await page.setInputFiles("#file-input", [
  path.join(tmp, "photo.png"),
  path.join(tmp, "notes.txt"),
  path.join(tmp, "contract.pdf"),
]);
await page.waitForTimeout(700);

const cardCount = await page.locator(".card").count();
check(cardCount === 3, `3 cards rendered (got ${cardCount})`);
check((await page.locator("[data-count='all']").textContent()).trim() === "3", "sidebar 'all' count = 3");
check(await page.locator("#nav-types").getByText("Images").isVisible(), "Images type appears in sidebar");
check(await page.locator("#nav-types").getByText("PDFs").isVisible(), "PDFs type appears in sidebar");
check(await page.locator("#nav-types").getByText("Text & code").isVisible(), "Text type appears in sidebar");

// --- Search (matches name / tags / notes / collection) ---
await page.fill("#search-input", "photo");
await page.waitForTimeout(300);
check((await page.locator(".card").count()) === 1, "search 'photo' -> 1 card (matches filename)");
await page.fill("#search-input", "notes");
await page.waitForTimeout(300);
check((await page.locator(".card").count()) === 1, "search 'notes' -> 1 card");
await page.fill("#search-input", "zzznotfound");
await page.waitForTimeout(300);
check((await page.locator(".card").count()) === 0, "search with no match -> 0 cards, empty state");
check(await page.locator("#empty").isVisible(), "empty 'No matches' state shows");
await page.fill("#search-input", "");
await page.waitForTimeout(250);

// --- Filter by type ---
await page.locator("#nav-types").getByText("PDFs").click();
await page.waitForTimeout(200);
check((await page.locator(".card").count()) === 1, "PDF filter -> 1 card");
check((await page.locator("#view-title").textContent()).includes("PDF"), "title shows PDFs");
await page.locator("[data-filter='all']").click();
await page.waitForTimeout(150);

// --- Open detail, edit tags + collection, save ---
await page.locator(".card").filter({ hasText: "notes.txt" }).click();
await page.waitForTimeout(300);
check(await page.locator("#detail").isVisible(), "detail drawer opens");
check(await page.locator("#d-preview pre").isVisible(), "text file previews inline");
await page.fill("#d-tags", "report, finance, 2026");
await page.fill("#d-collection", "Work");
await page.fill("#d-note", "important");
await page.click("#d-save");
await page.waitForTimeout(300);
check((await page.locator("#nav-collections").getByText("Work").count()) > 0, "collection 'Work' now in sidebar");
check((await page.locator("#tag-cloud").getByText("finance").count()) > 0, "tag 'finance' now in tag cloud");

// --- Tag filter ---
await page.locator("#tag-cloud").getByText("finance").click();
await page.waitForTimeout(200);
check((await page.locator(".card").count()) === 1, "tag filter -> 1 card");
await page.locator("#active-filters .chip button").click();
await page.waitForTimeout(150);

// --- Star ---
await page.locator(".card").first().hover();
await page.locator(".card__star").first().click();
await page.waitForTimeout(200);
check((await page.locator("[data-count='starred']").textContent()).trim() === "1", "starred count = 1");

// --- List view toggle (LI-style table) ---
await page.click("#view-list");
await page.waitForTimeout(200);
check((await page.locator("#results").getAttribute("class")).includes("list"), "list view active");
check(await page.locator("#list-head").isVisible(), "list view shows a table column header");
check((await page.locator(".row").count()) > 0, "list view renders table rows");
await page.click("#view-grid");
await page.waitForTimeout(150);
check(!(await page.locator("#list-head").isVisible()), "table header hidden in grid view");

// --- Export produces a downloadable backup ---
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.click("#more-btn").then(() => page.click("[data-action='export']")),
]);
const dlPath = path.join(tmp, "backup.fvault");
await download.saveAs(dlPath);
const backup = JSON.parse(fs.readFileSync(dlPath, "utf8"));
check(backup.format === "file-vault" && backup.files.length === 3, "export backup has 3 files");
check(backup.files.some((f) => f.tags && f.tags.includes("finance")), "export preserves tags");

// --- Reload persists data (IndexedDB) ---
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(500);
check((await page.locator(".card").count()) === 3, "data persists after reload");

// --- Service worker registered ---
const swReady = await page.evaluate(async () => {
  if (!("serviceWorker" in navigator)) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!reg;
});
check(swReady, "service worker registered (offline-capable)");

// --- Delete flow (accept confirm) ---
page.on("dialog", (d) => d.accept());
await page.locator(".card").filter({ hasText: "contract.pdf" }).click();
await page.waitForTimeout(200);
await page.click("#d-delete");
await page.waitForTimeout(300);
check((await page.locator(".card").count()) === 2, "delete removes a card -> 2 left");

// --- Theme toggle (system -> light -> dark) ---
check(await page.evaluate(() => !document.documentElement.hasAttribute("data-theme")), "starts on system theme (no data-theme attr)");
await page.click("#theme-btn"); // system -> light
await page.waitForTimeout(120);
check(await page.evaluate(() => document.documentElement.getAttribute("data-theme")) === "light", "toggle -> light");
await page.click("#theme-btn"); // light -> dark
await page.waitForTimeout(120);
check(await page.evaluate(() => document.documentElement.getAttribute("data-theme")) === "dark", "toggle -> dark");
const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
check(darkBg === "rgb(15, 20, 32)", `dark theme actually applies dark bg (got ${darkBg})`);
check(await page.evaluate(() => localStorage.getItem("fv-theme")) === "dark", "dark choice persisted to localStorage");
// Persists across reload with no flash (head script reads localStorage synchronously)
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(300);
check(await page.evaluate(() => document.documentElement.getAttribute("data-theme")) === "dark", "dark theme persists after reload");

await page.screenshot({ path: path.join(ROOT, "tools", "screenshot-dark.png") });

// --- Install button actually invokes the install prompt ---
const installResult = await page.evaluate(async () => {
  // Simulate Chrome's install criteria being met.
  let promptCalled = false;
  const evt = new Event("beforeinstallprompt");
  evt.prompt = () => { promptCalled = true; };
  evt.userChoice = Promise.resolve({ outcome: "accepted" });
  window.dispatchEvent(evt);
  const btn = document.getElementById("install-btn");
  const wasVisible = !btn.hidden;
  btn.click();
  await new Promise((r) => setTimeout(r, 50));
  return { wasVisible, promptCalled };
});
check(installResult.wasVisible, "install button shown after beforeinstallprompt");
check(installResult.promptCalled, "clicking install invokes the native prompt");

console.log(errors.length ? "\nConsole errors:\n" + errors.join("\n") : "\nNo console errors.");
check(errors.length === 0, "no console/page errors");

await browser.close();
server.close();
console.log(failures === 0 ? "\nALL CHECKS PASSED ✅" : `\n${failures} CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
