// Assemble the portable USB package: dist-portable/FileDatabase-Portable/
//   app/          the static site, with src/ bundled into ONE classic script
//                 (app/app.js) — the one build step the platform has
//   data/         (empty; the browser profile is created here on first run)
//   Start File Database.bat / .command, START-HERE.txt
// Run: node tools/build-portable.mjs
//
// Why a bundle: the page's entry (src/main.js) is an ES module, and a browser
// refuses to load a module from file:// unless it was started with
// --allow-file-access-from-files. The launchers pass that flag, but the
// package must not depend on it: app/index.html loads app/app.js, which is
// src/main.js and every module it imports — the features and their search
// modules included (dynamic import() is inlined) — as a plain <script>, so a
// double-clicked app/index.html opens too. The classic core/data/services
// scripts load as before. src/ still ships for the feature stylesheets.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist-portable", "FileDatabase-Portable");
const APP = path.join(OUT, "app");

// Only the files the running site actually needs (no dev tooling / repo cruft).
const INCLUDE = [
  "index.html", "viewer.html", "viewer.js", "debug.js", "ocr.js", "src", "vendor",
  "manifest.webmanifest", "sw.js", "icons",
];

fs.rmSync(path.join(ROOT, "dist-portable"), { recursive: true, force: true });
fs.mkdirSync(APP, { recursive: true });

let files = 0, bytes = 0;
function tally(p) {
  const st = fs.statSync(p);
  if (st.isDirectory()) fs.readdirSync(p).forEach((n) => tally(path.join(p, n)));
  else { files++; bytes += st.size; }
}
for (const rel of INCLUDE) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) { console.warn("skip (missing):", rel); continue; }
  fs.cpSync(src, path.join(APP, rel), { recursive: true });
  tally(path.join(APP, rel));
}

// Bundle src/main.js (and everything it imports) into app/app.js.
const MODULE_TAG = '<script type="module" src="src/main.js"></script>';
const CLASSIC_TAG = '<script src="app.js"></script>';
{
  const r = await build({
    entryPoints: [path.join(ROOT, "src", "main.js")],
    bundle: true, write: false, format: "iife", target: "es2020", platform: "browser",
    legalComments: "inline", logLevel: "silent",
    banner: { js: "/* app.js — src/main.js and every module it imports, bundled as one classic script by tools/build-portable.mjs (the portable package only). */" },
  });
  const w = r.warnings.filter((x) => /import\.meta/.test(x.text));
  if (w.length) throw new Error("a bundled module still uses import.meta: " + w[0].text);
  fs.writeFileSync(path.join(APP, "app.js"), r.outputFiles[0].text);
  const html = fs.readFileSync(path.join(APP, "index.html"), "utf8");
  if (!html.includes(MODULE_TAG)) throw new Error("index.html: the module entry tag changed — update tools/build-portable.mjs");
  fs.writeFileSync(path.join(APP, "index.html"), html.replace(MODULE_TAG, CLASSIC_TAG));
  tally(path.join(APP, "app.js"));
}

// Ship the special-tools catalog so the Tool Inventory can offer a one-click
// "Load the built-in catalog" offline (app/data/ = the site's ../data/).
if (fs.existsSync(path.join(ROOT, "inventory-data", "tools.json"))) {
  execFileSync(process.execPath, [path.join(ROOT, "tools", "build-inventory-db.mjs")], { stdio: "inherit" });
  fs.mkdirSync(path.join(APP, "data"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "dist-db", "FileInventory.tidb"), path.join(APP, "data", "FileInventory.tidb"));
  tally(path.join(APP, "data"));
}

// Served over http(s) instead (a copy on a web server), the worker must
// precache the bundle the page now loads — and its cache name must change
// whenever anything it caches changes. The repository's worker is versioned
// by hand; here a release can change app.js (or any copied file) alone,
// which would leave sw.js byte-identical: the browser would keep the old
// worker and its cache-first handler would serve the old app forever. So the
// cache name carries a hash of every file in app/ (the worker prunes any
// other file-database-* cache on activation).
{
  const swPath = path.join(APP, "sw.js");
  let sw = fs.readFileSync(swPath, "utf8");
  if (!sw.includes("const CORE = [\n")) throw new Error("sw.js: CORE list not found");
  const m = sw.match(/const CACHE = "(file-database-[^"]+)";/);
  if (!m) throw new Error("sw.js: CACHE name not found");
  const h = createHash("sha256");
  const walk = (dir) => fs.readdirSync(dir).sort().forEach((n) => {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) return walk(p);
    if (p === swPath) return;
    h.update(path.relative(APP, p).split(path.sep).join("/") + "\0");
    h.update(fs.readFileSync(p));
  });
  walk(APP);
  const cache = m[1] + "-" + h.digest("hex").slice(0, 12);
  sw = sw.replace(m[0], 'const CACHE = "' + cache + '";').replace("const CORE = [\n", 'const CORE = [\n  "./app.js",\n');
  fs.writeFileSync(swPath, sw);
  console.log("  worker cache: " + cache);
}

// Launchers + readme
for (const f of ["Start File Database.bat", "Start File Database (Mac).command", "START-HERE.txt"]) {
  fs.copyFileSync(path.join(ROOT, "portable", f), path.join(OUT, f));
}
try { fs.chmodSync(path.join(OUT, "Start File Database (Mac).command"), 0o755); } catch (e) {}

// Empty data dir (profile lands here on first run)
fs.mkdirSync(path.join(OUT, "data"), { recursive: true });
fs.writeFileSync(path.join(OUT, "data", ".keep"), "Your vault's browser profile is stored here on first run.\n");

const mb = (bytes / 1048576).toFixed(1);
console.log(`Portable package built: ${OUT}`);
console.log(`  app files: ${files}  (${mb} MB)`);
console.log("Copy the whole 'FileDatabase-Portable' folder to a USB stick and run the launcher.");
