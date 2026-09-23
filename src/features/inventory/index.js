/* Tool Inventory — feature entry (REWRITE-PLAN.md Phase 4 / §3.1). */
import { mountInto, featureStyle } from "../mount.js";
import markup from "./markup.js";
import { start } from "./app.js";

export const route = { key: "inventory", title: "Tool Inventory" };

export async function mount(host, shell) {
  const root = await mountInto(host, markup, featureStyle("inventory"));
  return start(root, host, shell);
}
