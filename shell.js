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

  function routeFiles(list) {
    var files = Array.prototype.slice.call(list || []).filter(Boolean);
    if (!files.length) return;
    if (!window.VaultBridge) { toast("Couldn't add files — transfer bus unavailable."); return; }
    var toLI = [], toVault = [];
    files.forEach(function (f) { (looksLikeLI(f) ? toLI : toVault).push(f); });

    function deliver(target, arr) {
      if (!arr.length) return;
      ensureLoaded(target);
      arr.forEach(function (f) {
        window.VaultBridge.send(target, { name: f.name, type: f.type, blob: f, meta: { fromShell: true } })
          .catch(function () { toast('Couldn’t add “' + f.name + '”.'); });
      });
    }
    deliver("li", toLI);
    deliver("vault", toVault);

    var parts = [];
    if (toVault.length) parts.push(toVault.length + " to Files");
    if (toLI.length) parts.push(toLI.length + " to LI Documents");
    toast("Added " + files.length + (files.length === 1 ? " file" : " files") + " — " + parts.join(" · ") + ".");

    // If the whole batch belongs to one app, surface it so the user sees the
    // result; a mixed batch stays put (switching would hide half of it).
    var only = toLI.length && !toVault.length ? "li" : (toVault.length && !toLI.length ? "vault" : null);
    if (only && only !== current) activate(only);

    // New rows land after the receiver ingests (LI may OCR) — nudge the badges.
    [500, 1500, 3500].forEach(function (d) { setTimeout(updateBadges, d); });
  }

  // ---------- app switching ----------
  function parseHash() {
    var h = (location.hash || "").replace(/^#\/?/, "");
    if (!h) return null;
    var parts = h.split("/");
    var app = parts[0] === "files" ? "vault" : parts[0];
    if (!APPS[app]) return null;
    return { app: app, tab: parts[1] || null };
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
    current = name;
    document.title = app.title + " · File Database";
    var hash = "#" + name + (name === "toolbox" && opts.tab ? "/" + opts.tab : "");
    if (location.hash !== hash || location.search) {
      // Also drop any legacy ?view=/?action= query once it has been consumed,
      // so a reload follows the hash (the latest navigation) instead of
      // snapping back to the shortcut target.
      try { history.replaceState(null, "", location.pathname + hash); } catch (e) {}
    }
    try { localStorage.setItem("fd-app", name); } catch (e) {}
    updateBadges();
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
    if (el) el.textContent = (n === null || n === undefined) ? "" : String(n);
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
        APPS[k].pending.splice(0).forEach(function (m) {
          try { f.contentWindow.postMessage(m, "*"); } catch (e) {}
        });
        updateBadges();
      });
    });
    $("#theme-btn").addEventListener("click", cycleTheme);

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
      if (d.type === "shell-nav" && APPS[d.app]) activate(d.app, { tab: d.tab || null });
      else if (d.type === "vault-nav" && d.to === "files") activate("vault");   // legacy contract
      else if (d.type === "li-changed") updateBadges();
      // An embedded app forwards files dropped/pasted over it, so the platform
      // files them through one router regardless of which tab is showing.
      else if (d.type === "shell-add-files" && d.files) routeFiles(d.files);
      else if (d.type === "shell-open-picker") $("#shell-file-input").click();
    });
    window.addEventListener("focus", updateBadges);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) updateBadges(); });

    // Initial app: hash (latest navigation) > legacy query params > last used
    // > default. The query is only honored on hashless URLs (PWA shortcuts,
    // old bookmarks) — activate() strips it once consumed.
    var params = new URLSearchParams(location.search);
    var view = params.get("view"), action = params.get("action");
    var fromHash = parseHash();
    if (fromHash) activate(fromHash.app, { tab: fromHash.tab });
    else if (view === "li" || view === "inventory") activate(view);
    else if (view === "starred" || action === "add") activate("vault", { query: location.search });
    else {
      var last = null;
      try { last = localStorage.getItem("fd-app"); } catch (e) {}
      activate(APPS[last] ? last : DEFAULT_APP);
    }
    window.addEventListener("hashchange", function () {
      var h = parseHash();
      if (h && h.app !== current) activate(h.app, { tab: h.tab });
      else if (h && h.app === "toolbox" && h.tab) frameMessage("toolbox", { type: "toolbox-open", tab: h.tab });
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

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
