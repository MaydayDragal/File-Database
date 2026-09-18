/* Files — feature entry (REWRITE-PLAN.md Phase 4 / §3.1). */
import { mountInto } from "../mount.js";
import markup from "./markup.js";
import { start } from "./app.js";
import "./db.js";
import "./blob-integrity.js";

export const route = { key: "vault", title: "Files" };

export async function mount(host, shell) {
  const root = await mountInto(host, markup, new URL("./styles.css", import.meta.url).href);
  return start(root, host, shell);
}
