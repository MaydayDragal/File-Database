// The Repair Order scan parser produces exactly what it produced when the
// golden was captured (tests/fixtures/golden/ro-scan.json).
// Inputs: tests/fixtures/inputs/ro-scan.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readGolden, normalize } from "./golden.mjs";
import { runRoCase } from "./harness/ro.mjs";
import { RO_CASES } from "../fixtures/inputs/ro-scan.mjs";

const golden = readGolden("ro-scan");
const byId = new Map(golden.cases.map((c) => [c.id, c]));

test("every input case has a golden", () => {
  const missing = RO_CASES.filter((c) => !byId.has(c.id)).map((c) => c.id);
  assert.deepEqual(missing, [], "run: npm run golden:capture");
});

for (const c of RO_CASES) {
  test(`ro golden: ${c.id}`, () => {
    const g = byId.get(c.id);
    if (!g) return;
    assert.deepEqual(normalize(runRoCase(c)), g.out);
  });
}
