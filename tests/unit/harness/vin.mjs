// The VIN / FIN classifier — src/core/vin.js, imported directly
// (REWRITE-PLAN.md Phase 1). The core file is a classic script that attaches
// to globalThis.FDCore, so importing it for its side effect is enough.
import "../../../src/core/vin.js";

const V = globalThis.FDCore.vin;

export function loadVin() {
  return {
    looksLikeVin: V.looksLikeVin,
    findVinsDetailed: V.findVinsDetailed,
    findVins: V.findVins,
    vinCheckOk: V.vinCheckOk,
    yearFromVin: V.yearFromVin,
    wmi: Array.from(V.MB_WMI).sort(),
    maxPerFile: V.VIN_MAX_PER_FILE,
  };
}

// Run one golden case: { fn, args } -> JSON-safe output.
export function runVinCase(c) {
  const v = loadVin();
  switch (c.fn) {
    case "looksLikeVin": return v.looksLikeVin(...c.args);
    case "findVinsDetailed": return v.findVinsDetailed(...c.args);
    case "findVins": return v.findVins(...c.args);
    case "vinCheckOk": return v.vinCheckOk(...c.args);
    case "yearFromVin": return v.yearFromVin(...c.args);
    case "wmi": return v.wmi;
    default: throw new Error("unknown vin case " + c.fn);
  }
}
