// LI Documents' text-level extraction — now the shared src/core modules,
// imported directly (REWRITE-PLAN.md Phase 1). The core files are classic
// scripts that attach to globalThis.FDCore, so importing them for their side
// effect is enough.
import "../../../src/core/text.js";
import "../../../src/core/ids.js";
import "../../../src/core/li-parse.js";

const core = globalThis.FDCore;

let cached = null;
export function loadLi() {
  if (cached) return cached;
  cached = Object.assign({}, core.text, core.ids, core.li);
  return cached;
}

// The metadata a document gets from its text, as the app stores it.
export function metaFromText(flat, p1, all, ocr, filename, pages) {
  return core.li.buildRecord(flat, p1, all, ocr, filename, pages);
}

// Regular expressions travel through JSON as { $re, flags }.
function revive(v) {
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === "object") {
    if (typeof v.$re === "string") return new RegExp(v.$re, v.flags || "");
    const o = {}; for (const k of Object.keys(v)) o[k] = revive(v[k]); return o;
  }
  return v;
}

export function runLiCase(c) {
  const L = loadLi();
  const args = revive(c.args);
  if (c.fn === "meta") return metaFromText(...args);
  if (c.fn === "fieldFromLines") {
    // The optional `valid` predicate is named, not serialized.
    const [lines, re, multi, valid] = args;
    return L.fieldFromLines(lines, re, multi, valid === "isDate" ? (v) => L.DATE_VAL.test(v) : undefined);
  }
  const f = L[c.fn];
  if (typeof f !== "function") throw new Error("unknown li case " + c.fn);
  return f(...args);
}
