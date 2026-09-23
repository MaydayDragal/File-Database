import { mountInto, featureStyle } from "../mount.js";
import markup from "./markup.js";
import { start } from "./app.js";

export const route = { key: "viewer", title: "Extract" };

// opts.styleUrl: an explicit stylesheet location (the standalone viewer.html
// passes its own); otherwise the feature's stylesheet beside the page.
export async function mount(host, shell, opts) {
  const styleUrl = (opts && opts.styleUrl) || featureStyle("extract");
  const root = await mountInto(host, markup, styleUrl);
  return start(root, host, shell);
}
