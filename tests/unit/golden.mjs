// Shared helpers for golden checks: load a golden file, compare one case.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./harness/lift.mjs";

export const GOLDEN_DIR = path.join(ROOT, "tests", "fixtures", "golden");

export function readGolden(name) {
  const p = path.join(GOLDEN_DIR, name + ".json");
  if (!fs.existsSync(p)) throw new Error(`${p} is missing — run: npm run golden:capture`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// JSON round-trip so undefined/Set/RegExp differences don't produce false diffs:
// the golden was written through JSON.stringify, so compare the same way.
export function normalize(v) { return JSON.parse(JSON.stringify(v === undefined ? null : v)); }
