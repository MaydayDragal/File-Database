// LI Documents' text-level extraction produces exactly what it produced when
// the golden was captured (tests/fixtures/golden/li-parse.json).
// Inputs: tests/fixtures/inputs/li-text.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readGolden, normalize } from "./golden.mjs";
import { runLiCase } from "./harness/li.mjs";
import { LI_CASES } from "../fixtures/inputs/li-text.mjs";

const golden = readGolden("li-parse");
const byId = new Map(golden.cases.map((c) => [c.id, c]));

test("every input case has a golden", () => {
  const missing = LI_CASES.filter((c) => !byId.has(c.id)).map((c) => c.id);
  assert.deepEqual(missing, [], "run: npm run golden:capture");
});

for (const c of LI_CASES) {
  test(`li golden: ${c.id}`, () => {
    const g = byId.get(c.id);
    if (!g) return;
    assert.deepEqual(normalize(runLiCase(c)), g.out);
  });
}
