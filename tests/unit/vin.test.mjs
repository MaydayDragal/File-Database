// The VIN / FIN classifier produces exactly what it produced when the golden
// was captured (tests/fixtures/golden/vin.json). Inputs: tests/fixtures/inputs/vin-text.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readGolden, normalize } from "./golden.mjs";
import { runVinCase } from "./harness/vin.mjs";
import { VIN_CASES } from "../fixtures/inputs/vin-text.mjs";

const golden = readGolden("vin");
const byId = new Map(golden.cases.map((c) => [c.id, c]));

test("every input case has a golden", () => {
  const missing = VIN_CASES.filter((c) => !byId.has(c.id)).map((c) => c.id);
  assert.deepEqual(missing, [], "run: npm run golden:capture");
});

for (const c of VIN_CASES) {
  test(`vin golden: ${c.id}`, () => {
    const g = byId.get(c.id);
    if (!g) return; // reported above
    assert.deepEqual(normalize(runVinCase(c)), g.out);
  });
}
