/*
 * debug.js — shared debug log for the File Database platform.
 *
 * Loaded by every page (shell + the four apps), before their own code. It
 * quietly records errors and warnings — uncaught exceptions, unhandled
 * promise rejections, failed resource loads, console.error/console.warn —
 * plus anything an app reports through window.FVDebug.log()/info()/warn()/
 * error(). Entries live in IndexedDB "fv-debug" (origin-wide, so one log
 * covers all apps) as a ring buffer; nothing ever leaves this device.
 *
 * A built-in viewer overlays any page: press Ctrl+Shift+D (or use an app
 * menu's "Debug log" entry / call FVDebug.open()). From there the log can be
 * filtered, copied, downloaded as a text file, or cleared.
 */
(function () {
  "use strict";
  if (window.FVDebug) return; // already installed on this page

  var DB_NAME = "fv-debug";
  var STORE = "entries";
  var MAX_ENTRIES = 600;   // trim the ring buffer when it grows past this…
  var TRIM_TO = 400;       // …down to this many (newest kept)
  var MAX_MSG = 4000;      // per-entry message/stack cap (characters)
  var memory = [];         // fallback + fast mirror of recent entries
  var MEM_MAX = 200;

  // Which app is this page? (drives the "app" column in the viewer)
  function appName() {
    var p = location.pathname;
    if (p.indexOf("/vault/") >= 0) return "vault";
    if (p.indexOf("/li/") >= 0) return "li";
    if (p.indexOf("/inventory/") >= 0) return "inventory";
    if (p.indexOf("/toolbox/") >= 0) return "toolbox";
    return "shell";
  }
  var APP = appName();

  // ---------- storage (never throws; falls back to memory only) ----------
  var dbP = null;
  function openDB() {
    if (dbP) return dbP;
    dbP = new Promise(function (res) {
      try {
        var r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = function () {
          var db = r.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        };
        r.onsuccess = function () {
          var db = r.result;
          db.onversionchange = function () { try { db.close(); } catch (e) {} dbP = null; };
          res(db);
        };
        r.onerror = function () { res(null); };
        r.onblocked = function () { res(null); };
      } catch (e) { res(null); }
    });
    return dbP;
  }

  var writes = 0;
  function persist(entry) {
    openDB().then(function (db) {
      if (!db) return;
      try {
        var store = db.transaction(STORE, "readwrite").objectStore(STORE);
        store.add(entry);
        // Occasionally enforce the ring buffer so the log can't grow forever.
        if (++writes % 25 !== 1) return;
        var cnt = store.count();
        cnt.onsuccess = function () {
          var extra = cnt.result - MAX_ENTRIES;
          if (extra <= 0) return;
          var toDelete = cnt.result - TRIM_TO;
          var cur = store.openCursor();
          cur.onsuccess = function (ev) {
            var c = ev.target.result;
            if (!c || toDelete-- <= 0) return;
            try { c.delete(); } catch (e) {}
            c.continue();
          };
        };
      } catch (e) { /* quota/closed DB — the memory mirror still has it */ }
    });
  }

  // ---------- entry building ----------
  function clip(s) {
    s = String(s == null ? "" : s);
    return s.length > MAX_MSG ? s.slice(0, MAX_MSG) + " …[truncated]" : s;
  }
  function fmtArg(a) {
    try {
      if (a instanceof Error) return a.message || String(a);
      if (typeof a === "string") return a;
      if (typeof a === "undefined") return "undefined";
      return JSON.stringify(a);
    } catch (e) { try { return String(a); } catch (e2) { return "[unprintable]"; } }
  }
  function stackOf(a) {
    for (var i = 0; i < a.length; i++) if (a[i] instanceof Error && a[i].stack) return String(a[i].stack);
    return "";
  }

  var listeners = [];
  function add(level, src, msg, stack) {
    var entry = { t: Date.now(), level: level, app: APP, src: src, msg: clip(msg), stack: clip(stack || "") };
    memory.push(entry);
    if (memory.length > MEM_MAX) memory.splice(0, memory.length - MEM_MAX);
    persist(entry);
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](entry); } catch (e) {} }
  }

  // ---------- capture ----------
  // Uncaught exceptions AND failed resource loads (capture phase sees both).
  window.addEventListener("error", function (e) {
    try {
      if (e.target && e.target !== window && (e.target.tagName || "")) {
        var el = e.target;
        add("warn", "resource", "Failed to load <" + el.tagName.toLowerCase() + "> " + (el.src || el.href || ""));
        return;
      }
      var where = e.filename ? " (" + e.filename + ":" + e.lineno + ":" + e.colno + ")" : "";
      add("error", "window", (e.message || "Uncaught error") + where, e.error && e.error.stack);
    } catch (x) {}
  }, true);

  window.addEventListener("unhandledrejection", function (e) {
    try {
      var r = e.reason;
      add("error", "promise", "Unhandled rejection: " + (r instanceof Error ? (r.message || r) : fmtArg(r)), r && r.stack);
    } catch (x) {}
  });

  // console.error / console.warn — record, then pass straight through.
  function patch(name, level) {
    var orig = console[name];
    console[name] = function () {
      try {
        var parts = [];
        for (var i = 0; i < arguments.length; i++) parts.push(fmtArg(arguments[i]));
        add(level, "console", parts.join(" "), stackOf(arguments));
      } catch (e) {}
      return orig.apply(console, arguments);
    };
  }
  patch("error", "error");
  patch("warn", "warn");

  // ---------- viewer ----------
  var overlay = null, filter = "all", renderT = null;
  var COLORS = { error: "#ff6b6b", warn: "#f5c542", info: "#5b8cff", log: "#98a3b8" };

  function el(tag, css, text) {
    var n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text != null) n.textContent = text;
    return n;
  }
  function btn(label, title, fn) {
    var b = el("button", "background:#232c3f;color:#e6ebf5;border:1px solid #3a465e;border-radius:7px;padding:4px 10px;font:600 12px/1.4 inherit;cursor:pointer", label);
    if (title) b.title = title;
    b.onclick = fn;
    return b;
  }
  function two(n) { return (n < 10 ? "0" : "") + n; }
  function fmtTime(t) {
    var d = new Date(t);
    return two(d.getHours()) + ":" + two(d.getMinutes()) + ":" + two(d.getSeconds());
  }
  function entryLine(e) {
    return new Date(e.t).toISOString() + " " + e.level.toUpperCase() + " [" + e.app + "/" + e.src + "] " + e.msg + (e.stack ? "\n  " + e.stack.replace(/\n/g, "\n  ") : "");
  }

  function getAll(cb) {
    openDB().then(function (db) {
      if (!db) return cb(memory.slice());
      try {
        var req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
        req.onsuccess = function () { cb(req.result || []); };
        req.onerror = function () { cb(memory.slice()); };
      } catch (e) { cb(memory.slice()); }
    });
  }

  function buildOverlay() {
    var wrap = el("div", "position:fixed;left:10px;right:10px;bottom:10px;z-index:2147483000;max-height:62vh;display:flex;flex-direction:column;background:#0f1420;color:#e6ebf5;border:1px solid #3a465e;border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.55);font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace");
    wrap.id = "fv-debug";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-label", "Debug log");

    var head = el("div", "display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid #2a3346;flex-wrap:wrap");
    var title = el("strong", "margin-right:auto;font-size:12.5px", "🐞 Debug log");
    var count = el("span", "color:#98a3b8;margin-right:8px", "");
    count.id = "fv-debug-count";
    var fAll = btn("All", "Show every entry", function () { filter = "all"; render(); });
    var fErr = btn("Errors", "Only errors", function () { filter = "error"; render(); });
    var fWarn = btn("Warnings", "Errors + warnings", function () { filter = "warn"; render(); });
    var copy = btn("Copy", "Copy the visible entries to the clipboard", function () {
      getAll(function (rows) {
        var text = visible(rows).map(entryLine).join("\n") || "(empty)";
        try { navigator.clipboard.writeText(text).then(function () { copy.textContent = "Copied!"; setTimeout(function () { copy.textContent = "Copy"; }, 1200); }); } catch (e) {}
      });
    });
    var dl = btn("Download", "Save the whole log as a text file", function () {
      getAll(function (rows) {
        var blob = new Blob([rows.map(entryLine).join("\n")], { type: "text/plain" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "fv-debug-" + new Date().toISOString().slice(0, 10) + ".log";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      });
    });
    var clear = btn("Clear", "Delete every log entry", function () {
      if (!confirm("Clear the entire debug log?")) return;
      memory = [];
      openDB().then(function (db) {
        if (db) { try { db.transaction(STORE, "readwrite").objectStore(STORE).clear(); } catch (e) {} }
        render();
      });
    });
    var close = btn("✕", "Close (Esc)", api.close);
    head.append(title, count, fAll, fErr, fWarn, copy, dl, clear, close);

    var list = el("div", "overflow:auto;padding:6px 10px;flex:1;min-height:60px");
    list.id = "fv-debug-list";
    wrap.append(head, list);
    return wrap;
  }

  function visible(rows) {
    if (filter === "error") return rows.filter(function (r) { return r.level === "error"; });
    if (filter === "warn") return rows.filter(function (r) { return r.level === "error" || r.level === "warn"; });
    return rows;
  }

  function render() {
    if (!overlay) return;
    getAll(function (rows) {
      if (!overlay) return;
      var list = overlay.querySelector("#fv-debug-list");
      var count = overlay.querySelector("#fv-debug-count");
      var show = visible(rows).slice(-300).reverse(); // newest first
      count.textContent = rows.length + " entr" + (rows.length === 1 ? "y" : "ies") + (show.length < rows.length ? " · showing " + show.length : "");
      list.innerHTML = "";
      if (!show.length) {
        list.append(el("div", "color:#98a3b8;padding:10px 0", "Nothing logged" + (filter !== "all" ? " at this level" : "") + " — errors, warnings and app messages will appear here."));
        return;
      }
      for (var i = 0; i < show.length; i++) (function (r) {
        var row = el("div", "padding:3px 0;border-bottom:1px dashed #2a3346;word-break:break-word;white-space:pre-wrap" + (r.stack ? ";cursor:pointer" : ""));
        var time = el("span", "color:#98a3b8", fmtTime(r.t) + " ");
        time.title = new Date(r.t).toISOString();
        var lvl = el("span", "color:" + (COLORS[r.level] || "#98a3b8") + ";font-weight:700", r.level.toUpperCase());
        var app = el("span", "color:#47d18f", " " + r.app + " ");
        var msg = el("span", "", r.msg);
        row.append(time, lvl, app, msg);
        if (r.stack) {
          var stack = el("div", "display:none;color:#98a3b8;margin:2px 0 4px 14px", r.stack);
          row.title = "Click to show/hide the stack trace";
          row.onclick = function () { stack.style.display = stack.style.display === "none" ? "block" : "none"; };
          row.append(stack);
        }
        list.append(row);
      })(show[i]);
    });
  }

  // Live-refresh while open (debounced so bursts don't thrash the DOM).
  listeners.push(function () {
    if (!overlay) return;
    clearTimeout(renderT);
    renderT = setTimeout(render, 250);
  });

  // ---------- public API ----------
  var api = {
    log: function (msg, data) { add("log", "app", fmtArg(msg) + (data !== undefined ? " " + fmtArg(data) : "")); },
    info: function (msg, data) { add("info", "app", fmtArg(msg) + (data !== undefined ? " " + fmtArg(data) : "")); },
    warn: function (msg, data) { add("warn", "app", fmtArg(msg) + (data !== undefined ? " " + fmtArg(data) : ""), stackOf(arguments)); },
    error: function (msg, data) { add("error", "app", fmtArg(msg) + (data !== undefined ? " " + fmtArg(data) : ""), stackOf(arguments)); },
    open: function () {
      if (overlay) { render(); return; }
      overlay = buildOverlay();
      (document.body || document.documentElement).appendChild(overlay);
      render();
    },
    close: function () {
      if (!overlay) return;
      try { overlay.remove(); } catch (e) {}
      overlay = null;
    },
    toggle: function () { overlay ? api.close() : api.open(); },
    getAll: getAll,
    clear: function () {
      memory = [];
      return openDB().then(function (db) {
        if (db) { try { db.transaction(STORE, "readwrite").objectStore(STORE).clear(); } catch (e) {} }
        if (overlay) render();
      });
    },
  };
  window.FVDebug = api;

  // Ctrl+Shift+D toggles the viewer on any page; Esc closes it.
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && overlay) { api.close(); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "D" || e.key === "d")) {
      e.preventDefault();
      api.toggle();
    }
  });
})();
