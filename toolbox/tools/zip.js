/* ===== Zip Splitter ===== */
// This tool's panel. The markup used to sit inline in toolbox/index.html
// (REWRITE-PLAN.md Phase 3); it is mounted where this script's tag sits.
document.currentScript.insertAdjacentHTML("beforebegin", `
<section class="tool active" id="tool-zip">
<div class="wrap">
  
  <header>
    <h1>📦 Zip Splitter</h1>
    <p>Upload one ZIP file and split it into several smaller ZIPs — either by the number of files per part, or by a target size per part. Everything runs in your browser; nothing is uploaded to a server.</p>
  </header>

  <!-- Step 1: file -->
  <div class="card">
    <h2>1 · Choose a ZIP file</h2>
    <div class="drop" id="z-drop">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      <div class="big">Drop a .zip here or click to browse</div>
      <div class="sub">Processed locally — your files never leave this device</div>
    </div>
    <input type="file" id="z-fileInput" accept=".zip,application/zip,application/x-zip-compressed" />
    <div class="filemeta" id="z-filemeta">
      <span class="dot">●</span>
      <div class="grow">
        <div class="name" id="z-fileName"></div>
        <div class="stats" id="z-fileStats"></div>
      </div>
      <button class="btn btn-ghost" id="z-clearFile">Remove</button>
    </div>
  </div>

  <!-- Step 2: mode -->
  <div class="card">
    <h2>2 · How should it be split?</h2>
    <div class="modes">
      <div class="mode active" data-mode="count">
        <label><input type="radio" name="mode" value="count" checked /> By file count</label>
        <div class="desc">Each output ZIP holds up to N files.</div>
      </div>
      <div class="mode" data-mode="size">
        <label><input type="radio" name="mode" value="size" /> By size</label>
        <div class="desc">Each output ZIP stays at or under a target size (never over).</div>
      </div>
    </div>

    <div class="valuerow" id="z-countRow">
      <label for="z-countVal">Files per ZIP:</label>
      <input type="number" id="z-countVal" min="1" step="1" value="10" />
    </div>

    <div class="valuerow" id="z-sizeRow" style="display:none">
      <label for="z-sizeVal">Target size per ZIP:</label>
      <input type="number" id="z-sizeVal" min="0.01" step="1" value="10" />
      <select id="z-sizeUnit">
        <option value="1048576" selected>MB</option>
        <option value="1024">KB</option>
        <option value="1073741824">GB</option>
      </select>
    </div>
  </div>

  <!-- Step 3: run -->
  <div class="card">
    <h2>3 · Split</h2>
    <button class="btn btn-primary" id="z-runBtn" disabled>Split ZIP</button>
    <div class="progress-wrap" id="z-progWrap">
      <div class="bar"><div id="z-progBar"></div></div>
      <div class="progress-label" id="z-progLabel">Working…</div>
    </div>
    <div class="err" id="z-err"></div>
  </div>

  <!-- Results -->
  <div class="card results" id="z-results">
    <div class="results-head">
      <h2 id="z-resultsTitle">Results</h2>
      <div class="head-actions">
        <div class="fmt" id="z-fmtToggle" role="group" aria-label="Output format">
          <button type="button" data-fmt="zip" class="active">📦 Zipped</button>
          <button type="button" data-fmt="folder">📁 Unzipped</button>
        </div>
        <button class="btn btn-download" id="z-downloadAll">⬇ Download all</button>
      </div>
    </div>
    <div class="fmt-hint" id="z-fmtHint"></div>
    <div id="z-partsList"></div>
  </div>

  <div class="foot">
    Sizes are measured by the files' original (uncompressed) content, so parts stay safely under your target.
    Choose <strong>Zipped</strong> to get a <code>.zip</code> per part, or <strong>Unzipped</strong> to get plain folders.<br />
    Runs entirely client-side · powered by <a href="https://stuk.github.io/jszip/" target="_blank" rel="noopener">JSZip</a>.
  </div>
</div>
</section>
`);


(function () {
  "use strict";

  var els = {
    drop: document.getElementById("z-drop"),
    fileInput: document.getElementById("z-fileInput"),
    filemeta: document.getElementById("z-filemeta"),
    fileName: document.getElementById("z-fileName"),
    fileStats: document.getElementById("z-fileStats"),
    clearFile: document.getElementById("z-clearFile"),
    countRow: document.getElementById("z-countRow"),
    sizeRow: document.getElementById("z-sizeRow"),
    countVal: document.getElementById("z-countVal"),
    sizeVal: document.getElementById("z-sizeVal"),
    sizeUnit: document.getElementById("z-sizeUnit"),
    runBtn: document.getElementById("z-runBtn"),
    progWrap: document.getElementById("z-progWrap"),
    progBar: document.getElementById("z-progBar"),
    progLabel: document.getElementById("z-progLabel"),
    err: document.getElementById("z-err"),
    results: document.getElementById("z-results"),
    resultsTitle: document.getElementById("z-resultsTitle"),
    partsList: document.getElementById("z-partsList"),
    downloadAll: document.getElementById("z-downloadAll"),
    fmtToggle: document.getElementById("z-fmtToggle"),
    fmtHint: document.getElementById("z-fmtHint")
  };

  var state = {
    file: null,
    mode: "count",
    format: "zip",   // "zip" = each part is a .zip; "folder" = loose files in folders
    groups: []       // { name (no extension), files:[{path,data,size}], fileCount, size }
  };

  var canSaveToDir = typeof window.showDirectoryPicker === "function";

  // ---------- helpers ----------
  function fmtBytes(b) {
    if (b === 0) return "0 B";
    var units = ["B", "KB", "MB", "GB", "TB"];
    var i = Math.floor(Math.log(b) / Math.log(1024));
    i = Math.min(i, units.length - 1);
    return (b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2) + " " + units[i];
  }
  function showError(msg) {
    els.err.textContent = msg;
    els.err.classList.add("show");
  }
  function clearError() {
    els.err.textContent = "";
    els.err.classList.remove("show");
  }
  function baseName(name) {
    return name.replace(/\.zip$/i, "");
  }

  // ---------- file selection ----------
  function setFile(file) {
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) {
      showError("Please choose a .zip file.");
      return;
    }
    clearError();
    state.file = file;
    els.fileName.textContent = file.name;
    els.fileStats.textContent = fmtBytes(file.size);
    els.filemeta.classList.add("show");
    resetResults();
    updateRunBtn();
  }
  function clearFile() {
    state.file = null;
    els.fileInput.value = "";
    els.filemeta.classList.remove("show");
    resetResults();
    updateRunBtn();
  }

  els.drop.addEventListener("click", function () { els.fileInput.click(); });
  els.fileInput.addEventListener("change", function (e) {
    if (e.target.files && e.target.files[0]) setFile(e.target.files[0]);
  });
  els.clearFile.addEventListener("click", clearFile);

  ["dragenter", "dragover"].forEach(function (ev) {
    els.drop.addEventListener(ev, function (e) {
      e.preventDefault(); e.stopPropagation();
      els.drop.classList.add("drag");
    });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    els.drop.addEventListener(ev, function (e) {
      e.preventDefault(); e.stopPropagation();
      els.drop.classList.remove("drag");
    });
  });
  els.drop.addEventListener("drop", function (e) {
    if (e.dataTransfer.files && e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
  });

  // ---------- mode selection ----------
  document.querySelectorAll(".mode").forEach(function (m) {
    m.addEventListener("click", function () {
      var mode = m.getAttribute("data-mode");
      selectMode(mode);
    });
  });
  document.querySelectorAll('input[name=mode]').forEach(function (r) {
    r.addEventListener("change", function () { selectMode(r.value); });
  });
  function selectMode(mode) {
    state.mode = mode;
    document.querySelectorAll(".mode").forEach(function (m) {
      m.classList.toggle("active", m.getAttribute("data-mode") === mode);
    });
    var radio = document.querySelector('input[name=mode][value="' + mode + '"]');
    if (radio) radio.checked = true;
    els.countRow.style.display = mode === "count" ? "flex" : "none";
    els.sizeRow.style.display = mode === "size" ? "flex" : "none";
  }

  function updateRunBtn() {
    els.runBtn.disabled = !state.file;
  }

  // ---------- results ----------
  function resetResults() {
    state.groups = [];
    els.partsList.innerHTML = "";
    els.results.classList.remove("show");
  }

  // ---------- output format toggle ----------
  els.fmtToggle.addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-fmt]");
    if (!btn) return;
    state.format = btn.getAttribute("data-fmt");
    Array.prototype.forEach.call(els.fmtToggle.children, function (b) {
      b.classList.toggle("active", b === btn);
    });
    applyFormatUI();
  });

  function applyFormatUI() {
    var folder = state.format === "folder";
    if (folder && canSaveToDir) {
      els.downloadAll.textContent = "📁 Save all to folder";
      els.fmtHint.textContent = "Each part becomes a real folder of the original files. You'll be asked to pick a destination folder — nothing is uploaded.";
      els.fmtHint.classList.add("show");
    } else if (folder) {
      els.downloadAll.textContent = "⬇ Download all (one ZIP)";
      els.fmtHint.textContent = "Each part becomes a plain folder. Your browser can't save loose folders directly, so you'll get one ZIP that extracts to those folders (no nested ZIPs inside).";
      els.fmtHint.classList.add("show");
    } else {
      els.downloadAll.textContent = "⬇ Download all (one ZIP)";
      els.fmtHint.classList.remove("show");
    }
    // Re-render existing rows so per-part buttons match the format.
    if (state.groups.length) renderResults();
  }

  function setProgress(frac, label) {
    els.progWrap.classList.add("show");
    els.progBar.style.width = Math.max(0, Math.min(1, frac)) * 100 + "%";
    if (label != null) els.progLabel.textContent = label;
  }
  function hideProgress() { els.progWrap.classList.remove("show"); }

  // ---------- core: read + plan + build ----------
  els.runBtn.addEventListener("click", run);

  function run() {
    if (!state.file) return;
    clearError();
    resetResults();

    var mode = state.mode;
    var countVal = parseInt(els.countVal.value, 10);
    var sizeBytes = parseFloat(els.sizeVal.value) * parseFloat(els.sizeUnit.value);

    if (mode === "count" && (!countVal || countVal < 1)) {
      showError("Enter a valid number of files per ZIP (1 or more)."); return;
    }
    if (mode === "size" && (!sizeBytes || sizeBytes <= 0)) {
      showError("Enter a valid target size."); return;
    }

    els.runBtn.disabled = true;
    setProgress(0.02, "Reading ZIP…");

    JSZip.loadAsync(state.file)
      .then(function (zip) {
        // Collect real files (skip directory entries)
        var entries = [];
        zip.forEach(function (path, entry) {
          if (!entry.dir) entries.push(entry);
        });
        if (entries.length === 0) throw new Error("This ZIP contains no files.");

        setProgress(0.08, "Reading " + entries.length + " files…");

        // Read all file contents + true uncompressed sizes
        var loaded = 0;
        return Promise.all(entries.map(function (entry) {
          return entry.async("uint8array").then(function (data) {
            loaded++;
            setProgress(0.08 + 0.42 * (loaded / entries.length),
              "Reading files… " + loaded + " / " + entries.length);
            return { path: entry.name, data: data, size: data.length };
          });
        }));
      })
      .then(function (files) {
        // Plan the partitions
        var groups = mode === "count"
          ? planByCount(files, countVal)
          : planBySize(files, sizeBytes);

        if (mode === "size") {
          var oversized = files.filter(function (f) { return f.size > sizeBytes; });
          if (oversized.length) {
            showError("Heads up: " + oversized.length + " file(s) are individually larger than the target size, so those parts will exceed it (a single file can't be split).");
          }
        }
        buildGroups(groups);
        setProgress(1, "Done");
        hideProgress();
        renderResults();
        els.runBtn.disabled = false;
      })
      .catch(function (e) {
        console.error(e);
        hideProgress();
        showError(e && e.message ? e.message : "Something went wrong reading that ZIP.");
        els.runBtn.disabled = false;
      });
  }

  // Greedy: N files per group, preserving original order.
  function planByCount(files, perGroup) {
    var groups = [];
    for (var i = 0; i < files.length; i += perGroup) {
      groups.push(files.slice(i, i + perGroup));
    }
    return groups;
  }

  // Greedy bin pack: fill a part until the next file would exceed the target,
  // then start a new part. Never goes over unless a single file is itself
  // bigger than the target (unavoidable).
  function planBySize(files, target) {
    var groups = [];
    var current = [];
    var currentSize = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (current.length > 0 && currentSize + f.size > target) {
        groups.push(current);
        current = [];
        currentSize = 0;
      }
      current.push(f);
      currentSize += f.size;
    }
    if (current.length) groups.push(current);
    return groups;
  }

  // Turn the planned file groups into named parts. We keep the raw file data
  // and only build ZIPs on demand (at download), so switching between the
  // zipped/unzipped output formats needs no re-processing.
  function buildGroups(groups) {
    var base = baseName(state.file.name);
    var pad = String(groups.length).length;
    state.groups = groups.map(function (group, idx) {
      var total = 0;
      group.forEach(function (f) { total += f.size; });
      return {
        name: base + "_part" + String(idx + 1).padStart(pad, "0"),
        files: group,
        fileCount: group.length,
        size: total
      };
    });
  }

  // Build one part's files into a ZIP blob (files at the ZIP root).
  function zipGroup(group) {
    var zip = new JSZip();
    group.files.forEach(function (f) { zip.file(f.path, f.data); });
    return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionLevel: 6 });
  }

  function triggerBlobDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    try { window.__vaultOffer && window.__vaultOffer(blob, filename); } catch (e) {}
  }

  // Write files (preserving their nested paths) into a directory handle.
  function writeFilesToDir(dirHandle, files) {
    var chain = Promise.resolve();
    files.forEach(function (f) {
      chain = chain.then(function () {
        var segs = f.path.split("/").filter(Boolean);
        var fname = segs.pop();
        var dirChain = Promise.resolve(dirHandle);
        segs.forEach(function (seg) {
          dirChain = dirChain.then(function (d) {
            return d.getDirectoryHandle(seg, { create: true });
          });
        });
        return dirChain.then(function (d) {
          return d.getFileHandle(fname, { create: true }).then(function (fh) {
            return fh.createWritable().then(function (w) {
              return w.write(f.data).then(function () { return w.close(); });
            });
          });
        });
      });
    });
    return chain;
  }

  function renderResults() {
    els.partsList.innerHTML = "";
    var folderMode = state.format === "folder";
    var saveToDir = folderMode && canSaveToDir;

    state.groups.forEach(function (g, i) {
      var row = document.createElement("div");
      row.className = "part";

      var idx = document.createElement("div");
      idx.className = "idx";
      idx.textContent = (i + 1);

      var info = document.createElement("div");
      info.className = "grow";
      var nm = document.createElement("div");
      nm.className = "pname";
      nm.textContent = folderMode ? g.name + "/" : g.name + ".zip";
      var st = document.createElement("div");
      st.className = "pstats";
      st.textContent = g.fileCount + " file" + (g.fileCount === 1 ? "" : "s") +
        " · " + fmtBytes(g.size);
      info.appendChild(nm);
      info.appendChild(st);

      var btn = document.createElement("button");
      btn.className = "btn btn-download";
      btn.textContent = saveToDir ? "📁 Save to folder" : "⬇ Download";
      btn.addEventListener("click", function () { downloadPart(g, btn); });

      row.appendChild(idx);
      row.appendChild(info);
      row.appendChild(btn);
      els.partsList.appendChild(row);
    });

    els.resultsTitle.textContent = "Results — " + state.groups.length +
      " part" + (state.groups.length === 1 ? "" : "s");
    els.results.classList.add("show");
    els.results.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // Download / save a single part according to the selected output format.
  function downloadPart(group, btn) {
    var original = btn.textContent;
    btn.disabled = true;

    var done = function () { btn.textContent = original; btn.disabled = false; };
    var fail = function (e) {
      if (e && e.name === "AbortError") { done(); return; } // user cancelled the folder picker
      console.error(e);
      showError("Couldn't save that part: " + (e && e.message ? e.message : e));
      done();
    };

    if (state.format === "folder" && canSaveToDir) {
      btn.textContent = "Saving…";
      window.showDirectoryPicker({ mode: "readwrite" })
        .then(function (dir) {
          return dir.getDirectoryHandle(group.name, { create: true })
            .then(function (sub) { return writeFilesToDir(sub, group.files); });
        })
        .then(done).catch(fail);
    } else {
      // Zipped part, or unzipped fallback (a ZIP whose files sit at the root).
      btn.textContent = "Zipping…";
      zipGroup(group)
        .then(function (blob) { triggerBlobDownload(blob, group.name + ".zip"); done(); })
        .catch(fail);
    }
  }

  // "Download all" / "Save all to folder" — one action for every part.
  els.downloadAll.addEventListener("click", function () {
    if (!state.groups.length) return;
    var btn = els.downloadAll;
    var original = btn.textContent;
    btn.disabled = true;
    var done = function () { btn.textContent = original; btn.disabled = false; };
    var fail = function (e) {
      if (e && e.name === "AbortError") { done(); return; }
      console.error(e);
      showError("Couldn't build the combined download: " + (e && e.message ? e.message : e));
      done();
    };

    var bundleName = baseName(state.file.name) + "_split";

    if (state.format === "folder" && canSaveToDir) {
      // Write real folders (one per part) into a directory the user picks.
      btn.textContent = "Choose a folder…";
      window.showDirectoryPicker({ mode: "readwrite" })
        .then(function (root) {
          return root.getDirectoryHandle(bundleName, { create: true }).then(function (base) {
            var chain = Promise.resolve();
            state.groups.forEach(function (g, i) {
              chain = chain.then(function () {
                btn.textContent = "Saving " + (i + 1) + " / " + state.groups.length + "…";
                return base.getDirectoryHandle(g.name, { create: true })
                  .then(function (sub) { return writeFilesToDir(sub, g.files); });
              });
            });
            return chain;
          });
        })
        .then(done).catch(fail);
      return;
    }

    // Build one parent ZIP. In folder mode its contents are plain folders;
    // in zip mode its contents are the per-part .zip files.
    btn.textContent = "Bundling…";
    var bundle = new JSZip();
    var root = bundle.folder(bundleName);

    var prep;
    if (state.format === "folder") {
      state.groups.forEach(function (g) {
        var sub = root.folder(g.name);
        g.files.forEach(function (f) { sub.file(f.path, f.data); });
      });
      prep = Promise.resolve();
    } else {
      // Zip each part first, then store the .zips (already compressed).
      var chain = Promise.resolve();
      state.groups.forEach(function (g) {
        chain = chain.then(function () {
          return zipGroup(g).then(function (blob) { root.file(g.name + ".zip", blob); });
        });
      });
      prep = chain;
    }

    var compression = state.format === "folder" ? "DEFLATE" : "STORE";
    prep.then(function () {
      return bundle.generateAsync(
        { type: "blob", compression: compression },
        function (meta) { btn.textContent = "Bundling… " + Math.round(meta.percent) + "%"; }
      );
    }).then(function (blob) {
      triggerBlobDownload(blob, bundleName + ".zip");
      done();
    }).catch(fail);
  });

  applyFormatUI();
  updateRunBtn();
})();

