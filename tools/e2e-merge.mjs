// Integration test for the cross-app handoffs through the File Database shell:
// vault → LI, LI → vault and vault → Toolbox over the shared database, with the shell
// (root index.html) owning tabs/navigation and each app living in its iframe.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser, launchPersistent } from "./e2e-browser.mjs";
import { fdbAll } from "./e2e-db.mjs";

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

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// --- The shell boots with the vault ("Files") as the default app ---
check(await page.locator("#tab-vault.is-active").count() === 1, "shell opens on the Files tab");
check(await page.locator("#view-vault:not([hidden])").count() === 1, "vault panel is visible");
const vault = page.locator("#view-vault");
await vault.locator("#empty").waitFor({ timeout: 8000 });
check(true, "vault iframe booted (empty state visible)");

// --- The LI Documents tab opens the embedded LI app ---
check(await page.locator("#tab-li").isVisible(), "shell shows an 'LI Documents' tab");
await page.click("#tab-li");
await page.waitForTimeout(300);
check(await page.locator("#view-li:not([hidden])").count() === 1, "clicking it reveals the embedded LI view");
const li = page.locator("#view-li");
await li.locator("header.topbar").waitFor({ timeout: 8000 });
check(await li.locator("#importBtn").isHidden(), "embedded LI app loaded; its own Import button hidden (shell owns 'Add files')");
// The LI app auto-opens its import prompt when empty; dismiss it like a user.
if (await li.locator("#importOverlay.show").count()) {
  await li.locator("#importOverlay .x[data-close]").click();
  await page.waitForTimeout(200);
}

// --- Both features are mounted on the one page, over the one data layer ---
check(await page.evaluate(() => !!(window.FDData && window.FDData.repos)), "the data layer is loaded once, on the page");
check(await page.evaluate(() => !!document.querySelector("#view-vault").shadowRoot && !!document.querySelector("#view-li").shadowRoot), "the Files and LI features are both mounted");

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

// The hand-off is an "li-import" job on the stored record (the shell page
// reads the same database).
await vault.locator("#d-send-li").click();
await page.waitForTimeout(400);
const outboxToLi = (await fdbAll(page, "jobs")).filter((j) => j.type === "li-import").map((j) => ({ type: j.type, state: j.state, files: j.inputIds.length }));
// The (loaded) LI iframe may already have run it — queued, running or done are all correct.
check(await page.locator("#tab-li.is-active").count() === 1, "'Send to LI' switches the shell to the LI tab");
check(await page.locator("#view-li:not([hidden])").count() === 1, "LI panel visible after the handoff");
check(outboxToLi.length >= 1, "an li-import job was queued for the stored PDF (" + JSON.stringify(outboxToLi) + ")");

// --- LI -> File Vault: store through the shared intake (the one data layer on the page) ---
await page.evaluate(async () => {
  const blob = new Blob(["%PDF-1.4 li->vault"], { type: "application/pdf" });
  const file = new File([blob], "LI54.10-P-071499 Steering column.pdf", { type: "application/pdf" });
  await window.FDData.intake.ingest("vault", [file], { collection: "LI Documents", meta: { tags: ["LI54.10-P-071499", "54 Electrical", "Model 205"], note: "LI: Steering column" } });
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
for (let i = 0; i < 25; i++) {           // the vault hears the change on the bus — poll
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
const toolbox = page.locator("#view-toolbox");
await toolbox.locator(".tabs .tab").first().waitFor({ timeout: 15000 });
let media = { active: false, name: "" };
for (let i = 0; i < 40; i++) {           // frame lazy-loads + the job runs async — poll
  media = await page.evaluate(() => {
    const doc = document.querySelector("#view-toolbox")?.shadowRoot;
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
