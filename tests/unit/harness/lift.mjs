// Lift a region of one of the single-file apps and evaluate it headless.
//
// Phase 0 of the rewrite (REWRITE-PLAN.md): the parsers still live inside
// li/index.html, vault/app.js and ros/index.html, so the golden checks reach
// them the same way tools/test-li-number.mjs always has — by cutting the block
// out between two marker strings and evaluating it. Phase 1 replaces every
// caller of this file with a plain import from src/core/; the golden files
// themselves do not change.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export function lift(file, startMark, endMark) {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const a = src.indexOf(startMark);
  const b = src.indexOf(endMark, a);
  if (a < 0 || b < 0) throw new Error(`${file}: could not locate ${a < 0 ? startMark : endMark}`);
  return src.slice(a, b);
}

// Evaluate `block` (preceded by `prelude`) and return the named bindings.
export function evalBlock(prelude, block, names) {
  const ret = "\n;return {" + names.map((n) => `${n}: typeof ${n} === "undefined" ? undefined : ${n}`).join(", ") + "};";
  return new Function(prelude + "\n" + block + ret)();
}
