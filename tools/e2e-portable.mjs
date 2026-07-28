// Builds the portable USB package and verifies it runs the way the launcher
// drives it: Edge/Chrome against app/index.html over file://, with the browser
// profile (and therefore the vault data) kept in the package's data/ folder.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import path from "node:path"; import fs from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
let fail = 0; const ok = (c, l) => { console.log((c ? "  ✓ " : "  ✗ ") + l); if (!c) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) Build the package fresh.
execFileSync("node", [path.join(ROOT, "tools", "build-portable.mjs")], { stdio: "inherit" });
const PKG = path.join(ROOT, "dist-portable", "FileDatabase-Portable");
ok(fs.existsSync(path.join(PKG, "app", "index.html")), "package has app/index.html");
ok(fs.existsSync(path.join(PKG, "Start File Database.bat")), "package has the Windows launcher");
ok(fs.existsSync(path.join(PKG, "START-HERE.txt")), "package has START-HERE.txt");
// The launcher must NOT depend on a network — no https URLs in the app entry.
ok(!/https?:\/\//.test(fs.readFileSync(path.join(PKG, "Start File Database.bat"), "utf8")), "launcher points at local files only");

const DATA = path.join(PKG, "data");                       // exactly what the .bat uses for --user-data-dir
const URL = "file://" + path.join(PKG, "app", "index.html");
const args = ["--allow-file-access-from-files", "--no-sandbox", "--no-first-run"];
const vaultFrame = async (page) => { for (let i = 0; i < 50; i++) { const f = page.frames().find((f) => f.url().includes("/vault/")); if (f) return f; await sleep(200); } return null; };
const countVaultFiles = (page) => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("file-vault");
  r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains("files")) return res(0);
    const c = db.transaction("files").objectStore("files").count(); c.onsuccess = () => res(c.result); c.onerror = () => res(-1); };
  r.onerror = () => res(-1);
}));

fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(DATA, { recursive: true }); // clean stick

let ctx = await chromium.launchPersistentContext(DATA, { executablePath: EXE, args, viewport: { width: 1280, height: 820 } });
let page = ctx.pages()[0] || await ctx.newPage();
const errs = []; page.on("pageerror", (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: "domcontentloaded" });
await sleep(800);
const tab = await page.$("#tab-vault"); if (tab) await tab.click();
const vf = await vaultFrame(page);
ok(!!vf, "shell + vault app boot from the USB over file://");
const tmp = path.join(ROOT, "tools", "_fixtures"); fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, "note.txt"), "portable hello");
await vf.locator("#file-input").setInputFiles(path.join(tmp, "note.txt"));
for (let i = 0; i < 30 && (await countVaultFiles(page)) < 1; i++) await sleep(200);
ok((await countVaultFiles(page)) === 1, "a saved file lands in IndexedDB inside the USB profile");
// Inventory seed loads (fetch of a local file works thanks to --allow-file-access-from-files)
const inv = await page.$("#tab-inventory"); if (inv) await inv.click();
await sleep(2500);
const invF = page.frames().find((f) => f.url().includes("/inventory/"));
ok(!!invF && (await invF.locator("#tbody tr").count()) > 1400, "inventory loads its bundled seed from local files");
await sleep(1200); await ctx.close();

ctx = await chromium.launchPersistentContext(DATA, { executablePath: EXE, args });
page = ctx.pages()[0] || await ctx.newPage();
await page.goto(URL, { waitUntil: "domcontentloaded" });
let persisted = -1; for (let i = 0; i < 30; i++) { persisted = await countVaultFiles(page); if (persisted >= 1) break; await sleep(200); }
ok(persisted === 1, "data persists across a full restart (portable data on the stick)");
await ctx.close();

const realErrs = errs.filter((e) => !/ServiceWorker|serviceworker/i.test(e)); // SW is expected to be unavailable on file://
ok(realErrs.length === 0, "no unexpected page errors" + (realErrs.length ? ": " + realErrs[0] : ""));

// leave a clean data/ dir behind
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(DATA, ".keep"), "Your vault's browser profile is stored here on first run.\n");
console.log(fail ? "\n" + fail + " PORTABLE CHECK(S) FAILED ❌" : "\nPORTABLE CHECKS PASSED ✅");
process.exit(fail ? 1 : 0);
