// LI Documents: the files embedded in a PDF ("📎 Files in this PDF").
// A real PDF is built with pdf-lib carrying three catalogue attachments (a
// text file, a PNG, an HTML file with a script in it) and a paperclip
// annotation on page 1 (a CSV); stored as an LI document, its detail view must
// list all four, show each safely in the preview pane (the HTML as text, its
// script never run), download one, and add one to Files tagged with the LI
// number. A PDF without attachments says so.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./e2e-browser.mjs";
import { vaultFiles } from "./e2e-db.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;
console.log("serving", base);

let failures = 0;
const check = (c, l, extra) => { console.log((c ? "  ✓ " : "  ✗ ") + l + (!c && extra !== undefined ? "  → " + JSON.stringify(extra) : "")); if (!c) failures++; };
const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true, serviceWorkers: "block" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
const waitFor = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(150); } return false; };

const LI = "LI54.10-P-070001", LI2 = "LI54.10-P-070002";
await page.goto(base + "#vault", { waitUntil: "load" });
await page.waitForFunction(() => window.FDData && window.PDFLib && window.FDShell);
await page.evaluate(async ({ LI, LI2 }) => {
  const { PDFDocument, PDFName, PDFString, PDFHexString, StandardFonts } = window.PDFLib;
  const enc = (s) => new TextEncoder().encode(s);
  const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([600, 800]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  p1.drawText(LI + " Wiring diagram", { x: 50, y: 740, size: 14, font });
  doc.addPage([600, 800]);
  await doc.attach(enc("Torque: 25 Nm\nSealant: required\n"), "torque-notes.txt", { mimeType: "text/plain", description: "Torque values" });
  await doc.attach(PNG, "connector.png", { mimeType: "image/png" });
  await doc.attach(enc("<html><body><script>window.parent.__pwned = 1; window.top.__pwned = 1;</script>hello</body></html>"), "report.html", { mimeType: "text/html" });
  // A paperclip annotation on page 1 carrying wiring.csv.
  const ctx = doc.context;
  const bytes = enc("pin,wire\n1,red\n2,black\n");
  const ef = ctx.stream(bytes, { Type: "EmbeddedFile", Length: bytes.length });
  const efRef = ctx.register(ef);
  const fs = ctx.obj({ Type: "Filespec", F: PDFString.of("wiring.csv"), UF: PDFHexString.fromText("wiring.csv"), EF: { F: efRef } });
  const fsRef = ctx.register(fs);
  const annot = ctx.obj({ Type: "Annot", Subtype: "FileAttachment", Rect: [50, 50, 70, 70], FS: fsRef, Contents: PDFString.of("Pinout"), Name: "PushPin" });
  p1.node.addAnnot(ctx.register(annot));
  const withFiles = new Blob([await doc.save()], { type: "application/pdf" });
  const plain = await PDFDocument.create(); plain.addPage([600, 800]);
  const noFiles = new Blob([await plain.save()], { type: "application/pdf" });
  const R = window.FDData.repos;
  await R.documents.putWithFile({ id: LI + "_1", li: LI, ver: "1", title: "Wiring diagram", filename: LI + ".pdf" }, withFiles);
  await R.documents.putWithFile({ id: LI2 + "_1", li: LI2, ver: "1", title: "No attachments", filename: LI2 + ".pdf" }, noFiles);
}, { LI, LI2 });

await page.goto(base + "#li/" + LI, { waitUntil: "load" });
const li = page.locator("#view-li");
await li.locator("#detailOverlay.show").waitFor({ timeout: 15000 });
const rows = li.locator("#dAttList .att-row");
check(await waitFor(async () => (await rows.count()) === 4), "all four embedded files are listed (three attachments + the page annotation)", await rows.count());
const names = await li.locator("#dAttList .att-row__name").allTextContents();
check(["torque-notes.txt", "connector.png", "report.html", "wiring.csv"].every((n) => names.includes(n)), "by name", names);
check(/\(4\)/.test(await li.locator("#dAttCount").textContent()), "the section header counts them");
const row = (n) => li.locator("#dAttList .att-row", { hasText: n });
check(/on page 1/.test(await row("wiring.csv").locator(".att-row__meta").textContent()), "the annotation's file says which page it is on");
check(/Pinout/.test(await row("wiring.csv").locator(".att-row__meta").textContent()), "a paperclip annotation's note is shown with its file");

// View a text file.
await row("torque-notes.txt").locator(".att-view-btn").click();
check(await waitFor(async () => /Torque: 25 Nm/.test((await li.locator("#dAttView pre").textContent().catch(() => "")) || "")), "View shows a text file's contents in the preview pane");
check(await li.locator("#dFrame").isHidden() && await li.locator("#dAttBar").isVisible(), "the PDF is swapped out and a bar names the file");
// An image.
await row("connector.png").locator(".att-view-btn").click();
check(await waitFor(async () => (await li.locator("#dAttView img").count()) === 1 && await li.locator("#dAttView img").evaluate((i) => i.complete && i.naturalWidth === 1)), "View shows an image");
// HTML is shown as text; its script never runs.
await row("report.html").locator(".att-view-btn").click();
check(await waitFor(async () => /<script>/.test((await li.locator("#dAttView pre").textContent().catch(() => "")) || "")), "an HTML file is shown as its source text");
await page.waitForTimeout(500);
check((await page.evaluate(() => window.__pwned)) === undefined && (await li.locator("#dAttView iframe").count()) === 0, "…and its script never runs");
// Back to the PDF.
await li.locator("#dAttBack").click();
check(await li.locator("#dFrame").isVisible() && await li.locator("#dAttView").isHidden(), "← Back to the PDF shows the document again");

// Download.
const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), row("wiring.csv").locator(".att-dl-btn").click()]);
const dlPath = path.join(ROOT, "tools", "_fixtures", "att-wiring.csv");
fs.mkdirSync(path.dirname(dlPath), { recursive: true });
await dl.saveAs(dlPath);
check(dl.suggestedFilename() === "wiring.csv" && fs.readFileSync(dlPath, "utf8") === "pin,wire\n1,red\n2,black\n", "⬇ downloads the file with its own name and bytes", dl.suggestedFilename());

// Add to Files.
await row("torque-notes.txt").locator(".att-add-btn").click();
const added = await waitFor(async () => (await vaultFiles(page)).some((f) => f.name === "torque-notes.txt"));
const rec = (await vaultFiles(page)).find((f) => f.name === "torque-notes.txt") || {};
check(added && (rec.tags || []).includes(LI) && rec.collection === "LI Documents" && /Attached inside LI54\.10-P-070001 v1/.test(rec.note || ""), "＋ Files stores it in Files, tagged with the LI number and noted with where it came from", rec);

// A PDF with no attachments.
await page.goto(base + "#li/" + LI2, { waitUntil: "load" });
await li.locator("#detailOverlay.show").waitFor({ timeout: 15000 });
check(await waitFor(async () => /No files are attached/.test(await li.locator("#dAttList").textContent())), "a PDF without files says so");

check(errors.length === 0, "no page errors", errors);
await browser.close();
server.close();
console.log(failures === 0 ? "\nLI-ATTACHMENTS CHECKS PASSED ✅" : `\n${failures} LI-ATTACHMENTS CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
