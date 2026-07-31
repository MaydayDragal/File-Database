// Durable VaultBridge delivery regression:
//   1. an item stays recoverable until the handler promise resolves
//   2. a second item sent during a busy drain is delivered (no focus/reload)
//   3. a rejected handler retries and eventually delivers
//   4. closing a receiver mid-handle leaves the item for a new receiver
//   5. two live receivers process the same item exactly once
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./e2e-browser.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MIME = { ".html": "text/html", ".js": "text/javascript" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  let file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;
const HARNESS = base + "tools/fixtures/bridge-harness.html";
console.log("serving", base);

const browser = await launchBrowser();
// One shared context: pages must share the same origin storage partition, or
// they get separate IndexedDB + BroadcastChannel (each context is isolated).
const ctx = await browser.newContext();
let failures = 0;
const check = (c, l) => { console.log((c ? "  ✓ " : "  ✗ ") + l); if (!c) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(100); } return false; }
async function newPage(query) {
  const page = await ctx.newPage();
  await page.goto(HARNESS + query, { waitUntil: "load" });
  return { ctx, page };
}

// ---------- 1. Item stays recoverable until the handler resolves ----------
{
  const { ctx, page } = await newPage("?recv=1&lease=60000");
  await page.evaluate(() => window.__clear());
  await page.evaluate(() => { window.__cfg.delay = 400; });
  await page.evaluate(() => window.__send("A"));
  // While the 400ms handler runs, the row is still present (status processing).
  const during = await waitFor(async () => {
    const rows = await page.evaluate(() => window.__peek());
    return rows.length === 1 && rows[0].status === "processing";
  }, 2000);
  check(during, "claimed item is still stored (processing) while the handler runs");
  // After it resolves the row is gone and the file is acknowledged.
  const done = await waitFor(async () => (await page.evaluate(() => window.__processed)).includes("A"));
  check(done, "handler eventually acknowledges the item");
  const empty = await waitFor(async () => (await page.evaluate(() => window.__peek())).length === 0);
  check(empty, "acknowledged item is removed from the outbox");
  await page.close();
}

// ---------- 2. A busy drain doesn't strand a later item ----------
{
  const { ctx, page } = await newPage("?recv=1&lease=60000");
  await page.evaluate(() => window.__clear());
  await page.evaluate(() => { window.__cfg.delay = 300; window.__processed.length = 0; });
  await page.evaluate(() => window.__send("B1"));
  await sleep(80); // B1's drain is now busy handling
  await page.evaluate(() => window.__send("B2")); // arrives mid-drain
  const both = await waitFor(async () => {
    const p = await page.evaluate(() => window.__processed);
    return p.includes("B1") && p.includes("B2");
  }, 8000);
  check(both, "an item sent during a busy drain is still delivered (no focus/reload)");
  await page.close();
}

// ---------- 3. A rejected handler retries and eventually delivers ----------
{
  const { ctx, page } = await newPage("?recv=1&lease=60000");
  await page.evaluate(() => window.__clear());
  await page.evaluate(() => { window.__cfg.delay = 0; window.__cfg.failTimes = 1; window.__processed.length = 0; });
  await page.evaluate(() => window.__send("C"));
  const delivered = await waitFor(async () => (await page.evaluate(() => window.__processed)).includes("C"), 8000);
  check(delivered, "a handler that fails once retries and eventually delivers");
  const gone = await waitFor(async () => (await page.evaluate(() => window.__peek())).length === 0);
  check(gone, "the retried item is acknowledged after success");
  await page.close();
}

// ---------- 4. Closing a receiver mid-handle leaves the item for another ----------
{
  // Page A takes the item and hangs; a short lease means it expires once A is
  // gone. Page B (opened after) reclaims and delivers it.
  const a = await newPage("?recv=1&lease=800");
  await a.page.evaluate(() => window.__clear());
  await a.page.evaluate(() => { window.__cfg.hang = true; });
  await a.page.evaluate(() => window.__send("D"));
  // A claims it (row goes processing) but never settles.
  await waitFor(async () => {
    const rows = await a.page.evaluate(() => window.__peek());
    return rows.length === 1 && rows[0].status === "processing";
  }, 3000);
  await a.page.close(); // A dies mid-handle; its renewal timer stops
  const b = await newPage("?recv=1&lease=800");
  await sleep(1100); // let A's lease expire
  await b.page.evaluate(() => window.__drain()); // a nudge/focus would do this in real use
  const recovered = await waitFor(async () => (await b.page.evaluate(() => window.__processed)).includes("D"), 6000);
  check(recovered, "an item left by a crashed receiver is recovered by a new one");
  await b.page.close();
}

// ---------- 5. Two live receivers process an item exactly once ----------
{
  const a = await newPage("?recv=1&lease=60000");
  const b = await newPage("?recv=1&lease=60000");
  const sender = await newPage(""); // no receiver — only sends, so both A and B get the nudge
  await sender.page.evaluate(() => window.__clear());
  await a.page.evaluate(() => { window.__cfg.delay = 150; window.__processed.length = 0; });
  await b.page.evaluate(() => { window.__cfg.delay = 150; window.__processed.length = 0; });
  await sender.page.evaluate(() => window.__send("E"));
  await sleep(2500);
  const pa = await a.page.evaluate(() => window.__processed);
  const pb = await b.page.evaluate(() => window.__processed);
  const total = pa.filter((n) => n === "E").length + pb.filter((n) => n === "E").length;
  check(total === 1, `two live receivers process the item exactly once (A=${pa.length}, B=${pb.length})`);
  const gone = await waitFor(async () => (await sender.page.evaluate(() => window.__peek())).length === 0);
  check(gone, "the singly-processed item is removed");
  await a.page.close(); await b.page.close(); await sender.page.close();
}

await browser.close();
server.close();
console.log(failures === 0 ? "\nBRIDGE CHECKS PASSED ✅" : `\n${failures} BRIDGE CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
