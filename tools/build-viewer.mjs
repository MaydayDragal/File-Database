// viewer.js — the standalone Database File Viewer's classic bundle.
//
// viewer.html is promised to work as a plain file next to your backups, and
// a browser will not load an ES module from file://. So the Extract feature
// (src/features/extract/) is bundled with esbuild into ONE classic script,
// viewer.js, which the page loads with a plain <script>. The platform's own
// Extract tab keeps loading the feature as a module.
//
// Usage:
//   node tools/build-viewer.mjs           regenerate viewer.js
//   node tools/build-viewer.mjs --check   verify viewer.js matches the sources
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "viewer.js";
const BANNER = "/* viewer.js — the standalone Database File Viewer: src/features/extract bundled as a classic script by tools/build-viewer.mjs; do not edit, regenerate. */";

async function bundle() {
  const r = await build({
    entryPoints: [path.join(ROOT, "src", "features", "extract", "standalone.js")],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2020",
    platform: "browser",
    legalComments: "inline",
    logLevel: "silent",
    banner: { js: BANNER },
  });
  return r.outputFiles[0].text;
}

const fresh = await bundle();
if (process.argv.includes("--check")) {
  const p = path.join(ROOT, OUT);
  const have = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  if (have !== fresh) {
    console.error("✗ " + OUT + " is out of date — run `npm run build:viewer` and commit the result");
    process.exit(1);
  }
  console.log("✓ " + OUT + " matches src/features/extract (" + (fresh.length / 1024).toFixed(0) + " KB)");
  console.log("\nVIEWER BUNDLE CHECK PASSED ✅");
} else {
  fs.writeFileSync(path.join(ROOT, OUT), fresh);
  console.log("✓ " + OUT + " (" + (fresh.length / 1024).toFixed(0) + " KB)");
}
