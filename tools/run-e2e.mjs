// Deterministic E2E runner: discovers every tracked tools/e2e*.mjs suite so a
// new suite can never silently fall outside the release gate. Suites run
// sequentially (they share browser resources and fixture files) and the first
// failure stops the run with a nonzero exit code.
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function listSuites() {
  const out = execFileSync("git", ["ls-files", "tools/e2e*.mjs"], { cwd: ROOT, encoding: "utf8" });
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((f) => !["run-e2e.mjs", "e2e-browser.mjs"].includes(path.basename(f)))
    .sort();
}

export function runSuite(file) {
  console.log(`\n━━━ ${file} ━━━`);
  const res = spawnSync(process.execPath, [file], { cwd: ROOT, stdio: "inherit" });
  return Promise.resolve(res.status === null ? 1 : res.status);
}

import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const suites = listSuites();
  if (!suites.length) {
    console.error("No tools/e2e*.mjs suites found via git ls-files.");
    process.exit(1);
  }
  console.log(`Running ${suites.length} E2E suite(s):\n  ${suites.join("\n  ")}`);
  for (const file of suites) {
    const code = await runSuite(file);
    if (code !== 0) {
      console.error(`\nSuite FAILED (${code}): ${file}`);
      process.exit(code);
    }
  }
  console.log(`\nAll ${suites.length} E2E suites passed.`);
}
