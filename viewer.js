/* ===== Database File Viewer (moved out of viewer.html, REWRITE-PLAN.md Phase 3) ===== */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var entries = [];   // { path, blob, type }
  var sourceName = "";
  var embedded = document.documentElement.classList.contains("embedded");

  // Platform integration (when hosted as the shell's Extract tab): follow the
  // shared theme and forward the platform's keyboard shortcuts up.
  window.addEventListener("message", function (ev) {
    var d = ev && ev.data;
    if (!d || d.type !== "platform-theme") return;
    if (d.mode === "light" || d.mode === "dark") document.documentElement.setAttribute("data-theme", d.mode);
    else document.documentElement.removeAttribute("data-theme");
  });
  document.addEventListener("keydown", function (e) {
    if (!embedded) return;
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key >= "1" && e.key <= "9") {
      e.preventDefault();
      try { window.parent.postMessage({ type: "shell-switch", n: +e.key }, "*"); } catch (x) {}
    } else if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      try { window.parent.postMessage({ type: "shell-quickopen" }, "*"); } catch (x) {}
    }
  });

  function fmtBytes(n) {
    if (n == null) return "—";
    var u = ["B", "KB", "MB", "GB"], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i ? n.toFixed(1) : n) + " " + u[i];
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  // Windows-safe file name (also strips path separators).
  function safeName(s, fallback) {
    s = String(s || "").replace(/[<>:"\/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "").trim();
    // Clamp the length: Windows paths max out at 260 chars TOTAL, and real
    // LI titles alone can exceed that ("file or directory could not be
    // found"). The identifier lives at the START of our names (LI number,
    // tool number), so trimming the tail keeps names unique and meaningful.
    if (s.length > 140) {
      var cm = s.match(/^(.*?)(\.[A-Za-z0-9]{1,8})?$/);
      var cext = cm[2] || "";
      s = cm[1].slice(0, 140 - cext.length).replace(/[. ]+$/, "") + cext;
    }
    return s || fallback || "file";
  }
  // Resolve duplicate names by suffixing " (2)", " (3)", … before the extension.
  function dedupe(used, path) {
    if (!used[path]) { used[path] = 1; return path; }
    var m = path.match(/^(.*?)(\.[A-Za-z0-9]{1,8})?$/);
    var stem = m[1], ext = m[2] || "", n = 2, p;
    do { p = stem + " (" + n + ")" + ext; n++; } while (used[p]);
    used[p] = 1;
    return p;
  }
  function setProgress(msg, isError) {
    var p = $("#progress"), s = $("#status");
    p.textContent = msg || "";
    p.classList.toggle("error", !!isError);
    // #progress sits inside #result, which is hidden until a backup has
    // opened — mirror the message outside it so "Reading…" and a failure to
    // open are actually visible.
    s.textContent = msg || "";
    s.classList.toggle("error", !!isError);
    s.hidden = !msg || !$("#result").hidden;
  }

  // ---------- format detection ----------
  function open(file) {
    sourceName = file.name || "backup";
    entries = [];
    setProgress("Reading…");
    file.slice(0, 4).arrayBuffer().then(function (buf) {
      var b = new Uint8Array(buf);
      var magic = String.fromCharCode.apply(null, b);
      if (magic === "FDBK") return openFdb(file);
      if (magic === "FVLT") return openFvault(file);
      if (magic === "TIDB") return openTidb(file);
      if (b[0] === 0x50 && b[1] === 0x4b) return openZip(file);      // "PK" — .lidb
      if (b[0] === 0x7b || b[0] === 0xef) return openJson(file);     // "{" or BOM — legacy JSON backup
      throw new Error("Not a recognized File Database backup (.fdb / .fvault / .lidb / .tidb).");
    }).then(function () {
      show();
    }).catch(function (e) {
      $("#result").hidden = true;
      setProgress(String(e && e.message || e), true);
    });
  }

  // ---------- readers (shared: src/core/formats) ----------
  // The four backup readers moved to src/core/formats/{fvault,tidb,lidb,zip}.js
  // (REWRITE-PLAN.md Phase 1); this page turns what they return into the
  // files a person can download, exactly as before.
  var readZipEntries = FDCore.formats.zip.readEntries;
  function openFvault(file) {
    return FDCore.formats.fvault.readLoose(file).then(function (r) {
      var used = {};
      r.entries.forEach(function (en) {
        var f = en.meta, folder = f.collection ? safeName(f.collection) + "/" : "";
        entries.push({ path: dedupe(used, folder + safeName(f.name, "file")), blob: en.blob, type: f.type || "" });
      });
      $("#kindLabel").textContent = "📁 File Vault backup";
    });
  }
  function openJson(file) {
    return FDCore.formats.fvault.readLegacyJson(file).then(function (r) {
      var used = {};
      r.entries.forEach(function (en) {
        var f = en.meta, folder = f.collection ? safeName(f.collection) + "/" : "";
        entries.push({ path: dedupe(used, folder + safeName(f.name, "file")), blob: en.blob, type: f.type || "" });
      });
      $("#kindLabel").textContent = "📁 File Vault backup (legacy)";
    });
  }
  // The whole-platform backup (.fdb): files under Files/, an LI document's
  // PDF under LI Documents/, tool photos, plus the tables as CSV/JSON.
  function openFdb(file) {
    return FDCore.formats.fdb.parse(file).then(function (r) {
      var recs = r.meta.records || {};
      var blobs = {};
      r.payloads.forEach(function (p) { blobs[p.store + ":" + p.id] = p.blob; });
      var used = {};
      var docsByFile = {};
      (recs.documents || []).forEach(function (d) { if (d.fileId) docsByFile[d.fileId] = d; });
      (recs.files || []).forEach(function (f) {
        var b = blobs["blobs:" + f.id];
        if (!b) return;
        var d = docsByFile[f.id];
        var path = d
          ? "LI Documents/" + safeName(FDCore.formats.lidb.readableName(d, "files/" + (f.name || "document.pdf")), "document.pdf")
          : "Files/" + (f.collection ? safeName(f.collection, "collection") + "/" : "") + safeName(f.name, "file");
        entries.push({ path: dedupe(used, path), blob: b, type: f.type || "" });
      });
      (recs.tools || []).length && entries.push({ path: "tools.csv", blob: new Blob([FDCore.formats.tidb.toolsCsv(recs.tools)], { type: "text/csv" }), type: "text/csv" });
      Object.keys(blobs).forEach(function (k) {
        if (k.indexOf("photos:") !== 0) return;
        entries.push({ path: dedupe(used, "photos/" + safeName(k.slice(7), "photo") + ".png"), blob: blobs[k], type: "image/png" });
      });
      ["files", "documents", "tools", "ros", "links", "settings"].forEach(function (k) {
        if ((recs[k] || []).length) entries.push({ path: "tables/" + k + ".json", blob: new Blob([JSON.stringify(recs[k], null, 1)], { type: "application/json" }), type: "application/json" });
      });
      $("#kindLabel").textContent = "🗃️ File Database backup";
    });
  }
  function openTidb(file) {
    return FDCore.formats.tidb.read(file).then(function (r) {
      var meta = r.meta;
      // The tool data itself, as a normal spreadsheet + full JSON.
      entries.push({ path: "tools.csv", blob: new Blob([FDCore.formats.tidb.toolsCsv(meta.tools)], { type: "text/csv" }), type: "text/csv" });
      entries.push({ path: "tools.json", blob: new Blob([JSON.stringify(meta.tools, null, 1)], { type: "application/json" }), type: "application/json" });
      var used = { "tools.csv": 1, "tools.json": 1 };
      r.photos.forEach(function (p) {
        entries.push({ path: dedupe(used, "photos/" + safeName(p.id, "photo") + ".png"), blob: p.blob, type: "image/png" });
      });
      $("#kindLabel").textContent = "🔧 Tool Inventory database";
    });
  }
  function openZip(file) {
    return FDCore.formats.lidb.read(file).then(function (r) {
      var used = {};
      r.pdfs.forEach(function (p) {
        var nice = FDCore.formats.lidb.readableName(p.doc, p.name);
        entries.push({ path: dedupe(used, "LI Documents/" + safeName(nice, "document.pdf")), blob: p.blob, type: "application/pdf" });
      });
      $("#kindLabel").textContent = "🗄️ LI Documents backup";
    });
  }

  // ---------- render ----------
  function show() {
    setProgress("");
    $("#result").hidden = false;
    var total = 0;
    var tb = $("#rows");
    tb.innerHTML = "";
    var zeroCount = 0;
    entries.forEach(function (en, i) {
      total += en.blob.size;
      var zero = en.blob.size === 0;
      if (zero) zeroCount++;
      var tr = document.createElement("tr");
      tr.innerHTML = '<td class="name">' + esc(en.path) + (zero ? ' <span class="zero" title="This entry was stored EMPTY in the backup — its source file never read correctly when it was added. It cannot be recovered from this backup.">⚠ empty</span>' : '') + '</td><td>' + esc(en.type || "—") + '</td><td class="num">' + fmtBytes(en.blob.size) + '</td>' +
        '<td><button class="dl" data-i="' + i + '">⬇ Download</button></td>';
      tb.append(tr);
    });
    if (zeroCount) setProgress("⚠ " + zeroCount + " entr" + (zeroCount === 1 ? "y was" : "ies were") + " stored EMPTY (0 bytes) in this backup — those files were damaged when they were originally added and can't be recovered from here.", true);
    $("#countLabel").textContent = entries.length + " file" + (entries.length === 1 ? "" : "s") + " · " + fmtBytes(total);
    $("#zipBtn").disabled = !entries.length || total > 0xFFFF0000;
    if (total > 0xFFFF0000) setProgress("Over 4 GB — use the per-file download links (the ZIP format tops out at 4 GB).");
  }
  function dl(blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
  }

  // ---------- ZIP writer (shared: src/core/formats/zip.js) ----------
  function buildZip() {
    return FDCore.formats.zip.build(entries, function (i, n, p) { setProgress("Packing " + i + " / " + n + " — " + p); });
  }

  // ---------- wiring ----------
  var drop = $("#drop");
  drop.addEventListener("click", function () { $("#pick").click(); });
  ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.add("drag"); }); });
  ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.remove("drag"); }); });
  drop.addEventListener("drop", function (e) { if (e.dataTransfer.files[0]) open(e.dataTransfer.files[0]); });
  // Drops anywhere else on the page: a database file opens here; while
  // embedded, anything else is handed to the platform's unified intake
  // instead of the browser navigating away.
  ["dragover", "drop"].forEach(function (ev) {
    window.addEventListener(ev, function (e) {
      if (!e.dataTransfer) return;
      e.preventDefault();
      if (ev !== "drop" || !e.dataTransfer.files || !e.dataTransfer.files[0]) return;
      var f = e.dataTransfer.files[0];
      if (/\.(fvault|lidb|tidb|json|zip)$/i.test(f.name)) { open(f); return; }
      if (embedded) {
        var files = Array.prototype.slice.call(e.dataTransfer.files);
        try { window.parent.postMessage({ type: "shell-add-files", files: files }, "*"); return; } catch (x) {}
      }
      setProgress("Not a File Database backup — drop a .fvault, .lidb or .tidb file.", true);
    });
  });
  $("#pick").addEventListener("change", function (e) { if (e.target.files[0]) open(e.target.files[0]); e.target.value = ""; });
  $("#rows").addEventListener("click", function (e) {
    var b = e.target.closest(".dl");
    if (!b) return;
    var en = entries[+b.dataset.i];
    if (en) dl(en.blob, en.path.split("/").pop());
  });
  $("#zipBtn").addEventListener("click", async function () {
    var btn = $("#zipBtn");
    btn.disabled = true;
    try {
      var zip = await buildZip();
      // Self-check: re-read the archive we just built with our own ZIP
      // reader — a malformed archive must never reach the download.
      var checked = await readZipEntries(zip);
      if (checked.length !== entries.length) throw new Error("self-check failed (" + checked.length + "/" + entries.length + " entries)");
      var base = sourceName.replace(/\.[A-Za-z0-9]+$/, "") || "backup";
      dl(zip, base + " (extracted).zip");
      setProgress("Done — " + entries.length + " files packed, exactly " + zip.size.toLocaleString() + " bytes. If a ZIP tool calls the download invalid, check the file on disk is that exact size (a smaller file = the download was cut short).");
    } catch (err) {
      setProgress("Couldn't build the ZIP: " + (err && err.message || err), true);
    } finally {
      btn.disabled = false;
    }
  });
  $("#resetBtn").addEventListener("click", function () {
    entries = [];
    $("#result").hidden = true;
    setProgress("");
  });

  // ---------- direct-to-folder export (File System Access API) ----------
  // The most robust path on locked-down machines: every file is written
  // straight into a folder the user picks and each write is verified — no
  // archive format, no single giant download to get truncated.
  if ("showDirectoryPicker" in window) $("#folderBtn").hidden = false;
  $("#folderBtn").addEventListener("click", async function () {
    var dir;
    try { dir = await window.showDirectoryPicker({ mode: "readwrite" }); }
    catch (e) { return; } // cancelled
    var btn = $("#folderBtn");
    btn.disabled = true;
    var ok = 0, failed = [];
    try {
      for (var i = 0; i < entries.length; i++) {
        var en = entries[i];
        setProgress("Saving " + (i + 1) + " / " + entries.length + " — " + en.path);
        try {
          var parts = en.path.split("/");
          var d = dir;
          for (var j = 0; j < parts.length - 1; j++) d = await d.getDirectoryHandle(parts[j], { create: true });
          var fh = await d.getFileHandle(parts[parts.length - 1], { create: true });
          var w = await fh.createWritable();
          await w.write(en.blob);
          await w.close();
          var back = await fh.getFile();           // verify what actually landed
          if (back.size !== en.blob.size) throw new Error("wrote " + back.size + " of " + en.blob.size + " bytes");
          ok++;
        } catch (err) {
          failed.push(en.path + " (" + (err && err.message || err) + ")");
        }
      }
      setProgress("Saved " + ok + " of " + entries.length + " files to the folder — every file verified on disk." +
        (failed.length ? " ⚠ Failed: " + failed.slice(0, 3).join("; ") + (failed.length > 3 ? " +" + (failed.length - 3) + " more" : "") : ""), !!failed.length);
    } finally {
      btn.disabled = false;
    }
  });
})();
