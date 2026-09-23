/*
 * LI Documents' `search` export (quick-open): one row per LI number (its
 * newest stored version) whose number, title or reason carries every token.
 */
import { tokens, hasAll, compact } from "../search-util.js";

export async function search(q, { repos, limit = 5 }) {
  const toks = tokens(q);
  if (!toks.length) return [];
  const qc = compact(q);
  const docs = await repos.documents.list();
  const best = new Map();
  for (const d of docs) {
    const hay = [d.li, d.title, d.reason, d.fgroup].join(" ");
    if (!(hasAll(hay, toks) || (qc.length >= 4 && compact(d.li).includes(qc)))) continue;
    const k = String(d.li || d.id).toUpperCase();
    const cur = best.get(k);
    if (!cur || repos.documents.verNum(d) > repos.documents.verNum(cur)) best.set(k, d);
  }
  return [...best.values()].slice(0, limit).map((d) => ({
    icon: "🗄️", label: (d.li || d.id) + (d.title ? " · " + d.title : ""), detail: d.ver ? "v" + d.ver : "",
    app: "li", msg: { type: "li-open", li: d.li || d.id },
  }));
}
