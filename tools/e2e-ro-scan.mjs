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

// A REAL read of that form, copied verbatim from a 300 dpi scan of the printed
// RO. This is what OCR actually hands over, and every way it differs from the
// tidy version above is a defect the parser has to survive: the two columns of
// the form flattened into each other, "Tag #T7910" read as "Tag #17910", the
// Year and Model labels lost entirely, "Color:" reduced to a "*", a digit
// clipped off the phone number, and the "# B"/"# C"/"# D" cells turned to noise.
const REAL_SCAN = [
  "RBM",
  "",
  "Options: RO # 935943 éN",
  "es Cust # 510459",
  "",
  "Tag #17910 Mercedes-Benz",
  "",
  "of ALPHARETTA",
  "",
  "345 McFarland Pkwy",
  "Alpharetta, GA 30004",
  "",
  "Service Advisor:",
  "",
  "JOHNSON, BRANDON S L Name: : 25",
  "Jill Blue : MERCEDES BENZ GLC300",
  "",
  "TRONo: 935943 Address: 12 CASCADE WAY * WINKM4GB9SF382775",
  "Tag No: T7910 City-ST-Zip: CANTON, GA 30114 * SILVER",
  "RO Open Date: 08-31-26 Home Ph:",
  "Mileage In: 15258 Bus Ph: Prod Date: ppATE!",
  "Complete by Time: (08-31-26 18:00 Cell Ph: 78 979-7260 Mibanr Exp § Stock No:",
  "",
  "wary 01-05-95 hiiGiDiR",
  "Pay Method: CASH E-mail: jillblue628@gmail.com| HOME Delivery ¢ selinglic {71s",
  "In Service : 01-01-25",
  "",
  "ESTIMATE AND AUTHORIZATION | | INE | OP CODE INSTRUCTIONS AND DESCRIPTIONS",
  "",
  "Original Estimate: # A | MPI (INS) COMPLIMENTARY RBM OF ALPHARETTA MULTI-POINT",
  "Client Advised of Completion ~~ INSPECTION WHICH INCLUDES VIDEO",
  "",
  "ph pn Ya RVR CUSTOMER STATES SCREEN CONTINUES TO GLITCH AFTER",
  "",
  "to be done along with the necessary RECENT SERVICE; CHECK AND ADVISE",
  "",
  "materials. I agree that RBM is not",
  "",
  "responsible for loss or damage to vehicle",
  "",
  "i sat tbc I HE COMPLIMENTARY COURTESY VEHICLE DURING SERVICING -",
  "",
  "¥ ie HERRON 4 200 eS0OTAIR Bray CHARGE $100.00 PER DAY TO SERVICE DEPARTMENT",
  "",
  "loss due to delays in returning my vehicle",
  "",
  "lieing] 0 fadibfaiis Riot, 888 | 0 PERFORM COMPLIMENTARY EXTERIOR SERVICE WASH - CHARGH",
  "",
  "roadtesting and/or inspection. An express = 19.95 TO SERVICE DEPARTMENT",
  "",
  "repairs of this work order.",
  "MOBILE SHOP COPY",
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

// A scripted OCR engine stands in for the real one (which is a CDN download).
// It plays a page that was fed through the scanner sideways: the which-way-up
// probe — which runs in single-block mode, so every recognize() carries the
// mode in force — only reads well on its third rotation (270°), and the read
// that follows returns the repair order. ocr.js's own decisions are covered
// directly in e2e-ocr-orient.mjs; this is the app wired to them.
await page.addInitScript((roText) => {
  window.__ocrCalls = [];
  const words = (n, conf) => Array.from({ length: n }, (_, i) => ({ text: "w" + i, confidence: conf }));
  window.Tesseract = {
    createWorker: function () {
      let psm = null;
      return Promise.resolve({
        setParameters: function (p) { psm = String(p.tessedit_pageseg_mode); return Promise.resolve(); },
        recognize: function (canvas) {
          const probe = psm === "6";
          const probeIndex = probe ? window.__ocrCalls.filter((c) => c.probe).length + 1 : 0;
          window.__ocrCalls.push({ psm: psm, probe: probe, probeIndex: probeIndex, w: canvas.width, h: canvas.height });
          const good = probe ? (probeIndex === 3 ? 60 : 1) : 60;
          const conf = probe ? (probeIndex === 3 ? 88 : 22) : 90;
          return Promise.resolve({ data: { text: probe ? "" : roText, confidence: conf, words: words(good, Math.max(60, conf)) } });
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

// ---------- Phase A2: the same form as OCR really reads it ----------
const real = await page.evaluate((t) => window.__ros.parseScan(t), REAL_SCAN);
check(real.ro === "935943", "real scan: RO number", real.ro);
check(real.tag === "T7910", "real scan: the tag that looks like a tag wins over the mangled one", real.tag);
check(real.vin === VIN, "real scan: VIN, with OCR's I-for-1 corrected", real.vin);
check(real.vehicle === "2025 GLC300", "real scan: vehicle, with the year taken from the VIN when the Year cell is lost", real.vehicle);
check(real.color === "Silver", "real scan: colour found by name when its label is lost — and not from “Jill Blue”", real.color);
check(real.mileage === "15258", "real scan: mileage", real.mileage);
check(real.opened === "08-31-26", "real scan: open date", real.opened);
check(real.advisor === "Johnson, Brandon S L", "real scan: advisor, cut off the next field on the same row", real.advisor);
check(real.customer === "Jill Blue", "real scan: customer, taken from the row below its own empty cell", real.customer);
check(real.phone === "78-979-7260", "real scan: the clipped phone number is shown rather than dropped", real.phone);
check(real.email === "jillblue628@gmail.com", "real scan: e-mail", real.email);
check(real.lines.length >= 4, "real scan: the flat text still yields the line descriptions", real.lines.length);
check(real.lines.some((l) => /CUSTOMER STATES SCREEN CONTINUES TO GLITCH/.test(l.text)), "real scan: the customer's complaint survives", real.lines.map((l) => l.text));
check(!real.lines.some((l) => /hereby authorize|responsible for loss/i.test(l.text)), "real scan: the legal small print stays out of the lines", real.lines.map((l) => l.text));

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

// ---------- Phase A3: the line table read from where things sat on the page ----------
// Two columns, as the form really prints: legal small print on the left, the
// line table on the right, and the engine reading each table row as one line.
const laid = await page.evaluate(() => {
  // Rows carry their words, because that is what the engine returns and what
  // makes a two-column row cuttable.
  const row = (text, x0, y0, w, h) => {
    const parts = text.split(" ");
    let x = x0;
    const words = parts.map((t) => { const wx = x; x += t.length * 11 + 8; return { text: t, x0: wx, x1: x - 8, conf: 90 }; });
    return { text, x0, y0, x1: x0 + w, y1: y0 + h, words };
  };
  // One row holding the legal column, the LINE/OP cells and the description.
  const merged = (legal, lx, mid, mx, desc, dx, y0, h, midConf) => {
    const words = [];
    const run = (s, from, conf) => { let x = from; s.split(" ").filter(Boolean).forEach((t) => { words.push({ text: t, x0: x, x1: x + t.length * 11, conf }); x += t.length * 11 + 8; }); return x; };
    run(legal, lx, 85);
    run(mid, mx, midConf == null ? 92 : midConf);
    const end = run(desc, dx, 90);
    const text = [legal, mid, desc].filter(Boolean).join(" ");
    return { text, x0: lx, y0, x1: end, y1: y0 + h, words };
  };
  return window.__ros.layoutLines([
    row("ESTIMATE AND AUTHORIZATION", 80, 500, 300, 18),
    // The heading is centred over a wide column: "INSTRUCTIONS" starts at 1483,
    // far right of where the descriptions actually begin.
    { text: "LINE OP CODE INSTRUCTIONS AND DESCRIPTIONS", x0: 630, y0: 529, x1: 1877, y1: 545, words: [
      { text: "LINE", x0: 630, x1: 678 }, { text: "OP", x0: 748, x1: 779 }, { text: "CODE", x0: 787, x1: 847 },
      { text: "INSTRUCTIONS", x0: 1483, x1: 1648 }, { text: "AND", x0: 1656, x1: 1705 }, { text: "DESCRIPTIONS", x0: 1714, x1: 1877 },
    ] },
    // Rows the engine merged ACROSS the two columns — the legal small print, the
    // LINE and OP CODE cells and the description all in one row, which is what
    // a real scan of this form comes back as.
    merged("Original Estimate:", 81, "# A | MPI", 602, "(INS) COMPLIMENTARY RBM OF ALPHARETTA MULTI-POINT", 900, 572, 19),
    merged("Client Advised of Completion ~~", 81, "", 0, "INSPECTION WHICH INCLUDES VIDEO", 900, 600, 16),
    row("I hereby authorize the repair work set forth to be done", 81, 624, 560, 17),
    merged("materials. I agree that RBM is not", 81, "# B", 602, "RVR CUSTOMER STATES SCREEN CONTINUES TO GLITCH AFTER", 900, 644, 19),
    merged("responsible for loss or damage to vehicle", 81, "", 0, "RECENT SERVICE; CHECK AND ADVISE", 900, 672, 16),
    row("or articles in the vehicle due to fire, theft,", 81, 696, 560, 17),
    merged("i sat tbc I HE", 81, "# C | CV", 602, "COMPLIMENTARY COURTESY VEHICLE DURING SERVICING -", 900, 716, 19),
    merged("loss due to delays in returning my vehicle", 81, "", 0, "CHARGE $100.00 PER DAY TO SERVICE DEPARTMENT", 900, 744, 16),
    row("to me by the time specified. I authorize", 81, 768, 560, 17),
    merged("lieing] 0 fadibfaiis Riot, 888", 81, "# D | CW", 602, "PERFORM COMPLIMENTARY EXTERIOR SERVICE WASH - CHARGE", 900, 788, 19),
    merged("roadtesting and/or inspection. An express =", 81, "", 0, "$19.95 TO SERVICE DEPARTMENT", 900, 816, 16),
    row("mechanic's lien is hereby acknowledged on this vehicle", 81, 840, 560, 17),
    row("TECH COPY MOBILE SHOP COPY", 80, 1003, 400, 13),
  ]);
});
check(laid.length === 4, "layout: four lines, one per table row, out of rows that merged the columns", laid.length);
check(laid.map((l) => l.op).join("|") === "MPI||CV|CW", "layout: the op code is read from the cell beside the description", laid.map((l) => l.op));
check(laid[0].text === "(INS) COMPLIMENTARY RBM OF ALPHARETTA MULTI-POINT INSPECTION WHICH INCLUDES VIDEO",
  "layout: a wrapped description is joined to the row it belongs to", laid[0].text);
check(laid[1].text === "RVR CUSTOMER STATES SCREEN CONTINUES TO GLITCH AFTER RECENT SERVICE; CHECK AND ADVISE",
  "layout: the line with no op code keeps its whole description", laid[1].text);
check(!laid.some((l) => /hereby authorize|responsible for loss|TECH COPY/i.test(l.text)),
  "layout: the neighbouring column of small print is left out entirely", laid.map((l) => l.text));

// The same table, but with the LINE and OP CODE cells read as the noise a real
// scan produces — "ph pn Ya", "i sat tbc I HE", "lieing] 0 fadibfaiis Riot, 888".
// A wrong op code is worse than none, so those must come back empty while the
// descriptions still arrive intact.
const noisy = await page.evaluate(() => {
  const merged = (legal, lx, mid, mx, desc, dx, y0, h, midConf) => {
    const words = [];
    const run = (s, from, conf) => { let x = from; s.split(" ").filter(Boolean).forEach((t) => { words.push({ text: t, x0: x, x1: x + t.length * 11, conf }); x += t.length * 11 + 8; }); return x; };
    run(legal, lx, 85);
    run(mid, mx, midConf == null ? 92 : midConf);
    const end = run(desc, dx, 90);
    return { text: [legal, mid, desc].filter(Boolean).join(" "), x0: lx, y0, x1: end, y1: y0 + h, words };
  };
  return window.__ros.layoutLines([
    { text: "LINE OP CODE INSTRUCTIONS AND DESCRIPTIONS", x0: 630, y0: 529, x1: 1877, y1: 545, words: [
      { text: "LINE", x0: 630, x1: 678, conf: 95 }, { text: "OP", x0: 748, x1: 779, conf: 95 }, { text: "CODE", x0: 787, x1: 847, conf: 95 },
      { text: "INSTRUCTIONS", x0: 1483, x1: 1648, conf: 95 }, { text: "AND", x0: 1656, x1: 1705, conf: 95 }, { text: "DESCRIPTIONS", x0: 1714, x1: 1877, conf: 95 },
    ] },
    merged("Original Estimate:", 81, "# A MPI", 602, "(INS) COMPLIMENTARY RBM OF ALPHARETTA MULTI-POINT", 900, 572, 19),
    merged("Client Advised of Completion", 81, "", 0, "INSPECTION WHICH INCLUDES VIDEO", 900, 600, 16),
    merged("ph pn", 81, "Ya", 700, "RVR CUSTOMER STATES SCREEN CONTINUES TO GLITCH AFTER", 900, 644, 19, 46),
    merged("materials. I agree", 81, "", 0, "RECENT SERVICE; CHECK AND ADVISE", 900, 672, 16),
    merged("i sat tbc", 81, "I HE", 690, "COMPLIMENTARY COURTESY VEHICLE DURING SERVICING -", 900, 716, 19, 51),
    merged("loss due to delays", 81, "", 0, "CHARGE $100.00 PER DAY TO SERVICE DEPARTMENT", 900, 744, 16),
    merged("lieing] 0", 81, "fadibfaiis Riot, 888", 640, "PERFORM COMPLIMENTARY EXTERIOR SERVICE WASH - CHARGE", 900, 788, 19, 38),
    merged("roadtesting and/or", 81, "", 0, "$19.95 TO SERVICE DEPARTMENT", 900, 816, 16),
  ]);
});
check(noisy.length === 4, "noisy op cells: the four descriptions still come through", noisy.length);
check(noisy.map((l) => l.op).join("|") === "MPI|||", "noisy op cells: an unreadable op code is left blank, never guessed", noisy.map((l) => l.op));
check(/^RVR CUSTOMER STATES SCREEN CONTINUES TO GLITCH AFTER RECENT SERVICE/.test(noisy[1].text),
  "noisy op cells: the noise stays out of the description too", noisy[1].text);

// A second real form, where the engine read the heading row as "INSTRUCTIONS AND
// DESCRIPTIONS" alone — no LINE or OP CODE beside it. That heading is CENTRED
// over its column, so its own left edge sits a word or two inside every
// description; taking it as the column edge ate the first word of every row
// ("COMPLIMENTARY RBM…" became "RBM…"). With nothing to the left of the heading
// to measure from, the descriptions are found by the other thing that separates
// the two columns: the table SHOUTS and the small print does not.
const centred = await page.evaluate(() => {
  const row = (text, x0, y0, w, h) => {
    let x = x0;
    const words = text.split(" ").filter(Boolean).map((t) => { const wx = x; x += t.length * 11 + 8; return { text: t, x0: wx, x1: x - 8, conf: 88 }; });
    return { text, x0, y0, x1: x0 + w, y1: y0 + h, words };
  };
  return window.__ros.layoutLines([
    // Centred heading, and nothing read to the left of it.
    row("INSTRUCTIONS AND DESCRIPTIONS", 1100, 500, 420, 16),
    row("Original Estimate: 0. oo afar dl 7 O00 Tl a HE mer eR CUSTOMER STATES THAT THE BATTERY WARNING", 81, 560, 1800, 18),
    row("Client Advised of Completion ~~~ LIGHT WAS ON 12 VOLT CRITICAL", 81, 586, 1800, 18),
    row("I hereby authorize the repair work set forth", 81, 620, 560, 17),
    row("CUSTOMER STATES THAT THE ENGINE LIGHT WAS ON, OFF", 640, 646, 1200, 18),
    row("NOW", 640, 672, 90, 16),
    row("materials. I agree that RBM is not", 81, 700, 560, 17),
    row("COMPLIMENTARY RBM OF ALPHARETTA MULTI-POINT", 640, 726, 1200, 18),
    row("INSPECTION WHICH INCLUDES VIDEO", 640, 752, 800, 16),
    row("or articles in the vehicle due to fire, theft,", 81, 780, 560, 17),
    // The engine split "CHARGE" off the end of this row into a fragment of its
    // own, and returned it first — it sits at the same height, further right.
    row("CHARGH", 1850, 804, 90, 17),
    row("PERFORM COMPLIMENTARY EXTERIOR SERVICE WASH -", 640, 806, 1300, 18),
    row("$19.95 TO SERVICE DEPARTMENT", 640, 832, 700, 16),
  ]);
});
check(centred.length === 4, "centred heading: one line per table row", centred.length);
check(centred[0].text === "CUSTOMER STATES THAT THE BATTERY WARNING LIGHT WAS ON 12 VOLT CRITICAL",
  "centred heading: the description keeps its first word, and the noise in front of it is dropped", centred[0].text);
check(centred[1].text === "CUSTOMER STATES THAT THE ENGINE LIGHT WAS ON, OFF NOW",
  "centred heading: a one-word continuation row is kept", centred[1].text);
check(centred[2].text === "COMPLIMENTARY RBM OF ALPHARETTA MULTI-POINT INSPECTION WHICH INCLUDES VIDEO",
  "centred heading: no first word is eaten off either row", centred[2].text);
check(!centred.some((l) => /hereby authorize|materials\. I agree|or articles/i.test(l.text)),
  "centred heading: the small print beside the table stays out", centred.map((l) => l.text));
check(centred[3].text === "PERFORM COMPLIMENTARY EXTERIOR SERVICE WASH - CHARGH $19.95 TO SERVICE DEPARTMENT",
  "a word split off the end of a row goes back where it was read, not in front", centred[3].text);

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
const scan = await page.evaluate(() => window.__ros.lastScan);
check(calls.some((c) => c.probe), "the scan is probed for which way up it is", calls.map((c) => c.psm));
check(scan && scan.angle === 270, "the rotation the engine could read is the one used", scan);
check(calls.filter((c) => c.probe).length === 3, "probing stops as soon as a rotation reads well", calls.filter((c) => c.probe).length);
check(calls[calls.length - 1].psm === "3", "the page itself is read in document mode, not the engine's one-block default", calls[calls.length - 1]);
check((await page.evaluate(() => window.__ocrTerminated || 0)) >= 1, "the OCR worker is shut down when the read finishes");
check((await page.inputValue("#rv-ro")) === "935943", "the sideways photo fills the review in as if it had been the right way up");
await page.keyboard.press("Escape");
check(await waitFor(async () => (await page.locator("#scan-modal.show").count()) === 0), "Escape closes the scan window");

console.log(errors.length ? "\nErrors:\n" + errors.join("\n") : "\nNo page errors.");
check(errors.length === 0, "no page errors");

await browser.close();
server.close();
console.log(failures === 0 ? "\nRO SCAN CHECKS PASSED ✅" : `\n${failures} RO SCAN CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
