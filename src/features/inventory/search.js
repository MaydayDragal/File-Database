/*
 * The Tool Inventory's `search` export (quick-open): tools whose number
 * (spaces ignored), description, group or note carries every token.
 */
import { tokens, hasAll, compact } from "../search-util.js";

export async function search(q, { repos, limit = 5 }) {
  const toks = tokens(q);
  if (!toks.length) return [];
  const qc = compact(q);
  const list = await repos.tools.list();
  return list
    .filter((t) => hasAll([t.toolNo, t.desc, t.svcGrp, t.note, t.location].join(" "), toks) || (qc.length >= 4 && compact(t.toolNo).includes(qc)))
    .slice(0, limit)
    .map((t) => ({
      icon: "🔧", label: (t.toolNo || t.id) + (t.desc ? " · " + t.desc : ""), detail: t.svcGrp ? "group " + t.svcGrp : "",
      app: "inventory", msg: { type: "inventory-open", toolNo: t.toolNo || "" },
    }));
}
