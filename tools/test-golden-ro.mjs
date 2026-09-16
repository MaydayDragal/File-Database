// The Repair Order scan parser produces exactly what it produced when the
// golden was captured (tests/fixtures/golden/ro-scan.json).
//
// This one needs a browser: the parser lives inside ros/index.html and is
// reached through the page's window.__ros test hook. Once Phase 1 extracts it
// to src/core/ro-parse.js this check moves into tests/unit/ as a plain import
// and this file goes away.
import { runRoCases } from "../tests/unit/harness/ro.mjs";
import { RO_CASES } from "../tests/fixtures/inputs/ro-scan.mjs";
import { readGolden, normalize } from "../tests/unit/golden.mjs";

const golden = readGolden("ro-scan");
const byId = new Map(golden.cases.map((c) => [c.id, c]));
let failures = 0;
const check = (ok, label, detail) => {
  console.log((ok ? "  ✓ " : "  ✗ ") + label + (ok ? "" : " — " + detail));
  if (!ok) failures++;
};

const missing = RO_CASES.filter((c) => !byId.has(c.id)).map((c) => c.id);
check(missing.length === 0, "every input case has a golden", "missing: " + missing.join(", ") + " (run: npm run golden:capture)");

const results = await runRoCases(RO_CASES);
for (const c of RO_CASES) {
  const g = byId.get(c.id);
  if (!g) continue;
  const got = JSON.stringify(normalize(results[c.id]));
  const want = JSON.stringify(g.out);
  check(got === want, `ro golden: ${c.id}`, `\n      got  ${got.slice(0, 400)}\n      want ${want.slice(0, 400)}`);
}

console.log(failures === 0 ? "\nRO GOLDEN CHECKS PASSED ✅" : `\n${failures} RO GOLDEN CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
