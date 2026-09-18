/* viewer.js — the standalone Database File Viewer: src/features/extract bundled as a classic script by tools/build-viewer.mjs; do not edit, regenerate. */
(() => {
  // src/features/mount.js
  function mountInto(host, markup, styleUrl) {
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
      setTimeout(done, 1500);
    });
    root.append(link, wrap);
    return ready;
  }

  // src/features/extract/markup.js
  var markup_default = `
<div class="wrap">
  <h1>\u{1F513} Database File Viewer</h1>
  <p class="sub">Open a File Database backup and get your files back out as <b>normal files</b> \u2014
  no app needed, works offline. Supports <b>.fvault</b> (Files), <b>.lidb</b> (LI Documents)
  and <b>.tidb</b> (Tool Inventory). Nothing is uploaded; everything happens on this computer.</p>

  <div class="drop" id="drop">
    <div class="big">Drop a .fvault / .lidb / .tidb file here</div>
    <div class="hint">or click to choose one</div>
  </div>
  <input type="file" id="pick" accept=".fdb,.fvault,.lidb,.tidb,.json,.zip" hidden />
  <div class="progress" id="status" hidden></div>

  <div id="result" hidden>
    <div class="summary">
      <span class="kind" id="kindLabel"></span>
      <span class="muted" id="countLabel"></span>
      <span class="spacer"></span>
      <button class="btn" id="folderBtn" hidden title="Writes every file straight into a folder you pick \u2014 no ZIP, no big download">\u{1F4C2} Save all to a folder\u2026</button>
      <button class="btn btn-ghost" id="zipBtn">\u2B07 Download all as ZIP</button>
      <button class="btn btn-ghost" id="resetBtn">Open another file</button>
    </div>
    <div class="progress" id="progress"></div>
    <div id="tablewrap"><table>
      <thead><tr><th>File</th><th>Type</th><th class="num">Size</th><th></th></tr></thead>
      <tbody id="rows"></tbody>
    </table></div>
  </div>

  <p class="foot">This page is part of <b>File Database</b> but depends on nothing else \u2014 keep a copy
  of <code>viewer.html</code> next to your backups and your data is always recoverable.
  Large backups: the ZIP is assembled from the source file on disk, so even multi-GB
  vaults extract without filling memory (4 GB per ZIP is the format's limit \u2014 beyond
  that, use the per-file download links).</p>
</div>
`;

  // src/features/extract/app.js
  function start(root, host, shell2) {
    "use strict";
    var $ = function(s) {
      return root.querySelector(s);
    };
    var entries = [];
    var sourceName = "";
    var embedded = true;
    function fmtBytes(n) {
      if (n == null) return "\u2014";
      var u = ["B", "KB", "MB", "GB"], i = 0;
      while (n >= 1024 && i < u.length - 1) {
        n /= 1024;
        i++;
      }
      return (i ? n.toFixed(1) : n) + " " + u[i];
    }
    function esc(s) {
      return String(s == null ? "" : s).replace(/[&<>"']/g, function(c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    }
    function safeName(s, fallback) {
      s = String(s || "").replace(/[<>:"\/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "").trim();
      if (s.length > 140) {
        var cm = s.match(/^(.*?)(\.[A-Za-z0-9]{1,8})?$/);
        var cext = cm[2] || "";
        s = cm[1].slice(0, 140 - cext.length).replace(/[. ]+$/, "") + cext;
      }
      return s || fallback || "file";
    }
    function dedupe(used, path) {
      if (!used[path]) {
        used[path] = 1;
        return path;
      }
      var m = path.match(/^(.*?)(\.[A-Za-z0-9]{1,8})?$/);
      var stem = m[1], ext = m[2] || "", n = 2, p;
      do {
        p = stem + " (" + n + ")" + ext;
        n++;
      } while (used[p]);
      used[p] = 1;
      return p;
    }
    function setProgress(msg, isError) {
      var p = $("#progress"), s = $("#status");
      p.textContent = msg || "";
      p.classList.toggle("error", !!isError);
      s.textContent = msg || "";
      s.classList.toggle("error", !!isError);
      s.hidden = !msg || !$("#result").hidden;
    }
    function open(file) {
      sourceName = file.name || "backup";
      entries = [];
      setProgress("Reading\u2026");
      file.slice(0, 4).arrayBuffer().then(function(buf) {
        var b = new Uint8Array(buf);
        var magic = String.fromCharCode.apply(null, b);
        if (magic === "FDBK") return openFdb(file);
        if (magic === "FVLT") return openFvault(file);
        if (magic === "TIDB") return openTidb(file);
        if (b[0] === 80 && b[1] === 75) return openZip(file);
        if (b[0] === 123 || b[0] === 239) return openJson(file);
        throw new Error("Not a recognized File Database backup (.fdb / .fvault / .lidb / .tidb).");
      }).then(function() {
        show();
      }).catch(function(e) {
        $("#result").hidden = true;
        setProgress(String(e && e.message || e), true);
      });
    }
    var readZipEntries = FDCore.formats.zip.readEntries;
    function openFvault(file) {
      return FDCore.formats.fvault.readLoose(file).then(function(r) {
        var used = {};
        r.entries.forEach(function(en) {
          var f = en.meta, folder = f.collection ? safeName(f.collection) + "/" : "";
          entries.push({ path: dedupe(used, folder + safeName(f.name, "file")), blob: en.blob, type: f.type || "" });
        });
        $("#kindLabel").textContent = "\u{1F4C1} File Vault backup";
      });
    }
    function openJson(file) {
      return FDCore.formats.fvault.readLegacyJson(file).then(function(r) {
        var used = {};
        r.entries.forEach(function(en) {
          var f = en.meta, folder = f.collection ? safeName(f.collection) + "/" : "";
          entries.push({ path: dedupe(used, folder + safeName(f.name, "file")), blob: en.blob, type: f.type || "" });
        });
        $("#kindLabel").textContent = "\u{1F4C1} File Vault backup (legacy)";
      });
    }
    function openFdb(file) {
      return FDCore.formats.fdb.parse(file).then(function(r) {
        var recs = r.meta.records || {};
        var blobs = {};
        r.payloads.forEach(function(p) {
          blobs[p.store + ":" + p.id] = p.blob;
        });
        var used = {};
        var docsByFile = {};
        (recs.documents || []).forEach(function(d) {
          if (d.fileId) docsByFile[d.fileId] = d;
        });
        (recs.files || []).forEach(function(f) {
          var b = blobs["blobs:" + f.id];
          if (!b) return;
          var d = docsByFile[f.id];
          var path = d ? "LI Documents/" + safeName(FDCore.formats.lidb.readableName(d, "files/" + (f.name || "document.pdf")), "document.pdf") : "Files/" + (f.collection ? safeName(f.collection, "collection") + "/" : "") + safeName(f.name, "file");
          entries.push({ path: dedupe(used, path), blob: b, type: f.type || "" });
        });
        (recs.tools || []).length && entries.push({ path: "tools.csv", blob: new Blob([FDCore.formats.tidb.toolsCsv(recs.tools)], { type: "text/csv" }), type: "text/csv" });
        Object.keys(blobs).forEach(function(k) {
          if (k.indexOf("photos:") !== 0) return;
          entries.push({ path: dedupe(used, "photos/" + safeName(k.slice(7), "photo") + ".png"), blob: blobs[k], type: "image/png" });
        });
        ["files", "documents", "tools", "ros", "links", "settings"].forEach(function(k) {
          if ((recs[k] || []).length) entries.push({ path: "tables/" + k + ".json", blob: new Blob([JSON.stringify(recs[k], null, 1)], { type: "application/json" }), type: "application/json" });
        });
        $("#kindLabel").textContent = "\u{1F5C3}\uFE0F File Database backup";
      });
    }
    function openTidb(file) {
      return FDCore.formats.tidb.read(file).then(function(r) {
        var meta = r.meta;
        entries.push({ path: "tools.csv", blob: new Blob([FDCore.formats.tidb.toolsCsv(meta.tools)], { type: "text/csv" }), type: "text/csv" });
        entries.push({ path: "tools.json", blob: new Blob([JSON.stringify(meta.tools, null, 1)], { type: "application/json" }), type: "application/json" });
        var used = { "tools.csv": 1, "tools.json": 1 };
        r.photos.forEach(function(p) {
          entries.push({ path: dedupe(used, "photos/" + safeName(p.id, "photo") + ".png"), blob: p.blob, type: "image/png" });
        });
        $("#kindLabel").textContent = "\u{1F527} Tool Inventory database";
      });
    }
    function openZip(file) {
      return FDCore.formats.lidb.read(file).then(function(r) {
        var used = {};
        r.pdfs.forEach(function(p) {
          var nice = FDCore.formats.lidb.readableName(p.doc, p.name);
          entries.push({ path: dedupe(used, "LI Documents/" + safeName(nice, "document.pdf")), blob: p.blob, type: "application/pdf" });
        });
        $("#kindLabel").textContent = "\u{1F5C4}\uFE0F LI Documents backup";
      });
    }
    function show() {
      setProgress("");
      $("#result").hidden = false;
      var total = 0;
      var tb = $("#rows");
      tb.innerHTML = "";
      var zeroCount = 0;
      entries.forEach(function(en, i) {
        total += en.blob.size;
        var zero = en.blob.size === 0;
        if (zero) zeroCount++;
        var tr = document.createElement("tr");
        tr.innerHTML = '<td class="name">' + esc(en.path) + (zero ? ' <span class="zero" title="This entry was stored EMPTY in the backup \u2014 its source file never read correctly when it was added. It cannot be recovered from this backup.">\u26A0 empty</span>' : "") + "</td><td>" + esc(en.type || "\u2014") + '</td><td class="num">' + fmtBytes(en.blob.size) + '</td><td><button class="dl" data-i="' + i + '">\u2B07 Download</button></td>';
        tb.append(tr);
      });
      if (zeroCount) setProgress("\u26A0 " + zeroCount + " entr" + (zeroCount === 1 ? "y was" : "ies were") + " stored EMPTY (0 bytes) in this backup \u2014 those files were damaged when they were originally added and can't be recovered from here.", true);
      $("#countLabel").textContent = entries.length + " file" + (entries.length === 1 ? "" : "s") + " \xB7 " + fmtBytes(total);
      $("#zipBtn").disabled = !entries.length || total > 4294901760;
      if (total > 4294901760) setProgress("Over 4 GB \u2014 use the per-file download links (the ZIP format tops out at 4 GB).");
    }
    function dl(blob, name) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(function() {
        URL.revokeObjectURL(a.href);
      }, 6e4);
    }
    function buildZip() {
      return FDCore.formats.zip.build(entries, function(i, n, p) {
        setProgress("Packing " + i + " / " + n + " \u2014 " + p);
      });
    }
    var drop = $("#drop");
    drop.addEventListener("click", function() {
      $("#pick").click();
    });
    ["dragenter", "dragover"].forEach(function(ev) {
      drop.addEventListener(ev, function(e) {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.add("drag");
      });
    });
    ["dragleave", "drop"].forEach(function(ev) {
      drop.addEventListener(ev, function(e) {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.remove("drag");
      });
    });
    drop.addEventListener("drop", function(e) {
      if (e.dataTransfer.files[0]) open(e.dataTransfer.files[0]);
    });
    function intake(files) {
      var f = files && files[0];
      if (!f || !/\.(fdb|fvault|lidb|tidb|json|zip)$/i.test(f.name)) return false;
      open(f);
      return true;
    }
    $("#pick").addEventListener("change", function(e) {
      if (e.target.files[0]) open(e.target.files[0]);
      e.target.value = "";
    });
    $("#rows").addEventListener("click", function(e) {
      var b = e.target.closest(".dl");
      if (!b) return;
      var en = entries[+b.dataset.i];
      if (en) dl(en.blob, en.path.split("/").pop());
    });
    $("#zipBtn").addEventListener("click", async function() {
      var btn = $("#zipBtn");
      btn.disabled = true;
      try {
        var zip = await buildZip();
        var checked = await readZipEntries(zip);
        if (checked.length !== entries.length) throw new Error("self-check failed (" + checked.length + "/" + entries.length + " entries)");
        var base = sourceName.replace(/\.[A-Za-z0-9]+$/, "") || "backup";
        dl(zip, base + " (extracted).zip");
        setProgress("Done \u2014 " + entries.length + " files packed, exactly " + zip.size.toLocaleString() + " bytes. If a ZIP tool calls the download invalid, check the file on disk is that exact size (a smaller file = the download was cut short).");
      } catch (err) {
        setProgress("Couldn't build the ZIP: " + (err && err.message || err), true);
      } finally {
        btn.disabled = false;
      }
    });
    $("#resetBtn").addEventListener("click", function() {
      entries = [];
      $("#result").hidden = true;
      setProgress("");
    });
    if ("showDirectoryPicker" in window) $("#folderBtn").hidden = false;
    $("#folderBtn").addEventListener("click", async function() {
      var dir;
      try {
        dir = await window.showDirectoryPicker({ mode: "readwrite" });
      } catch (e) {
        return;
      }
      var btn = $("#folderBtn");
      btn.disabled = true;
      var ok = 0, failed = [];
      try {
        for (var i = 0; i < entries.length; i++) {
          var en = entries[i];
          setProgress("Saving " + (i + 1) + " / " + entries.length + " \u2014 " + en.path);
          try {
            var parts = en.path.split("/");
            var d = dir;
            for (var j = 0; j < parts.length - 1; j++) d = await d.getDirectoryHandle(parts[j], { create: true });
            var fh = await d.getFileHandle(parts[parts.length - 1], { create: true });
            var w = await fh.createWritable();
            await w.write(en.blob);
            await w.close();
            var back = await fh.getFile();
            if (back.size !== en.blob.size) throw new Error("wrote " + back.size + " of " + en.blob.size + " bytes");
            ok++;
          } catch (err) {
            failed.push(en.path + " (" + (err && err.message || err) + ")");
          }
        }
        setProgress("Saved " + ok + " of " + entries.length + " files to the folder \u2014 every file verified on disk." + (failed.length ? " \u26A0 Failed: " + failed.slice(0, 3).join("; ") + (failed.length > 3 ? " +" + (failed.length - 3) + " more" : "") : ""), !!failed.length);
      } finally {
        btn.disabled = false;
      }
    });
    return { intake };
  }

  // src/features/extract/index.js
  var import_meta = {};
  async function mount(host, shell2, opts) {
    const styleUrl = opts && opts.styleUrl || new URL("./styles.css", import_meta.url).href;
    const root = await mountInto(host, markup_default, styleUrl);
    return start(root, host, shell2);
  }

  // src/features/extract/standalone.js
  var shell = { send() {
  }, toast(m) {
    console.log(m);
  }, setSub() {
  }, openPicker() {
  }, activate() {
  } };
  mount(document.getElementById("view-viewer"), shell, { styleUrl: "src/features/extract/styles.css" });
})();
