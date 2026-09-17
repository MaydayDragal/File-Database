// Static source checks: every tracked script parses, every web manifest is
// valid JSON with the required fields, and no test depends on a
// machine-specific browser executable path.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const check = (ok, label, detail) => {
  console.log((ok ? "  ✓ " : "  ✗ ") + label + (ok || !detail ? "" : " — " + detail));
  if (!ok) failures++;
};
const tracked = (patterns) =>
  execFileSync("git", ["ls-files", ...patterns], { cwd: ROOT, encoding: "utf8" })
    .split("\n").map((s) => s.trim()).filter(Boolean);

// ---------- 1. Every tracked script parses ----------
const scripts = tracked(["*.js", "*.mjs"]);
let parseFailures = [];
for (const f of scripts) {
  const res = spawnSync(process.execPath, ["--check", f], { cwd: ROOT, encoding: "utf8" });
  if (res.status !== 0) parseFailures.push(f + ": " + (res.stderr || "").split("\n")[0]);
}
check(parseFailures.length === 0, `all ${scripts.length} tracked scripts parse (node --check)`, parseFailures.join("; "));

// ---------- 2. Every web manifest is valid ----------
const manifests = tracked(["*.webmanifest"]);
check(manifests.length >= 4, `found the app manifests (${manifests.length})`, manifests.join(", "));
for (const f of manifests) {
  let ok = false, detail = "";
  try {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
    ok = typeof m.name === "string" && Array.isArray(m.icons) && m.icons.length > 0;
    if (!ok) detail = "missing name/icons";
  } catch (e) { detail = e.message; }
  check(ok, `manifest parses: ${f}`, detail);
}

// ---------- 3. No machine-specific browser path ----------
const offenders = [];
for (const f of tracked(["tools/*.mjs", "package.json"])) {
  if (f === "tools/test-static.mjs") continue; // this file names the path to ban it
  const src = fs.readFileSync(path.join(ROOT, f), "utf8");
  if (src.includes("/opt/pw-browsers")) offenders.push(f);
}
check(offenders.length === 0, "no suite depends on a fixed /opt browser path", offenders.join(", "));

// ---------- 4. PDF.js source policy ----------
// (a) no app source may still carry the vulnerable 3.x PDF.js build, and
// (b) every application getDocument({...}) call must disable eval.
// The vendored runtimes under vendor/ are the library, not call sites.
const appSources = tracked(["*.js", "*.html"]).filter((f) => !f.startsWith("tools/") && !f.startsWith("vendor/"));
const oldPdfjs = [];
const unsafeCalls = [];
for (const f of appSources) {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8");
  if (src.includes("3.11.174")) oldPdfjs.push(f);
  const re = /getDocument\(\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const slice = src.slice(m.index, m.index + 400);
    if (!/isEvalSupported\s*:\s*false/.test(slice)) unsafeCalls.push(f + " @" + m.index);
  }
}
for (const f of tracked(["vendor/*.js"])) {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8");
  if (src.includes("3.11.174")) oldPdfjs.push(f);
}
check(oldPdfjs.length === 0, "no PDF.js 3.11.174 artifacts remain", oldPdfjs.join(", "));
check(unsafeCalls.length === 0, "every app getDocument({...}) call passes isEvalSupported: false", unsafeCalls.slice(0, 5).join(", "));

// ---------- 5. Nothing inlined: no source file over 300 KB outside vendor/ ----------
// A page or script that big is carrying a library (REWRITE-PLAN.md Phase 3
// moved them all to vendor/, where they are loaded on demand).
const SIZE_LIMIT = 300 * 1024;
const tooBig = [];
for (const f of tracked(["*.js", "*.mjs", "*.html", "*.css"])) {
  if (f.startsWith("vendor/")) continue;
  const size = fs.statSync(path.join(ROOT, f)).size;
  if (size > SIZE_LIMIT) tooBig.push(f + " (" + Math.round(size / 1024) + " KB)");
}
check(tooBig.length === 0, "no source file over 300 KB outside vendor/", tooBig.join(", "));

console.log(failures === 0 ? "\nSTATIC CHECKS PASSED ✅" : `\n${failures} STATIC CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
