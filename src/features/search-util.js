/*
 * search-util.js — what every feature's `search` export shares: a query
 * folded to lowercase tokens, and "does this text carry every token".
 * Pure; imported by the feature search modules and the unit tests.
 */
export function tokens(q) {
  return String(q || "").toLowerCase().normalize("NFKC").replace(/[‐-― ]/g, (c) => (c === " " ? " " : "-")).split(/\s+/).filter(Boolean);
}
export function hasAll(text, toks) {
  const t = String(text || "").toLowerCase();
  return toks.every((k) => t.includes(k));
}
// Characters only — "000 589 01 23 00" and "0005890123 00" match each other.
export function compact(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
