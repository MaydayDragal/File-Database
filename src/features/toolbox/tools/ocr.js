/* ===== Image to Text (OCR) — Tesseract.js ===== */
// This tool's panel markup and its wiring; the Toolbox feature mounts every
// tool's markup into its shadow root, then calls init(root) for each.
export const markup = `
<section class="tool" id="tool-ocr">
<div class="wrap">
  <header>
    <h1>🔤 Image to Text (OCR)</h1>
    <p>Upload or paste an image and pull out the text it contains. The recognition runs in your browser — the image is never uploaded. The first run downloads the OCR engine (needs an internet connection once), then it's cached for offline use.</p>
  </header>

  <!-- Step 1: image -->
  <div class="card">
    <h2>1 · Choose an image</h2>
    <div class="drop" id="o-drop">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      <div class="big">Drop an image here, click to browse, or paste (Ctrl/⌘+V)</div>
      <div class="sub">JPEG · PNG · WebP · GIF · BMP — a screenshot, photo, or scan of text</div>
    </div>
    <input type="file" id="o-fileInput" accept="image/*" />
    <div class="filemeta" id="o-filemeta">
      <span class="dot">●</span>
      <div class="grow">
        <div class="name" id="o-fileName"></div>
        <div class="stats" id="o-fileStats"></div>
      </div>
      <button class="btn btn-ghost" id="o-clearFile">Remove</button>
    </div>
    <div class="o-preview" id="o-preview"></div>
  </div>

  <!-- Step 2: language + run -->
  <div class="card" id="o-runCard" style="display:none">
    <h2>2 · Extract text</h2>
    <div class="field">
      <label class="lbl" for="o-lang">Language</label>
      <div class="row">
        <select id="o-lang">
          <option value="eng" selected>English</option>
          <option value="spa">Spanish</option>
          <option value="fra">French</option>
          <option value="deu">German</option>
          <option value="ita">Italian</option>
          <option value="por">Portuguese</option>
          <option value="nld">Dutch</option>
          <option value="rus">Russian</option>
          <option value="chi_sim">Chinese (Simplified)</option>
          <option value="jpn">Japanese</option>
          <option value="kor">Korean</option>
        </select>
      </div>
    </div>
    <button class="btn btn-primary" id="o-runBtn">Extract text</button>
    <div class="progress-wrap" id="o-progWrap">
      <div class="bar"><div id="o-progBar"></div></div>
      <div class="progress-label" id="o-progLabel">Working…</div>
    </div>
    <div class="err" id="o-err"></div>
  </div>

  <!-- Step 3: result -->
  <div class="card results" id="o-results">
    <div class="results-head">
      <h2 style="margin:0">Extracted text</h2>
      <div class="head-actions">
        <span class="stats" id="o-count" style="color:var(--muted); font-size:13px"></span>
        <button type="button" class="btn btn-ghost" id="o-copyBtn">📋 Copy</button>
        <a class="btn btn-download" id="o-downloadBtn" href="#">⬇ Download .txt</a>
      </div>
    </div>
    <textarea id="o-text" class="o-textarea" spellcheck="true" placeholder="Recognized text will appear here…"></textarea>
  </div>

  <div class="foot">
    Powered by <a class="inline" href="https://tesseract.projectnaptha.com/" target="_blank" rel="noopener">Tesseract.js</a>,
    running locally in your browser. Accuracy depends on image clarity — clean, high-contrast, upright text works best.
  </div>
</div>
</section>
`;

export function init(root) {
  "use strict";
  var $ = function (id) { return root.getElementById(id); };
  var els = {
    drop: $("o-drop"), fileInput: $("o-fileInput"), filemeta: $("o-filemeta"),
    fileName: $("o-fileName"), fileStats: $("o-fileStats"), clearFile: $("o-clearFile"),
    preview: $("o-preview"), runCard: $("o-runCard"), lang: $("o-lang"), runBtn: $("o-runBtn"),
    progWrap: $("o-progWrap"), progBar: $("o-progBar"), progLabel: $("o-progLabel"), err: $("o-err"),
    results: $("o-results"), text: $("o-text"), count: $("o-count"),
    copyBtn: $("o-copyBtn"), downloadBtn: $("o-downloadBtn")
  };

  // The engine comes from the shared service (src/services/ocr.js);
  // window.__TESS_* still override where it is fetched from.

  var state = { file: null, previewUrl: null, outUrl: null };

  function fmtBytes(b) {
    if (b === 0) return "0 B";
    var u = ["B", "KB", "MB", "GB"], i = Math.floor(Math.log(b) / Math.log(1024));
    i = Math.min(i, u.length - 1);
    return (b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2) + " " + u[i];
  }
  function showError(m) { els.err.textContent = m; els.err.classList.add("show"); }
  function clearError() { els.err.textContent = ""; els.err.classList.remove("show"); }
  function setProgress(frac, label) {
    els.progWrap.classList.add("show");
    els.progBar.style.width = Math.max(0, Math.min(1, frac)) * 100 + "%";
    if (label != null) els.progLabel.textContent = label;
  }
  function hideProgress() { els.progWrap.classList.remove("show"); }

  function setFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name)) {
      showError("Please choose an image file."); return;
    }
    clearError(); resetResults();
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.file = file;
    state.previewUrl = URL.createObjectURL(file);
    els.fileName.textContent = file.name || "pasted image";
    els.fileStats.textContent = fmtBytes(file.size);
    els.filemeta.classList.add("show");
    els.preview.innerHTML = "";
    var im = new Image();
    im.onload = function () {
      els.fileStats.textContent = fmtBytes(file.size) + " · " + im.naturalWidth + "×" + im.naturalHeight;
    };
    im.src = state.previewUrl;
    els.preview.appendChild(im);
    els.preview.classList.add("show");
    els.runCard.style.display = "";
  }
  function clearFile() {
    if (state.previewUrl) { URL.revokeObjectURL(state.previewUrl); state.previewUrl = null; }
    state.file = null; els.fileInput.value = "";
    els.filemeta.classList.remove("show");
    els.preview.classList.remove("show"); els.preview.innerHTML = "";
    els.runCard.style.display = "none";
    resetResults(); clearError();
  }

  els.drop.addEventListener("click", function () { els.fileInput.click(); });
  els.fileInput.addEventListener("change", function (e) { if (e.target.files[0]) setFile(e.target.files[0]); });
  els.clearFile.addEventListener("click", clearFile);
  ["dragenter", "dragover"].forEach(function (ev) {
    els.drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); els.drop.classList.add("drag"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    els.drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); els.drop.classList.remove("drag"); });
  });
  els.drop.addEventListener("drop", function (e) { if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); });

  // Paste an image from the clipboard (only acts when the OCR tab is visible).
  root.addEventListener("paste", function (e) {
    var section = root.getElementById("tool-ocr");
    if (!section || !section.classList.contains("active")) return;
    var items = (e.clipboardData || {}).items || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf("image") === 0) {
        var f = items[i].getAsFile();
        if (f) { setFile(f); e.preventDefault(); break; }
      }
    }
  });

  function resetResults() {
    els.results.classList.remove("show");
    els.text.value = "";
    els.count.textContent = "";
    if (state.outUrl) { URL.revokeObjectURL(state.outUrl); state.outUrl = null; }
  }

  // Decode the picked file so it can be turned and measured before reading.
  function bitmapOfFile(file) {
    var viaImg = function () {
      return new Promise(function (res, rej) {
        var url = URL.createObjectURL(file), im = new Image();
        im.onload = function () { URL.revokeObjectURL(url); res(im); };
        im.onerror = function () { URL.revokeObjectURL(url); rej(new Error("Couldn't open that image.")); };
        im.src = url;
      });
    };
    if (!window.createImageBitmap) return viaImg();
    return createImageBitmap(file).catch(viaImg);
  }

  els.runBtn.addEventListener("click", function () {
    if (!state.file) return;
    clearError(); resetResults();
    els.runBtn.disabled = true;
    setProgress(0.03, "Loading OCR engine…");

    var lang = els.lang.value || "eng";
    var worker = null;

    FDServices.tess.createWorker(lang, {
        logger: function (m) {
          if (m.status === "recognizing text") setProgress(0.35 + 0.6 * (m.progress || 0), "Recognizing text… " + Math.round((m.progress || 0) * 100) + "%");
          else if (m.status && m.progress != null) setProgress(0.05 + 0.25 * m.progress, cap(m.status) + "…");
        }
    }).then(function (w) {
      worker = w;
      setProgress(0.35, "Recognizing text…");
      // Straighten first. The engine reads only horizontal text but never says
      // so — a photo taken sideways comes back as a few scraps of nonsense —
      // and it defaults to treating the image as one block, which loses most of
      // a form. ../ocr.js settles both; without it, read the image as-is.
      if (!window.OcrOrient) return worker.recognize(state.file).then(function (r) { return { text: (r && r.data && r.data.text) || "" }; });
      return bitmapOfFile(state.file).then(function (src) {
        return OcrOrient.readUpright(worker, src, {
          onStatus: function (m) { setProgress(0.4, m); }
        });
      }, function () { return worker.recognize(state.file).then(function (r) { return { text: (r && r.data && r.data.text) || "" }; }); });
    }).then(function (res) {
      var text = (res && res.text) ? res.text.replace(/\n{3,}/g, "\n\n").trim() : "";
      showResult(text);
      if (worker) worker.terminate();
      hideProgress();
      els.runBtn.disabled = false;
    }).catch(function (e) {
      console.error(e);
      if (worker) { try { worker.terminate(); } catch (x) {} }
      hideProgress();
      showError(e && e.message ? e.message : "Text recognition failed.");
      els.runBtn.disabled = false;
    });
  });

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function showResult(text) {
    els.text.value = text;
    var words = text ? (text.match(/\S+/g) || []).length : 0;
    els.count.textContent = text
      ? (text.length + " chars · " + words + " words")
      : "No text found — try a clearer or higher-contrast image.";
    var base = state.file && state.file.name ? state.file.name.replace(/\.[^.]+$/, "") : "extracted-text";
    els.downloadBtn.setAttribute("download", base + ".txt");
    refreshDownload();
    // The offer reads the text when it is taken, so corrections typed after
    // recognition are what gets saved.
    try { window.__vaultOffer && window.__vaultOffer(currentBlob, base + ".txt"); } catch (e) {}
    els.results.classList.add("show");
    els.results.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // The download and the "Save to File Vault" offer are built from the text
  // as it is NOW — the textarea is editable, and a corrected read is the one
  // worth keeping (the first recognition used to be frozen into both).
  function currentBlob() { return new Blob([els.text.value], { type: "text/plain" }); }
  function refreshDownload() {
    if (state.outUrl) URL.revokeObjectURL(state.outUrl);
    state.outUrl = URL.createObjectURL(currentBlob());
    els.downloadBtn.href = state.outUrl;
  }
  els.text.addEventListener("input", function () { if (els.results.classList.contains("show")) refreshDownload(); });

  els.copyBtn.addEventListener("click", function () {
    var txt = els.text.value;
    if (!txt) return;
    var original = els.copyBtn.textContent;
    var restore = function () { setTimeout(function () { els.copyBtn.textContent = original; }, 1200); };
    var ok = function () { els.copyBtn.textContent = "✓ Copied"; restore(); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(ok).catch(function () { legacyCopy(txt); ok(); });
    } else { legacyCopy(txt); ok(); }
  });
  function legacyCopy(txt) {
    els.text.focus(); els.text.select();
    try { document.execCommand("copy"); } catch (e) {}
    window.getSelection && window.getSelection().removeAllRanges();
  }
}
