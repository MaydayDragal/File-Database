/*
 * duplicates.js — the exact-duplicate review (REWRITE-PLAN.md Phase 5).
 *
 * reviewDuplicates(list) is what FDData.intake.ingest(…, { reviewDuplicates })
 * calls when files about to be stored have bytes the database already holds
 * (a blobs.sha256 match — never a name or size guess). It shows one row per
 * such file with the record(s) it matches and resolves one decision each:
 *   reuse — store a new record that shares the stored bytes (default)
 *   keep  — store a second copy of the bytes
 *   skip  — store nothing (on a repair order, the stored file is attached)
 * Closing the dialog keeps both: nothing is ever dropped without a choice.
 *
 * ES module; the dialog is appended to document.body with its own styles
 * keyed to the shared theme tokens, so any feature can await it.
 */
const CSS = `
.fd-dup{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--text,#111)}
.fd-dup__box{width:min(94vw,620px);max-height:86vh;display:flex;flex-direction:column;background:var(--bg-elev,var(--panel,#fff));border:1px solid var(--border,#d7dbe0);border-radius:var(--radius,12px);box-shadow:0 20px 60px rgba(0,0,0,.35);padding:18px 20px}
.fd-dup h2{margin:0 0 6px;font-size:17px}
.fd-dup p{margin:0 0 10px;opacity:.85}
.fd-dup__list{overflow:auto;display:flex;flex-direction:column;gap:8px;margin:4px 0 12px}
.fd-dup__row{border:1px solid var(--border,#e2e6ea);border-radius:10px;padding:8px 10px;display:grid;grid-template-columns:1fr auto;gap:4px 10px;align-items:center}
.fd-dup__name{font-weight:600;overflow-wrap:anywhere}
.fd-dup__match{grid-column:1/2;font-size:12.5px;opacity:.8;overflow-wrap:anywhere}
.fd-dup select{grid-row:1/3;grid-column:2;font:inherit;padding:6px 8px;border-radius:8px;border:1px solid var(--border,#c9cfd6);background:var(--bg,#fff);color:inherit}
.fd-dup__row-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.fd-dup button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid var(--border,#c9cfd6);background:var(--bg,#fff);color:inherit;cursor:pointer}
.fd-dup button.primary{background:var(--accent,#2563eb);border-color:var(--accent,#2563eb);color:#fff}
`;

function ensureStyle() {
  if (document.getElementById("fd-dup-style")) return;
  const s = document.createElement("style");
  s.id = "fd-dup-style";
  s.textContent = CSS;
  document.head.append(s);
}
function where(m) {
  if (m.deletedAt) return "in the trash";
  if (m.docId && !m.inFiles) return "an LI document's PDF";
  return m.collection ? "in " + m.collection : "in Files";
}
function fmt(n) { if (!n) return "0 B"; const u = ["B", "KB", "MB", "GB"]; const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024))); return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + " " + u[i]; }

export function reviewDuplicates(list) {
  if (!list || !list.length) return Promise.resolve([]);
  ensureStyle();
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "fd-dup";
    wrap.id = "fd-dup";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-labelledby", "fd-dup-title");
    const box = document.createElement("div");
    box.className = "fd-dup__box";
    const h = document.createElement("h2");
    h.id = "fd-dup-title";
    h.textContent = list.length === 1 ? "This file is already stored" : list.length + " files are already stored";
    const p = document.createElement("p");
    p.textContent = "The same bytes are in the database already. Reuse them (a new entry, no second copy), keep a second copy, or skip the file.";
    const rows = document.createElement("div");
    rows.className = "fd-dup__list";
    const selects = [];
    list.forEach((d) => {
      const row = document.createElement("div");
      row.className = "fd-dup__row";
      const name = document.createElement("div");
      name.className = "fd-dup__name";
      name.textContent = d.name + " (" + fmt(d.size) + ")";
      const match = document.createElement("div");
      match.className = "fd-dup__match";
      const m0 = d.matches[0];
      match.textContent = "Same as “" + m0.name + "” " + where(m0) + (d.matches.length > 1 ? " and " + (d.matches.length - 1) + " more" : "");
      const sel = document.createElement("select");
      sel.setAttribute("aria-label", "What to do with " + d.name);
      sel.dataset.index = String(d.index);
      [["reuse", "Reuse stored bytes"], ["keep", "Keep a second copy"], ["skip", "Skip this file"]].forEach(([v, t]) => {
        const o = document.createElement("option"); o.value = v; o.textContent = t; sel.append(o);
      });
      selects.push(sel);
      row.append(name, sel, match);
      rows.append(row);
    });
    const actions = document.createElement("div");
    actions.className = "fd-dup__row-actions";
    const skipAll = document.createElement("button"); skipAll.type = "button"; skipAll.id = "fd-dup-skip-all"; skipAll.textContent = "Skip all";
    const keepAll = document.createElement("button"); keepAll.type = "button"; keepAll.id = "fd-dup-keep-all"; keepAll.textContent = "Keep all";
    const apply = document.createElement("button"); apply.type = "button"; apply.id = "fd-dup-apply"; apply.className = "primary"; apply.textContent = "Continue";
    actions.append(skipAll, keepAll, apply);
    box.append(h, p, rows, actions);
    wrap.append(box);
    document.body.append(wrap);
    const done = (action) => {
      wrap.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(list.map((d, i) => ({ index: d.index, action: action || selects[i].value })));
    };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); done("keep"); } };
    document.addEventListener("keydown", onKey, true);
    skipAll.onclick = () => done("skip");
    keepAll.onclick = () => done("keep");
    apply.onclick = () => done(null);
    setTimeout(() => apply.focus(), 0);
  });
}
export default reviewDuplicates;
