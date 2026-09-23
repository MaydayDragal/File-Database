/*
 * src/shell/index.js — the File Database shell (REWRITE-PLAN.md Phase 4).
 *
 * One page. The shell owns the top bar and its tabs, the one front door for
 * files, Ctrl+K quick-open, the pinned vehicle, the theme, the tab badges,
 * install and the service worker. Each feature (src/features/*) is mounted
 * into its panel's shadow root the first time its tab is shown — or the
 * first time work is routed to it — and stays mounted while another tab is
 * visible, exactly as the lazy iframes did.
 *
 * Cross-feature traffic keeps the message contract the iframes spoke
 * (FEATURES.md §9): a feature calls shell.send({type, …}) where it used to
 * postMessage to its parent, and the shell calls instance.receive({type, …})
 * where it used to postMessage into a frame. Same messages, function calls.
 */
import { FEATURES, KEYS, byKey } from "../features/index.js";
import { createVehicleView } from "./vehicle.js";
import { reviewDuplicates } from "../ui/duplicates.js";

const $ = (s, r = document) => r.querySelector(s);
const DEFAULT_APP = "vault";
const TITLES = {};
FEATURES.forEach((f) => { TITLES[f.key] = f.title; });

// key → { host, root, inst, ready, pending: [], loading }
const mounted = {};
let current = null;

let toastT;
export function toast(m) {
  const t = $("#shell-toast"); if (!t) return;
  t.textContent = m; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600);
}
function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => { try { URL.revokeObjectURL(a.href); } catch (e) {} }, 60000);
}

// ---------- theme (localStorage "fv-theme" + data-theme on <html>; tokens.css does the rest) ----------
const THEMES = ["system", "light", "dark"];
let themeMode = "system";
try { const st = localStorage.getItem("fv-theme"); if (st === "light" || st === "dark") themeMode = st; } catch (e) {}
function applyTheme() {
  const root = document.documentElement;
  if (themeMode === "light" || themeMode === "dark") root.setAttribute("data-theme", themeMode);
  else root.removeAttribute("data-theme");
  const dark = themeMode === "dark" ||
    (themeMode === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#16203a" : "#4f46e5");
  const di = $(".theme-icon-dark"), li = $(".theme-icon-light");
  if (di && li) { di.hidden = dark; li.hidden = !dark; }
}
function persistTheme() {
  try {
    if (themeMode === "system") localStorage.removeItem("fv-theme");
    else localStorage.setItem("fv-theme", themeMode);
  } catch (e) {}
}
function cycleTheme() {
  themeMode = THEMES[(THEMES.indexOf(themeMode) + 1) % THEMES.length];
  applyTheme(); persistTheme();
  toast("Theme: " + themeMode);
}

// ---------- features: mount on demand, deliver messages ----------
const api = {
  send: (msg) => onMessage(msg || {}),
  toast,
  activate: (key, opts) => activate(key, opts),
  // A feature reflecting its open record in the URL (#li/LI54.10-P-070001).
  setSub(app, sub) {
    if (app !== current) return;
    const hash = "#" + app + (sub ? "/" + encodeURIComponent(sub) : "");
    if (location.hash !== hash) { try { history.replaceState(null, "", location.pathname + hash); } catch (e) {} }
  },
  openPicker: () => $("#shell-file-input").click(),
};

function entry(key) {
  if (!mounted[key]) mounted[key] = { host: $("#view-" + key), root: null, inst: null, ready: false, pending: [], loading: null };
  return mounted[key];
}
// Load a feature's module and mount it into its panel (once). Resolves with
// the instance. Mounting without switching to it keeps a routed file's
// receiver live and a queued job's runner up, as loading a frame did.
function ensureLoaded(key) {
  const f = byKey(key);
  if (!f) return Promise.resolve(null);
  const e = entry(key);
  if (e.loading) return e.loading;
  e.loading = f.load().then((mod) => mod.mount(e.host, api)).then((inst) => {
    e.inst = inst || {};
    e.root = e.host.shadowRoot;
    e.ready = true;
    // Apply the pinned-vehicle scope BEFORE flushing queued messages, so an
    // explicit deep link/navigation queued for this feature wins over it.
    if (vehiclePin && (key === "vault" || key === "li" || key === "inventory")) sendVehicleScope(key);
    e.pending.splice(0).forEach((m) => { try { e.inst.receive && e.inst.receive(m); } catch (err) { console.error(err); } });
    if (key === current) focusPanel(key);
    updateBadges();
    return e.inst;
  }, (err) => {
    e.loading = null;
    console.error(err);
    toast("Couldn't load " + (TITLES[key] || key) + " — " + ((err && err.message) || err));
    throw err;
  });
  return e.loading;
}
function deliver(key, msg) {
  const e = entry(key);
  if (e.ready && e.inst.receive) { try { e.inst.receive(msg); } catch (err) { console.error(err); } }
  else e.pending.push(msg);
}
function instance(key) { const e = mounted[key]; return e && e.ready ? e.inst : null; }
// Keyboard shortcuts inside a feature listen on its shadow root, so the
// panel gets the focus a freshly opened app would have had — unless the user
// is already typing somewhere.
function focusPanel(key) {
  const e = mounted[key];
  if (!e || !e.root) return;
  const active = document.activeElement;
  if (active && active !== document.body && active !== e.host) return;
  const el = e.root.querySelector(".fd-root");
  if (el) { try { el.focus({ preventScroll: true }); } catch (err) {} }
}

// ---------- unified file intake (one front door, auto-filed) ----------
// A file is an "LI document" if it's a PDF whose name carries a Mercedes
// document number — the SAME pattern the LI feature uses to identify one.
// Those go to LI Documents; everything else to Files. Detection is silent:
// no prompt, no per-drop choice.
const liNorm = FDCore.text.normLI;
function isPdf(f) { return /pdf/i.test(f.type || "") || /\.pdf$/i.test(f.name || ""); }
function looksLikeLI(f) { return isPdf(f) && FDCore.ids.hasLiNumber(f.name); }

function routeFiles(list, opts) {
  opts = opts || {};
  const files = Array.prototype.slice.call(list || []).filter(Boolean);
  if (!files.length) return;
  // The feature on screen may claim the drop for itself (Extract opens a
  // backup it is shown instead of the shell restoring it).
  const act = instance(current);
  if (!opts.routed && act && act.intake && act.intake(files)) return;
  if (!window.FDData || !FDData.intake) { toast("Couldn't add files — storage unavailable."); return; }
  const toLI = [], toVault = [], special = [];
  files.forEach((f) => {
    const n = (f.name || "").toLowerCase();
    // The platform's own database files open in their app instead of being
    // stored as opaque blobs: .tidb → Tool Inventory, .fvault → Files
    // restore, .lidb → LI restore. (.zip stays a regular file — only LI's
    // own .lidb extension is unambiguous.)
    if (/\.tidb$/.test(n)) special.push({ app: "inventory", msg: { type: "inventory-import", file: f }, label: "Tool Inventory" });
    else if (/\.fvault$/.test(n)) special.push({ app: "vault", msg: { type: "vault-restore", file: f }, label: "Files (restore)" });
    else if (/\.lidb$/.test(n)) special.push({ app: "li", msg: { type: "li-restore", file: f }, label: "LI Documents (restore)" });
    else if (/\.fdb$/.test(n)) special.push({ restore: f, label: "File Database (restore)" });
    else (looksLikeLI(f) ? toLI : toVault).push(f);
  });

  special.forEach((s) => {
    if (s.restore) { restorePlatform(s.restore); return; }
    ensureLoaded(s.app);
    deliver(s.app, s.msg);
    toast("Opening " + s.msg.file.name + " in " + s.label + "…");
  });

  // The data layer reads each file's bytes NOW (a dropped File is a lazy
  // handle — a OneDrive placeholder or a locked file can read as garbage
  // later), stores them, and queues the receiving feature's follow-up work
  // (thumbnails, the quick VIN read, the LI import) as jobs it runs once it
  // is mounted. A file that fails to read or store is reported here, never
  // counted as added.
  function deliverFiles(target, arr) {
    if (!arr.length) return;
    ensureLoaded(target);
    const o = { collection: "", vin: "", source: "shell" };
    // While a vehicle is pinned, files headed for the vault are tagged
    // with its VIN — new paperwork joins the car with zero clicks. A drop
    // over an open vault collection keeps that collection.
    if (target === "vault" && vehiclePin) o.vin = vehiclePin.vin;
    if (target === "vault" && opts.vin) o.vin = opts.vin; // RO's own vehicle wins
    if (target === "vault" && opts.collection) o.collection = opts.collection;
    if (target === "vault" && opts.roId) o.roId = opts.roId;
    // Bytes the database already holds are put to the duplicate review
    // (reuse them, keep a second copy, or skip) before anything is written.
    if (target === "vault") o.reviewDuplicates = reviewDuplicates;
    FDData.intake.ingest(target, arr, o).then((out) => {
      const skipped = out.results.filter((r) => r.skipped).length;
      if (skipped) toast("Skipped " + skipped + " file(s) already stored.");
      out.results.filter((r) => !r.ok && !r.skipped).forEach((r) => {
        toast(r.error.indexOf("read") === 0
          ? 'Couldn’t read “' + r.name + '” — if it lives in OneDrive or on a network drive, open it once (or copy it locally), then add it again.'
          : 'Couldn’t save “' + r.name + '” — ' + r.error);
      });
    }).catch((e) => { toast("Couldn't add files — " + ((e && e.message) || e)); });
  }
  deliverFiles("li", toLI);
  deliverFiles("vault", toVault);

  const n = toLI.length + toVault.length;
  if (n) {
    const parts = [];
    if (toVault.length) parts.push(toVault.length + " to Files");
    if (toLI.length) parts.push(toLI.length + " to LI Documents");
    toast("Added " + n + (n === 1 ? " file" : " files") + " — " + parts.join(" · ") + ".");
  }

  // Surface the feature that received the batch: a database file opens its
  // app; otherwise a single-target batch switches, a mixed batch stays put.
  const only = special.length === 1 && !n ? special[0].app
    : (!special.length && toLI.length && !toVault.length) ? "li"
    : (!special.length && toVault.length && !toLI.length) ? "vault" : null;
  if (only && only !== current && !opts.stay) activate(only);
}

// A whole-platform backup (.fdb) restores into a fresh database
// generation; the live data is replaced only once the copy has verified.
function restorePlatform(file) {
  if (!window.FDData || !FDData.backup) { toast("Restore isn't available."); return; }
  if (!confirm("Restore “" + file.name + "”?\n\nThis replaces everything in File Database (files, LI documents, tools, repair orders, vehicles, the trash) with the backup's contents. The current data is removed only after the backup has been copied and verified.")) return;
  toast("Restoring backup…");
  FDData.backup.restore(file, {
    onProgress: (p) => { if (p.phase === "verify") toast("Verifying backup… " + p.done + " / " + p.total); },
  }).then(() => {
    toast("Backup restored — reloading…");
    setTimeout(() => location.reload(), 600);
  }).catch((e) => {
    toast("Restore failed — " + ((e && e.message) || e) + " Nothing was changed.");
  });
}

// ---------- app switching ----------
function parseHash() {
  const h = (location.hash || "").replace(/^#\/?/, "");
  if (!h) return null;
  const i = h.indexOf("/");
  const head = i === -1 ? h : h.slice(0, i);
  const sub = i === -1 ? null : h.slice(i + 1);
  // #vehicle/<VIN> is the vehicle view, over whichever feature is showing.
  if (head === "vehicle") return sub ? { vehicle: decodeURIComponent(sub).toUpperCase() } : null;
  const app = head === "files" ? "vault" : head;
  if (!byKey(app)) return null;
  return { app, tab: app === "toolbox" ? sub : null, sub };
}

// Record-level deep links: translate a hash sub-path into the target
// feature's message contract. #li/LI54.10-P-070001 opens that document,
// #li/group/54 shows group-54 docs (every LI number embeds its group, so a
// "LI54." search is precise), #inventory/group/54 filters tools,
// #inventory/model/214 and #li/model/214 filter by model series,
// #vault/vin/<VIN> opens that vehicle.
function subMessage(app, sub) {
  if (!sub) return null;
  let dec = sub;
  try { dec = decodeURIComponent(sub); } catch (e) {}
  let m;
  if (app === "li") {
    if ((m = dec.match(/^group\/(\d{2})/))) return { type: "li-search", q: "LI" + m[1] + "." };
    if ((m = dec.match(/^model\/(\d{3})$/))) return { type: "li-filter", model: m[1] };
    if ((m = dec.match(/^search\/(.+)$/))) return { type: "li-search", q: m[1] };
    return { type: "li-open", li: dec };
  }
  if (app === "inventory") {
    if ((m = dec.match(/^group\/(\d{1,2})$/))) return { type: "inventory-filter", grp: m[1] };
    if ((m = dec.match(/^model\/(\d{3})$/))) return { type: "inventory-filter", model: m[1] };
    if ((m = dec.match(/^search\/(.+)$/))) return { type: "inventory-search", q: m[1] };
    return { type: "inventory-open", toolNo: dec.replace(/^tool\//, "") };
  }
  if (app === "vault") {
    if ((m = dec.match(/^vin\/([A-Za-z0-9]{6,17})$/))) return { type: "vault-filter", filter: "vin:" + m[1].toUpperCase() };
    if ((m = dec.match(/^search\/(.+)$/))) return { type: "vault-search", q: m[1] };
  }
  if (app === "ros" && dec) return { type: "shell-nav", id: dec };
  return null;
}

export function activate(name, opts) {
  opts = opts || {};
  name = byKey(name) ? name : DEFAULT_APP;
  if (vehicleView.isOpen()) vehicleView.close();
  KEYS.forEach((k) => {
    const tab = $("#tab-" + k);
    $("#view-" + k).hidden = k !== name;
    tab.classList.toggle("is-active", k === name);
    tab.setAttribute("aria-selected", k === name ? "true" : "false");
    tab.tabIndex = k === name ? 0 : -1; // roving tabindex (ARIA tabs)
  });
  current = name;
  ensureLoaded(name);
  if (name === "toolbox" && opts.tab) deliver("toolbox", { type: "toolbox-open", tab: opts.tab });
  else if (opts.sub) {
    const sm = subMessage(name, opts.sub);
    if (sm) deliver(name, sm);
  }
  // Legacy PWA shortcuts (?view=starred, ?action=add) — honored once.
  if (name === "vault" && opts.starred) deliver("vault", { type: "vault-filter", filter: "starred" });
  if (opts.add) setTimeout(() => $("#shell-file-input").click(), 300);
  document.title = TITLES[name] + " · File Database";
  const subPart = name === "toolbox" ? opts.tab : (opts.sub && subMessage(name, opts.sub) ? opts.sub : null);
  const hash = "#" + name + (subPart ? "/" + subPart : "");
  if (location.hash !== hash || location.search) {
    // Also drop any legacy ?view=/?action= query once it has been consumed,
    // so a reload follows the hash (the latest navigation) instead of
    // snapping back to the shortcut target.
    try { history.replaceState(null, "", location.pathname + hash); } catch (e) {}
  }
  try { localStorage.setItem("fd-app", name); } catch (e) {}
  focusPanel(name);
  updateBadges();
}

// ---------- pinned "Active Vehicle" (platform-wide current-car context) ----------
// A tech works on one car at a time. Pin its VIN once and every data tab
// scopes to that vehicle: Files filters to the VIN, LI Documents and the
// Tool Inventory filter to the model series derived from the VIN's
// Baumuster digits (chars 4-6). Files added through the front door while
// pinned are tagged with the VIN automatically. Unpin clears the scope.
let vehiclePin = null; // { vin, series }
try { const vp = JSON.parse(localStorage.getItem("fd-vehicle") || "null"); if (vp && vp.vin) vehiclePin = vp; } catch (e) {}
const seriesOfVin = FDCore.ids.seriesOfVin;
function vehicleScopeMsg(app) {
  if (app === "vault") return { type: "vault-filter", filter: vehiclePin ? "vin:" + vehiclePin.vin : "all" };
  const model = vehiclePin ? vehiclePin.series : "";
  if (app === "li") return { type: "li-filter", model };
  if (app === "inventory") return { type: "inventory-filter", model };
  return null;
}
function sendVehicleScope(app) {
  const m = vehicleScopeMsg(app);
  if (m) deliver(app, m);
}
function renderVehicleChip() {
  const chip = $("#vehicle-chip");
  if (!chip) return;
  chip.hidden = !vehiclePin;
  if (vehiclePin) {
    $("#vehicle-chip-main").textContent = "🚗 …" + vehiclePin.vin.slice(-6);
    $("#vehicle-chip-main").title = "Active vehicle " + vehiclePin.vin +
      (vehiclePin.series ? " (model " + vehiclePin.series + ")" : "") + " — click for its files";
  }
}
function pinVehicle(vin) {
  vin = String(vin || "").toUpperCase().trim();
  if (!vin) return;
  vehiclePin = { vin, series: seriesOfVin(vin) };
  try { localStorage.setItem("fd-vehicle", JSON.stringify(vehiclePin)); } catch (e) {}
  renderVehicleChip();
  ["vault", "li", "inventory"].forEach((k) => { if (instance(k)) sendVehicleScope(k); });
  toast("Pinned " + vin + (vehiclePin.series ? " — tabs now scope to model " + vehiclePin.series : "") + ".");
}
function unpinVehicle() {
  if (!vehiclePin) return;
  const was = vehiclePin.vin;
  vehiclePin = null;
  try { localStorage.removeItem("fd-vehicle"); } catch (e) {}
  renderVehicleChip();
  ["vault", "li", "inventory"].forEach((k) => { if (instance(k)) sendVehicleScope(k); });
  toast("Unpinned " + was + ".");
}

// ---------- the vehicle view (#vehicle/<VIN>) ----------
// Everything about one car from one query; see vehicle.js. Opening it puts
// the VIN in the address bar; closing it restores the feature's own hash.
const vehicleView = createVehicleView({
  go: (app, msg) => { activate(app); deliver(app, msg); },
  pin: (vin) => pinVehicle(vin),
  toast: (m) => toast(m),
});
function openVehicle(vin, fromHash) {
  vin = String(vin || "").trim().toUpperCase();
  if (!fromHash) { try { history.replaceState(null, "", location.pathname + "#vehicle/" + encodeURIComponent(vin)); } catch (e) {} }
  vehicleView.open(vin, {
    onClose: () => { if (/^#vehicle\//.test(location.hash)) { try { history.replaceState(null, "", location.pathname + "#" + (current || DEFAULT_APP)); } catch (e) {} } },
  });
}

// ---------- Ctrl+K quick-open (ID router + every store's search) ----------
// Recognizes the platform's shared IDs and jumps straight to the record;
// anything else offers a search in each feature with the query carried over.
const QO_LI = FDCore.ids.DOCNUM_EXACT, QO_TOOL = FDCore.ids.TOOL_NO, QO_VIN = FDCore.ids.VIN_SHAPE;
function qoRows(q) {
  const s = liNorm(q).trim(), rows = [];
  let m;
  if (!s) return rows;
  if (QO_LI.test(s)) {
    const li = s.toUpperCase();
    rows.push({ icon: "🗄️", label: "Open " + li + " in LI Documents", app: "li", msg: { type: "li-open", li } });
  }
  if ((m = s.match(QO_TOOL))) {
    const tn = [m[1], m[2], m[3], m[4], m[5]].join(" ");
    rows.push({ icon: "🔧", label: "Open tool " + tn + " in the Tool Inventory", app: "inventory", msg: { type: "inventory-open", toolNo: tn } });
  }
  if (QO_VIN.test(s) && !QO_TOOL.test(s)) {
    const vin = s.toUpperCase();
    rows.push({ icon: "🚗", label: "Files for vehicle " + vin, app: "vault", msg: { type: "vault-filter", filter: "vin:" + vin } });
    rows.push({ icon: "🚘", label: "Vehicle " + vin + " — files, repair orders, LI documents and tools", run: () => openVehicle(vin) });
    rows.push({ icon: "📌", label: "Pin " + vin + " as the active vehicle", run: () => pinVehicle(vin) });
  }
  rows.push({ icon: "📁", label: "Search Files for “" + s + "”", app: "vault", msg: { type: "vault-search", q: s }, fallback: true });
  rows.push({ icon: "🗄️", label: "Search LI Documents for “" + s + "”", app: "li", msg: { type: "li-search", q: s }, fallback: true });
  rows.push({ icon: "🔧", label: "Search the Tool Inventory for “" + s + "”", app: "inventory", msg: { type: "inventory-search", q: s }, fallback: true });
  return rows;
}
// Records that match, from every store: each feature's `search` export
// (src/features/*/search.js — loaded without the feature's UI) plus the
// vehicles the platform has recorded.
let qoSeq = 0;
async function searchVehicles(q) {
  const k = q.replace(/\s+/g, "").toUpperCase();
  if (k.length < 4) return [];
  const list = await FDData.repos.vehicles.list();
  return list.filter((v) => v.vin.includes(k) || (v.fin || "").includes(k)).slice(0, 3).map((v) => ({
    icon: "🚘", label: "Vehicle " + v.vin, detail: [v.series && "model " + v.series, v.status === "confirmed" ? "confirmed" : v.checkDigit ? "check digit OK" : "unverified"].filter(Boolean).join(" · "),
    run: () => openVehicle(v.vin),
  }));
}
async function qoSearch(q) {
  const seq = ++qoSeq;
  const repos = window.FDData && FDData.repos;
  if (!repos) return;
  const groups = await Promise.all(FEATURES.filter((f) => f.search).map(async (f) => {
    try { const mod = await f.search(); return { key: f.key, title: f.title, rows: await mod.search(q, { repos, limit: 5 }) }; }
    catch (e) { return { key: f.key, title: f.title, rows: [] }; }
  }).concat([searchVehicles(q).then((rows) => ({ key: "vehicles", title: "Vehicles", rows }), () => ({ key: "vehicles", title: "Vehicles", rows: [] }))]));
  if (seq !== qoSeq || $("#quickopen").hidden) return;
  const box = $("#qo-found");
  if (!box) return;
  box.innerHTML = "";
  groups.filter((g) => g.rows.length).forEach((g) => {
    const h = document.createElement("div");
    h.className = "qo-group";
    h.textContent = g.title;
    box.append(h);
    g.rows.forEach((r) => box.append(qoButton(r)));
  });
  markFirst();
}
function qoOpen() {
  $("#quickopen").hidden = false;
  const inp = $("#qo-input");
  inp.value = "";
  $("#qo-results").innerHTML = "";
  setTimeout(() => inp.focus(), 0);
}
function qoClose() { $("#quickopen").hidden = true; }
function qoButton(r) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "qo-row";
  b.innerHTML = '<span class="qo-row__icon"></span><span class="qo-row__label"></span><span class="qo-row__detail"></span>';
  b.children[0].textContent = r.icon;
  b.children[1].textContent = r.label;
  b.children[2].textContent = r.detail || "";
  b.onclick = () => {
    qoClose();
    if (r.run) { r.run(); return; }
    activate(r.app);
    deliver(r.app, r.msg);
  };
  return b;
}
function markFirst() {
  const all = Array.from(document.querySelectorAll("#qo-results .qo-row"));
  all.forEach((b, i) => b.classList.toggle("is-first", i === 0));
}
let qoT = null;
function qoRender() {
  const box = $("#qo-results");
  box.innerHTML = "";
  const q = $("#qo-input").value;
  const rows = qoRows(q);
  // Exact IDs first, then records found in the stores, then "search app X".
  rows.filter((r) => !r.fallback).forEach((r) => box.append(qoButton(r)));
  const found = document.createElement("div");
  found.id = "qo-found";
  box.append(found);
  rows.filter((r) => r.fallback).forEach((r) => box.append(qoButton(r)));
  markFirst();
  clearTimeout(qoT);
  const s = liNorm(q).trim();
  if (s.length >= 2) qoT = setTimeout(() => qoSearch(s), 120);
  else qoSeq++;
}

// ---------- tab badges (counts from the shared database, refreshed by change events) ----------
function setBadge(key, n) {
  const el = document.querySelector('[data-count="' + key + '"]');
  if (!el) return;
  const next = (n === null || n === undefined) ? "" : String(n);
  if (el.textContent !== next && next !== "") {
    // Pulse so a background feature's count change is noticeable.
    el.classList.remove("pulse");
    void el.offsetWidth; // restart the animation
    el.classList.add("pulse");
  }
  el.textContent = next;
}
let badgeT = null;
function updateBadges() {
  if (badgeT) return;
  badgeT = setTimeout(() => {
    badgeT = null;
    if (!window.FDData || !FDData.repos) return;
    const r = FDData.repos;
    r.files.countInFiles().then((n) => setBadge("vault", n), () => setBadge("vault", null));
    r.documents.count().then((n) => setBadge("li", n), () => setBadge("li", null));
    r.tools.count().then((n) => setBadge("inventory", n), () => setBadge("inventory", null));
  }, 200);
}
// Which feature runs a job type — it is mounted so queued work starts
// without a visit to that tab.
const JOB_APP = { thumb: "vault", "vin-detect": "vault", "vin-scan": "vault", "li-import": "li", "toolbox-intake": "toolbox" };
function wakeRunners() {
  if (!window.FDData || !FDData.jobs) return;
  FDData.jobs.listActive().then((list) => {
    list.forEach((j) => { if (JOB_APP[j.type]) ensureLoaded(JOB_APP[j.type]); });
  }).catch(() => {});
}

// ---------- the cross-feature contract (what the frames used to postMessage) ----------
function onMessage(d) {
  if (d.type === "shell-nav" && byKey(d.app)) {
    activate(d.app, { tab: d.tab || null });
    // Features can attach a ready-made message for the target (cross-app
    // links: "tools for group 54", "open LI…"). The shell just routes it.
    if (d.payload && d.payload.type) deliver(d.app, d.payload);
  }
  else if (d.type === "vault-nav" && d.to === "files") activate("vault");   // legacy contract
  else if (d.type === "li-changed") updateBadges();
  // A feature hands over files it was given directly, so the platform files
  // them through one router regardless of which tab is showing.
  else if (d.type === "shell-add-files" && d.files) routeFiles(d.files, { collection: d.collection || "", vin: d.vin || "", roId: d.roId || "", stay: !!d.stay, routed: true });
  else if (d.type === "shell-open-picker") $("#shell-file-input").click();
  // Deliver a message to another feature WITHOUT switching to it (used by
  // Repair Orders to keep an RO's files in sync in the background).
  else if (d.type === "shell-relay" && byKey(d.app) && d.payload) { ensureLoaded(d.app); deliver(d.app, d.payload); }
  // Toast relay: a feature in a BACKGROUND tab announced something (import
  // finished, sync ran). Surface it with an app prefix — otherwise it toasts
  // invisibly inside a hidden panel.
  else if (d.type === "shell-toast" && byKey(d.app) && d.msg) {
    if (d.app !== current) toast(TITLES[d.app] + ": " + d.msg);
    updateBadges();
  }
  else if (d.type === "shell-switch" && d.n >= 1 && d.n <= KEYS.length) activate(KEYS[d.n - 1]);
  else if (d.type === "shell-quickopen") qoOpen();
  // A feature asks to pin the active vehicle (vault By-VIN header / detail).
  else if (d.type === "shell-pin-vehicle" && d.vin) pinVehicle(d.vin);
  // A feature opens the vehicle view (a file's or an RO's 🚗 button).
  else if (d.type === "shell-vehicle" && d.vin) openVehicle(d.vin);
}

// ---------- boot ----------
// The database opens first — on a profile with the old per-app databases
// the migration dialog runs here, before any feature can open them.
export function boot() {
  applyTheme();
  const ready = (window.FDData && FDData.boot) ? FDData.boot() : Promise.resolve();
  ready.then(null, (e) => { toast("Couldn't open the database — " + ((e && e.message) || e)); }).then(bootShell);
}
function bootShell() {
  if (window.matchMedia) {
    try {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if (themeMode === "system") applyTheme();
      });
    } catch (e) {}
  }

  KEYS.forEach((k) => { $("#tab-" + k).addEventListener("click", () => activate(k)); });
  $("#shell-theme-btn").addEventListener("click", cycleTheme);

  // Pinned-vehicle chip: click = that vehicle's files; ✕ = unpin.
  renderVehicleChip();
  $("#vehicle-chip-main").addEventListener("click", () => {
    if (!vehiclePin) return;
    activate("vault");
    deliver("vault", { type: "vault-filter", filter: "vin:" + vehiclePin.vin });
  });
  $("#vehicle-chip-unpin").addEventListener("click", unpinVehicle);

  // One-click platform backup: ONE download — a .fdb with everything
  // (files, LI documents, tools, repair orders, links, vehicles, the trash,
  // settings) with every blob's sha256 in its manifest; restoring it is one
  // step into a new database generation. Each app's own export (.fvault,
  // .lidb, .tidb) stays in that app's menu.
  $("#backup-all-btn").addEventListener("click", () => {
    if (!window.FDData || !FDData.backup) { toast("Backup isn't available."); return; }
    toast("Backing up…");
    FDData.backup.collect().then((r) => {
      downloadBlob(r.blob, FDData.backup.fileName());
      const n = r.meta.records;
      toast("Backed up " + n.files.length + " files, " + n.documents.length + " LI documents, " + n.tools.length + " tools and " + n.ros.length + " repair orders.");
    }).catch((e) => { toast("Backup failed — " + ((e && e.message) || e)); });
  });

  // Unified "Add files": one button + one hidden input for the whole platform.
  const fileInput = $("#shell-file-input");
  $("#shell-add-btn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => { routeFiles(e.target.files); e.target.value = ""; });

  // Full-window drop zone and paste: files land in the one router. A
  // feature's own drop zone (an RO's attachments, a Toolbox tool) handles
  // its drop first and marks it handled; the feature on screen can add
  // context to the rest (the Vault collection that is open).
  const drop = $("#shell-drop");
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") !== -1;
  const context = () => { const a = instance(current); return (a && a.dropContext && a.dropContext()) || {}; };
  window.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; drop.hidden = false; });
  window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) drop.hidden = true; });
  window.addEventListener("drop", () => { dragDepth = 0; drop.hidden = true; }, true);
  window.addEventListener("drop", (e) => {
    if (!e.dataTransfer) return;
    if (e.defaultPrevented) return; // a feature's own drop zone took it
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length) routeFiles(e.dataTransfer.files, context());
  });
  window.addEventListener("paste", (e) => {
    if (e.defaultPrevented) return; // a feature took the paste (the OCR tool's image)
    const t = e.composedPath ? e.composedPath()[0] : e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
    if (files.length) { e.preventDefault(); routeFiles(files, context()); }
  });

  // Alt+1–6 switches features from anywhere; Ctrl/Cmd+K opens quick-open.
  // (Events from inside a feature's shadow root reach the window too.)
  window.addEventListener("keydown", (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key >= "1" && e.key <= "9") {
      if (+e.key <= KEYS.length) { e.preventDefault(); activate(KEYS[+e.key - 1]); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      qoOpen();
      return;
    }
    if (e.key === "Escape" && !$("#quickopen").hidden) { qoClose(); return; }
    // A feature's own shortcuts listen on its shadow root. A key pressed while
    // nothing inside the feature has focus (the page body, the tab bar) is
    // re-dispatched inside the feature on screen, so it reaches the feature
    // exactly as it reached the app's document inside its frame.
    const en = mounted[current];
    if (!en || !en.root || (e.composedPath && e.composedPath().includes(en.host))) return;
    const t = e.composedPath ? e.composedPath()[0] : e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    const el = en.root.querySelector(".fd-root");
    if (!el) return;
    const ev = new KeyboardEvent("keydown", { key: e.key, code: e.code, keyCode: e.keyCode, which: e.which, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, repeat: e.repeat, bubbles: true, cancelable: true, composed: false });
    el.dispatchEvent(ev);
    if (ev.defaultPrevented) e.preventDefault();
  });

  // Quick-open wiring
  $("#qo-input").addEventListener("input", qoRender);
  $("#qo-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { const first = $("#qo-results .qo-row"); if (first) first.click(); }
    else if (e.key === "Escape") qoClose();
  });
  $("#quickopen").addEventListener("click", (e) => { if (e.target === $("#quickopen")) qoClose(); });

  // ARIA tabs keyboard pattern: arrows move + activate, Home/End jump.
  $("#tabs").addEventListener("keydown", (e) => {
    const i = KEYS.indexOf(current);
    let next = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = KEYS[(i + 1) % KEYS.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = KEYS[(i - 1 + KEYS.length) % KEYS.length];
    else if (e.key === "Home") next = KEYS[0];
    else if (e.key === "End") next = KEYS[KEYS.length - 1];
    if (next) { e.preventDefault(); activate(next); $("#tab-" + next).focus(); }
  });

  window.addEventListener("focus", updateBadges);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) updateBadges(); });
  // Every commit in any context announces itself: badges follow, and a
  // queued job wakes the feature that runs it.
  if (window.FDData && FDData.bus) {
    ["files:changed", "documents:changed", "tools:changed", "db:generation"].forEach((t) => FDData.bus.on(t, updateBadges));
    ["files:changed", "ros:changed", "vehicles:changed"].forEach((t) => FDData.bus.on(t, () => vehicleView.refresh()));
    FDData.bus.on("jobs:changed", (d) => { if (d.op === "enqueue" && JOB_APP[d.type]) ensureLoaded(JOB_APP[d.type]); });
  }
  wakeRunners();

  // Initial feature: hash (latest navigation) > legacy query params > last
  // used > default. The query is only honored on hashless URLs (PWA
  // shortcuts, old bookmarks) — activate() strips it once consumed.
  const params = new URLSearchParams(location.search);
  const view = params.get("view"), action = params.get("action");
  const fromHash = parseHash();
  if (fromHash && fromHash.vehicle) {
    let last = null;
    try { last = localStorage.getItem("fd-app"); } catch (e) {}
    activate(byKey(last) ? last : DEFAULT_APP);
    openVehicle(fromHash.vehicle);
  }
  else if (fromHash) activate(fromHash.app, { tab: fromHash.tab, sub: fromHash.sub });
  else if (view === "li" || view === "inventory") activate(view);
  else if (view === "starred" || action === "add") activate("vault", { starred: view === "starred", add: action === "add" });
  else {
    let last = null;
    try { last = localStorage.getItem("fd-app"); } catch (e) {}
    activate(byKey(last) ? last : DEFAULT_APP);
  }
  window.addEventListener("hashchange", () => {
    const h = parseHash();
    if (h && h.vehicle) { openVehicle(h.vehicle, true); return; }
    if (h && h.app !== current) activate(h.app, { tab: h.tab, sub: h.sub });
    else if (h && h.app === "toolbox" && h.tab) deliver("toolbox", { type: "toolbox-open", tab: h.tab });
    else if (h && h.sub) {
      const sm = subMessage(h.app, h.sub);
      if (sm) deliver(h.app, sm);
    }
  });

  // PWA install
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); deferredPrompt = e; $("#shell-install-btn").hidden = false;
  });
  $("#shell-install-btn").addEventListener("click", () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(() => { deferredPrompt = null; $("#shell-install-btn").hidden = true; });
  });
  window.addEventListener("appinstalled", () => { $("#shell-install-btn").hidden = true; toast("File Database installed."); });

  // The one service worker.
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("sw.js").then((reg) => {
      try { reg.update(); } catch (e) {}
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) toast("Update installed — refreshing…");
        });
      });
    }).catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || reloaded) { hadController = true; return; }
      reloaded = true;
      location.reload();
    });
  }

  // Spell-check every text field, including ones created after load and
  // ones inside a feature's shadow root — flipping the flag at focus time
  // covers them all without touching each creation site.
  document.addEventListener("focusin", (e) => {
    const t = e.composedPath ? e.composedPath()[0] : e.target;
    if (!t || !t.tagName) return;
    if (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && (t.type === "text" || t.type === "search"))) t.spellcheck = true;
  });

  updateBadges();
}

// Exposed for the browser suites and the console.
window.FDShell = { activate, deliver, ensureLoaded, instance, toast, send: api.send, openVehicle, get current() { return current; } };
