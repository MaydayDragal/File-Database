/*
 * src/features/index.js — the platform's features, one entry per tab.
 *
 * A feature is a folder under src/features/ whose index.js exports
 *   route  { key, title }          the tab: `key` is the hash head (#files is
 *                                  an alias of #vault) and the app name every
 *                                  cross-feature message carries
 *   mount(host, shell) → instance   render into the panel's shadow root once
 *                                  and wire the app; the instance exposes
 *                                  receive(msg) (the cross-feature contract,
 *                                  FEATURES.md §9), and optionally
 *                                  dropContext() and intake(files)
 * `load` imports the module on first use, so a tab that is never opened
 * costs nothing. Adding a seventh tab is one folder plus one line here (and
 * its <section> + tab button in index.html).
 */
export const FEATURES = [
  { key: "vault",     title: "Files",          load: () => import("./files/index.js") },
  { key: "li",        title: "LI Documents",   load: () => import("./documents/index.js") },
  { key: "inventory", title: "Tool Inventory", load: () => import("./inventory/index.js") },
  { key: "toolbox",   title: "Toolbox",        load: () => import("./toolbox/index.js") },
  { key: "ros",       title: "Repair Orders",  load: () => import("./ros/index.js") },
  { key: "viewer",    title: "Extract",        load: () => import("./extract/index.js") },
];

export const KEYS = FEATURES.map((f) => f.key);
export function byKey(key) { return FEATURES.find((f) => f.key === key) || null; }

/*
 * mountInto(host, markup, styleUrl) — the one way a feature renders: a shadow
 * root on its panel, the feature's stylesheet, then its markup wrapped in
 * `.fd-root` (the element that was the app's <body>). Resolves with the root
 * once the stylesheet has loaded, so the panel never shows unstyled.
 */
export function mountInto(host, markup, styleUrl) {
  const root = host.shadowRoot || host.attachShadow({ mode: "open" });
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = styleUrl;
  const wrap = document.createElement("div");
  wrap.className = "fd-root";
  wrap.tabIndex = -1;
  wrap.innerHTML = markup;
  const ready = new Promise((res) => {
    const done = () => res(root);
    link.addEventListener("load", done, { once: true });
    link.addEventListener("error", done, { once: true });
    setTimeout(done, 1500); // a slow stylesheet must not hold the app hostage
  });
  root.append(link, wrap);
  return ready;
}
