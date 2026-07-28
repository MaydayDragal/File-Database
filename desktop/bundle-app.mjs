// Copy a clean copy of the static web platform into desktop/app/ so Electron
// can bundle it. Same file set as the portable/USB build.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const APP = path.join(HERE, "app");

const INCLUDE = [
  "index.html", "shell.js", "shell.css", "bridge.js", "debug.js",
  "manifest.webmanifest", "sw.js", "icons",
  "vault", "li", "inventory", "toolbox",
];

fs.rmSync(APP, { recursive: true, force: true });
fs.mkdirSync(APP, { recursive: true });
let files = 0, bytes = 0;
const tally = (p) => { const s = fs.statSync(p); if (s.isDirectory()) fs.readdirSync(p).forEach((n) => tally(path.join(p, n))); else { files++; bytes += s.size; } };
for (const rel of INCLUDE) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) { console.warn("skip (missing):", rel); continue; }
  fs.cpSync(src, path.join(APP, rel), { recursive: true });
  tally(path.join(APP, rel));
}

// Ship the Mercedes special-tools catalog with the standalone app, so the Tool
// Inventory can offer a one-click "Load the built-in catalog" instead of
// booting empty with no offline way to get the data.
if (fs.existsSync(path.join(ROOT, "inventory-data", "tools.json"))) {
  execFileSync(process.execPath, [path.join(ROOT, "tools", "build-inventory-db.mjs")], { stdio: "inherit" });
  const tidb = path.join(ROOT, "dist-db", "FileInventory.tidb");
  fs.mkdirSync(path.join(APP, "data"), { recursive: true });
  fs.copyFileSync(tidb, path.join(APP, "data", "FileInventory.tidb"));
  tally(path.join(APP, "data"));
} else {
  console.warn("skip catalog: inventory-data/tools.json not found");
}
console.log(`Bundled web app into desktop/app  (${files} files, ${(bytes / 1048576).toFixed(1)} MB)`);
