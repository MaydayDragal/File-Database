/*
 * shell.js — File Database platform shell.
 * Hosts the four apps (Files / LI Documents / Tool Inventory / Toolbox) as
 * lazy same-origin iframes, owns cross-app navigation, the shared theme, tab
 * badges and the platform PWA. File handoffs between apps go over bridge.js
 * (IndexedDB + BroadcastChannel), never through the shell.
 */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };

  var APPS = {
    vault:     { view: "#view-vault",     frame: "#frame-vault",     tab: "#tab-vault",     src: "vault/index.html",     title: "Files",          loaded: false, pending: [] },
    li:        { view: "#view-li",        frame: "#frame-li",        tab: "#tab-li",        src: "li/index.html",        title: "LI Documents",   loaded: false, pending: [] },
    inventory: { view: "#view-inventory", frame: "#frame-inventory", tab: "#tab-inventory", src: "inventory/index.html", title: "Tool Inventory", loaded: false, pending: [] },
    toolbox:   { view: "#view-toolbox",   frame: "#frame-toolbox",   tab: "#tab-toolbox",   src: "toolbox/index.html",   title: "Toolbox",        loaded: false, pending: [] },
    viewer:    { view: "#view-viewer",    frame: "#frame-viewer",    tab: "#tab-viewer",    src: "viewer.html",          title: "Extract",        loaded: false, pending: [] },
  };
  var DEFAULT_APP = "vault";
  var current = null;

  var toastT;
  function toast(m) {
    var t = $("#toast"); if (!t) return;
    t.textContent = m; t.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  // ---------- theme (shared contract: localStorage "fv-theme" + data-theme attr) ----------
  var THEMES = ["system", "light", "dark"];
  var themeMode = "system";
  try { var st = localStorage.getItem("fv-theme"); if (st === "light" || st === "dark") themeMode = st; } catch (e) {}

  function applyTheme() {
    var root = document.documentElement;
    if (themeMode === "light" || themeMode === "dark") root.setAttribute("data-theme", themeMode);
    else root.removeAttribute("data-theme");
    var dark = themeMode === "dark" ||
      (themeMode === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#16203a" : "#4f46e5");
    var di = $(".theme-icon-dark"), li = $(".theme-icon-light");
    if (di && li) { di.hidden = dark; li.hidden = !dark; }
  }
  function persistTheme() {
    try {
      if (themeMode === "system") localStorage.removeItem("fv-theme");
      else localStorage.setItem("fv-theme", themeMode);
    } catch (e) {}
  }
  function broadcastTheme(frameEl) {
    var msg = { type: "platform-theme", mode: themeMode };
    var targets = frameEl ? [frameEl] : Object.keys(APPS).map(function (k) { return APPS[k].loaded ? $(APPS[k].frame) : null; });
    targets.forEach(function (f) {
      if (f && f.contentWindow) { try { f.contentWindow.postMessage(msg, "*"); } catch (e) {} }
    });
  }
  function cycleTheme() {
    themeMode = THEMES[(THEMES.indexOf(themeMode) + 1) % THEMES.length];
    applyTheme(); persistTheme(); broadcastTheme();
    toast("Theme: " + themeMode);
  }

  // ---------- unified file intake (one front door, auto-filed) ----------
  // A file is an "LI document" if it's a PDF whose name carries a Mercedes
  // document number — the SAME pattern the LI app uses to identify one
  // (DOCNUM in li/index.html). Those go to LI Documents; everything else to
  // Files. Detection is silent: no prompt, no per-drop choice.
  var LI_DOCNUM = /\b[A-Z]{2}\d{2}\.\d{2}-[A-Z]-\d{5,7}\b/i;
  function isPdf(f) { return /pdf/i.test(f.type || "") || /\.pdf$/i.test(f.name || ""); }
  function looksLikeLI(f) { return isPdf(f) && LI_DOCNUM.test(f.name || ""); }

  // Load an app's iframe without switching to it, so a routed file's receiver
  // is live and ingests immediately (badges then catch up).
  function ensureLoaded(name) {
    var a = APPS[name];
    if (a && !a.loaded) { a.loaded = true; $(a.frame).src = a.src; }
  }

  function routeFiles(list, opts) {
    opts = opts || {};
    var files = Array.prototype.slice.call(list || []).filter(Boolean);
    if (!files.length) return;
    if (!window.VaultBridge) { toast("Couldn't add files — transfer bus unavailable."); return; }
    var toLI = [], toVault = [], special = [];
    files.forEach(function (f) {
      var n = (f.name || "").toLowerCase();
      // The platform's own database files open in their app instead of being
      // stored as opaque blobs: .tidb → Tool Inventory, .fvault → Files
      // restore, .lidb → LI restore. (.zip stays a regular file — only LI's
      // own .lidb extension is unambiguous.)
      if (/\.tidb$/.test(n)) special.push({ app: "inventory", msg: { type: "inventory-import", file: f }, label: "Tool Inventory" });
      else if (/\.fvault$/.test(n)) special.push({ app: "vault", msg: { type: "vault-restore", file: f }, label: "Files (restore)" });
      else if (/\.lidb$/.test(n)) special.push({ app: "li", msg: { type: "li-restore", file: f }, label: "LI Documents (restore)" });
      else (looksLikeLI(f) ? toLI : toVault).push(f);
    });

    special.forEach(function (s) {
      ensureLoaded(s.app);
      frameMessage(s.app, s.msg);
      toast("Opening " + s.msg.file.name + " in " + s.label + "…");
    });

    // Read each file's bytes NOW, at the moment of adding. A dropped File is a
    // lazy handle to its source — if that source is a OneDrive/network
    // placeholder, a locked file, or an app's temp export, a LATER read (when
    // the databases serialize it) can silently return garbage. Reading eagerly
    // surfaces the failure immediately instead of storing a corrupt copy.
    var MATERIALIZE_MAX = 256 * 1024 * 1024; // beyond this, keep the handle (memory)
    function materialize(f) {
      if (f.size > MATERIALIZE_MAX) return Promise.resolve(f);
      return f.arrayBuffer().then(function (buf) {
        if (f.size && !buf.byteLength) throw new Error("empty read");
        return new File([buf], f.name, { type: f.type });
      });
    }

    function deliver(target, arr) {
      if (!arr.length) return;
      ensureLoaded(target);
      arr.forEach(function (f) {
        // While a vehicle is pinned, files headed for the vault are tagged
        // with its VIN — new paperwork joins the car with zero clicks. A drop
        // forwarded from inside an open vault collection keeps that collection.
        var meta = { fromShell: true };
        if (target === "vault" && vehiclePin) meta.vin = vehiclePin.vin;
        if (target === "vault" && opts.collection) meta.collection = opts.collection;
        materialize(f)
          .then(function (safe) { return window.VaultBridge.send(target, { name: f.name, type: f.type, blob: safe, meta: meta }); })
          .catch(function () { toast('Couldn’t read “' + f.name + '” — if it lives in OneDrive or on a network drive, open it once (or copy it locally), then add it again.'); });
      });
    }
    deliver("li", toLI);
    deliver("vault", toVault);

    var n = toLI.length + toVault.length;
    if (n) {
      var parts = [];
      if (toVault.length) parts.push(toVault.length + " to Files");
      if (toLI.length) parts.push(toLI.length + " to LI Documents");
      toast("Added " + n + (n === 1 ? " file" : " files") + " — " + parts.join(" · ") + ".");
    }

    // Surface the app that received the batch: a database file opens its app;
    // otherwise a single-target batch switches, a mixed batch stays put.
    var only = special.length === 1 && !n ? special[0].app
      : (!special.length && toLI.length && !toVault.length) ? "li"
      : (!special.length && toVault.length && !toLI.length) ? "vault" : null;
    if (only && only !== current) activate(only);

    // New rows land after the receiver ingests (LI may OCR) — nudge the badges.
    [500, 1500, 3500].forEach(function (d) { setTimeout(updateBadges, d); });
  }

  // ---------- app switching ----------
  function parseHash() {
    var h = (location.hash || "").replace(/^#\/?/, "");
    if (!h) return null;
    var i = h.indexOf("/");
    var head = i === -1 ? h : h.slice(0, i);
    var sub = i === -1 ? null : h.slice(i + 1);
    var app = head === "files" ? "vault" : head;
    if (!APPS[app]) return null;
    return { app: app, tab: app === "toolbox" ? sub : null, sub: sub };
  }

  // Record-level deep links: translate a hash sub-path into the target app's
  // message contract. #li/LI54.10-P-070001 opens that document, #li/group/54
  // shows group-54 docs (every LI number embeds its group, so a "LI54." search
  // is precise), #inventory/group/54 filters tools, #inventory/model/214 and
  // #li/model/214 filter by model series, #vault/vin/<VIN> opens that vehicle.
  function subMessage(app, sub) {
    if (!sub) return null;
    var dec = sub;
    try { dec = decodeURIComponent(sub); } catch (e) {}
    var m;
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
    return null;
  }

  function frameMessage(app, msg) {
    var a = APPS[app];
    var f = $(a.frame);
    if (a.ready && f && f.contentWindow) { try { f.contentWindow.postMessage(msg, "*"); } catch (e) {} }
    else a.pending.push(msg);
  }

  function activate(name, opts) {
    opts = opts || {};
    var app = APPS[name] || APPS[DEFAULT_APP];
    name = APPS[name] ? name : DEFAULT_APP;
    Object.keys(APPS).forEach(function (k) {
      var a = APPS[k];
      $(a.view).hidden = k !== name;
      $(a.tab).classList.toggle("is-active", k === name);
      $(a.tab).setAttribute("aria-selected", k === name ? "true" : "false");
      $(a.tab).tabIndex = k === name ? 0 : -1; // roving tabindex (ARIA tabs)
    });
    if (!app.loaded) {
      app.loaded = true;
      var src = app.src;
      if (name === "vault" && opts.query) src += opts.query;
      $(app.frame).src = src;
    }
    if (name === "toolbox" && opts.tab) frameMessage("toolbox", { type: "toolbox-open", tab: opts.tab });
    else if (opts.sub) {
      var sm = subMessage(name, opts.sub);
      if (sm) frameMessage(name, sm);
    }
    current = name;
    document.title = app.title + " · File Database";
    var subPart = name === "toolbox" ? opts.tab : (opts.sub && subMessage(name, opts.sub) ? opts.sub : null);
    var hash = "#" + name + (subPart ? "/" + subPart : "");
    if (location.hash !== hash || location.search) {
      // Also drop any legacy ?view=/?action= query once it has been consumed,
      // so a reload follows the hash (the latest navigation) instead of
      // snapping back to the shortcut target.
      try { history.replaceState(null, "", location.pathname + hash); } catch (e) {}
    }
    try { localStorage.setItem("fd-app", name); } catch (e) {}
    updateBadges();
  }

  // ---------- pinned "Active Vehicle" (platform-wide current-car context) ----------
  // A tech works on one car at a time. Pin its VIN once and every data tab
  // scopes to that vehicle: Files filters to the VIN, LI Documents and the
  // Tool Inventory filter to the model series derived from the VIN's
  // Baumuster digits (chars 4-6). Files added through the front door while
  // pinned are tagged with the VIN automatically. Unpin clears the scope.
  var vehiclePin = null; // { vin, series }
  try { var vp = JSON.parse(localStorage.getItem("fd-vehicle") || "null"); if (vp && vp.vin) vehiclePin = vp; } catch (e) {}
  function seriesOfVin(vin) {
    var s = String(vin || "").toUpperCase();
    return s.length === 17 && /^\d{3}$/.test(s.slice(3, 6)) ? s.slice(3, 6) : "";
  }
  function vehicleScopeMsg(app) {
    if (app === "vault") return { type: "vault-filter", filter: vehiclePin ? "vin:" + vehiclePin.vin : "all" };
    var model = vehiclePin ? vehiclePin.series : "";
    if (app === "li") return { type: "li-filter", model: model };
    if (app === "inventory") return { type: "inventory-filter", model: model };
    return null;
  }
  function sendVehicleScope(app) {
    var m = vehicleScopeMsg(app);
    if (m) frameMessage(app, m);
  }
  function renderVehicleChip() {
    var chip = $("#vehicle-chip");
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
    vehiclePin = { vin: vin, series: seriesOfVin(vin) };
    try { localStorage.setItem("fd-vehicle", JSON.stringify(vehiclePin)); } catch (e) {}
    renderVehicleChip();
    ["vault", "li", "inventory"].forEach(function (k) { if (APPS[k].loaded) sendVehicleScope(k); });
    toast("Pinned " + vin + (vehiclePin.series ? " — tabs now scope to model " + vehiclePin.series : "") + ".");
  }
  function unpinVehicle() {
    if (!vehiclePin) return;
    var was = vehiclePin.vin;
    vehiclePin = null;
    try { localStorage.removeItem("fd-vehicle"); } catch (e) {}
    renderVehicleChip();
    ["vault", "li", "inventory"].forEach(function (k) { if (APPS[k].loaded) sendVehicleScope(k); });
    toast("Unpinned " + was + ".");
  }

  // ---------- Ctrl+K quick-open (ID router) ----------
  // Recognizes the platform's shared IDs and jumps straight to the record;
  // anything else offers a search in each app with the query carried over.
  var QO_LI = /^[A-Z]{2}\d{2}\.\d{2}-[A-Z]-\d{5,7}$/i;
  var QO_TOOL = /^(\d{3})\s*(\d{3})\s*(\d{2})\s*(\d{2})\s*(\d{2})$/;
  var QO_VIN = /^[A-HJ-NPR-Z0-9]{17}$/i;
  function qoRows(q) {
    var s = q.trim(), rows = [], m;
    if (!s) return rows;
    if (QO_LI.test(s)) {
      var li = s.toUpperCase();
      rows.push({ icon: "🗄️", label: "Open " + li + " in LI Documents", app: "li", msg: { type: "li-open", li: li } });
    }
    if ((m = s.match(QO_TOOL))) {
      var tn = [m[1], m[2], m[3], m[4], m[5]].join(" ");
      rows.push({ icon: "🔧", label: "Open tool " + tn + " in the Tool Inventory", app: "inventory", msg: { type: "inventory-open", toolNo: tn } });
    }
    if (QO_VIN.test(s) && !QO_TOOL.test(s)) {
      var vin = s.toUpperCase();
      rows.push({ icon: "🚗", label: "Files for vehicle " + vin, app: "vault", msg: { type: "vault-filter", filter: "vin:" + vin } });
      rows.push({ icon: "📌", label: "Pin " + vin + " as the active vehicle", run: function () { pinVehicle(vin); } });
    }
    rows.push({ icon: "📁", label: "Search Files for “" + s + "”", app: "vault", msg: { type: "vault-search", q: s } });
    rows.push({ icon: "🗄️", label: "Search LI Documents for “" + s + "”", app: "li", msg: { type: "li-search", q: s } });
    rows.push({ icon: "🔧", label: "Search the Tool Inventory for “" + s + "”", app: "inventory", msg: { type: "inventory-search", q: s } });
    return rows;
  }
  function qoOpen() {
    $("#quickopen").hidden = false;
    var inp = $("#qo-input");
    inp.value = "";
    $("#qo-results").innerHTML = "";
    setTimeout(function () { inp.focus(); }, 0);
  }
  function qoClose() { $("#quickopen").hidden = true; }
  function qoRender() {
    var box = $("#qo-results");
    box.innerHTML = "";
    qoRows($("#qo-input").value).forEach(function (r, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "qo-row" + (i === 0 ? " is-first" : "");
      b.innerHTML = '<span class="qo-row__icon">' + r.icon + "</span><span></span>";
      b.lastChild.textContent = r.label;
      b.onclick = function () {
        qoClose();
        if (r.run) { r.run(); return; }
        activate(r.app);
        frameMessage(r.app, r.msg);
      };
      box.append(b);
    });
  }

  // ---------- tab badges (peek sibling app databases without creating them) ----------
  function peekCount(dbName, store) {
    return new Promise(function (resolve) {
      var req;
      try { req = indexedDB.open(dbName); } catch (e) { resolve(null); return; }
      var created = false;
      req.onupgradeneeded = function () { created = true; try { req.transaction.abort(); } catch (e) {} };
      req.onsuccess = function () {
        var db = req.result;
        try {
          if (!db.objectStoreNames.contains(store)) { db.close(); resolve(null); return; }
          var c = db.transaction(store, "readonly").objectStore(store).count();
          c.onsuccess = function () { db.close(); resolve(c.result); };
          c.onerror = function () { db.close(); resolve(null); };
        } catch (e) { db.close(); resolve(null); }
      };
      req.onerror = function () { resolve(null); };
      req.onblocked = function () { resolve(null); };
      if (created) resolve(null);
    });
  }
  function setBadge(key, n) {
    var el = document.querySelector('[data-count="' + key + '"]');
    if (!el) return;
    var next = (n === null || n === undefined) ? "" : String(n);
    if (el.textContent !== next && next !== "") {
      // Pulse so a background app's count change is noticeable.
      el.classList.remove("pulse");
      void el.offsetWidth; // restart the animation
      el.classList.add("pulse");
    }
    el.textContent = next;
  }
  var badgeT = null;
  function updateBadges() {
    if (badgeT) return;
    badgeT = setTimeout(function () {
      badgeT = null;
      peekCount("file-vault", "files").then(function (n) { setBadge("vault", n); });
      peekCount("LIDocsDB", "docs").then(function (n) { setBadge("li", n); });
      peekCount("tool-inventory", "tools").then(function (n) { setBadge("inventory", n); });
    }, 200);
  }

  // ---------- boot ----------
  function boot() {
    applyTheme();
    if (window.matchMedia) {
      try {
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
          if (themeMode === "system") applyTheme();
        });
      } catch (e) {}
    }

    // Wire tabs
    Object.keys(APPS).forEach(function (k) {
      $(APPS[k].tab).addEventListener("click", function () { activate(k); });
      var f = $(APPS[k].frame);
      f.addEventListener("load", function () {
        if (!f.src) return;
        APPS[k].ready = true;
        broadcastTheme(f);
        // Apply the pinned-vehicle scope BEFORE flushing queued messages, so
        // an explicit deep link/navigation queued for this app wins over it.
        if (vehiclePin && (k === "vault" || k === "li" || k === "inventory")) sendVehicleScope(k);
        APPS[k].pending.splice(0).forEach(function (m) {
          try { f.contentWindow.postMessage(m, "*"); } catch (e) {}
        });
        updateBadges();
      });
    });
    $("#theme-btn").addEventListener("click", cycleTheme);

    // Pinned-vehicle chip: click = that vehicle's files; ✕ = unpin.
    renderVehicleChip();
    $("#vehicle-chip-main").addEventListener("click", function () {
      if (!vehiclePin) return;
      activate("vault");
      frameMessage("vault", { type: "vault-filter", filter: "vin:" + vehiclePin.vin });
    });
    $("#vehicle-chip-unpin").addEventListener("click", unpinVehicle);

    // One-click platform backup: each app runs its own existing export
    // (.fvault, .lidb, .tidb) — three files, one button, no menu spelunking.
    // Staggered so three save prompts don't land at the same instant.
    $("#backup-all-btn").addEventListener("click", function () {
      toast("Backing up all three databases…");
      ["vault", "li", "inventory"].forEach(function (k, i) {
        ensureLoaded(k);
        setTimeout(function () { frameMessage(k, { type: "platform-backup" }); }, i * 1200);
      });
    });

    // Unified "Add files": one button + one hidden input for the whole platform.
    var fileInput = $("#shell-file-input");
    $("#add-btn").addEventListener("click", function () { fileInput.click(); });
    fileInput.addEventListener("change", function (e) { routeFiles(e.target.files); e.target.value = ""; });

    // Full-window drop zone. Drops on the shell chrome land here; drops over an
    // app's iframe are caught inside that app and forwarded up as shell-add-files.
    var drop = $("#shell-drop"), dragDepth = 0;
    function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") !== -1; }
    window.addEventListener("dragenter", function (e) { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; drop.hidden = false; });
    window.addEventListener("dragover", function (e) { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener("dragleave", function () { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) drop.hidden = true; });
    window.addEventListener("drop", function (e) {
      if (!e.dataTransfer) return;
      e.preventDefault(); dragDepth = 0; drop.hidden = true;
      if (e.dataTransfer.files && e.dataTransfer.files.length) routeFiles(e.dataTransfer.files);
    });

    // Alt+1–5 switches apps from anywhere in the shell chrome (apps forward
    // the same combo up from inside their iframes as {shell-switch});
    // Ctrl/Cmd+K opens quick-open (forwarded as {shell-quickopen}).
    window.addEventListener("keydown", function (e) {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key >= "1" && e.key <= "9") {
        var order = Object.keys(APPS);
        if (+e.key <= order.length) { e.preventDefault(); activate(order[+e.key - 1]); }
      } else if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        qoOpen();
      } else if (e.key === "Escape" && !$("#quickopen").hidden) {
        qoClose();
      }
    });

    // Quick-open wiring
    $("#qo-input").addEventListener("input", qoRender);
    $("#qo-input").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { var first = $("#qo-results .qo-row"); if (first) first.click(); }
      else if (e.key === "Escape") qoClose();
    });
    $("#quickopen").addEventListener("click", function (e) { if (e.target === $("#quickopen")) qoClose(); });

    // ARIA tabs keyboard pattern: arrows move + activate, Home/End jump.
    $("#tabs").addEventListener("keydown", function (e) {
      var order = Object.keys(APPS);
      var i = order.indexOf(current);
      var next = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = order[(i + 1) % order.length];
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = order[(i - 1 + order.length) % order.length];
      else if (e.key === "Home") next = order[0];
      else if (e.key === "End") next = order[order.length - 1];
      if (next) { e.preventDefault(); activate(next); $(APPS[next].tab).focus(); }
    });

    // Cross-app navigation + notifications from the apps
    window.addEventListener("message", function (e) {
      var d = e.data || {};
      if (d.type === "shell-nav" && APPS[d.app]) {
        activate(d.app, { tab: d.tab || null });
        // Apps can attach a ready-made message for the target app (cross-app
        // links: "tools for group 54", "open LI…"). The shell just routes it.
        if (d.payload && d.payload.type) frameMessage(d.app, d.payload);
      }
      else if (d.type === "vault-nav" && d.to === "files") activate("vault");   // legacy contract
      else if (d.type === "li-changed") updateBadges();
      // An embedded app forwards files dropped/pasted over it, so the platform
      // files them through one router regardless of which tab is showing.
      else if (d.type === "shell-add-files" && d.files) routeFiles(d.files, { collection: d.collection || "" });
      else if (d.type === "shell-open-picker") $("#shell-file-input").click();
      // Toast relay: an app in a BACKGROUND tab announced something (import
      // finished, sync ran, bridge delivery). Surface it with an app prefix —
      // otherwise it toasts invisibly inside a hidden iframe.
      else if (d.type === "shell-toast" && APPS[d.app] && d.msg) {
        if (d.app !== current) toast(APPS[d.app].title + ": " + d.msg);
        updateBadges();
      }
      // Keyboard forwarded from inside an iframe (Alt+N app switching).
      else if (d.type === "shell-switch" && d.n >= 1 && d.n <= Object.keys(APPS).length) {
        activate(Object.keys(APPS)[d.n - 1]);
      }
      else if (d.type === "shell-quickopen") qoOpen();
      // An app asks to pin the active vehicle (vault By-VIN header / detail).
      else if (d.type === "shell-pin-vehicle" && d.vin) pinVehicle(d.vin);
    });
    window.addEventListener("focus", updateBadges);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) updateBadges(); });

    // Initial app: hash (latest navigation) > legacy query params > last used
    // > default. The query is only honored on hashless URLs (PWA shortcuts,
    // old bookmarks) — activate() strips it once consumed.
    var params = new URLSearchParams(location.search);
    var view = params.get("view"), action = params.get("action");
    var fromHash = parseHash();
    if (fromHash) activate(fromHash.app, { tab: fromHash.tab, sub: fromHash.sub });
    else if (view === "li" || view === "inventory") activate(view);
    else if (view === "starred" || action === "add") activate("vault", { query: location.search });
    else {
      var last = null;
      try { last = localStorage.getItem("fd-app"); } catch (e) {}
      activate(APPS[last] ? last : DEFAULT_APP);
    }
    window.addEventListener("hashchange", function () {
      var h = parseHash();
      if (h && h.app !== current) activate(h.app, { tab: h.tab, sub: h.sub });
      else if (h && h.app === "toolbox" && h.tab) frameMessage("toolbox", { type: "toolbox-open", tab: h.tab });
      else if (h && h.sub) {
        var sm = subMessage(h.app, h.sub);
        if (sm) frameMessage(h.app, sm);
      }
    });

    // PWA install
    var deferredPrompt = null;
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault(); deferredPrompt = e; $("#install-btn").hidden = false;
    });
    $("#install-btn").addEventListener("click", function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () { deferredPrompt = null; $("#install-btn").hidden = true; });
    });
    window.addEventListener("appinstalled", function () { $("#install-btn").hidden = true; toast("File Database installed."); });

    // Service worker (platform scope; each app keeps its own SW for its folder)
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
      var hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register("sw.js").then(function (reg) {
        try { reg.update(); } catch (e) {}
        reg.addEventListener("updatefound", function () {
          var nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", function () {
            if (nw.state === "installed" && navigator.serviceWorker.controller) toast("Update installed — refreshing…");
          });
        });
      }).catch(function () {});
      var reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", function () {
        if (!hadController || reloaded) { hadController = true; return; }
        reloaded = true;
        location.reload();
      });
    }

    updateBadges();
  }

  // Spell-check every text field, including ones created after load —
  // flipping the flag at focus time covers them all without touching each
  // creation site.
  document.addEventListener("focusin", (e) => {
    const t = e.target;
    if (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && (t.type === "text" || t.type === "search"))) t.spellcheck = true;
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
