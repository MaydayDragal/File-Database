// End-to-end test for viewer.html — the standalone Database File Viewer that
// turns .fvault / .lidb / .tidb backups back into normal files. The "Download
// all" ZIP is validated with Python's zipfile (an independent implementation).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchBrowser, launchPersistent } from "./e2e-browser.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIX = path.join(ROOT, "tools", "_fixtures");
fs.mkdirSync(FIX, { recursive: true });

// ---------- fixture: .fvault (binary v2) ----------
function buildFvault() {
  const files = [
    { name: "report.pdf", type: "application/pdf", collection: "Jobs", bytes: Buffer.from("%PDF-1.4 fake report") },
    { name: "notes.txt", type: "text/plain", collection: "", bytes: Buffer.from("hello vault") },
  ];
  const meta = {
    format: "file-vault", version: 2, exportedAt: 0,
    files: files.map((f) => ({
      id: f.name, name: f.name, type: f.type, kind: "other", size: f.bytes.length,
      tags: [], collection: f.collection, note: "", starred: false,
      blobType: f.type, blobLen: f.bytes.length, thumbType: null, thumbLen: 0,
    })),
  };
  const metaBytes = Buffer.from(JSON.stringify(meta));
  const header = Buffer.alloc(12);
  header.write("FVLT", 0, "ascii"); header.writeUInt32LE(2, 4); header.writeUInt32LE(metaBytes.length, 8);
  fs.writeFileSync(path.join(FIX, "viewer.fvault"), Buffer.concat([header, metaBytes, ...files.map((f) => f.bytes)]));
  return files;
}

// ---------- fixture: .tidb ----------
function buildTidb() {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
  const meta = {
    format: "tool-inventory-db", version: 1, exportedAt: 0, source: "fixture", updated: "",
    tools: [
      { id: "t1", toolNo: "111 111 00 00 00", desc: "Wrench, special", svcGrp: "54", price: 10, photo: "p1" },
      { id: "t2", toolNo: "222 222 00 00 00", desc: "Gauge", svcGrp: "07", price: 20, photo: "" },
    ],
    photos: [{ id: "p1", len: png.length }],
  };
  const metaBytes = Buffer.from(JSON.stringify(meta));
  const header = Buffer.alloc(12);
  header.write("TIDB", 0, "ascii"); header.writeUInt32LE(1, 4); header.writeUInt32LE(metaBytes.length, 8);
  fs.writeFileSync(path.join(FIX, "viewer.tidb"), Buffer.concat([header, metaBytes, png]));
}

// ---------- fixture: .lidb (STORE zip via python, like the LI app's JSZip STORE) ----------
function buildLidb() {
  const longTitle = "Transmission in limp-home mode, fault message in IC Gear Change to R Not Possible ! MODEL 177, 118, 247 with ENGINE M260 and TRANSMISSION 724.0 (except model designations 118.351, 118.651, 177.051, 177.151, 177.951)";
  const script = `
import json, zipfile, sys
p = sys.argv[1]
man = {"v": 1, "docs": [{"id": "LI54.10-P-070001_2", "li": "LI54.10-P-070001", "ver": "2",
        "title": "Brake procedure", "filename": "orig.pdf", "fname": "doc1.pdf"},
       {"id": "LI27.60-P-071321_4", "li": "LI27.60-P-071321", "ver": "4",
        "title": ${JSON.stringify(longTitle)}, "filename": "orig2.pdf", "fname": "doc2.pdf"}]}
with zipfile.ZipFile(p, "w", zipfile.ZIP_STORED) as z:
    z.writestr("manifest.json", json.dumps(man))
    z.writestr("files/doc1.pdf", "%PDF-1.4 fake LI doc")
    z.writestr("files/doc2.pdf", "%PDF-1.4 long title doc")
`;
  execFileSync("python3", ["-c", script, path.join(FIX, "viewer.lidb")]);
}

const fvaultFiles = buildFvault();
buildTidb();
buildLidb();

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  let file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;
console.log("serving", base);

const browser = await launchBrowser();
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
let failures = 0;
const check = (c, l) => { console.log((c ? "  ✓ " : "  ✗ ") + l); if (!c) failures++; };

const zipList = (zp) => execFileSync("python3", ["-c", `
import zipfile, sys, json
z = zipfile.ZipFile(sys.argv[1])
bad = z.testzip()
print(json.dumps({"bad": bad, "names": sorted(z.namelist()),
  "first": z.read(sorted(z.namelist())[0]).decode("utf-8", "replace")[:40]}))
`, zp]).toString();

await page.goto(base + "viewer.html", { waitUntil: "networkidle" });

// ---------- .fvault ----------
await page.setInputFiles("#pick", path.join(FIX, "viewer.fvault"));
await page.waitForTimeout(500);
check((await page.locator("#kindLabel").textContent()).includes("File Vault"), "recognizes a .fvault backup");
check((await page.locator("#rows tr").count()) === 2, "lists both vault files");
check((await page.locator("#rows").textContent()).includes("Jobs/report.pdf"), "collection becomes a folder in the listing");
let [dl] = await Promise.all([page.waitForEvent("download"), page.click("#zipBtn")]);
const fvZip = path.join(FIX, "fvault-out.zip");
await dl.saveAs(fvZip);
let r = JSON.parse(zipList(fvZip));
check(r.bad === null, "fvault ZIP passes python zipfile CRC validation");
check(JSON.stringify(r.names) === JSON.stringify(["Jobs/report.pdf", "notes.txt"]), `ZIP contains the expected paths (${r.names.join(", ")})`);
check(r.first.startsWith("%PDF-1.4 fake report"), "extracted bytes match the original file");

// ---------- .tidb ----------
await page.click("#resetBtn");
await page.setInputFiles("#pick", path.join(FIX, "viewer.tidb"));
await page.waitForTimeout(500);
check((await page.locator("#kindLabel").textContent()).includes("Tool Inventory"), "recognizes a .tidb database");
check((await page.locator("#rows tr").count()) === 3, "lists tools.csv + tools.json + the photo");
[dl] = await Promise.all([page.waitForEvent("download"), page.click("#zipBtn")]);
const tiZip = path.join(FIX, "tidb-out.zip");
await dl.saveAs(tiZip);
r = JSON.parse(zipList(tiZip));
check(r.bad === null, "tidb ZIP passes python zipfile CRC validation");
check(r.names.includes("photos/p1.png") && r.names.includes("tools.csv") && r.names.includes("tools.json"), `tidb ZIP paths ok (${r.names.join(", ")})`);
const csvTxt = execFileSync("python3", ["-c", `import zipfile,sys;print(zipfile.ZipFile(sys.argv[1]).read("tools.csv").decode())`, tiZip]).toString();
check(csvTxt.includes("111 111 00 00 00") && csvTxt.includes("Wrench, special"), "tools.csv carries the tool data");

// ---------- .lidb ----------
await page.click("#resetBtn");
await page.setInputFiles("#pick", path.join(FIX, "viewer.lidb"));
await page.waitForTimeout(500);
check((await page.locator("#kindLabel").textContent()).includes("LI Documents"), "recognizes a .lidb backup");
const liRow = await page.locator("#rows").textContent();
check(liRow.includes("LI Documents/LI54.10-P-070001_2 - Brake procedure.pdf"), `LI PDF gets a readable name (${liRow.trim().slice(0, 70)})`);
// A real-length LI title must be clamped under Windows' 260-char path limit
// (the identifier prefix stays; the tail is trimmed; extension survives).
const longPaths = await page.evaluate(() => Array.from(document.querySelectorAll("#rows .name")).map((td) => td.textContent));
const clamped = longPaths.find((p) => p.includes("LI27.60-P-071321_4"));
check(!!clamped && clamped.length <= 155 && clamped.trim().endsWith(".pdf"), `overlong LI title clamped to a safe path length (${clamped ? clamped.length : "missing"} chars)`);
// per-file download path
const [single] = await Promise.all([page.waitForEvent("download"), page.locator("#rows .dl").first().click()]);
const liPdf = path.join(FIX, "li-out.pdf");
await single.saveAs(liPdf);
check(fs.readFileSync(liPdf, "utf8").startsWith("%PDF-1.4 fake LI doc"), "per-file download returns the original bytes");

// ---------- junk file rejected cleanly ----------
await page.click("#resetBtn");
fs.writeFileSync(path.join(FIX, "junk.bin"), "not a backup at all");
await page.setInputFiles("#pick", path.join(FIX, "junk.bin"));
await page.waitForTimeout(400);
check((await page.locator("#progress").textContent()).includes("Not a recognized"), "junk input gets a clear error, not a crash");

// ---------- embedded in the platform shell (the Extract tab) ----------
await page.goto(base + "#viewer", { waitUntil: "networkidle" });
await page.waitForTimeout(600);
check(await page.locator("#tab-viewer.is-active").count() === 1, "#viewer deep link activates the shell's Extract tab");
const emb = page.frameLocator("#frame-viewer");
await emb.locator("#drop").waitFor({ timeout: 10000 });
check(await emb.locator("h1").isHidden(), "embedded viewer hides its own heading (the tab names it)");
await emb.locator("#pick").setInputFiles(path.join(FIX, "viewer.fvault"));
await page.waitForTimeout(500);
check((await emb.locator("#rows tr").count()) === 2, "extraction works inside the embedded tab");
// Alt+6 pressed inside another iframe reaches the Extract tab (tab order:
// vault·li·inventory·toolbox·story·viewer — Extract is the 6th).
await page.click("#tab-vault");
await page.waitForTimeout(500);
const vaultFrame = page.frames().find((f) => f.url().includes("/vault/"));
if (vaultFrame) await vaultFrame.locator("body").press("Alt+6").catch(() => {});
await page.waitForTimeout(400);
check(await page.locator("#tab-viewer.is-active").count() === 1, "Alt+6 from inside an app switches to the Extract tab");

console.log(errors.length ? "\nErrors:\n" + errors.join("\n") : "\nNo page errors.");
check(errors.length === 0, "no page errors");

await browser.close();
server.close();
console.log(failures === 0 ? "\nVIEWER CHECKS PASSED ✅" : `\n${failures} VIEWER CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
