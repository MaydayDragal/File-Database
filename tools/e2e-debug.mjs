// End-to-end test for the shared debug log (debug.js).
// On the vault page it triggers every capture path — console.error, an
// uncaught exception, an unhandled promise rejection, and FVDebug.log — then
// opens the viewer from the ⋮ menu and checks the entries, the level filter,
// persistence across a reload (IndexedDB "fv-debug"), and Clear. Finally it
// confirms the platform shell records into the SAME origin-wide log and that
// Ctrl+Shift+D toggles the viewer there.
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
const ctx = await browser.newContext({ viewport: { width: 1200, height: 850 } });
const page = await ctx.newPage();
page.on("dialog", (d) => d.accept()); // the Clear button confirms
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
let failures = 0;
const check = (c, l) => { console.log((c ? "  ✓ " : "  ✗ ") + l); if (!c) failures++; };
async function waitFor(fn, ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(200); }
  return fn();
}
const listText = () => page.locator("#fv-debug-list").textContent().catch(() => "");

// --- Vault: every capture path lands in the log ---
await page.goto(base + "vault/index.html", { waitUntil: "networkidle" });
await page.waitForTimeout(400);
check(await page.evaluate(() => !!window.FVDebug), "FVDebug is installed on the vault page");

await page.evaluate(() => {
  console.error("dbg-console-error", { code: 42 });
  console.warn("dbg-console-warn");
  window.FVDebug.log("dbg-app-note");
  Promise.reject(new Error("dbg-unhandled-rejection"));
  setTimeout(() => { throw new Error("dbg-uncaught-throw"); }, 0);
});
await page.waitForTimeout(600);

// Open the viewer from the ⋮ menu
await page.locator("#more-btn").click();
await page.locator('#more-menu button[data-action="debug"]').click();
check(await waitFor(async () => (await page.locator("#fv-debug").count()) === 1), "viewer opens from the vault ⋮ menu");
check(await waitFor(async () => /dbg-console-error/.test(await listText())), "console.error is captured (with its argument)");
check(/"code":42|code.*42/.test(await listText()), "console.error object argument is serialized");
check(/dbg-console-warn/.test(await listText()), "console.warn is captured");
check(/dbg-app-note/.test(await listText()), "FVDebug.log app message is captured");
check(await waitFor(async () => /dbg-unhandled-rejection/.test(await listText())), "unhandled promise rejection is captured");
check(await waitFor(async () => /dbg-uncaught-throw/.test(await listText())), "uncaught exception is captured");

// Level filter: Errors hides the warn + app entries
await page.locator("#fv-debug button", { hasText: "Errors" }).click();
await page.waitForTimeout(300);
const errOnly = await listText();
check(/dbg-console-error/.test(errOnly) && !/dbg-console-warn/.test(errOnly) && !/dbg-app-note/.test(errOnly), "Errors filter shows errors only");
await page.locator("#fv-debug button", { hasText: "All" }).click();
await page.waitForTimeout(300);

// --- Persistence: entries survive a reload ---
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(400);
await page.keyboard.press("Control+Shift+D");
check(await waitFor(async () => (await page.locator("#fv-debug").count()) === 1), "Ctrl+Shift+D opens the viewer after a reload");
check(await waitFor(async () => /dbg-console-error/.test(await listText())), "entries persist across reloads (IndexedDB)");

// --- Shell writes into the same origin-wide log ---
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(400);
check(await page.evaluate(() => !!window.FVDebug), "FVDebug is installed on the platform shell");
await page.evaluate(() => console.error("dbg-shell-error"));
await page.keyboard.press("Control+Shift+D");
check(await waitFor(async () => (await page.locator("#fv-debug").count()) === 1), "Ctrl+Shift+D opens the viewer on the shell");
check(await waitFor(async () => /dbg-shell-error/.test(await listText())), "shell errors land in the log");
check(/dbg-console-error/.test(await listText()), "vault entries are visible from the shell (one shared log)");
check(/shell/.test(await listText()) && /vault/.test(await listText()), "entries carry their source app name");

// --- Clear empties the log everywhere ---
await page.locator("#fv-debug button", { hasText: "Clear" }).click();
check(await waitFor(async () => /Nothing logged/.test(await listText())), "Clear empties the log");
await page.keyboard.press("Escape");
check((await page.locator("#fv-debug").count()) === 0, "Esc closes the viewer");
const stored = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("fv-debug");
  r.onsuccess = () => {
    const c = r.result.transaction("entries").objectStore("entries").count();
    c.onsuccess = () => res(c.result);
    c.onerror = () => res(-1);
  };
  r.onerror = () => res(-1);
}));
check(stored === 0, "cleared log is empty in IndexedDB too");

// Our own intentional test errors are expected; anything else is not.
const realErrors = errors.filter((e) => !/dbg-|favicon|manifest|the server responded|404|Failed to load resource/i.test(e));
console.log(realErrors.length ? "\nConsole errors:\n" + realErrors.join("\n") : "\nNo unexpected console errors.");
check(realErrors.length === 0, "no unexpected console/page errors");

await browser.close();
server.close();
console.log(failures === 0 ? "\nDEBUG-LOG CHECKS PASSED ✅" : `\n${failures} DEBUG-LOG CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
