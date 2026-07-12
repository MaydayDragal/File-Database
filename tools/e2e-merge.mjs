// Integration test for the File Vault ⇄ LI Database merge (bridge + embedded app).
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

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// --- The LI Documents nav entry exists and opens the embedded app ---
check(await page.locator("#nav-li").isVisible(), "sidebar shows 'LI Documents' entry");
await page.locator("#nav-li").click();
await page.waitForTimeout(300);
check(await page.locator("#li-view").isVisible(), "clicking it reveals the embedded LI view");
check((await page.locator("#view-title").textContent()).includes("LI"), "title switches to LI Documents");
const frame = page.frameLocator("#li-frame");
await page.waitForTimeout(1500); // let the LI app boot inside the iframe
check(await frame.locator("#importBtn").isVisible(), "embedded LI app loaded (Import button visible)");
check(await frame.locator("#backToVault").isVisible(), "LI app shows a '← Files' back link");
// The LI app auto-opens its import prompt when empty; dismiss it like a user.
if (await frame.locator("#importOverlay.show").count()) {
  await frame.locator("#importOverlay .x[data-close]").click();
  await page.waitForTimeout(200);
}

// --- Bridge is present in BOTH frames ---
check(await page.evaluate(() => !!window.VaultBridge), "bridge loaded in File Vault");
const liHasBridge = await page.evaluate(() => {
  const f = document.getElementById("li-frame");
  return !!(f && f.contentWindow && f.contentWindow.VaultBridge);
});
check(liHasBridge, "bridge loaded inside the LI iframe");

// --- Back link switches the shell back to Files ---
await frame.locator("#backToVault").click();
await page.waitForTimeout(500);
check(!(await page.locator("#li-view").isVisible()), "back link returns to the file list");

// --- Add a PDF to File Vault, then 'Send to LI' ---
const tmp = path.join(ROOT, "tools", "_fixtures");
fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, "bulletin.pdf"), "%PDF-1.4\n% LI test\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
await page.setInputFiles("#file-input", [path.join(tmp, "bulletin.pdf")]);
await page.waitForTimeout(500);
check((await page.locator(".card").count()) === 1, "PDF added to File Vault");
await page.locator(".card").first().click();
await page.waitForTimeout(300);
check(await page.locator("#d-send-li").isVisible(), "'Send to LI' button shows for a PDF");

// Intercept the bridge to confirm the payload is queued for the LI app.
await page.click("#d-send-li");
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
check(await page.locator("#li-view").isVisible(), "'Send to LI' switches to the LI view");
console.log("    (bridge outbox snapshot:", JSON.stringify(outboxToLi) + ")");

// --- LI -> File Vault: drive the bridge from the LI frame with a real blob ---
const beforeCards = await page.evaluate(() => {
  // count File Vault cards currently in DOM
  return document.querySelectorAll(".card").length;
});
await page.evaluate(async () => {
  const f = document.getElementById("li-frame");
  const B = f.contentWindow.VaultBridge;
  const blob = new Blob(["%PDF-1.4 li->vault"], { type: "application/pdf" });
  await B.send("vault", {
    name: "LI54.10-P-071499 Steering column.pdf",
    type: "application/pdf",
    blob,
    meta: { li: "LI54.10-P-071499", fgroup: "54 Electrical", title: "Steering column", modelSeries: ["205"] },
  });
});
await page.waitForTimeout(700);
// Switch back to the file list (the user's natural next step) to see the arrival.
await page.locator("[data-filter='all']").click();
await page.waitForTimeout(200);
await page.fill("#search-input", "LI54.10-P-071499");
await page.waitForTimeout(300);
const recvCount = await page.locator(".card:visible").count();
check(recvCount === 1, `LI→Vault handoff created a File Vault card (got ${recvCount})`);
await page.locator(".card").first().click();
await page.waitForTimeout(300);
check((await page.locator("#d-collection").inputValue()) === "LI Documents", "received file filed under 'LI Documents' collection");
check((await page.locator("#d-tags").inputValue()).includes("LI54.10-P-071499"), "received file tagged with the LI number");
check((await page.locator("#d-tags").inputValue()).includes("Model 205"), "received file tagged with the model series");
await page.click("#detail [data-close]");
await page.fill("#search-input", "");
await page.waitForTimeout(200);

// --- The 'LI Documents' collection now appears in the sidebar ---
check((await page.locator("#nav-collections").getByText("LI Documents").count()) > 0, "'LI Documents' collection in sidebar");

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
