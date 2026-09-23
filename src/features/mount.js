/* src/features/mount.js — how a feature renders into its panel (REWRITE-PLAN.md Phase 4). */
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

// A feature's stylesheet, resolved against the PAGE (the page sits at the
// site root with src/ beside it). Not import.meta.url: the portable build
// bundles src/ into one classic script, where that has no meaning, and the
// same line then works both ways.
export function featureStyle(folder) {
  return new URL("src/features/" + folder + "/styles.css", document.baseURI).href;
}
