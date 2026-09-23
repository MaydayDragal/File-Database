/*
 * Repair Orders' `search` export (quick-open): live repair orders whose
 * number, VIN, vehicle, customer, advisor, tag or story text carries every
 * token.
 */
import { tokens, hasAll } from "../search-util.js";

export function roText(r) {
  return [r.ro, r.vin, r.vehicle, r.customer, r.advisor, r.tag, r.phone, r.email, (r.lines || []).map((l) => (l.op || "") + " " + (l.text || "")).join(" "), r.scanText].join(" ");
}
export async function search(q, { repos, limit = 5 }) {
  const toks = tokens(q);
  if (!toks.length) return [];
  const list = await repos.ros.live();
  return list
    .filter((r) => hasAll(roText(r), toks))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, limit)
    .map((r) => ({
      icon: "🧾", label: (r.ro ? "RO " + r.ro : "Repair order (no number)") + (r.vehicle ? " · " + r.vehicle : ""),
      detail: [r.customer, r.vin].filter(Boolean).join(" · "),
      app: "ros", msg: { type: "shell-nav", id: r.id },
    }));
}
