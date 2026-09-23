// LI Documents: the files embedded in a PDF ("📎 Files in this PDF").
// A real PDF is built with pdf-lib carrying three catalogue attachments (a
// text file, a PNG, an HTML file with a script in it) and a paperclip
// annotation on page 1 (a CSV); stored as an LI document, its detail view must
// list all four, show each safely in the preview pane (the HTML as text, its
// script never run), download one, and add one to Files tagged with the LI
// number. A PDF without attachments says so. Files that share a name and
// size but not bytes are all listed, the same bytes twice once, and an empty
// file is still a file. A page saved from XENTRY TIPS only links to its
// attachments: they are listed (by the link's text) as not inside the PDF;
// ⬇ Get file fetches one into the list (then View / ⬇ / ＋ Files), an
// expired key shows XENTRY's message, a refusing server says to open the
// link instead; ordinary web and mailto links are not files.
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

const LI = "LI54.10-P-070001", LI2 = "LI54.10-P-070002", LI3 = "LI54.10-P-070003", LI4 = "LI42.10-P-078779";
await page.goto(base + "#vault", { waitUntil: "load" });
await page.waitForFunction(() => window.FDData && window.PDFLib && window.FDShell);
await page.evaluate(async ({ LI, LI2, LI3, LI4 }) => {
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
  const alike = await PDFDocument.create();
  const a1 = alike.addPage([600, 800]);
  await alike.attach(enc("AAAA"), "part.bin", { mimeType: "application/octet-stream" });
  await alike.attach(new Uint8Array(0), "empty.txt", { mimeType: "text/plain" });
  {
    const c = alike.context;
    const clip = (name, data, x) => {
      const e = c.register(c.stream(data, { Type: "EmbeddedFile", Length: data.length }));
      const s = c.register(c.obj({ Type: "Filespec", F: PDFString.of(name), UF: PDFHexString.fromText(name), EF: { F: e } }));
      a1.node.addAnnot(c.register(c.obj({ Type: "Annot", Subtype: "FileAttachment", Rect: [x, 50, x + 20, 70], FS: s, Name: "PushPin" })));
    };
    clip("part.bin", enc("BBBB"), 50);
    clip("part.bin", enc("AAAA"), 100);
  }
  const alikeFiles = new Blob([await alike.save()], { type: "application/pdf" });
  // A web page saved as PDF: the attachment is a link over its name.
  const web = await PDFDocument.create();
  const w1 = web.addPage([600, 800]);
  const wf = await web.embedFont(StandardFonts.Helvetica);
  const linkOver = (text, uri, y) => {
    w1.drawText(text, { x: 50, y, size: 12, font: wf });
    const c = web.context;
    w1.node.addAnnot(c.register(c.obj({ Type: "Annot", Subtype: "Link", Rect: [48, y - 3, 52 + wf.widthOfTextAtSize(text, 12), y + 12], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(uri) } })));
  };
  linkOver("Repeat Brake Judder Data Gathering.pdf", "https://xentry.mercedes-benz.com/ats/public/attachment/v1/read/download/redirect?readKey=55eea2e4-8a4c-494d-9dfb-4378ee0942cc", 700);
  linkOver("Mercedes-Benz", "https://www.mercedes-benz.com/", 650);
  linkOver("Write to us", "mailto:someone@example.com", 600);
  linkOver("Old Measurements.pdf", "https://xentry.mercedes-benz.com/ats/public/attachment/v1/read/download/redirect?readKey=deadbeef-0000-0000-0000-000000000000", 560);
  linkOver("Wiring.pdf", "https://files.example.net/docs/wiring.pdf", 520);
  const webFiles = new Blob([await web.save()], { type: "application/pdf" });
  const R = window.FDData.repos;
  await R.documents.putWithFile({ id: LI + "_1", li: LI, ver: "1", title: "Wiring diagram", filename: LI + ".pdf" }, withFiles);
  await R.documents.putWithFile({ id: LI2 + "_1", li: LI2, ver: "1", title: "No attachments", filename: LI2 + ".pdf" }, noFiles);
  await R.documents.putWithFile({ id: LI4 + "_5", li: LI4, ver: "5", title: "Repeat workshop visit", filename: LI4 + ".pdf" }, webFiles);
  await R.documents.putWithFile({ id: LI3 + "_1", li: LI3, ver: "1", title: "Look-alike attachments", filename: LI3 + ".pdf" }, alikeFiles);
}, { LI, LI2, LI3, LI4 });

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
check(await li.locator("#dAttLinks").isHidden(), "…and lists no links");

// Look-alikes: same name and size, different bytes.
await page.goto(base + "#li/" + LI3, { waitUntil: "load" });
await li.locator("#detailOverlay.show").waitFor({ timeout: 15000 });
check(await waitFor(async () => (await rows.count()) === 3), "two part.bin files with different bytes are both listed, the repeated one once, and the empty file too", await li.locator("#dAttList .att-row__name").allTextContents());
const metas = await li.locator("#dAttList .att-row", { hasText: "part.bin" }).locator(".att-row__meta").allTextContents();
check(metas.length === 2 && metas.some((m) => /attached to the document/.test(m)) && metas.some((m) => /on page 1/.test(m)), "…one from the catalogue, the other from the page", metas);
check(/0 B/.test(await row("empty.txt").locator(".att-row__meta").textContent()), "an empty file is listed as 0 B");
const [dl0] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), row("empty.txt").locator(".att-dl-btn").click()]);
const dl0Path = path.join(ROOT, "tools", "_fixtures", "att-empty.txt");
await dl0.saveAs(dl0Path);
check(dl0.suggestedFilename() === "empty.txt" && fs.statSync(dl0Path).size === 0, "…and downloads as an empty file", dl0.suggestedFilename());
fs.rmSync(dl0Path, { force: true });

// A saved web page that only links to its attachments. XENTRY's attachment
// service is stood in for: a good key answers with the file (cross-origin
// allowed, as the real service does), a bad one with its JSON error; a third
// host refuses the request outright.
const LINKED_PDF = await page.evaluate(async () => {
  const d = await PDFLib.PDFDocument.create(); d.addPage([300, 300]);
  return Array.from(await d.save());
});
await page.route("https://xentry.mercedes-benz.com/**", (route) => {
  const u = route.request().url();
  if (u.includes("readKey=55eea2e4")) return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/pdf" }, body: Buffer.from(LINKED_PDF) });
  const key = new URL(u).searchParams.get("readKey");
  return route.fulfill({ status: 400, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify({ errorInfo: { applicationName: "attachment-service", errorTitle: "Validation Error", developerMessage: `Read Key [${key}] is invalid.` }, status: 400, message: `Read Key [${key}] is invalid.` }) });
});
await page.route("https://files.example.net/**", (route) => route.abort("failed"));
await page.goto(base + "#li/" + LI4, { waitUntil: "load" });
await li.locator("#detailOverlay.show").waitFor({ timeout: 15000 });
const linkRows = li.locator("#dAttLinks .att-row");
const linkNames = async () => li.locator("#dAttLinks .att-row__name").allTextContents();
check(await waitFor(async () => (await linkRows.count()) === 3), "files the PDF only links to are listed — the web and mailto links are not", await linkNames());
check(/No files are stored inside this PDF/.test(await li.locator("#dAttList").textContent()) && (await li.locator("#dAttCount").textContent()) === "", "…and it says nothing is stored inside the PDF");
const lrow = (n) => li.locator("#dAttLinks .att-row", { hasText: n });
check((await linkNames()).includes("Repeat Brake Judder Data Gathering.pdf"), "a linked file is named by the link's text", await linkNames());
check(/linked on page 1 · xentry\.mercedes-benz\.com/.test(await lrow("Repeat Brake").locator(".att-row__meta").textContent()), "…with its page and host", await lrow("Repeat Brake").locator(".att-row__meta").textContent());
const open = lrow("Repeat Brake").locator(".att-open-btn");
check((await open.getAttribute("href")).includes("readKey=55eea2e4") && (await open.getAttribute("target")) === "_blank" && /noopener/.test(await open.getAttribute("rel")), "↗ opens the link in a new tab");

// ⬇ Get file: a good link becomes a file like the embedded ones.
await lrow("Repeat Brake").locator(".att-fetch-btn").click();
check(await waitFor(async () => (await lrow("Repeat Brake").locator(".att-view-btn").count()) === 1), "⬇ Get file fetches it and it becomes a file with View / ⬇ / ＋ Files");
check(/fetched from the link on page 1/.test(await lrow("Repeat Brake").locator(".att-row__meta").textContent()), "…marked as fetched from the link", await lrow("Repeat Brake").locator(".att-row__meta").textContent());
await lrow("Repeat Brake").locator(".att-view-btn").click();
check(await waitFor(async () => (await li.locator("#dAttView iframe").count()) === 1) && /Repeat Brake Judder/.test(await li.locator("#dAttBarName").textContent()), "…and View shows it in the preview pane");
await li.locator("#dAttBack").click();
await lrow("Repeat Brake").locator(".att-add-btn").click();
const linkedAdded = await waitFor(async () => (await vaultFiles(page)).some((f) => f.name === "Repeat Brake Judder Data Gathering.pdf"));
const lrec = (await vaultFiles(page)).find((f) => f.name === "Repeat Brake Judder Data Gathering.pdf") || {};
check(linkedAdded && (lrec.tags || []).includes(LI4) && /Linked from LI42\.10-P-078779 v5/.test(lrec.note || ""), "…and ＋ Files stores it tagged with the LI number, noted as linked from it", lrec);

// An expired XENTRY key: the server's own message, and what to do.
await lrow("Old Measurements").locator(".att-fetch-btn").click();
check(await waitFor(async () => /expired.*Read Key \[deadbeef-0000-0000-0000-000000000000\] is invalid/.test(await lrow("Old Measurements").locator(".att-row__err").textContent())), "an expired key shows XENTRY's own message and says the link has expired", await lrow("Old Measurements").locator(".att-row__err").textContent());
check((await lrow("Old Measurements").locator(".att-view-btn").count()) === 0, "…and the error page is never kept as the file");

// A server that won't serve other sites.
await lrow("Wiring.pdf").locator(".att-fetch-btn").click();
check(await waitFor(async () => /Couldn't fetch it here/.test(await lrow("Wiring.pdf").locator(".att-row__err").textContent())), "a server that refuses says to open the link and add the download instead");
check(/＋ Add files/.test(await li.locator("#dAttLinks .att-note").textContent()), "a note explains what to do when a link doesn't work");

check(errors.length === 0, "no page errors", errors);
await browser.close();
server.close();
console.log(failures === 0 ? "\nLI-ATTACHMENTS CHECKS PASSED ✅" : `\n${failures} LI-ATTACHMENTS CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
