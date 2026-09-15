// End-to-end test for scanning a paper repair order into the ROs tab:
//  - parsing a dealer RO form and a DISPATCH screen into fields + lines
//  - a PDF with a text layer goes straight through (no OCR needed)
//  - the review step prefills every field and every line, then creates the RO
//  - scanning the same RO again fills gaps and adds only genuinely new lines
//  - an image is OCR'd, and a sideways scan is turned the right way up first
// The OCR engine is stubbed (the real one is a CDN download), so the suite runs
// offline; the stub asserts the orientation probe by only "reading" a page that
// has been rotated upright.
import http from "node:http";
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./e2e-browser.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".pdf": "application/pdf", ".txt": "text/plain", ".jpg": "image/jpeg" };
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

const VIN = "W1NKM4GB9SF382775";

// The dealer's printed RO, flattened the way OCR (or a PDF text layer) hands it
// over: labels and values on one row, line descriptions wrapping onto the next.
const FORM_TEXT = [
  "RBM of Alpharetta",
  "345 McFarland Pkwy",
  "Alpharetta, GA 30004",
  "Options: DLR:17114",
  "Service Advisor: JOHNSON,BRANDON S L",
  "RO No: 935943",
  "Tag No: T7910",
  "RO Open Date: 08-31-26",
  "Mileage In: 15258",
  "Complete by Time: 08-31-26 18:00",
  "Pay Method: CASH",
  "Name: Jill Blue",
  "Address: 612 CASCADE WAY",
  "City-ST-Zip: CANTON, GA 30114",
  "Home Ph:",
  "Bus Ph:",
  "Cell Ph: 678-979-7260",
  "E-mail: jillblue628@gmail.com|HOME",
  "RO # 935943 Cust # 510459 Tag # T7910",
  "Year: 25",
  "Model: MERCEDES BENZ GLC300",
  "VIN: " + VIN,
  "Color: SILVER",
  "Prod Date: UPDATE!! Stock No: SellingDlr: 17114",
  "Warr Exp : Delivery : 01-01-25 In Service : 01-01-25",
  "LINE OP CODE INSTRUCTIONS AND DESCRIPTIONS",
  "# A MPI CC (INS) COMPLIMENTARY RBM OF ALPHARETTA MULTI-POINT",
  "INSPECTION WHICH INCLUDES VIDEO",
  "# B CC RVR CUSTOMER STATES SCREEN CONTINUES TO GLITCH AFTER",
  "RECENT SERVICE; CHECK AND ADVISE",
  "# C CV CC COMPLIMENTARY COURTESY VEHICLE DURING SERVICING -",
  "CHARGE $100.00 PER DAY TO SERVICE DEPARTMENT",
  "# D CW CC PERFORM COMPLIMENTARY EXTERIOR SERVICE WASH - CHARGE",
  "$19.95 TO SERVICE DEPARTMENT",
  "TECH COPY MOBILE SHOP COPY",
].join("\n");

// The green-screen DISPATCH print-out, with a note stuck under it.
const DISPATCH_TEXT = [
  "D I S P A T C H",
  "ESTIMATE: 245.00",
  "TAG:T7095 NAME: BURDETT,CARL SA: 5582 MAKE: M STATUS: AVL/VEH. DISABLE",
  "1) LOT LOC: PROMISED:17AUG26 1800 EST COMP:29AUG26 1012 P: 8999",
  "2) SDLR: Y APPT: N WAIT: N SPEC: N RENT: N VEH:26 E53E LIC: MI:1499",
  "3) RO: 934687 REMARKS:",
  "LC SKILL ST DESCRIPTION.. TECH... EST ACT LEFT STATUS.....CHG'D CBK HLD",
  "(A) (BC)(D) (E) (F) AT TME",
  "4) A P110 3R MPI-RBM OF AL 5401 0.2 PREASSIGNE 11:00",
  "5) B P110 3R CUSTOMER STAT 5401 1.0 5.5 -4.5 TECH HOLD 11:00 0.0",
  "6) C S181 7R COMPLIMENTARY 0.8 OPENED 10:42",
  "7) D S19 7M CLIENT DECLIN 0.5 OPENED 10:42",
  "END OF DISPLAY",
  "COMMAND:",
  "MBUX Display Goes Blank at times. Data line fault case?",
].join("\n");

// --- fixtures -------------------------------------------------------------
const FIX = path.join(__dirname, "_fixtures");
fs.mkdirSync(FIX, { recursive: true });

// A minimal one-page PDF whose text layer is the RO, one Td-positioned row per
// line so the page reads back as rows (which is how a real RO is laid out).
function buildPdf(text) {
  const rows = text.split("\n");
  const esc = (s) => s.replace(/[\\()]/g, (c) => "\\" + c);
  let y = 20 + rows.length * 14;
  const stream = ["BT /F1 9 Tf"]
    .concat(rows.map((r) => `1 0 0 1 24 ${(y -= 14)} Tm (${esc(r)}) Tj`))
    .concat(["ET"]).join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 ${40 + rows.length * 14}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const off = [];
  objs.forEach((o, i) => { off[i] = pdf.length; pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  off.forEach((o) => { pdf += String(o).padStart(10, "0") + " 00000 n \n"; });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}
const pdfPath = path.join(FIX, "ro-935943.pdf");
fs.writeFileSync(pdfPath, buildPdf(FORM_TEXT));

// A landscape photo stands in for an RO fed through the scanner on its side;
// the stubbed engine only "reads" it once the page has been rotated upright.
function buildPng(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h, 0xff);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;       // filter byte per scanline
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;  // 8-bit truecolour
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const pngPath = path.join(FIX, "ro-photo-sideways.png");
fs.writeFileSync(pngPath, buildPng(900, 600));

// --- browser --------------------------------------------------------------
const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
let failures = 0;
const check = (c, l, extra) => { console.log((c ? "  ✓ " : "  ✗ ") + l + (c || extra === undefined ? "" : " — got " + JSON.stringify(extra))); if (!c) failures++; };
const waitFor = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(120); } return false; };

// Stub the OCR engine: it returns the RO text only for a canvas that is taller
// than it is wide, i.e. only once the sideways photo has been turned upright.
await page.addInitScript((roText) => {
  window.__ocrCalls = [];
  window.Tesseract = {
    createWorker: function () {
      return Promise.resolve({
        recognize: function (canvas) {
          const upright = canvas.height > canvas.width;
          window.__ocrCalls.push({ w: canvas.width, h: canvas.height, upright: upright });
          return Promise.resolve({ data: { text: upright ? roText : "mmm wvvv nnnn" } });
        },
        terminate: function () { window.__ocrTerminated = (window.__ocrTerminated || 0) + 1; return Promise.resolve(); },
      });
    },
  };
}, FORM_TEXT);

await page.goto(base + "ros/index.html", { waitUntil: "load" });
await page.waitForTimeout(400);

// ---------- Phase A: the parser ----------
const form = await page.evaluate((t) => window.__ros.parseScan(t), FORM_TEXT);
check(form.ro === "935943", "dealer RO: reads the RO number", form.ro);
check(form.tag === "T7910", "dealer RO: reads the tag", form.tag);
check(form.vin === VIN, "dealer RO: reads the VIN", form.vin);
check(form.vehicle === "2025 GLC300", "dealer RO: reads year + model (2-digit year expanded)", form.vehicle);
check(form.color === "Silver", "dealer RO: reads the colour", form.color);
check(form.mileage === "15258", "dealer RO: reads mileage in", form.mileage);
check(form.opened === "08-31-26", "dealer RO: reads the open date", form.opened);
check(form.customer === "Jill Blue", "dealer RO: reads the customer", form.customer);
check(form.advisor === "Johnson, Brandon S L", "dealer RO: reads the service advisor", form.advisor);
check(form.phone === "678-979-7260", "dealer RO: reads the phone number", form.phone);
check(form.email === "jillblue628@gmail.com", "dealer RO: reads the e-mail", form.email);
check(form.lines.length === 4, "dealer RO: finds all four lines", form.lines.length);
check(form.lines.map((l) => l.op).join("|") === "MPI||CV|CW", "dealer RO: splits the op code off each line", form.lines.map((l) => l.op));
check(/^\(INS\) COMPLIMENTARY RBM OF ALPHARETTA MULTI-POINT INSPECTION WHICH INCLUDES VIDEO$/.test(form.lines[0].text), "dealer RO: line A joins its wrapped description", form.lines[0].text);
check(form.lines[1].text === "RVR CUSTOMER STATES SCREEN CONTINUES TO GLITCH AFTER RECENT SERVICE; CHECK AND ADVISE", "dealer RO: line B keeps the whole customer complaint", form.lines[1].text);
check(form.lines[2].text === "COMPLIMENTARY COURTESY VEHICLE DURING SERVICING - CHARGE $100.00 PER DAY TO SERVICE DEPARTMENT", "dealer RO: a dash at a line break is not treated as a split word", form.lines[2].text);
check(!/TECH COPY/i.test(form.lines[3].text), "dealer RO: page footers stay out of the lines", form.lines[3].text);

const disp = await page.evaluate((t) => window.__ros.parseScan(t), DISPATCH_TEXT);
check(disp.source === "dispatch", "dispatch: recognised as a dispatch screen", disp.source);
check(disp.ro === "934687", "dispatch: reads the RO number", disp.ro);
check(disp.tag === "T7095", "dispatch: reads the tag", disp.tag);
check(disp.customer === "Burdett, Carl", "dispatch: reads the customer", disp.customer);
check(disp.advisor === "5582", "dispatch: reads the advisor number", disp.advisor);
check(disp.vehicle === "2026 E53E", "dispatch: reads the vehicle", disp.vehicle);
check(disp.mileage === "1499", "dispatch: reads the mileage", disp.mileage);
check(disp.lines.map((l) => l.text).join("|") === "MPI-RBM OF AL|CUSTOMER STAT|COMPLIMENTARY|CLIENT DECLIN", "dispatch: reads all four lines without their number columns", disp.lines.map((l) => l.text));
check(/MBUX Display Goes Blank/.test(disp.note), "dispatch: keeps the note written under the print-out", disp.note);

// ---------- Phase B: a PDF with a text layer goes straight to review ----------
await page.click("#scan-btn");
check(await page.locator("#scan-modal.show").count() === 1, "the scan window opens");
await page.setInputFiles("#scan-input", pdfPath);
check(await waitFor(async () => (await page.locator("#scan-review:not([hidden])").count()) === 1), "a PDF with a text layer reaches the review step");
check((await page.evaluate(() => window.__ocrCalls.length)) === 0, "a PDF that already has text is never sent to OCR");
check((await page.inputValue("#rv-ro")) === "935943", "review: RO number is filled in");
check((await page.inputValue("#rv-vin")) === VIN, "review: VIN is filled in");
check((await page.inputValue("#rv-vehicle")) === "2025 GLC300", "review: vehicle is filled in");
check((await page.inputValue("#rv-customer")) === "Jill Blue", "review: customer is filled in");
check((await page.locator("#rv-lines .rv-line").count()) === 4, "review: all four lines are listed");
check((await page.locator("#rv-dupe:not([hidden])").count()) === 0, "review: no duplicate warning for a new RO");

// Drop line D before creating — the review is the place to change your mind.
await page.locator("#rv-lines .rv-line .btn--danger").nth(3).click();
await page.click("#rv-create");
check(await waitFor(async () => (await page.evaluate(() => window.__ros.count())) === 1), "creating the repair order from the scan");
await page.waitForTimeout(400);
check((await page.inputValue("#ro-no")) === "935943", "the new RO opens with its number");
check((await page.inputValue("#ro-vin")) === VIN, "the new RO carries the VIN");
check((await page.inputValue("#ro-vehicle")) === "2025 GLC300", "the new RO carries the vehicle");
check((await page.inputValue("#ro-tag")) === "T7910", "the new RO carries the tag");
check((await page.inputValue("#ro-mileage")) === "15258", "the new RO carries the mileage");
check((await page.inputValue("#ro-customer")) === "Jill Blue", "the new RO carries the customer");
check((await page.inputValue("#ro-advisor")) === "Johnson, Brandon S L", "the new RO carries the advisor");
check((await page.inputValue("#ro-phone")) === "678-979-7260", "the new RO carries the phone number");
check((await page.inputValue("#ro-email")) === "jillblue628@gmail.com", "the new RO carries the e-mail");
check((await page.inputValue("#ro-color")) === "Silver", "the new RO carries the colour");
const lineTexts = await page.locator("#lines textarea").all().then((ts) => Promise.all(ts.map((t) => t.inputValue())));
check(lineTexts.length === 3, "the three kept lines are on the RO", lineTexts.length);
check(/CUSTOMER STATES SCREEN CONTINUES TO GLITCH/.test(lineTexts[1] || ""), "line B is the customer's complaint, in full");
const ops = await page.locator("#lines .line__op").all().then((os) => Promise.all(os.map((o) => o.inputValue())));
check(ops.join("|") === "MPI||CV", "op codes came across with the lines", ops);

// Persistence: everything the scan filled in survives a reload.
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(500);
check((await page.inputValue("#ro-customer")) === "Jill Blue", "scanned details persist across a reload");
check((await page.locator("#lines textarea").count()) === 3, "scanned lines persist across a reload");

// ---------- Phase C: scanning the same RO again tops it up ----------
await page.fill("#ro-customer", "");            // a field someone cleared…
await page.waitForTimeout(700);
await page.click("#scan-btn");
await page.setInputFiles("#scan-input", pdfPath);
check(await waitFor(async () => (await page.locator("#rv-dupe:not([hidden])").count()) === 1), "review: a second scan of the same RO warns that it already exists");
check(/Update RO 935943/.test(await page.locator("#rv-create").textContent()), "review: the button offers to update rather than duplicate");
await page.click("#rv-create");
await page.waitForTimeout(600);
check((await page.evaluate(() => window.__ros.count())) === 1, "the second scan did not create a second RO");
check((await page.inputValue("#ro-customer")) === "Jill Blue", "the second scan filled the gap back in");
check((await page.locator("#lines textarea").count()) === 4, "only the line that was missing got added back", await page.locator("#lines textarea").count());

// ---------- Phase D: a sideways photo is turned upright and OCR'd ----------
await page.evaluate(() => { window.__ocrCalls = []; });
await page.click("#scan-btn");
await page.setInputFiles("#scan-input", pngPath);
check(await waitFor(async () => (await page.locator("#scan-review:not([hidden])").count()) === 1), "an image is read by the OCR engine");
const calls = await page.evaluate(() => window.__ocrCalls);
check(calls.length > 1, "the scan is probed for which way up it is", calls.length);
check(calls[calls.length - 1].upright, "the page it finally reads is the one turned upright", calls[calls.length - 1]);
check((await page.evaluate(() => window.__ocrTerminated || 0)) >= 1, "the OCR worker is shut down when the read finishes");
check((await page.inputValue("#rv-ro")) === "935943", "the OCR'd photo fills the review in too");
await page.keyboard.press("Escape");
check(await waitFor(async () => (await page.locator("#scan-modal.show").count()) === 0), "Escape closes the scan window");

console.log(errors.length ? "\nErrors:\n" + errors.join("\n") : "\nNo page errors.");
check(errors.length === 0, "no page errors");

await browser.close();
server.close();
console.log(failures === 0 ? "\nRO SCAN CHECKS PASSED ✅" : `\n${failures} RO SCAN CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
