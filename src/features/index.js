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
 * costs nothing. `search` (optional) imports the feature's quick-open
 * provider — search(q, { repos, limit }) → rows { icon, label, detail,
 * app, msg } — a small module of its own, so Ctrl+K searching every store
 * never loads a feature's UI. Adding a seventh tab is one folder plus one line here (and
 * its <section> + tab button in index.html).
 */
export const FEATURES = [
  { key: "vault",     title: "Files",          load: () => import("./files/index.js"),     search: () => import("./files/search.js") },
  { key: "li",        title: "LI Documents",   load: () => import("./documents/index.js"), search: () => import("./documents/search.js") },
  { key: "inventory", title: "Tool Inventory", load: () => import("./inventory/index.js"), search: () => import("./inventory/search.js") },
  { key: "toolbox",   title: "Toolbox",        load: () => import("./toolbox/index.js") },
  { key: "ros",       title: "Repair Orders",  load: () => import("./ros/index.js"),       search: () => import("./ros/search.js") },
  { key: "viewer",    title: "Extract",        load: () => import("./extract/index.js") },
];

export const KEYS = FEATURES.map((f) => f.key);
export function byKey(key) { return FEATURES.find((f) => f.key === key) || null; }

export { mountInto } from "./mount.js";
