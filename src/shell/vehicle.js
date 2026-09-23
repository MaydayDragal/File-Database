/*
 * vehicle.js — the vehicle view (REWRITE-PLAN.md Phase 5): everything the
 * platform knows about one car, from ONE query (repos.vehicles.summary):
 * its record (check digit, technician confirmation, sources), its files and
 * repair orders, and the LI documents and special tools that fit its model
 * series. Route: #vehicle/<VIN>. Opened from quick-open, a file's or an
 * RO's 🚗 button, or the address bar.
 *
 * createVehicleView({ go, pin, toast }) → { open(vin), close(), isOpen() }
 *   go(app, msg)  switch to a feature and deliver it a message
 *   pin(vin)      pin the vehicle platform-wide
 */
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function createVehicleView({ go, pin, toast }) {
  let box = null, vin = "", onClose = null;

  function ensure() {
    if (box) return box;
    box = el("div", "vehicle-view");
    box.id = "vehicle-view";
    box.hidden = true;
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-labelledby", "vv-title");
    box.addEventListener("click", (e) => { if (e.target === box) close(); });
    box.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    document.body.append(box);
    return box;
  }

  function section(title, count, more, items, render) {
    const s = el("section", "vv-sec");
    const h = el("h3", "vv-sec__head");
    h.append(el("span", "", title), el("span", "vv-count", String(count)));
    if (more && count) { const b = el("button", "vv-more", more.label); b.type = "button"; b.onclick = more.go; h.append(b); }
    s.append(h);
    if (!count) s.append(el("p", "vv-empty", "None."));
    else {
      const ul = el("ul", "vv-list");
      items.forEach((it) => { const li = el("li"); li.append(render(it)); ul.append(li); });
      s.append(ul);
    }
    return s;
  }
  function linkBtn(text, fn, title) { const b = el("button", "vv-link", text); b.type = "button"; if (title) b.title = title; b.onclick = fn; return b; }

  async function paint() {
    const R = window.FDData.repos;
    let s;
    try { s = await R.vehicles.summary(vin); }
    catch (e) { toast("Couldn't read that vehicle — " + ((e && e.message) || e)); close(); return; }
    const b = ensure();
    b.innerHTML = "";
    const panel = el("div", "vehicle-view__panel");
    const head = el("header", "vv-head");
    const title = el("h2", "", "🚗 " + s.vin);
    title.id = "vv-title";
    const x = el("button", "icon-btn vv-close", "✕"); x.type = "button"; x.title = "Close"; x.setAttribute("aria-label", "Close"); x.onclick = close;
    head.append(title, x);

    const v = s.vehicle;
    const facts = el("div", "vv-facts");
    facts.append(el("span", s.checkDigit ? "vv-ok" : "vv-warn", s.checkDigit ? "✓ Check digit OK" : "⚠ Check digit fails"));
    const conf = !!(v && v.confirmedAt);
    const cs = el("span", conf ? "vv-ok" : "", conf ? "✓ Confirmed by a technician" : "Not confirmed");
    cs.id = "vv-confirmed";
    facts.append(cs);
    if (s.series) facts.append(el("span", "", "Model series " + s.series));
    if (v && v.fin) facts.append(el("span", "", "FIN " + v.fin));
    if (!v) facts.append(el("span", "vv-dim", "Not recorded yet — seen only in files"));
    else if (v.sources && v.sources.length) facts.append(el("span", "vv-dim", "Seen by: " + v.sources.join(", ")));

    const acts = el("div", "vv-actions");
    const cb = el("button", "btn", conf ? "Withdraw confirmation" : "✓ Confirm VIN");
    cb.type = "button"; cb.id = "vv-confirm";
    cb.title = "You checked this VIN against the car";
    cb.onclick = async () => { try { await R.vehicles.confirm(s.vin, !conf); paint(); } catch (e) { toast("Couldn't record that — " + ((e && e.message) || e)); } };
    const pb = el("button", "btn", "📌 Pin as the active vehicle"); pb.type = "button"; pb.onclick = () => { pin(s.vin); close(); };
    acts.append(cb, pb);

    const secs = el("div", "vv-secs");
    secs.append(
      section("📁 Files", s.files.count, { label: "Show all in Files", go: () => { close(); go("vault", { type: "vault-filter", filter: "vin:" + s.vin }); } },
        s.files.items, (f) => linkBtn(f.name, () => { close(); go("vault", { type: "vault-open", id: f.id }); })),
      section("🧾 Repair orders", s.ros.count, null,
        s.ros.items, (r) => linkBtn(((r.ro || "").trim() ? "RO " + r.ro.trim() : "Repair order") + (r.opened ? " · " + r.opened : "") + (r.customer ? " · " + r.customer : ""), () => { close(); go("ros", { type: "shell-nav", id: r.id }); })),
      section("🗄️ LI documents" + (s.series ? " · model " + s.series : ""), s.documents.count, { label: "Show all in LI Documents", go: () => { close(); go("li", { type: "li-filter", model: s.series }); } },
        s.documents.items, (d) => linkBtn((d.li || d.id) + (d.title ? " · " + d.title : ""), () => { close(); go("li", { type: "li-open", li: d.li || d.id }); })),
      section("🔧 Special tools" + (s.series ? " · model " + s.series : ""), s.tools.count, { label: "Show all in the Tool Inventory", go: () => { close(); go("inventory", { type: "inventory-filter", model: s.series }); } },
        s.tools.items, (t) => linkBtn((t.toolNo || t.id) + (t.desc ? " · " + t.desc : ""), () => { close(); go("inventory", { type: "inventory-open", toolNo: t.toolNo || "" }); })),
    );
    if (!s.series) secs.append(el("p", "vv-dim", "This VIN carries no model series (characters 4–6 aren't digits), so LI documents and tools can't be matched to it."));
    panel.append(head, facts, acts, secs);
    b.append(panel);
    b.hidden = false;
    setTimeout(() => { if (!b.hidden) x.focus(); }, 0);
  }

  function open(v, opts) {
    vin = String(v || "").trim().toUpperCase().replace(/\s+/g, "");
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) { toast("That isn't a VIN."); return; }
    onClose = (opts && opts.onClose) || null;
    paint();
  }
  function close() {
    if (!box || box.hidden) return;
    box.hidden = true;
    const f = onClose; onClose = null;
    if (f) f();
  }
  function refresh() { if (box && !box.hidden) paint(); }
  return { open, close, refresh, isOpen: () => !!(box && !box.hidden), get vin() { return vin; } };
}
