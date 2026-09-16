// (Re)capture the golden outputs of the three parsers from the CURRENT code.
//
//   node tools/capture-golden.mjs            all three
//   node tools/capture-golden.mjs li vin     a subset
//
// A golden file is the recorded behaviour of the code at one commit. The unit
// checks (tests/unit/*.test.mjs, tools/test-golden-ro.mjs) fail when the code
// stops producing it. Re-run this ONLY when a behaviour change is intended,
// and commit the regenerated file with the change so the diff shows exactly
// what moved.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT } from "../tests/unit/harness/lift.mjs";
import { GOLDEN_DIR, normalize } from "../tests/unit/golden.mjs";

const which = new Set(process.argv.slice(2).length ? process.argv.slice(2) : ["li", "vin", "ro"]);
fs.mkdirSync(GOLDEN_DIR, { recursive: true });

function stamp() {
  let commit = "unknown";
  try { commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); } catch (e) {}
  return { commit, node: process.version, at: new Date().toISOString() };
}
function write(name, cases) {
  const p = path.join(GOLDEN_DIR, name + ".json");
  fs.writeFileSync(p, JSON.stringify({ captured: stamp(), cases }, null, 1) + "\n");
  console.log(`  ${name}.json: ${cases.length} cases`);
}

if (which.has("li")) {
  const { runLiCase } = await import("../tests/unit/harness/li.mjs");
  const { LI_CASES } = await import("../tests/fixtures/inputs/li-text.mjs");
  write("li-parse", LI_CASES.map((c) => ({ id: c.id, fn: c.fn, out: normalize(runLiCase(c)) })));
}
if (which.has("vin")) {
  const { runVinCase } = await import("../tests/unit/harness/vin.mjs");
  const { VIN_CASES } = await import("../tests/fixtures/inputs/vin-text.mjs");
  write("vin", VIN_CASES.map((c) => ({ id: c.id, fn: c.fn, out: normalize(runVinCase(c)) })));
}
if (which.has("ro")) {
  const { runRoCases } = await import("../tests/unit/harness/ro.mjs");
  const { RO_CASES } = await import("../tests/fixtures/inputs/ro-scan.mjs");
  const results = await runRoCases(RO_CASES);
  write("ro-scan", RO_CASES.map((c) => ({ id: c.id, fn: c.fn, out: normalize(results[c.id]) })));
}
console.log("golden capture done");
