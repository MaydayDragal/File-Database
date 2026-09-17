/*
 * src/services/folder-sync.js — import new or changed files from a linked
 * folder (File System Access API).
 *
 * The Files app and LI Documents each had a copy of this; this is the one
 * (REWRITE-PLAN.md Phase 3). Link a folder once (the handle is stored and
 * restored on every launch); "Sync" scans it and imports anything new or
 * changed; "Auto-sync" repeats the scan on a timer, on focus and when the tab
 * becomes visible while the app is open. A folder file counts as new or
 * changed unless a stored file has the same name, size AND modified-time
 * (records stored before mtime was tracked match on name + size, so they
 * aren't all re-imported once).
 *
 * What each feature supplies:
 *   pickerId   the picker's `id` (remembers the last folder per feature)
 *   load()     → Promise<{ dir, auto }>            the persisted handle + flag
 *   save(key, value) → Promise                     key "dir" | "auto"
 *   accept(entry) → boolean                        which folder entries count (default: every file)
 *   known()    → Promise<{ name: [{ size, mtime }] }>  what is already stored
 *   import(files, folderName, quiet) → Promise     the feature's own import path
 *   busy()     → boolean                           a feature-level mutex (an import running)
 *   busyMessage                                     what to say when it is
 *   toast(msg), onChange()                          messages and label refresh
 *   interval   auto-sync period (default 5 minutes)
 *
 * What comes back:
 *   sync.dir / sync.auto        the linked handle / the auto flag (read-only)
 *   sync.pick()                 link a (new) folder → handle or null
 *   sync.run(quiet)             scan and import; quiet is the auto path — it
 *                               never prompts and stays silent unless it
 *                               actually imports something
 *   sync.toggleAuto()           flip auto-sync (linking a folder first if none)
 *   sync.resume()               restore the handle + flag, start the timer
 *   sync.stop()                 stop the timer
 */
(function (global) {
  "use strict";
  var DEFAULT_INTERVAL = 5 * 60 * 1000;
  var MAX_FILES = 20000, MAX_DEPTH = 8;

  // Recursively gather file handles, bounded so a huge tree can't hang. One
  // unreadable subfolder or a mid-scan error skips just that entry rather
  // than aborting the whole sync; the count cap is enforced continuously.
  async function collect(dir, accept, out, depth) {
    out = out || []; depth = depth || 0;
    if (depth > MAX_DEPTH || out.length > MAX_FILES) return out;
    try {
      for await (const entry of dir.values()) {
        if (out.length > MAX_FILES) break;
        if (entry.kind === "file") { if (!accept || accept(entry)) out.push(entry); }
        else if (entry.kind === "directory") { try { await collect(entry, accept, out, depth + 1); } catch (e) {} }
      }
    } catch (e) {} // unreadable folder — keep what we have
    return out;
  }

  function create(opts) {
    var toast = opts.toast || function () {};
    var onChange = opts.onChange || function () {};
    var interval = opts.interval || DEFAULT_INTERVAL;
    var dir = null, auto = false, timer = null, syncing = false;
    var listening = false;

    function name() { return (dir && dir.name) || "folder"; }
    async function save(key, value) { try { await opts.save(key, value); } catch (e) {} }

    async function pick() {
      if (!global.showDirectoryPicker) { toast("Folder sync needs Microsoft Edge or Chrome."); return null; }
      var h;
      try { h = await global.showDirectoryPicker({ id: opts.pickerId, mode: "read" }); }
      catch (e) { return null; } // user cancelled the picker
      dir = h;
      await save("dir", h);
      onChange();
      return h;
    }

    async function ensurePerm(silent) {
      if (!dir) return false;
      var q = dir.queryPermission ? await dir.queryPermission({ mode: "read" }) : "granted";
      if (q === "granted") return true;
      if (silent) return false; // never prompt without a user gesture (auto path)
      var p = dir.requestPermission ? await dir.requestPermission({ mode: "read" }) : "denied";
      return p === "granted";
    }

    async function run(quiet) {
      if (syncing) { if (!quiet) toast("A folder sync is already running…"); return; }
      if (opts.busy && opts.busy()) { if (!quiet) toast(opts.busyMessage || "An import is already running — wait for it to finish."); return; }
      if (!dir) { if (quiet) return; var h = await pick(); if (!h) return; }
      var ok = await ensurePerm(quiet);
      if (!ok) { if (!quiet) toast("Couldn't read that folder — link it again."); return; }
      syncing = true;
      try {
        if (!quiet) toast("Scanning “" + name() + "”…");
        var handles = await collect(dir, opts.accept, []);
        var known = (await opts.known()) || {};
        var fresh = [];
        for (var i = 0; i < handles.length; i++) {
          var f; try { f = await handles[i].getFile(); } catch (e) { continue; }
          var cand = known[f.name] || [];
          var mtime = f.lastModified || 0;
          var dup = cand.some(function (k) { return k.size === f.size && (k.mtime == null || k.mtime === mtime); });
          if (!dup) fresh.push(f);
        }
        if (!fresh.length) { if (!quiet) toast("“" + name() + "” is up to date — nothing new."); return; }
        await opts.import(fresh, name(), quiet);
      } catch (e) {
        console.error(e);
        if (!quiet) toast("Folder sync failed.");
      } finally { syncing = false; }
    }

    function start() {
      stop();
      if (!auto || !dir) return;
      timer = setInterval(function () { run(true); }, interval);
      setTimeout(function () { run(true); }, 1500); // prompt-free catch-up shortly after enabling / launching
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }

    async function toggleAuto() {
      if (!dir) { var h = await pick(); if (!h) return; }
      auto = !auto;
      await save("auto", auto);
      onChange();
      if (auto) { start(); toast("Auto-sync on — “" + name() + "” is checked every 5 minutes while the app is open."); }
      else { stop(); toast("Auto-sync off."); }
    }

    function listen() {
      if (listening) return;
      listening = true;
      // Re-scan when the app regains attention (covers files added while away).
      global.addEventListener("focus", function () { if (auto && dir) run(true); });
      document.addEventListener("visibilitychange", function () { if (!document.hidden && auto && dir) run(true); });
    }

    async function resume() {
      try {
        var saved = (await opts.load()) || {};
        dir = saved.dir || null;
        auto = !!saved.auto;
      } catch (e) { dir = null; auto = false; }
      onChange();
      if (auto && dir) start();
      listen();
    }

    return {
      get dir() { return dir; },
      get auto() { return auto; },
      get syncing() { return syncing; },
      pick: pick, run: run, toggleAuto: toggleAuto, resume: resume, stop: stop,
    };
  }

  global.FDServices = global.FDServices || {};
  global.FDServices.folderSync = { create: create, collect: collect };
})(typeof self !== "undefined" ? self : globalThis);
