// End-to-end test for the File Database platform shell (root index.html):
// tabs, features mounted lazily into their panels, the features' own chrome
// hidden inside the shell, unified theme, deep links, legacy URLs/messages,
// tab badges and the Toolbox → File Vault save flow.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser, launchPersistent } from "./e2e-browser.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
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

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 850 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

let failures = 0;
const check = (cond, label) => { console.log((cond ? "  ✓ " : "  ✗ ") + label); if (!cond) failures++; };
// A feature is "loaded" once it has mounted into its panel's shadow root.
const mountedApp = (key) => page.evaluate((k) => !!document.querySelector("#view-" + k).shadowRoot, key);

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// --- Default app + lazily mounted features ---
check((await page.title()) === "Files · File Database", `title is "${await page.title()}"`);
check(await page.locator("#tab-vault.is-active").count() === 1, "Files tab active by default");
check((await page.locator("#tab-vault").getAttribute("aria-selected")) === "true", "Files tab aria-selected");
check(await page.locator("#view-vault:not([hidden])").count() === 1, "vault panel visible");
const panelsVisible = async () => page.evaluate(() =>
  Array.from(document.querySelectorAll(".app-panel")).filter((el) => !el.hidden).map((el) => el.id));
let vis = await panelsVisible();
check(vis.length === 1 && vis[0] === "view-vault", `exactly one panel visible (${vis.join(", ")})`);
check(await mountedApp("vault"), "vault feature mounts eagerly (default app)");
check(!(await mountedApp("li")), "LI feature not mounted yet (lazy)");
check(!(await mountedApp("inventory")), "inventory feature not mounted yet (lazy)");
check(!(await mountedApp("toolbox")), "toolbox feature not mounted until first activation (lazy)");

// --- Vault boots embedded: shell chrome wins, app chrome hidden ---
const vault = page.locator("#view-vault");
await vault.locator("#empty").waitFor({ timeout: 8000 });
check(await vault.locator(".topbar .brand").isHidden(), "vault brand hidden when embedded");
check(await vault.locator("#theme-btn").isHidden(), "vault theme button hidden when embedded");

// --- LI tab ---
await page.click("#tab-li");
await page.waitForTimeout(300);
check(await page.locator("#tab-li.is-active").count() === 1, "LI tab active after click");
vis = await panelsVisible();
check(vis.length === 1 && vis[0] === "view-li", "LI panel is the only visible panel");
const li = page.locator("#view-li");
await li.locator("header.topbar").waitFor({ timeout: 8000 });
check(true, "LI feature mounted on first activation");
check(await li.locator("header.topbar h1").isHidden(), "LI h1 hidden when embedded");
check(await li.locator("#backToVault").isHidden(), "LI back link hidden when embedded");
check(await li.locator("#importBtn").isHidden(), "LI's own Import button hidden when embedded (shell owns 'Add files')");
// The LI app auto-opens its import prompt when empty; dismiss it like a user.
if (await li.locator("#importOverlay.show").count()) {
  await li.locator("#importOverlay .x[data-close]").click();
  await page.waitForTimeout(200);
}

// --- Inventory tab ---
// Inventory ships empty and loads a portable .tidb database file, so a fresh
// embed shows its empty-state prompt rather than bundled rows.
await page.click("#tab-inventory");
const inv = page.locator("#view-inventory");
await inv.locator("#empty").waitFor({ timeout: 20000 });
check(await inv.locator("#empty").evaluate((el) => /no tool database loaded/i.test(el.textContent)), "inventory feature mounted (empty-state prompt)");
check(await inv.locator("#backBtn").isHidden(), "inventory back link hidden when embedded");

// --- Toolbox tab ---
await page.click("#tab-toolbox");
const toolbox = page.locator("#view-toolbox");
await toolbox.locator(".tabs .tab").first().waitFor({ timeout: 15000 });
check(true, "toolbox feature mounted on first activation");
check(await toolbox.locator(".brand").isHidden(), "toolbox brand hidden when embedded");
check((await toolbox.locator(".tabs .tab").count()) === 10, "toolbox shows its 10 tool tabs");
check((await page.title()) === "Toolbox · File Database", "shell title follows the active app");

// --- Theme: cycle system → light → dark; one document, one theme (tokens.css) ---
check(await page.evaluate(() => !document.documentElement.hasAttribute("data-theme")), "shell starts on system theme");
await page.click("#shell-theme-btn"); // light
await page.click("#shell-theme-btn"); // dark
await page.waitForTimeout(400);
check((await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) === "dark", "shell data-theme=dark");
check((await page.evaluate(() => localStorage.getItem("fv-theme"))) === "dark", "fv-theme=dark persisted");
// The tokens are inherited into every feature's shadow root: a feature's
// panel background follows the theme with no message and no per-app copy.
const panelBg = (key) => page.evaluate((k) => getComputedStyle(document.querySelector("#view-" + k).shadowRoot.querySelector(".fd-root")).backgroundColor, key);
for (const name of ["vault", "li", "inventory", "toolbox"]) {
  check((await panelBg(name)) === "rgb(15, 20, 32)", `${name} panel follows the dark theme`);
}
await page.screenshot({ path: path.join(ROOT, "tools", "screenshot-shell.png") });
await page.click("#shell-theme-btn"); // back to system
await page.waitForTimeout(400);
check(await page.evaluate(() => !document.documentElement.hasAttribute("data-theme")), "cycling back to system removes the shell attribute");
check((await page.evaluate(() => localStorage.getItem("fv-theme"))) === null, "fv-theme removed for system");
for (const name of ["vault", "li", "inventory", "toolbox"]) {
  check((await panelBg(name)) === "rgb(244, 246, 251)", `${name} panel back on the light theme`);
}

// --- Hash deep links ---
await page.goto(base + "#toolbox/pdf");
await page.waitForTimeout(800);
check(await page.locator("#tab-toolbox.is-active").count() === 1, "#toolbox/pdf activates the Toolbox");
let activeTool = "";
for (let i = 0; i < 20; i++) {           // the toolbox-open message may be pending until the feature mounts
  activeTool = await page.evaluate(() =>
    document.querySelector("#view-toolbox")?.shadowRoot?.querySelector(".tab.active")?.dataset.tab || "");
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
let starredNav = 0;
for (let i = 0; i < 20; i++) {           // the feature mounts and boots asynchronously — poll
  starredNav = await page.locator("#view-vault").locator('#nav-filters [data-filter="starred"].is-active').count().catch(() => 0);
  if (starredNav === 1) break;
  await page.waitForTimeout(250);
}
check(starredNav === 1, "?view=starred opens the vault on its starred files");
await page.goto(base + "?action=add", { waitUntil: "networkidle" });
await page.waitForTimeout(400);
check(await page.locator("#tab-vault.is-active").count() === 1, "?action=add activates the vault");
check(await mountedApp("vault"), "?action=add mounts the vault (and opens the platform's file picker)");

// --- Legacy child → shell navigation message ---
await page.click("#tab-li");
const liDeep = page.locator("#view-li");
await liDeep.locator("header.topbar").waitFor({ timeout: 8000 });
if (await liDeep.locator("#importOverlay.show").count()) {
  await liDeep.locator("#importOverlay .x[data-close]").click();
}
await page.evaluate(() => window.FDShell.send({ type: "vault-nav", to: "files" }));
await page.waitForTimeout(400);
check(await page.locator("#tab-vault.is-active").count() === 1, "legacy {type:'vault-nav'} from a feature switches to Files");

// --- Tab badges reflect the vault's file count ---
await page.goto(base, { waitUntil: "networkidle" });   // plain URL again (no ?view= query)
const vault2 = page.locator("#view-vault");
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

// --- Toolbox → File Vault save (snackbar offer, through the shared database) ---
await page.click("#tab-toolbox");
const tb = page.locator("#view-toolbox");
await tb.locator(".tabs .tab").first().waitFor({ timeout: 15000 });
await page.waitForFunction(() => typeof window.__vaultOffer === "function", null, { timeout: 8000 });
await page.evaluate(() => {
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
