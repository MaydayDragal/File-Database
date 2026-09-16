// The Repair Order scan parser — src/core/ro-parse.js, imported directly
// (REWRITE-PLAN.md Phase 1); no browser needed any more. The core files are
// classic scripts that attach to globalThis.FDCore, so importing them for
// their side effect is enough. A case is { id, fn, args } where fn is a
// FDCore.ro function and args are JSON; a regular expression argument is
// written as { "$re": "source", "flags": "i" }.
import "../../../src/core/vin.js";
import "../../../src/core/ro-parse.js";

const R = globalThis.FDCore.ro;
const V = globalThis.FDCore.vin;

function revive(v) {
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === "object") {
    if (typeof v.$re === "string") return new RegExp(v.$re, v.flags || "");
    const o = {}; for (const k of Object.keys(v)) o[k] = revive(v[k]); return o;
  }
  return v;
}

export function runRoCase(c) {
  const fn = R[c.fn] || (c.fn === "vinCheckOk" ? V.vinCheckOk : undefined);
  if (typeof fn !== "function") throw new Error("unknown ro case " + c.fn);
  return fn(...revive(c.args));
}

// Same shape the browser harness had, so capture-golden needs no change.
export async function runRoCases(cases) {
  const out = {};
  for (const c of cases) {
    try { out[c.id] = JSON.parse(JSON.stringify(runRoCase(c) === undefined ? null : runRoCase(c))); }
    catch (e) { out[c.id] = { $error: String(e && e.message || e) }; }
  }
  return out;
}
