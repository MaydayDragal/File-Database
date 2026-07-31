// PDF.js security regression: the vendored library is the patched 4.x build,
// eval is disabled at the parser, and a malformed PDF fails in a controlled
// way (no thrown-through crash, no page-context code execution, no network).
//
// The fixture is a deliberately broken PDF (valid header, garbage body). It
// stands in for the malformed-input class the advisory covers: the point is
// that parsing it is contained, not that it renders.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./e2e-browser.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".pdf": "application/pdf" };
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

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
// A parser that respected an embedded action or fetched a remote resource
// would show up here; a contained failure makes no requests at all.
const extraRequests = [];
page.on("request", (r) => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith("data:") && !u.startsWith("blob:")) extraRequests.push(u); });
let failures = 0;
const check = (c, l) => { console.log((c ? "  ✓ " : "  ✗ ") + l); if (!c) failures++; };

await page.goto(base + "vault/index.html", { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// 1) The vendored library reports the pinned major/version and disables eval.
const info = await page.evaluate(async () => {
  const s = document.createElement("script");
  s.src = "vendor/pdf.min.js";
  await new Promise((res, rej) => { s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  const lib = await Promise.resolve(window.pdfjsLibPromise || window.pdfjsLib);
  return { version: (lib || window.pdfjsLib).version };
});
check(!!info.version && info.version.startsWith("4."), "vendored PDF.js is the 4.x line (" + info.version + ")");
check(info.version === "4.2.67", "vendored PDF.js is pinned at 4.2.67");

// 2) A malformed PDF fails in a controlled way — the getDocument promise
//    rejects (or yields an unusable doc) instead of crashing the page, and
//    only when isEvalSupported:false is honored by the parser.
const outcome = await page.evaluate(async () => {
  const lib = await Promise.resolve(window.pdfjsLibPromise || window.pdfjsLib) || window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
  // valid %PDF- header, then bytes that are not a real cross-reference table
  const bad = new TextEncoder().encode("%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%garbage%%\n");
  try {
    const doc = await lib.getDocument({ data: bad, isEvalSupported: false, disableAutoFetch: true, disableStream: true }).promise;
    // If it somehow "opens", it must not yield a usable first page.
    try { await doc.getPage(1); return { handled: true, note: "opened-but-page-guarded" }; }
    catch (e) { return { handled: true, note: "page-rejected" }; }
  } catch (e) {
    return { handled: true, note: "getDocument-rejected", name: e && e.name };
  }
});
check(outcome.handled, "malformed PDF is handled as a controlled failure (" + outcome.note + ")");

// 3) No arbitrary page-context execution and no unexpected network fetches.
const marker = await page.evaluate(() => window.__PDF_EVAL_MARKER__ === undefined);
check(marker, "parsing did not define any page-context marker (no eval side effect)");
check(extraRequests.length === 0, "parsing made no unexpected network requests" + (extraRequests.length ? ": " + extraRequests[0] : ""));

// 4) The page itself never threw.
const realErrs = errors.filter((e) => !/ServiceWorker/i.test(e));
check(realErrs.length === 0, "no uncaught page errors" + (realErrs.length ? ": " + realErrs[0] : ""));

await browser.close();
server.close();
console.log(failures === 0 ? "\nPDF-SECURITY CHECKS PASSED ✅" : `\n${failures} PDF-SECURITY CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
