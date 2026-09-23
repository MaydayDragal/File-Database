/* LI Documents — feature entry (REWRITE-PLAN.md Phase 4 / §3.1). */
import { mountInto, featureStyle } from "../mount.js";
import markup from "./markup.js";
import { start } from "./app.js";

export const route = { key: "li", title: "LI Documents" };

export async function mount(host, shell) {
  const root = await mountInto(host, markup, featureStyle("documents"));
  return start(root, host, shell);
}
