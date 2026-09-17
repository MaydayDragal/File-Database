/* ===== PDF Toolkit ===== */
// This tool's panel. The markup used to sit inline in toolbox/index.html
// (REWRITE-PLAN.md Phase 3); it is mounted where this script's tag sits.
document.currentScript.insertAdjacentHTML("beforebegin", `
<section class="tool" id="tool-pdf">
<div class="wrap">
  <header>
    <h1>📕 PDF Toolkit</h1>
    <p>Merge, reorder, rotate, delete and split PDF pages, build a PDF from images, or extract pages as images — all in your browser, nothing uploaded.</p>
  </header>

  <div class="card">
    <div class="seg elec-nav" id="pdf-nav" role="tablist">
      <button type="button" data-p="org" class="active">Organize &amp; Merge</button>
      <button type="button" data-p="i2p">Images → PDF</button>
      <button type="button" data-p="ext">Extract Pages</button>
      <button type="button" data-p="renli">Rename LI Docs</button>
    </div>
  </div>

  <!-- Organize -->
  <div class="card pdf-panel active" id="pdfp-org">
    <h2>Organize &amp; Merge</h2>
    <div class="drop" id="pdf-org-drop">
      <div class="big">Drop PDF(s) here or click to browse</div>
      <div class="sub">Add several to merge · drag page tiles to reorder</div>
    </div>
    <input type="file" id="pdf-org-file" accept="application/pdf,.pdf" multiple />
    <div id="pdf-org-body" style="display:none">
      <div class="pdf-bar">
        <button type="button" class="btn btn-ghost" id="pdf-org-rot">⟳ Rotate selected</button>
        <button type="button" class="btn btn-ghost" id="pdf-org-del">🗑 Delete selected</button>
        <button type="button" class="btn btn-ghost" id="pdf-org-all">Select all</button>
        <button type="button" class="btn btn-ghost" id="pdf-org-none">Clear selection</button>
        <span class="pdf-hint" id="pdf-org-count"></span>
      </div>
      <div class="pdf-bar">
        <button type="button" class="btn btn-primary" id="pdf-org-merge" style="width:auto; padding:11px 20px">⬇ Save PDF</button>
        <label class="lbl" style="margin:0 0 0 6px">Split every</label>
        <input type="number" id="pdf-org-splitn" min="1" step="1" value="1" style="width:80px" />
        <label class="lbl" style="margin:0">pages →</label>
        <button type="button" class="btn btn-ghost" id="pdf-org-split">Split to ZIP</button>
      </div>
      <div class="err" id="pdf-org-err"></div>
      <div class="pdf-grid" id="pdf-org-grid"></div>
      <div class="pdf-hint">Click a page to select it. Drag pages to reorder. The rotate button on each tile turns that page.</div>
    </div>
    <div class="progress-wrap" id="pdf-org-prog"><div class="bar"><div id="pdf-org-bar"></div></div><div class="progress-label" id="pdf-org-lbl"></div></div>
  </div>

  <!-- Images to PDF -->
  <div class="card pdf-panel" id="pdfp-i2p">
    <h2>Images → PDF</h2>
    <div class="drop" id="pdf-i2p-drop">
      <div class="big">Drop images here or click to browse</div>
      <div class="sub">One image per page · drag to reorder</div>
    </div>
    <input type="file" id="pdf-i2p-file" accept="image/*" multiple />
    <div id="pdf-i2p-body" style="display:none">
      <div class="e-grid">
        <div class="e-field"><label>Page size</label><select id="pdf-i2p-size"><option value="fit">Fit to image</option><option value="a4">A4</option><option value="letter">Letter</option></select></div>
        <div class="e-field"><label>Orientation</label><select id="pdf-i2p-orient"><option value="auto">Auto</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></div>
      </div>
      <div class="row" style="margin:14px 0">
        <label class="lbl" style="margin:0">Margin (pt)</label>
        <input type="number" id="pdf-i2p-margin" min="0" step="1" value="0" style="width:100px" />
      </div>
      <button type="button" class="btn btn-primary" id="pdf-i2p-go" style="width:auto; padding:11px 20px">⬇ Build PDF</button>
      <div class="pdf-grid" id="pdf-i2p-grid"></div>
    </div>
  </div>

  <!-- Extract pages -->
  <div class="card pdf-panel" id="pdfp-ext">
    <h2>Extract Pages as Images</h2>
    <div class="drop" id="pdf-ext-drop">
      <div class="big">Drop a PDF here or click to browse</div>
      <div class="sub">Render each page to PNG or JPEG</div>
    </div>
    <input type="file" id="pdf-ext-file" accept="application/pdf,.pdf" />
    <div id="pdf-ext-body" style="display:none">
      <div class="e-grid">
        <div class="e-field"><label>Format</label><select id="pdf-ext-fmt"><option value="image/png">PNG</option><option value="image/jpeg">JPEG</option></select></div>
        <div class="e-field"><label>Scale (DPI ≈ 72×)</label><select id="pdf-ext-scale"><option value="1">1× (72 dpi)</option><option value="2" selected>2× (144 dpi)</option><option value="3">3× (216 dpi)</option></select></div>
      </div>
      <button type="button" class="btn btn-primary" id="pdf-ext-go" style="width:auto; padding:11px 20px; margin-top:14px">⬇ Extract to ZIP</button>
      <div class="progress-wrap" id="pdf-ext-prog"><div class="bar"><div id="pdf-ext-bar"></div></div><div class="progress-label" id="pdf-ext-lbl"></div></div>
      <div class="pdf-hint" id="pdf-ext-info"></div>
    </div>
  </div>

  <!-- Rename Mercedes LI docs -->
  <div class="card pdf-panel" id="pdfp-renli">
    <h2>Rename Mercedes-Benz LI Documents</h2>
    <p class="desc">Upload LI PDFs with inconsistent names. The tool reads the <b>document number</b>, <b>version</b>, and <b>title</b> and renames each to
      <code>LI00.20-P-077615_2 Vehicle handover cannot be performed.pdf</code>. Auto-detected values are editable — check them before downloading.</p>
    <div class="drop" id="pdf-rl-drop">
      <div class="big">Drop LI PDF(s) here or click to browse</div>
      <div class="sub">Reads the doc number / version / title from the file — nothing is uploaded</div>
    </div>
    <input type="file" id="pdf-rl-file" accept="application/pdf,.pdf" multiple />
    <div class="results-head" id="pdf-rl-head" style="display:none; margin-top:16px">
      <h2 style="margin:0">Files</h2>
      <div class="head-actions">
        <button class="btn btn-ghost" id="pdf-rl-clear">Clear files</button>
        <button class="btn btn-download" id="pdf-rl-all">⬇ Download all renamed (ZIP)</button>
      </div>
    </div>
    <div id="pdf-rl-list"></div>
    <div class="progress-wrap" id="pdf-rl-prog"><div class="bar"><div id="pdf-rl-bar"></div></div><div class="progress-label" id="pdf-rl-lbl"></div></div>
  </div>

  <div class="foot">Powered by pdf-lib and PDF.js, inlined so the toolkit works fully offline. Large or scanned PDFs may take a moment.</div>
</div>
</section>
`);

(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  // pdf-lib is a page script (vendor/pdf-lib.min.js); PDF.js is the shared,
  // on-demand copy (src/services/pdf.js → vendor/). Start fetching it now —
  // this tab exists to open PDFs — and wait for it at every entry point.
  FDServices.pdf.load().catch(function () {});
  function ready() {
    return FDServices.pdf.load().then(function () {
      if (!window.PDFLib) throw new Error("PDF engine still loading — try again in a second.");
    });
  }
  function dl(blob, name) { var u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); try { window.__vaultOffer && window.__vaultOffer(blob, name); } catch (e) {} }
  function loadImg(file) { return new Promise(function (res, rej) { var u = URL.createObjectURL(file); var im = new Image(); im.onload = function () { res({ im: im, url: u }); }; im.onerror = function () { rej(new Error("bad image")); }; im.src = u; }); }

  var nav = $("pdf-nav");
  nav.addEventListener("click", function (e) { var b = e.target.closest("button[data-p]"); if (!b) return; Array.prototype.forEach.call(nav.children, function (c) { c.classList.toggle("active", c === b); }); ["org", "i2p", "ext", "renli"].forEach(function (p) { $("pdfp-" + p).classList.toggle("active", p === b.getAttribute("data-p")); }); });

  function wireDrop(drop, input, onFiles) {
    drop.addEventListener("click", function () { input.click(); });
    input.addEventListener("change", function (e) { if (e.target.files.length) onFiles(e.target.files); });
    ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.add("drag"); }); });
    ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.remove("drag"); }); });
    drop.addEventListener("drop", function (e) { if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files); });
  }

  // ============ ORGANIZE ============
  var docs = [], tiles = [], uid = 0, thumbCache = {};
  function orgErr(m) { var e = $("pdf-org-err"); if (m) { e.textContent = m; e.classList.add("show"); } else e.classList.remove("show"); }

  wireDrop($("pdf-org-drop"), $("pdf-org-file"), addOrgFiles);
  function addOrgFiles(files) {
    ready().then(function () { addOrgFilesLoaded(files); }, function (e) { orgErr((e && e.message) || "Couldn't load the PDF reader."); });
  }
  function addOrgFilesLoaded(files) {
    orgErr("");
    var arr = Array.prototype.slice.call(files).filter(function (f) { return /pdf/i.test(f.type) || /\.pdf$/i.test(f.name); });
    var i = 0;
    (function next() {
      if (i >= arr.length) { $("pdf-org-body").style.display = "block"; renderGrid(); return; }
      var f = arr[i];
      f.arrayBuffer().then(function (buf) {
        return Promise.all([
          PDFLib.PDFDocument.load(buf.slice(0), { ignoreEncryption: true }),
          pdfjsLib.getDocument({ data: buf.slice(0), isEvalSupported: false }).promise
        ]).then(function (r) {
          var di = docs.length; docs.push({ pl: r[0], pj: r[1], name: f.name });
          var n = r[0].getPageCount();
          for (var pg = 0; pg < n; pg++) tiles.push({ doc: di, page: pg, rot: 0, id: ++uid });
        });
      }).catch(function (e) { orgErr("Couldn't open " + f.name + " (" + (e && e.message) + ")"); }).then(function () { i++; next(); });
    })();
  }
  function selCount() { return tiles.filter(function (t) { return t.sel; }).length; }
  function updateCount() { $("pdf-org-count").textContent = tiles.length + " page(s), " + selCount() + " selected"; }
  function thumbKey(t) { return t.doc + ":" + t.page + ":" + t.rot; }
  function ensureThumb(t, img) {
    var key = thumbKey(t);
    if (thumbCache[key]) { img.src = thumbCache[key]; return; }
    var d = docs[t.doc];
    d.pj.getPage(t.page + 1).then(function (page) {
      var base = page.getViewport({ scale: 1 });
      var scale = Math.min(150 / base.width, 150 / base.height);
      var vp = page.getViewport({ scale: scale, rotation: ((page.rotate || 0) + t.rot) % 360 });
      var c = document.createElement("canvas"); c.width = Math.max(1, Math.ceil(vp.width)); c.height = Math.max(1, Math.ceil(vp.height));
      return page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise.then(function () { var u = c.toDataURL("image/png"); thumbCache[key] = u; img.src = u; });
    }).catch(function () {});
  }
  function renderGrid() {
    var grid = $("pdf-org-grid"); grid.innerHTML = "";
    tiles.forEach(function (t, idx) {
      var tile = document.createElement("div");
      tile.className = "pdf-tile" + (t.sel ? " sel" : "");
      tile.draggable = true; tile.dataset.idx = idx;
      var img = document.createElement("img"); img.className = "ph"; img.alt = "";
      var ph = document.createElement("div"); ph.className = "ph"; ph.textContent = "…";
      tile.appendChild(img);
      var lab = document.createElement("div"); lab.className = "lab"; lab.textContent = (idx + 1) + " · " + docs[t.doc].name.slice(0, 14);
      var rot = document.createElement("button"); rot.className = "rot"; rot.textContent = "⟳"; rot.title = "Rotate this page";
      rot.addEventListener("click", function (e) { e.stopPropagation(); t.rot = (t.rot + 90) % 360; var ni = document.createElement("img"); ni.className = "ph"; tile.replaceChild(ni, tile.firstChild); ensureThumb(t, ni); });
      tile.appendChild(rot); tile.appendChild(lab);
      tile.addEventListener("click", function () { t.sel = !t.sel; tile.classList.toggle("sel", t.sel); updateCount(); });
      // drag reorder
      tile.addEventListener("dragstart", function (e) { e.dataTransfer.setData("text/plain", idx); });
      tile.addEventListener("dragover", function (e) { e.preventDefault(); tile.classList.add("dragover"); });
      tile.addEventListener("dragleave", function () { tile.classList.remove("dragover"); });
      tile.addEventListener("drop", function (e) { e.preventDefault(); tile.classList.remove("dragover"); var from = +e.dataTransfer.getData("text/plain"), to = idx; if (from === to) return; var m = tiles.splice(from, 1)[0]; tiles.splice(to, 0, m); renderGrid(); });
      grid.appendChild(tile);
      ensureThumb(t, img);
    });
    updateCount();
  }
  $("pdf-org-rot").addEventListener("click", function () { tiles.forEach(function (t) { if (t.sel) t.rot = (t.rot + 90) % 360; }); renderGrid(); });
  $("pdf-org-del").addEventListener("click", function () { tiles = tiles.filter(function (t) { return !t.sel; }); if (!tiles.length) { $("pdf-org-body").style.display = "none"; docs = []; } renderGrid(); });
  $("pdf-org-all").addEventListener("click", function () { tiles.forEach(function (t) { t.sel = true; }); renderGrid(); });
  $("pdf-org-none").addEventListener("click", function () { tiles.forEach(function (t) { t.sel = false; }); renderGrid(); });

  function buildDoc(list) {
    return PDFLib.PDFDocument.create().then(function (out) {
      var i = 0;
      return (function step() {
        if (i >= list.length) return out.save();
        var t = list[i];
        return out.copyPages(docs[t.doc].pl, [t.page]).then(function (pgs) {
          var pg = pgs[0], cur = pg.getRotation().angle || 0;
          pg.setRotation(PDFLib.degrees((cur + t.rot) % 360)); out.addPage(pg); i++; return step();
        });
      })();
    });
  }
  $("pdf-org-merge").addEventListener("click", function () {
    if (!tiles.length) return;
    var btn = $("pdf-org-merge"), o = btn.textContent; btn.disabled = true; btn.textContent = "Building…";
    buildDoc(tiles).then(function (bytes) { dl(new Blob([bytes], { type: "application/pdf" }), "merged.pdf"); }).catch(function (e) { orgErr(e.message); }).then(function () { btn.disabled = false; btn.textContent = o; });
  });
  $("pdf-org-split").addEventListener("click", function () {
    if (!tiles.length) return;
    var n = Math.max(1, parseInt($("pdf-org-splitn").value, 10) || 1);
    var groups = []; for (var i = 0; i < tiles.length; i += n) groups.push(tiles.slice(i, i + n));
    var zip = new JSZip(), gi = 0;
    (function step() {
      if (gi >= groups.length) { zip.generateAsync({ type: "blob" }).then(function (b) { dl(b, "split.zip"); }); return; }
      buildDoc(groups[gi]).then(function (bytes) { zip.file("part_" + String(gi + 1).padStart(2, "0") + ".pdf", bytes); gi++; step(); });
    })();
  });

  // ============ IMAGES → PDF ============
  var i2pFiles = [];
  wireDrop($("pdf-i2p-drop"), $("pdf-i2p-file"), function (files) {
    for (var i = 0; i < files.length; i++) if (/^image\//.test(files[i].type)) i2pFiles.push(files[i]);
    $("pdf-i2p-body").style.display = i2pFiles.length ? "block" : "none";
    renderI2p();
  });
  function renderI2p() {
    var grid = $("pdf-i2p-grid"); grid.innerHTML = "";
    i2pFiles.forEach(function (f, idx) {
      var tile = document.createElement("div"); tile.className = "pdf-tile"; tile.draggable = true;
      var img = document.createElement("img"); img.className = "ph"; img.src = URL.createObjectURL(f);
      var lab = document.createElement("div"); lab.className = "lab"; lab.textContent = (idx + 1) + " · " + f.name.slice(0, 14);
      tile.appendChild(img); tile.appendChild(lab);
      tile.addEventListener("dragstart", function (e) { e.dataTransfer.setData("text/plain", idx); });
      tile.addEventListener("dragover", function (e) { e.preventDefault(); tile.classList.add("dragover"); });
      tile.addEventListener("dragleave", function () { tile.classList.remove("dragover"); });
      tile.addEventListener("drop", function (e) { e.preventDefault(); var from = +e.dataTransfer.getData("text/plain"); if (from === idx) return; var m = i2pFiles.splice(from, 1)[0]; i2pFiles.splice(idx, 0, m); renderI2p(); });
      grid.appendChild(tile);
    });
  }
  function imgBytes(file) {
    return file.arrayBuffer().then(function (buf) {
      var type = file.type;
      if (type === "image/jpeg" || type === "image/png") return { buf: buf, type: type };
      // convert others to PNG
      return loadImg(file).then(function (r) { var c = document.createElement("canvas"); c.width = r.im.naturalWidth; c.height = r.im.naturalHeight; c.getContext("2d").drawImage(r.im, 0, 0); URL.revokeObjectURL(r.url); return new Promise(function (res) { c.toBlob(function (b) { b.arrayBuffer().then(function (ab) { res({ buf: ab, type: "image/png" }); }); }, "image/png"); }); });
    });
  }
  $("pdf-i2p-go").addEventListener("click", function () {
    if (!i2pFiles.length) return;
    var btn = $("pdf-i2p-go"), o = btn.textContent; btn.disabled = true; btn.textContent = "Building…";
    var sizeMode = $("pdf-i2p-size").value, orient = $("pdf-i2p-orient").value, margin = parseFloat($("pdf-i2p-margin").value) || 0;
    var PAGE = { a4: [595.28, 841.89], letter: [612, 792] };
    PDFLib.PDFDocument.create().then(function (out) {
      var i = 0;
      return (function step() {
        if (i >= i2pFiles.length) return out.save();
        return imgBytes(i2pFiles[i]).then(function (d) {
          return (d.type === "image/jpeg" ? out.embedJpg(d.buf) : out.embedPng(d.buf));
        }).then(function (emb) {
          var iw = emb.width, ih = emb.height, pw, ph;
          if (sizeMode === "fit") { pw = iw + margin * 2; ph = ih + margin * 2; }
          else { var base = PAGE[sizeMode]; var land = orient === "landscape" || (orient === "auto" && iw > ih); pw = land ? base[1] : base[0]; ph = land ? base[0] : base[1]; }
          var page = out.addPage([pw, ph]);
          var aw = pw - margin * 2, ah = ph - margin * 2, s = Math.min(aw / iw, ah / ih);
          var dw = iw * s, dh = ih * s;
          page.drawImage(emb, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
          i++; return step();
        });
      })();
    }).then(function (bytes) { dl(new Blob([bytes], { type: "application/pdf" }), "images.pdf"); }).catch(function (e) { alert("Failed: " + e.message); }).then(function () { btn.disabled = false; btn.textContent = o; });
  });

  // ============ EXTRACT ============
  var extDoc = null, extName = "pages";
  wireDrop($("pdf-ext-drop"), $("pdf-ext-file"), function (files) {
    var f = files[0]; if (!f) return; extName = f.name.replace(/\.pdf$/i, "");
    ready().then(function () { return f.arrayBuffer(); }).then(function (buf) { return pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise; }).then(function (doc) { extDoc = doc; $("pdf-ext-body").style.display = "block"; $("pdf-ext-info").textContent = doc.numPages + " page(s) ready."; });
  });
  $("pdf-ext-go").addEventListener("click", function () {
    if (!extDoc) return;
    var fmt = $("pdf-ext-fmt").value, scale = parseFloat($("pdf-ext-scale").value), ext = fmt === "image/png" ? "png" : "jpg";
    var zip = new JSZip(), i = 1, N = extDoc.numPages;
    $("pdf-ext-prog").classList.add("show");
    (function step() {
      if (i > N) { $("pdf-ext-prog").classList.remove("show"); zip.generateAsync({ type: "blob", compression: "STORE" }).then(function (b) { dl(b, extName + "_pages.zip"); }); return; }
      $("pdf-ext-bar").style.width = ((i - 1) / N * 100) + "%"; $("pdf-ext-lbl").textContent = "Rendering page " + i + " / " + N + "…";
      extDoc.getPage(i).then(function (page) {
        var vp = page.getViewport({ scale: scale });
        var c = document.createElement("canvas"); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        if (fmt === "image/jpeg") { var ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); }
        return page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise.then(function () {
          return new Promise(function (res) { c.toBlob(function (b) { zip.file(extName + "_p" + String(i).padStart(3, "0") + "." + ext, b); i++; res(); }, fmt, 0.9); });
        });
      }).then(step);
    })();
  });

  // ============ RENAME MERCEDES LI DOCS ============
  var rlItems = [];
  // The document-number matcher and text normalization are shared with the
  // LI app: src/core/{text,ids}.js (REWRITE-PLAN.md Phase 1).
  var DOCNUM = FDCore.ids.DOCNUM, normText = FDCore.text.normText, normLI = FDCore.text.normLI;

  // OCR fallback: the shared engine (src/services/ocr.js), one worker per PDF.
  function ocrPdf(doc, onStatus) {
    return FDServices.tess.createWorker("eng").then(function (worker) {
        var pages = Math.min(doc.numPages, 2), text = "", items = [], i = 1, angle = 0;
        function step() {
          if (i > pages) return worker.terminate().then(function () { return { text: text, lines: items }; });
          return doc.getPage(i).then(function (page) {
            var vp = page.getViewport({ scale: 3 });
            var c = document.createElement("canvas"); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
            var ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
            return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
              if (onStatus) onStatus("Running OCR on page " + i + "…");
              // See ../ocr.js: document mode instead of the engine's one-block
              // default, and a which-way-up check when page 1 yields no
              // document number (a sideways scan otherwise reads as noise).
              var orient = window.OcrOrient;
              var opts = orient && { readEdge: function (s) { return Math.max(s.width, s.height); } };
              var read = !orient
                ? worker.recognize(c).then(function (r) { return { text: (r.data && r.data.text) || "", data: r.data, angle: 0 }; })
                : i === 1
                  ? orient.readSmart(worker, c, Object.assign({ accept: function (t) { return !!(detectLI(t) || detectLIFuzzy(t)); } }, opts))
                  : orient.readAt(worker, c, angle, opts);
              return read.then(function (r) {
                if (i === 1) angle = r.angle || 0;
                text += (r.text || "") + "\n";
                ((r.data && r.data.lines) || []).forEach(function (ln) { var s = (ln.text || "").replace(/\s+/g, " ").trim(); if (s) items.push({ text: s, h: ln.bbox ? (ln.bbox.y1 - ln.bbox.y0) : 0, y: ln.bbox ? ln.bbox.y0 : 0 }); });
                c.width = c.height = 0;
                i++; return step();
              });
            });
          });
        }
        return step();
    });
  }
  // Filename rules, fuzzy OCR numbers, versions, line assembly and title
  // extraction: src/core/{text,ids,li-parse}.js, the same code the LI app runs.
  var reEsc = FDCore.text.reEsc, sanitize = FDCore.text.sanitize, cleanTitle = FDCore.text.cleanTitle;
  var detectLI = FDCore.ids.detectLI, detectLIFuzzy = FDCore.ids.detectLIFuzzy, detectVersion = FDCore.ids.detectVersion;
  var itemsToLines = FDCore.li.itemsToLines, titleFromStructure = FDCore.li.titleFromStructure;
  // The Toolbox also has the PDF's metadata title to fall back on, which the
  // LI app does not: structure first, then metadata, then the shared fallbacks.
  function detectTitle(metaTitle, lines, text, li) {
    var st = titleFromStructure(lines, li);
    if (st && st.length >= 4) return cleanTitle(st);
    var t = (metaTitle || "").trim();
    if (t && !DOCNUM.test(t) && t.length >= 4 && !/\.(pdf|indd|doc)$/i.test(t)) return cleanTitle(t);
    return FDCore.li.detectTitle(lines, text, li);
  }
  function extractLI(file, onStatus) {
    return ready().then(function () { return file.arrayBuffer(); }).then(function (buf) {
      return pdfjsLib.getDocument({ data: buf.slice(0), isEvalSupported: false }).promise.then(function (doc) {
        var metaP = doc.getMetadata().then(function (m) { return m && m.info && m.info.Title ? m.info.Title : ""; }).catch(function () { return ""; });
        var pages = Math.min(doc.numPages, 3), text = "", lines = [], i = 1;
        function pg() {
          if (i > pages) return Promise.resolve();
          return doc.getPage(i).then(function (page) {
            return page.getTextContent().then(function (tc) {
              tc.items.forEach(function (it) { text += normText(it.str) + " "; });
              if (i === 1) lines = itemsToLines(tc.items);   // title lives on page 1
              text += "\n"; i++; return pg();
            });
          });
        }
        return pg().then(function () { return metaP; }).then(function (metaTitle) {
          if (text.trim().length > 0) {
            var hay = text + " " + file.name, li = detectLI(hay);
            return { li: li, ver: detectVersion(hay, li), title: detectTitle(metaTitle, lines, text, li), hadText: true, ocr: false };
          }
          // no text layer → OCR fallback
          if (onStatus) onStatus("No text found — running OCR…");
          return ocrPdf(doc, onStatus).then(function (o) {
            var hay = o.text + " " + file.name, li = detectLI(hay) || detectLIFuzzy(o.text) || detectLIFuzzy(file.name);
            return { li: li, ver: detectVersion(hay, li), title: detectTitle(metaTitle, o.lines, o.text, li), hadText: false, ocr: true };
          }).catch(function (e) {
            var hay = file.name, li = detectLI(hay);
            return { li: li, ver: detectVersion(hay, li), title: "", hadText: false, ocr: false, ocrErr: (e && e.message) || "OCR failed" };
          });
        });
      });
    }).catch(function () { var hay = file.name, li = detectLI(hay); return { li: li, ver: detectVersion(hay, li), title: "", hadText: false }; });
  }
  var rlName = FDCore.li.rlName;
  wireDrop($("pdf-rl-drop"), $("pdf-rl-file"), function (files) {
    var arr = Array.prototype.slice.call(files).filter(function (f) { return /pdf/i.test(f.type) || /\.pdf$/i.test(f.name); });
    if (!arr.length) return;
    $("pdf-rl-prog").classList.add("show");
    var i = 0;
    (function next() {
      if (i >= arr.length) { $("pdf-rl-prog").classList.remove("show"); $("pdf-rl-head").style.display = "flex"; renderRl(); return; }
      var f = arr[i];
      $("pdf-rl-bar").style.width = (i / arr.length * 100) + "%";
      $("pdf-rl-lbl").textContent = "Reading " + (i + 1) + " / " + arr.length + " — " + f.name;
      extractLI(f, function (msg) { $("pdf-rl-lbl").textContent = (i + 1) + " / " + arr.length + ": " + msg; }).then(function (d) { d.file = f; rlItems.push(d); i++; next(); });
    })();
  });
  function renderRl() {
    var list = $("pdf-rl-list"); list.innerHTML = "";
    rlItems.forEach(function (it, idx) {
      var row = document.createElement("div"); row.className = "g-item"; row.style.flexDirection = "column"; row.style.alignItems = "stretch"; row.style.gap = "10px";
      var orig = document.createElement("div"); orig.className = "st"; orig.textContent = "Original: " + it.file.name + (it.hadText ? "" : it.ocr ? " (scanned — read via OCR)" : it.ocrErr ? " (no text; OCR unavailable — used filename)" : " (no text layer — used filename)");
      var grid = document.createElement("div"); grid.className = "e-grid"; grid.style.gridTemplateColumns = "1fr 90px";
      var fLi = field("Document number", it.li, function (v) { it.li = v; upd(); });
      var fVer = field("Version", it.ver, function (v) { it.ver = v; upd(); });
      var fTitle = field("Title", it.title, function (v) { it.title = v; upd(); });
      fTitle.style.gridColumn = "1 / -1";
      grid.appendChild(fLi); grid.appendChild(fVer); grid.appendChild(fTitle);
      var prevRow = document.createElement("div"); prevRow.style.display = "flex"; prevRow.style.gap = "10px"; prevRow.style.alignItems = "center"; prevRow.style.flexWrap = "wrap";
      var prev = document.createElement("div"); prev.className = "nm"; prev.style.flex = "1"; prev.style.color = "var(--ok-text)"; prev.style.fontFamily = "ui-monospace, monospace"; prev.style.fontSize = "13px";
      var btn = document.createElement("button"); btn.className = "btn btn-download"; btn.textContent = "⬇ Save renamed";
      btn.addEventListener("click", function () { dl(it.file, rlName(it)); });
      prevRow.appendChild(prev); prevRow.appendChild(btn);
      row.appendChild(orig); row.appendChild(grid); row.appendChild(prevRow); list.appendChild(row);
      function upd() { prev.textContent = rlName(it); }
      upd();
    });
  }
  function field(label, val, cb) {
    var wrap = document.createElement("div"); wrap.className = "e-field";
    var l = document.createElement("label"); l.textContent = label;
    var inp = document.createElement("input"); inp.type = "text"; inp.value = val || ""; inp.spellcheck = true;
    inp.addEventListener("input", function () { cb(inp.value); });
    wrap.appendChild(l); wrap.appendChild(inp); return wrap;
  }
  $("pdf-rl-all").addEventListener("click", function () {
    if (!rlItems.length) return;
    var zip = new JSZip(), used = {};
    rlItems.forEach(function (it) { var n = rlName(it), k = 2, b = n.replace(/\.pdf$/i, ""); while (used[n]) { n = b + " (" + k + ").pdf"; k++; } used[n] = true; zip.file(n, it.file); });
    zip.generateAsync({ type: "blob", compression: "STORE" }).then(function (b) { dl(b, "renamed_LI_docs.zip"); });
  });
  $("pdf-rl-clear").addEventListener("click", function () {
    rlItems = []; $("pdf-rl-list").innerHTML = ""; $("pdf-rl-head").style.display = "none"; $("pdf-rl-file").value = "";
  });
})();
