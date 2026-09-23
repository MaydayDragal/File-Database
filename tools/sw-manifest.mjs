// The service worker's precache list, kept honest against the tree.
//
// sw.js precaches everything the platform needs to open offline. The list is
// generated, not typed: every script and stylesheet under src/ (except the
// standalone viewer's bundle entry, which lives inside viewer.js), the shared
// root scripts, the vendored runtimes, the two pages, the manifest and the
// icons. A file that is added to src/ without appearing here would load
// online and be missing from an offline launch — this check fails instead.
//
// Usage:
//   node tools/sw-manifest.mjs --check   fail if sw.js's lists differ from the tree
//   node tools/sw-manifest.mjs --write   rewrite the lists in sw.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SW = path.join(ROOT, "sw.js");

// The page cannot start without these (installed with addAll: all or
// nothing): the page, its two stylesheets, and src/main.js with every module
// it imports statically, followed through the graph — a module the shell
// imports is part of booting, so it can never be missing offline. (Dynamic
// import() targets — the features — are extras.)
const CORE_FIXED = ["./", "./index.html", "./src/styles/tokens.css", "./src/styles/shell.css"];
const STATIC_IMPORT = /(?:^|[;\n])\s*(?:import|export)\s[^;'"`]*?from\s*["']([^"']+)["']|(?:^|[;\n])\s*import\s*["']([^"']+)["']/g;
function staticGraph(entry) {
  const seen = [];
  const visit = (rel) => {
    if (seen.includes(rel)) return;
    seen.push(rel);
    const abs = path.join(ROOT, rel);
    const text = fs.readFileSync(abs, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const m of text.matchAll(STATIC_IMPORT)) {
      const spec = m[1] || m[2];
      if (!spec.startsWith(".")) continue;
      const next = "./" + path.relative(ROOT, path.resolve(path.dirname(abs), spec)).split(path.sep).join("/");
      visit(next);
    }
  };
  visit(entry);
  return seen;
}
const CORE = CORE_FIXED.concat(staticGraph("./src/main.js"));
// Bundled into viewer.js; never fetched by the page itself.
const NOT_FETCHED = new Set(["./src/features/extract/standalone.js"]);

function walk(dir, out) {
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|css)$/.test(name)) out.push("./" + path.relative(ROOT, p).split(path.sep).join("/"));
  }
  return out;
}
export function expected() {
  const src = walk(path.join(ROOT, "src"), []).filter((f) => !CORE.includes(f) && !NOT_FETCHED.has(f));
  const rest = ["./debug.js", "./ocr.js"];
  const vendor = fs.readdirSync(path.join(ROOT, "vendor")).filter((n) => n.endsWith(".js")).sort().map((n) => "./vendor/" + n);
  const pages = ["./viewer.html", "./viewer.js", "./manifest.webmanifest"];
  const icons = fs.readdirSync(path.join(ROOT, "icons")).filter((n) => /\.(png|svg)$/.test(n)).sort().map((n) => "./icons/" + n);
  return { core: CORE, extras: src.concat(rest, vendor, pages, icons) };
}
function listOf(src, name) {
  const m = src.match(new RegExp("const " + name + " = \\[\\n([\\s\\S]*?)\\n\\];"));
  if (!m) throw new Error("sw.js: could not find const " + name);
  return { text: m[0], items: [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) };
}
function render(name, items) { return "const " + name + " = [\n" + items.map((f) => '  "' + f + '",').join("\n") + "\n];"; }

const sw = fs.readFileSync(SW, "utf8");
const want = expected();
const have = { core: listOf(sw, "CORE"), extras: listOf(sw, "EXTRAS") };
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

if (process.argv.includes("--write")) {
  const out = sw.replace(have.core.text, render("CORE", want.core)).replace(have.extras.text, render("EXTRAS", want.extras));
  fs.writeFileSync(SW, out);
  console.log("✓ sw.js precache lists written (" + want.core.length + " core, " + want.extras.length + " extras)");
} else {
  let ok = true;
  for (const k of ["core", "extras"]) {
    const missing = want[k].filter((f) => !have[k].items.includes(f));
    const stale = have[k].items.filter((f) => !want[k].includes(f));
    if (missing.length || stale.length || !same(want[k], have[k].items)) {
      ok = false;
      console.error("✗ sw.js " + k.toUpperCase() + " differs from the tree" + (missing.length ? " — missing: " + missing.join(", ") : "") + (stale.length ? " — stale: " + stale.join(", ") : ""));
    }
  }
  if (!ok) { console.error("  run `node tools/sw-manifest.mjs --write`"); process.exit(1); }
  console.log("✓ sw.js precaches the whole tree (" + want.core.length + " core, " + want.extras.length + " extras)");
  console.log("\nSW MANIFEST CHECK PASSED ✅");
}
