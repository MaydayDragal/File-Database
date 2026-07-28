// Assemble the portable USB package: dist-portable/FileDatabase-Portable/
//   app/          a clean copy of the static site
//   data/         (empty; the browser profile is created here on first run)
//   Start File Database.bat / .command, START-HERE.txt
// Run: node tools/build-portable.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist-portable", "FileDatabase-Portable");
const APP = path.join(OUT, "app");

// Only the files the running site actually needs (no dev tooling / repo cruft).
const INCLUDE = [
  "index.html", "shell.js", "shell.css", "bridge.js", "debug.js",
  "manifest.webmanifest", "sw.js", "icons",
  "vault", "li", "inventory", "toolbox",
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
