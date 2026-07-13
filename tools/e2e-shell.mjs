// End-to-end test for the File Database platform shell (root index.html):
// tabs, lazy iframes, embedded chrome, unified theme, deep links, legacy
// URLs/messages, tab badges and the Toolbox → File Vault save flow.
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
  if (p.endsWith("/")) p += "index.html";           // directory index (/, /vault/, /li/, …)
  let file = path.join(ROOT, p);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end("nf"); return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;
console.log("serving", base);

const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 850 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

let failures = 0;
const check = (cond, label) => { console.log((cond ? "  ✓ " : "  ✗ ") + label); if (!cond) failures++; };
const frameFor = (part) => page.frames().find((f) => f.url().includes(part));
const frameSrc = (sel) => page.evaluate((s) => document.querySelector(s).getAttribute("src"), sel);
const frameTheme = (sel) => page.evaluate((s) => {
  const doc = document.querySelector(s).contentDocument;
  return doc ? doc.documentElement.getAttribute("data-theme") : "no-doc";
}, sel);

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// --- Default app + lazy iframes ---
check((await page.title()) === "Files · File Database", `title is "${await page.title()}"`);
check(await page.locator("#tab-vault.is-active").count() === 1, "Files tab active by default");
check((await page.locator("#tab-vault").getAttribute("aria-selected")) === "true", "Files tab aria-selected");
check(await page.locator("#view-vault:not([hidden])").count() === 1, "vault panel visible");
const panelsVisible = async () => page.evaluate(() =>
  Array.from(document.querySelectorAll(".app-panel")).filter((el) => !el.hidden).map((el) => el.id));
let vis = await panelsVisible();
check(vis.length === 1 && vis[0] === "view-vault", `exactly one panel visible (${vis.join(", ")})`);
check(!!(await frameSrc("#frame-vault")), "vault iframe loads eagerly (default app)");
check(!(await frameSrc("#frame-li")), "LI iframe not loaded yet (lazy)");
check(!(await frameSrc("#frame-inventory")), "inventory iframe not loaded yet (lazy)");
check(!(await frameSrc("#frame-toolbox")), "toolbox iframe not loaded until first activation (lazy)");

// --- Vault boots embedded: shell chrome wins, app chrome hidden ---
const vault = page.frameLocator("#frame-vault");
await vault.locator("#empty").waitFor({ timeout: 8000 });
check(await vault.locator(".topbar .brand").isHidden(), "vault brand hidden when embedded");
check(await vault.locator("#theme-btn").isHidden(), "vault theme button hidden when embedded");

// --- LI tab ---
await page.click("#tab-li");
await page.waitForTimeout(300);
check(await page.locator("#tab-li.is-active").count() === 1, "LI tab active after click");
vis = await panelsVisible();
check(vis.length === 1 && vis[0] === "view-li", "LI panel is the only visible panel");
const li = page.frameLocator("#frame-li");
await li.locator("#importBtn").waitFor({ timeout: 8000 });
check(true, "LI iframe booted on first activation");
check(await li.locator("header.topbar h1").isHidden(), "LI h1 hidden when embedded");
check(await li.locator("#backToVault").isHidden(), "LI back link hidden when embedded");
// The LI app auto-opens its import prompt when empty; dismiss it like a user.
if (await li.locator("#importOverlay.show").count()) {
  await li.locator("#importOverlay .x[data-close]").click();
  await page.waitForTimeout(200);
}

// --- Inventory tab ---
await page.click("#tab-inventory");
const inv = page.frameLocator("#frame-inventory");
await inv.locator("#tbody tr").first().waitFor({ timeout: 20000 });
check(true, "inventory iframe booted with rows");
check(await inv.locator("#backBtn").isHidden(), "inventory back link hidden when embedded");

// --- Toolbox tab ---
await page.click("#tab-toolbox");
const toolbox = page.frameLocator("#frame-toolbox");
await toolbox.locator(".tabs .tab").first().waitFor({ timeout: 15000 });
check(true, "toolbox iframe booted on first activation");
check(await toolbox.locator(".brand").isHidden(), "toolbox brand hidden when embedded");
check((await toolbox.locator(".tabs .tab").count()) === 10, "toolbox shows its 10 tool tabs");
check((await page.title()) === "Toolbox · File Database", "shell title follows the active app");

// --- Theme: cycle system → light → dark, broadcast into every loaded frame ---
check(await page.evaluate(() => !document.documentElement.hasAttribute("data-theme")), "shell starts on system theme");
await page.click("#theme-btn"); // light
await page.click("#theme-btn"); // dark
await page.waitForTimeout(400);
check((await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) === "dark", "shell data-theme=dark");
check((await page.evaluate(() => localStorage.getItem("fv-theme"))) === "dark", "fv-theme=dark persisted");
for (const [name, sel] of [["vault", "#frame-vault"], ["li", "#frame-li"], ["inventory", "#frame-inventory"], ["toolbox", "#frame-toolbox"]]) {
  check((await frameTheme(sel)) === "dark", `${name} frame follows the dark theme`);
}
await page.screenshot({ path: path.join(ROOT, "tools", "screenshot-shell.png") });
await page.click("#theme-btn"); // back to system
await page.waitForTimeout(400);
check(await page.evaluate(() => !document.documentElement.hasAttribute("data-theme")), "cycling back to system removes the shell attribute");
check((await page.evaluate(() => localStorage.getItem("fv-theme"))) === null, "fv-theme removed for system");
for (const [name, sel] of [["vault", "#frame-vault"], ["li", "#frame-li"], ["inventory", "#frame-inventory"], ["toolbox", "#frame-toolbox"]]) {
  check((await frameTheme(sel)) === null, `${name} frame attribute removed for system`);
}

// --- Hash deep links ---
await page.goto(base + "#toolbox/pdf");
await page.waitForTimeout(800);
check(await page.locator("#tab-toolbox.is-active").count() === 1, "#toolbox/pdf activates the Toolbox");
let activeTool = "";
for (let i = 0; i < 20; i++) {           // the toolbox-open message may be pending until the frame loads
  activeTool = await page.evaluate(() =>
    document.querySelector("#frame-toolbox")?.contentDocument?.querySelector(".tab.active")?.dataset.tab || "");
  if (activeTool === "pdf") break;
  await page.waitForTimeout(250);
}
check(activeTool === "pdf", `#toolbox/pdf opens the PDF tool tab (got "${activeTool}")`);
// hashchange after load switches apps
await page.evaluate(() => { location.hash = "#li"; });
await page.waitForTimeout(400);
check(await page.locator("#tab-li.is-active").count() === 1, "hashchange to #li switches to LI Documents");

// #files is a contracted alias for the vault tab (fresh load — a hash-only
// goto would be a same-document navigation and never reach networkidle)
await page.goto("about:blank");
await page.goto(base + "#files", { waitUntil: "networkidle" });
await page.waitForTimeout(400);
check(await page.locator("#tab-vault.is-active").count() === 1, "#files alias activates the Files tab");

// --- Legacy query params ---
await page.goto(base + "?view=inventory", { waitUntil: "networkidle" });
await page.waitForTimeout(400);
check(await page.locator("#tab-inventory.is-active").count() === 1, "?view=inventory activates the inventory");
check(!new URL(page.url()).search, "consumed legacy query is stripped from the URL");
await page.goto(base + "?view=starred", { waitUntil: "networkidle" });
await page.waitForTimeout(400);
check(await page.locator("#tab-vault.is-active").count() === 1, "?view=starred activates the vault");
check(((await frameSrc("#frame-vault")) || "").includes("?view=starred"), "?view=starred is passed through to the vault iframe");
await page.goto(base + "?action=add", { waitUntil: "networkidle" });
await page.waitForTimeout(400);
check(await page.locator("#tab-vault.is-active").count() === 1, "?action=add activates the vault");
check(((await frameSrc("#frame-vault")) || "").includes("action=add"), "?action=add is passed through to the vault iframe");

// --- Legacy child → shell navigation message ---
await page.click("#tab-li");
const liDeep = page.frameLocator("#frame-li");
await liDeep.locator("#importBtn").waitFor({ timeout: 8000 });
if (await liDeep.locator("#importOverlay.show").count()) {
  await liDeep.locator("#importOverlay .x[data-close]").click();
}
await frameFor("/li/").evaluate(() => window.parent.postMessage({ type: "vault-nav", to: "files" }, "*"));
await page.waitForTimeout(400);
check(await page.locator("#tab-vault.is-active").count() === 1, "legacy {type:'vault-nav'} from a child switches to Files");

// --- Tab badges reflect the vault's file count ---
await page.goto(base, { waitUntil: "networkidle" });   // plain URL again (no ?view= query)
const vault2 = page.frameLocator("#frame-vault");
await vault2.locator("#empty").waitFor({ timeout: 8000 });
const tmp = path.join(ROOT, "tools", "_fixtures");
fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, "badge.txt"), "one file for the badge count");
await vault2.locator("#file-input").setInputFiles(path.join(tmp, "badge.txt"));
await page.waitForTimeout(500);
check((await vault2.locator(".card").count()) === 1, "a file added through the embedded vault");
await page.click("#tab-li");                           // switching tabs refreshes the badges
await page.waitForTimeout(400);
await page.click("#tab-vault");
let badge = "";
for (let i = 0; i < 25; i++) {           // badge peek is debounced + async — poll
  badge = ((await page.locator('[data-count="vault"]').textContent()) || "").trim();
  if (badge === "1") break;
  await page.waitForTimeout(250);
}
check(badge === "1", `Files tab badge shows the exact vault count (got "${badge}")`);

// --- Toolbox → File Vault save (snackbar offer over the bridge) ---
await page.click("#tab-toolbox");
const tb = page.frameLocator("#frame-toolbox");
await tb.locator(".tabs .tab").first().waitFor({ timeout: 15000 });
const tbFrame = frameFor("/toolbox/");
await tbFrame.waitForFunction(() => typeof window.__vaultOffer === "function", null, { timeout: 8000 });
await tbFrame.evaluate(() => {
  window.__vaultOffer(new Blob(["hi"], { type: "text/plain" }), "note.txt");
});
const saveBtn = tb.locator("button", { hasText: "Save to File Vault" });
await saveBtn.waitFor({ timeout: 5000 });
check(true, "toolbox output offers a 'Save to File Vault' snackbar");
await saveBtn.click();
await page.waitForTimeout(400);
await page.click("#tab-vault");
await vault2.locator("#search-input").fill("note.txt");
let toolboxCard = 0;
for (let i = 0; i < 25; i++) {           // bridge delivery is async — poll
  toolboxCard = await vault2.locator(".card:visible").filter({ hasText: "note.txt" }).count();
  if (toolboxCard >= 1) break;
  await page.waitForTimeout(250);
}
check(toolboxCard === 1, `saved toolbox output shows up as a vault card (got ${toolboxCard})`);
await vault2.locator(".card").filter({ hasText: "note.txt" }).first().click();
await page.waitForTimeout(300);
check((await vault2.locator("#d-collection").inputValue()) === "Toolbox", "saved file filed under the 'Toolbox' collection");

// Filter benign noise: missing favicons/manifest 404s + PDF.js worker warnings.
const realErrors = errors.filter((e) =>
  !/favicon|manifest|the server responded|404|Failed to load resource|pdf|worker|InvalidPDF|structure|Setting up fake|extract|Warning/i.test(e));
console.log(realErrors.length ? "\nErrors:\n" + realErrors.join("\n") : "\nNo unexpected console errors.");
check(realErrors.length === 0, "no unexpected console/page errors");

await browser.close();
server.close();
console.log(failures === 0 ? "\nSHELL CHECKS PASSED ✅" : `\n${failures} SHELL CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
