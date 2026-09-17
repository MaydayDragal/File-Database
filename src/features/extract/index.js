import { mountInto } from "../mount.js";
import markup from "./markup.js";
import { start } from "./app.js";

export const route = { key: "viewer", title: "Extract" };

// opts.styleUrl: where the stylesheet is when this module is not being run as
// a module — the standalone viewer.html loads a classic bundle of this feature
// (tools/build-viewer.mjs), where import.meta.url has no meaning.
export async function mount(host, shell, opts) {
  const styleUrl = (opts && opts.styleUrl) || new URL("./styles.css", import.meta.url).href;
  const root = await mountInto(host, markup, styleUrl);
  return start(root, host, shell);
}
