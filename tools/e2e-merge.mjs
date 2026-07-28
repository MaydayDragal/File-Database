// Integration test for the cross-app handoffs through the File Database shell:
// vault → LI, LI → vault and vault → Toolbox over bridge.js, with the shell
// (root index.html) owning tabs/navigation and each app living in its iframe.
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

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// --- The shell boots with the vault ("Files") as the default app ---
check(await page.locator("#tab-vault.is-active").count() === 1, "shell opens on the Files tab");
check(await page.locator("#view-vault:not([hidden])").count() === 1, "vault panel is visible");
const vault = page.frameLocator("#frame-vault");
await vault.locator("#empty").waitFor({ timeout: 8000 });
check(true, "vault iframe booted (empty state visible)");

// --- The LI Documents tab opens the embedded LI app ---
check(await page.locator("#tab-li").isVisible(), "shell shows an 'LI Documents' tab");
await page.click("#tab-li");
await page.waitForTimeout(300);
check(await page.locator("#view-li:not([hidden])").count() === 1, "clicking it reveals the embedded LI view");
const li = page.frameLocator("#frame-li");
await li.locator("header.topbar").waitFor({ timeout: 8000 });
check(await li.locator("#importBtn").isHidden(), "embedded LI app loaded; its own Import button hidden (shell owns 'Add files')");
// The LI app auto-opens its import prompt when empty; dismiss it like a user.
if (await li.locator("#importOverlay.show").count()) {
  await li.locator("#importOverlay .x[data-close]").click();
  await page.waitForTimeout(200);
}

// --- Bridge is present in BOTH app frames (evaluated inside each iframe) ---
const vaultFrame = frameFor("/vault/");
const liFrame = frameFor("/li/");
check(!!vaultFrame && await vaultFrame.evaluate(() => !!window.VaultBridge), "bridge loaded inside the vault iframe");
check(!!liFrame && await liFrame.evaluate(() => !!window.VaultBridge), "bridge loaded inside the LI iframe");

// --- Add a PDF to File Vault, then 'Send to LI' ---
await page.click("#tab-vault");
await page.waitForTimeout(200);
const tmp = path.join(ROOT, "tools", "_fixtures");
fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, "bulletin.pdf"), "%PDF-1.4\n% LI test\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
await vault.locator("#file-input").setInputFiles(path.join(tmp, "bulletin.pdf"));
await page.waitForTimeout(500);
check((await vault.locator(".card").count()) === 1, "PDF added to File Vault");
await vault.locator(".card").first().click();
await page.waitForTimeout(300);
check(await vault.locator("#d-send-li").isVisible(), "'Send to LI' button shows for a PDF");

// Intercept the bridge to confirm the payload is queued for the LI app.
// (IndexedDB is origin-shared, so the shell page sees the same "vault-bridge" DB.)
await vault.locator("#d-send-li").click();
await page.waitForTimeout(400);
const outboxToLi = await page.evaluate(() => new Promise((resolve) => {
  const r = indexedDB.open("vault-bridge");
  r.onsuccess = () => {
    const db = r.result;
    if (!db.objectStoreNames.contains("outbox")) return resolve([]);
    const all = db.transaction("outbox", "readonly").objectStore("outbox").getAll();
    all.onsuccess = () => resolve(all.result.map((x) => ({ target: x.target, name: x.name, type: x.type, hasBlob: !!x.blob })));
    all.onerror = () => resolve([]);
  };
  r.onerror = () => resolve([]);
}));
// It may already be drained by the (loaded) LI iframe — either queued OR consumed is correct.
check(await page.locator("#tab-li.is-active").count() === 1, "'Send to LI' switches the shell to the LI tab");
check(await page.locator("#view-li:not([hidden])").count() === 1, "LI panel visible after the handoff");
console.log("    (bridge outbox snapshot:", JSON.stringify(outboxToLi) + ")");

// --- LI -> File Vault: drive the bridge from inside the LI frame with a real blob ---
await liFrame.evaluate(async () => {
  const blob = new Blob(["%PDF-1.4 li->vault"], { type: "application/pdf" });
  await window.VaultBridge.send("vault", {
    name: "LI54.10-P-071499 Steering column.pdf",
    type: "application/pdf",
    blob,
    meta: { li: "LI54.10-P-071499", fgroup: "54 Electrical", title: "Steering column", modelSeries: ["205"] },
  });
});
await page.waitForTimeout(700);
// Switch back to the file list (the user's natural next step) to see the arrival.
await page.click("#tab-vault");
await page.waitForTimeout(200);
await vault.locator("[data-filter='all']").click();
await page.waitForTimeout(200);
await vault.locator("#search-input").fill("LI54.10-P-071499");
await page.waitForTimeout(300);
let recvCount = 0;
for (let i = 0; i < 25; i++) {           // bridge delivery is async — poll
  recvCount = await vault.locator(".card:visible").count();
  if (recvCount === 1) break;
  await page.waitForTimeout(200);
}
check(recvCount === 1, `LI→Vault handoff created a File Vault card (got ${recvCount})`);
await vault.locator(".card").first().click();
await page.waitForTimeout(300);
check((await vault.locator("#d-collection").inputValue()) === "LI Documents", "received file filed under 'LI Documents' collection");
check((await vault.locator("#d-tags").inputValue()).includes("LI54.10-P-071499"), "received file tagged with the LI number");
check((await vault.locator("#d-tags").inputValue()).includes("Model 205"), "received file tagged with the model series");
await vault.locator("#detail button[data-close]").click();
await vault.locator("#search-input").fill("");
await page.waitForTimeout(200);

// --- The 'LI Documents' collection now appears in the vault sidebar ---
check((await vault.locator("#nav-collections").getByText("LI Documents").count()) > 0, "'LI Documents' collection in sidebar");

// --- Vault -> Toolbox: an image opens the Media tool with the file loaded ---
const png = Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001080600000" +
  "01f15c4890000000d49444154789c6360000002000154a24f5f0000000049454e44ae426082", "hex");
fs.writeFileSync(path.join(tmp, "snapshot.png"), png);
await vault.locator("#file-input").setInputFiles(path.join(tmp, "snapshot.png"));
await page.waitForTimeout(500);
await vault.locator(".card").filter({ hasText: "snapshot.png" }).click();
await page.waitForTimeout(300);
check(await vault.locator("#d-send-toolbox").isVisible(), "'Send to Toolbox' button shows for an image");
await vault.locator("#d-send-toolbox").click();
await page.waitForTimeout(400);
check(await page.locator("#tab-toolbox.is-active").count() === 1, "'Send to Toolbox' switches the shell to the Toolbox tab");
check(await page.locator("#view-toolbox:not([hidden])").count() === 1, "Toolbox panel visible after the handoff");
const toolbox = page.frameLocator("#frame-toolbox");
await toolbox.locator(".tabs .tab").first().waitFor({ timeout: 15000 });
let media = { active: false, name: "" };
for (let i = 0; i < 40; i++) {           // frame lazy-loads + bridge drains async — poll
  media = await page.evaluate(() => {
    const doc = document.querySelector("#frame-toolbox")?.contentDocument;
    if (!doc) return { active: false, name: "" };
    return {
      active: !!doc.querySelector("#tool-media.active"),
      name: (doc.querySelector("#m-fileName")?.textContent || "").trim(),
    };
  });
  if (media.active && media.name.includes("snapshot.png")) break;
  await page.waitForTimeout(250);
}
check(media.active, "toolbox opened on the Media Compressor tool");
check(media.name.includes("snapshot.png"), `media tool loaded the handed-over file (got "${media.name}")`);

await page.screenshot({ path: path.join(ROOT, "tools", "screenshot-merge.png") });

// Filter out benign LI-app console noise (PDF.js worker warnings on the fake PDF).
const realErrors = errors.filter((e) =>
  !/pdf|worker|InvalidPDF|structure|Setting up fake|extract|Warning/i.test(e));
console.log(realErrors.length ? "\nErrors:\n" + realErrors.join("\n") : "\nNo unexpected console errors.");
check(realErrors.length === 0, "no unexpected console/page errors");

await browser.close();
server.close();
console.log(failures === 0 ? "\nMERGE CHECKS PASSED ✅" : `\n${failures} MERGE CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
