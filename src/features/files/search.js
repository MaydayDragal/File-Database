/*
 * The Files feature's `search` export (quick-open): file records in the
 * Files app (not the trash, not a record another feature owns) whose name,
 * collection, note, tags, VINs or FINs carry every query token.
 */
import { tokens, hasAll } from "../search-util.js";

export async function search(q, { repos, limit = 5 }) {
  const toks = tokens(q);
  if (!toks.length) return [];
  const list = await repos.files.listBy("inFiles", 1);
  return list
    .filter((f) => !f.deletedAt && hasAll(f.searchText || repos.files.buildSearchText(f), toks))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, limit)
    .map((f) => ({
      icon: "📄", label: f.name, detail: [f.collection, (f.vins || [])[0]].filter(Boolean).join(" · "),
      app: "vault", msg: { type: "vault-open", id: f.id },
    }));
}
