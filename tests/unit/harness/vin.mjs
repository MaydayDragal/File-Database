// The Vault's VIN / FIN classifier, lifted from vault/app.js.
// Pure: no DOM, no IndexedDB, no OCR — the block between the two markers is
// constants, looksLikeVin() and findVinsDetailed().
import { lift, evalBlock } from "./lift.mjs";

let cached = null;
export function loadVin() {
  if (cached) return cached;
  const block = lift("vault/app.js", "  const VIN_TEXT_MAX", "  // OCR engine (lazy, from a CDN");
  const f = evalBlock("", block, ["looksLikeVin", "findVinsDetailed", "findVins", "MB_WMI", "VIN_MAX_PER_FILE"]);
  cached = {
    looksLikeVin: f.looksLikeVin,
    findVinsDetailed: f.findVinsDetailed,
    findVins: f.findVins,
    wmi: Array.from(f.MB_WMI).sort(),
    maxPerFile: f.VIN_MAX_PER_FILE,
  };
  return cached;
}

// Run one golden case: { fn, args } -> JSON-safe output.
export function runVinCase(c) {
  const v = loadVin();
  switch (c.fn) {
    case "looksLikeVin": return v.looksLikeVin(...c.args);
    case "findVinsDetailed": return v.findVinsDetailed(...c.args);
    case "findVins": return v.findVins(...c.args);
    case "wmi": return v.wmi;
    default: throw new Error("unknown vin case " + c.fn);
  }
}
