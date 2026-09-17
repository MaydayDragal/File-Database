/* ===== Media Compressor ===== */
// This tool's panel. The markup used to sit inline in toolbox/index.html
// (REWRITE-PLAN.md Phase 3); it is mounted where this script's tag sits.
document.currentScript.insertAdjacentHTML("beforebegin", `
<section class="tool" id="tool-media">
<div class="wrap">
  

  <header>
    <h1>🎬 Media Compressor</h1>
    <p>Upload a photo or a video, choose an output size or resolution, rotate it, keep or drop the audio — and download the result. Everything happens in your browser; nothing is uploaded.</p>
  </header>

  <!-- Step 1: file -->
  <div class="card">
    <h2>1 · Choose a photo or video</h2>
    <div class="drop" id="m-drop">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      <div class="big">Drop an image or video here, or click to browse</div>
      <div class="sub">JPEG · PNG · WebP · GIF · MP4 · WebM · MOV — processed locally</div>
    </div>
    <input type="file" id="m-fileInput" accept="image/*,video/*" multiple />
    <div class="filemeta" id="m-filemeta">
      <span class="dot">●</span>
      <div class="grow">
        <div class="name" id="m-fileName"></div>
        <div class="stats" id="m-fileStats"></div>
      </div>
      <button class="btn btn-ghost" id="m-clearFile">Remove</button>
    </div>
    <div class="filemeta" id="m-queueBar">
      <span class="dot">⏳</span>
      <div class="grow">
        <div class="name" id="m-queueInfo"></div>
        <div class="stats">Files wait here — convert the current one, then load the next.</div>
      </div>
      <button class="btn btn-primary" id="m-queueNext">Next file ▸</button>
      <button class="btn btn-ghost" id="m-queueClear">Clear</button>
    </div>
  </div>

  <!-- Step 2: settings -->
  <div class="card" id="m-settingsCard" style="display:none">
    <h2>2 · Settings</h2>

    <!-- IMAGE -->
    <div id="m-imgControls">
      <div class="field">
        <label class="lbl">Resolution (longest edge)</label>
        <div class="row">
          <select id="m-imgRes">
            <option value="0">Keep original</option>
            <option value="3840">Max 3840 px (4K)</option>
            <option value="2560">Max 2560 px</option>
            <option value="1920">Max 1920 px (1080p)</option>
            <option value="1280">Max 1280 px (720p)</option>
            <option value="1024">Max 1024 px</option>
            <option value="800">Max 800 px</option>
            <option value="640">Max 640 px</option>
            <option value="custom">Custom…</option>
          </select>
          <input type="number" id="m-imgResCustom" min="16" step="1" placeholder="px" style="display:none" />
        </div>
      </div>

      <div class="field">
        <label class="lbl">Orientation</label>
        <div class="row">
          <div class="rotctl">
            <button type="button" class="btn btn-ghost" id="m-imgRotL">⟲ 90°</button>
            <button type="button" class="btn btn-ghost" id="m-imgRotR">⟳ 90°</button>
            <span class="rotdisp" id="m-imgRotDisp">0°</span>
          </div>
          <label class="chk"><input type="checkbox" id="m-imgFlipH" /> Flip ↔</label>
          <label class="chk"><input type="checkbox" id="m-imgFlipV" /> Flip ↕</label>
        </div>
      </div>

      <div class="field">
        <label class="lbl">Output format</label>
        <div class="seg" id="m-imgFmt">
          <button type="button" data-v="image/jpeg" class="active">JPEG</button>
          <button type="button" data-v="image/webp">WebP</button>
          <button type="button" data-v="image/png">PNG</button>
        </div>
      </div>

      <div class="field">
        <label class="lbl">Compress by</label>
        <div class="seg" id="m-imgMode">
          <button type="button" data-v="size" class="active">Target file size</button>
          <button type="button" data-v="quality">Quality</button>
        </div>
        <div class="row" id="m-imgSizeRow" style="margin-top:12px">
          <label class="lbl" style="margin:0">Target:</label>
          <input type="number" id="m-imgSizeVal" min="0.01" step="1" value="500" />
          <select id="m-imgSizeUnit">
            <option value="1024">KB</option>
            <option value="1048576">MB</option>
          </select>
        </div>
        <div class="row" id="m-imgQualRow" style="margin-top:12px; display:none">
          <label class="lbl" style="margin:0">Quality:</label>
          <input type="range" id="m-imgQual" min="10" max="100" value="80" />
          <span id="m-imgQualDisp" style="font-size:14px; min-width:42px">80%</span>
        </div>
        <div class="note" id="m-imgPngNote" style="display:none">PNG is lossless, so quality can't be lowered — size is reduced by lowering the resolution instead.</div>
      </div>
    </div>

    <!-- VIDEO -->
    <div id="m-vidControls" style="display:none">
      <div class="field">
        <label class="lbl">Resolution (height)</label>
        <div class="row">
          <select id="m-vidRes">
            <option value="0">Keep original</option>
            <option value="2160">2160p (4K)</option>
            <option value="1080">1080p</option>
            <option value="720" selected>720p</option>
            <option value="480">480p</option>
            <option value="360">360p</option>
          </select>
        </div>
      </div>

      <div class="field">
        <label class="lbl">Orientation</label>
        <div class="rotctl">
          <button type="button" class="btn btn-ghost" id="m-vidRotL">⟲ 90°</button>
          <button type="button" class="btn btn-ghost" id="m-vidRotR">⟳ 90°</button>
          <span class="rotdisp" id="m-vidRotDisp">0°</span>
        </div>
      </div>

      <div class="field">
        <label class="lbl">Audio</label>
        <label class="chk"><input type="checkbox" id="m-vidSound" checked /> Keep the sound</label>
      </div>

      <div class="field">
        <label class="lbl">Compress by</label>
        <div class="seg" id="m-vidMode">
          <button type="button" data-v="size" class="active">Target file size</button>
          <button type="button" data-v="preset">Quality preset</button>
        </div>
        <div class="row" id="m-vidSizeRow" style="margin-top:12px">
          <label class="lbl" style="margin:0">Target:</label>
          <input type="number" id="m-vidSizeVal" min="0.1" step="1" value="10" />
          <select id="m-vidSizeUnit">
            <option value="1048576" selected>MB</option>
            <option value="1024">KB</option>
          </select>
        </div>
        <div class="row" id="m-vidPresetRow" style="margin-top:12px; display:none">
          <div class="seg" id="m-vidPreset">
            <button type="button" data-v="high">High</button>
            <button type="button" data-v="medium" class="active">Medium</button>
            <button type="button" data-v="low">Low</button>
          </div>
        </div>
        <div class="note">Video is re-encoded in real time (it plays through once) and saved as WebM. Target size is approximate — the tool sets the bitrate to land near your target.</div>
      </div>
    </div>
  </div>

  <!-- Step 3: run -->
  <div class="card" id="m-runCard" style="display:none">
    <h2>3 · Compress</h2>
    <button class="btn btn-primary" id="m-runBtn">Compress</button>
    <div class="progress-wrap" id="m-progWrap">
      <div class="bar"><div id="m-progBar"></div></div>
      <div class="progress-label" id="m-progLabel">Working…</div>
    </div>
    <div class="err" id="m-err"></div>
  </div>

  <!-- Results -->
  <div class="card results" id="m-results">
    <h2>Result</h2>
    <div class="preview" id="m-preview"></div>
    <div class="statgrid">
      <div class="stat"><div class="k">Original</div><div class="v" id="m-stOrig">–</div></div>
      <div class="stat"><div class="k">Compressed</div><div class="v" id="m-stNew">–</div></div>
      <div class="stat"><div class="k">Saved</div><div class="v" id="m-stSaved">–</div></div>
    </div>
    <div class="row" style="justify-content:space-between; align-items:center">
      <div class="stats" id="m-outMeta" style="color:var(--muted); font-size:13px"></div>
      <a class="btn btn-download" id="m-downloadBtn" href="#">⬇ Download</a>
    </div>
  </div>

  <div class="foot">
    Runs entirely in your browser · no uploads, no server, works offline.<br />
    Images use the Canvas API; video uses MediaRecorder (WebM output). Video re-encoding
    speed depends on the clip length. Some players (e.g. older iOS) may not play WebM.
  </div>
</div>
</section>
`);


(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    drop: $("m-drop"), fileInput: $("m-fileInput"), filemeta: $("m-filemeta"),
    fileName: $("m-fileName"), fileStats: $("m-fileStats"), clearFile: $("m-clearFile"),
    queueBar: $("m-queueBar"), queueInfo: $("m-queueInfo"), queueNext: $("m-queueNext"), queueClear: $("m-queueClear"),
    settingsCard: $("m-settingsCard"), imgControls: $("m-imgControls"), vidControls: $("m-vidControls"),
    runCard: $("m-runCard"), runBtn: $("m-runBtn"),
    progWrap: $("m-progWrap"), progBar: $("m-progBar"), progLabel: $("m-progLabel"), err: $("m-err"),
    results: $("m-results"), preview: $("m-preview"),
    stOrig: $("m-stOrig"), stNew: $("m-stNew"), stSaved: $("m-stSaved"),
    outMeta: $("m-outMeta"), downloadBtn: $("m-downloadBtn"),
    // image
    imgRes: $("m-imgRes"), imgResCustom: $("m-imgResCustom"),
    imgRotL: $("m-imgRotL"), imgRotR: $("m-imgRotR"), imgRotDisp: $("m-imgRotDisp"),
    imgFlipH: $("m-imgFlipH"), imgFlipV: $("m-imgFlipV"),
    imgFmt: $("m-imgFmt"), imgMode: $("m-imgMode"),
    imgSizeRow: $("m-imgSizeRow"), imgSizeVal: $("m-imgSizeVal"), imgSizeUnit: $("m-imgSizeUnit"),
    imgQualRow: $("m-imgQualRow"), imgQual: $("m-imgQual"), imgQualDisp: $("m-imgQualDisp"), imgPngNote: $("m-imgPngNote"),
    // video
    vidRes: $("m-vidRes"), vidRotL: $("m-vidRotL"), vidRotR: $("m-vidRotR"), vidRotDisp: $("m-vidRotDisp"),
    vidSound: $("m-vidSound"), vidMode: $("m-vidMode"),
    vidSizeRow: $("m-vidSizeRow"), vidSizeVal: $("m-vidSizeVal"), vidSizeUnit: $("m-vidSizeUnit"),
    vidPresetRow: $("m-vidPresetRow"), vidPreset: $("m-vidPreset")
  };

  var state = {
    file: null, kind: null, // "image" | "video"
    queue: [], // files waiting behind the current one (bulk sends, multi-pick)
    imgFmt: "image/jpeg", imgMode: "size", imgRotate: 0,
    vidMode: "size", vidRotate: 0, vidPreset: "medium",
    outUrl: null
  };

  // ---------- helpers ----------
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
  function stripExt(n) { return n.replace(/\.[^.]+$/, ""); }
  function segWire(container, cb) {
    container.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-v]"); if (!b) return;
      Array.prototype.forEach.call(container.children, function (c) { c.classList.toggle("active", c === b); });
      cb(b.getAttribute("data-v"));
    });
  }

  // ---------- file selection ----------
  function isMedia(file) {
    return /^image\//.test(file.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name) ||
      /^video\//.test(file.type) || /\.(mp4|webm|mov|m4v|ogv|avi|mkv)$/i.test(file.name);
  }
  function renderQueue() {
    var n = state.queue.length;
    els.queueBar.classList.toggle("show", n > 0);
    if (n > 0) els.queueInfo.textContent = "Next: " + state.queue[0].name + " · " + n + " more file" + (n === 1 ? "" : "s") + " waiting";
  }
  // Load the first file now, keep the rest in a visible queue.
  function setBatch(fileList) {
    var files = Array.prototype.filter.call(fileList || [], isMedia);
    if (!files.length) { showError("Please choose an image or a video file."); return; }
    setFile(files[0]);
    state.queue = files.slice(1);
    renderQueue();
  }
  // Bridge deliveries append: a straggler from a bulk vault send must join the
  // queue, not replace the file that's already loaded.
  window.__mediaAddFiles = function (fileList) {
    var files = Array.prototype.filter.call(fileList || [], isMedia);
    if (!files.length) return;
    if (!state.file) { setBatch(files); return; }
    state.queue = state.queue.concat(files);
    renderQueue();
  };
  function setFile(file) {
    if (!file) return;
    var isImg = /^image\//.test(file.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name);
    var isVid = /^video\//.test(file.type) || /\.(mp4|webm|mov|m4v|ogv|avi|mkv)$/i.test(file.name);
    if (!isImg && !isVid) { showError("Please choose an image or a video file."); return; }
    clearError(); resetResults();
    state.file = file;
    state.kind = isImg ? "image" : "video";
    els.fileName.textContent = file.name;
    els.fileStats.textContent = fmtBytes(file.size) + " · " + (state.kind === "image" ? "image" : "video");
    els.filemeta.classList.add("show");
    els.imgControls.style.display = isImg ? "" : "none";
    els.vidControls.style.display = isVid ? "" : "none";
    els.settingsCard.style.display = "";
    els.runCard.style.display = "";
    // probe dimensions for the file stats line
    probeDimensions(file, isImg);
  }
  function probeDimensions(file, isImg) {
    var url = URL.createObjectURL(file);
    if (isImg) {
      var im = new Image();
      im.onload = function () {
        els.fileStats.textContent = fmtBytes(file.size) + " · " + im.naturalWidth + "×" + im.naturalHeight;
        URL.revokeObjectURL(url);
      };
      im.onerror = function () { URL.revokeObjectURL(url); };
      im.src = url;
    } else {
      var v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = function () {
        var dur = isFinite(v.duration) ? " · " + v.duration.toFixed(1) + "s" : "";
        els.fileStats.textContent = fmtBytes(file.size) + " · " + v.videoWidth + "×" + v.videoHeight + dur;
        URL.revokeObjectURL(url);
      };
      v.onerror = function () { URL.revokeObjectURL(url); };
      v.src = url;
    }
  }
  function clearFile() {
    // With files waiting, "Remove" advances to the next one.
    if (state.queue.length) { setFile(state.queue.shift()); renderQueue(); return; }
    state.file = null; state.kind = null; els.fileInput.value = "";
    els.filemeta.classList.remove("show");
    els.settingsCard.style.display = "none";
    els.runCard.style.display = "none";
    resetResults(); clearError();
  }

  els.drop.addEventListener("click", function () { els.fileInput.click(); });
  els.fileInput.addEventListener("change", function (e) { if (e.target.files.length) setBatch(e.target.files); });
  els.clearFile.addEventListener("click", clearFile);
  els.queueNext.addEventListener("click", function () { if (state.queue.length) { setFile(state.queue.shift()); renderQueue(); } });
  els.queueClear.addEventListener("click", function () { state.queue = []; renderQueue(); });
  ["dragenter", "dragover"].forEach(function (ev) {
    els.drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); els.drop.classList.add("drag"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    els.drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); els.drop.classList.remove("drag"); });
  });
  els.drop.addEventListener("drop", function (e) { if (e.dataTransfer.files.length) setBatch(e.dataTransfer.files); });

  // ---------- image control wiring ----------
  els.imgRes.addEventListener("change", function () {
    els.imgResCustom.style.display = els.imgRes.value === "custom" ? "" : "none";
  });
  function bumpRot(delta) {
    state.imgRotate = (((state.imgRotate + delta) % 360) + 360) % 360;
    els.imgRotDisp.textContent = state.imgRotate + "°";
  }
  els.imgRotL.addEventListener("click", function () { bumpRot(-90); });
  els.imgRotR.addEventListener("click", function () { bumpRot(90); });
  segWire(els.imgFmt, function (v) {
    state.imgFmt = v;
    var isPng = v === "image/png";
    // PNG: hide quality, and if in quality mode, note that only resolution matters
    els.imgPngNote.style.display = (isPng && state.imgMode !== "size") ? "block" : (isPng ? "block" : "none");
    updateImgModeRows();
  });
  segWire(els.imgMode, function (v) { state.imgMode = v; updateImgModeRows(); });
  function updateImgModeRows() {
    var sizeMode = state.imgMode === "size";
    var isPng = state.imgFmt === "image/png";
    els.imgSizeRow.style.display = sizeMode ? "flex" : "none";
    els.imgQualRow.style.display = (!sizeMode && !isPng) ? "flex" : "none";
    els.imgPngNote.style.display = isPng ? "block" : "none";
  }
  els.imgQual.addEventListener("input", function () { els.imgQualDisp.textContent = els.imgQual.value + "%"; });

  // ---------- video control wiring ----------
  function bumpVRot(delta) {
    state.vidRotate = (((state.vidRotate + delta) % 360) + 360) % 360;
    els.vidRotDisp.textContent = state.vidRotate + "°";
  }
  els.vidRotL.addEventListener("click", function () { bumpVRot(-90); });
  els.vidRotR.addEventListener("click", function () { bumpVRot(90); });
  segWire(els.vidMode, function (v) {
    state.vidMode = v;
    els.vidSizeRow.style.display = v === "size" ? "flex" : "none";
    els.vidPresetRow.style.display = v === "preset" ? "flex" : "none";
  });
  segWire(els.vidPreset, function (v) { state.vidPreset = v; });

  // ---------- results ----------
  function resetResults() {
    if (state.outUrl) { URL.revokeObjectURL(state.outUrl); state.outUrl = null; }
    els.preview.innerHTML = "";
    els.results.classList.remove("show");
  }

  // ================= IMAGE PIPELINE =================
  function loadImage(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file);
      var im = new Image();
      im.onload = function () { res({ img: im, url: url }); };
      im.onerror = function () { URL.revokeObjectURL(url); rej(new Error("Could not read this image.")); };
      im.src = url;
    });
  }
  function makeCanvas(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function drawImage(img, sw, sh, rotate, flipH, flipV) {
    var rot = (((rotate % 360) + 360) % 360), swap = rot === 90 || rot === 270;
    var cw = swap ? sh : sw, ch = swap ? sw : sh;
    var c = makeCanvas(cw, ch), ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate(rot * Math.PI / 180);
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
    return c;
  }
  function downscaleCanvas(c, factor) {
    var nc = makeCanvas(Math.max(16, Math.round(c.width * factor)), Math.max(16, Math.round(c.height * factor)));
    var ctx = nc.getContext("2d"); ctx.imageSmoothingQuality = "high";
    ctx.drawImage(c, 0, 0, nc.width, nc.height);
    return nc;
  }
  function toBlob(canvas, type, quality) {
    return new Promise(function (res) { canvas.toBlob(res, type, quality); });
  }

  function compressImage() {
    var maxEdge = els.imgRes.value === "custom"
      ? (parseInt(els.imgResCustom.value, 10) || 0)
      : parseInt(els.imgRes.value, 10);

    return loadImage(state.file).then(function (r) {
      var img = r.img, url = r.url;
      var w = img.naturalWidth, h = img.naturalHeight, sw = w, sh = h;
      if (maxEdge && Math.max(w, h) > maxEdge) {
        var s = maxEdge / Math.max(w, h); sw = Math.round(w * s); sh = Math.round(h * s);
      }
      var canvas = drawImage(img, sw, sh, state.imgRotate, els.imgFlipH.checked, els.imgFlipV.checked);
      URL.revokeObjectURL(url);

      var type = state.imgFmt;
      setProgress(0.4, "Encoding…");

      if (state.imgMode === "quality" && type !== "image/png") {
        var q = parseInt(els.imgQual.value, 10) / 100;
        return toBlob(canvas, type, q).then(function (blob) {
          return { blob: blob, w: canvas.width, h: canvas.height };
        });
      }
      if (state.imgMode === "quality" && type === "image/png") {
        return toBlob(canvas, type).then(function (blob) {
          return { blob: blob, w: canvas.width, h: canvas.height };
        });
      }
      // target-size mode
      var targetBytes = parseFloat(els.imgSizeVal.value) * parseFloat(els.imgSizeUnit.value);
      if (!targetBytes || targetBytes <= 0) return Promise.reject(new Error("Enter a valid target size."));
      return encodeImageToTarget(canvas, type, targetBytes);
    });
  }

  function encodeImageToTarget(startCanvas, type, targetBytes) {
    var canvas = startCanvas;
    var attempt = 0, maxAttempts = 10;
    function step() {
      setProgress(0.4 + 0.5 * (attempt / maxAttempts), "Fitting to target size…");
      if (type === "image/png") {
        return toBlob(canvas, type).then(function (blob) {
          if (blob.size <= targetBytes || canvas.width <= 32 || attempt >= maxAttempts) {
            return { blob: blob, w: canvas.width, h: canvas.height };
          }
          canvas = downscaleCanvas(canvas, 0.8); attempt++; return step();
        });
      }
      // JPEG / WebP: binary-search quality at current resolution
      return bestQualityUnder(canvas, type, targetBytes).then(function (blob) {
        if (blob) return { blob: blob, w: canvas.width, h: canvas.height };
        if (canvas.width <= 32 || attempt >= maxAttempts) {
          return toBlob(canvas, type, 0.1).then(function (b) { return { blob: b, w: canvas.width, h: canvas.height }; });
        }
        canvas = downscaleCanvas(canvas, 0.8); attempt++; return step();
      });
    }
    return step();
  }
  function bestQualityUnder(canvas, type, targetBytes) {
    var lo = 0.1, hi = 0.96, best = null;
    var i = 0;
    function iter() {
      if (i >= 7) return Promise.resolve(best);
      var q = (lo + hi) / 2;
      return toBlob(canvas, type, q).then(function (blob) {
        if (blob.size <= targetBytes) { best = blob; lo = q; } else { hi = q; }
        i++; return iter();
      });
    }
    return iter();
  }

  // ================= VIDEO PIPELINE =================
  function pickVideoMime() {
    var cands = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
    for (var i = 0; i < cands.length; i++) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(cands[i])) return cands[i];
    }
    return "";
  }

  function compressVideo() {
    if (!window.MediaRecorder) return Promise.reject(new Error("Your browser doesn't support in-browser video encoding (MediaRecorder)."));
    var mime = pickVideoMime();
    if (!mime) return Promise.reject(new Error("No supported video output format in this browser."));

    var file = state.file;
    var url = URL.createObjectURL(file);
    var video = document.createElement("video");
    var sound = els.vidSound.checked;
    video.src = url;
    video.muted = !sound;         // silent when dropping audio; routed via WebAudio when keeping it
    video.playsInline = true;

    return new Promise(function (resolve, reject) {
      video.onloadedmetadata = function () { resolve(); };
      video.onerror = function () { reject(new Error("Could not read this video.")); };
    }).then(function () {
      var dur = video.duration;
      var vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) throw new Error("This video has no visual track to encode.");

      var maxH = parseInt(els.vidRes.value, 10);
      var sw = vw, sh = vh;
      if (maxH && vh > maxH) { var s = maxH / vh; sw = Math.round(vw * s); sh = Math.round(vh * s); }
      sw += sw % 2; sh += sh % 2; // keep even dimensions

      var rot = state.vidRotate, swap = rot === 90 || rot === 270;
      var cw = swap ? sh : sw, ch = swap ? sw : sh;
      var canvas = makeCanvas(cw, ch), ctx = canvas.getContext("2d");

      // bitrate
      var videoBps, audioBps = sound ? 128000 : 0;
      if (state.vidMode === "size") {
        var targetBytes = parseFloat(els.vidSizeVal.value) * parseFloat(els.vidSizeUnit.value);
        if (!targetBytes || targetBytes <= 0) throw new Error("Enter a valid target size.");
        if (!isFinite(dur) || dur <= 0) throw new Error("Couldn't determine the video length.");
        // 3% muxing/overhead headroom so we tend to land under target
        var budget = targetBytes * 8 * 0.97;
        videoBps = Math.max(80000, Math.floor(budget / dur) - audioBps);
      } else {
        // Bitrate preset scaled by frame size: ~perK kbps per 1000 pixels.
        var pixelsK = (sw * sh) / 1000;
        var perK = state.vidPreset === "high" ? 5.5 : state.vidPreset === "low" ? 1.4 : 3.0;
        videoBps = Math.max(150000, Math.round(pixelsK * perK * 1000));
      }

      var fps = 30;
      var cstream = canvas.captureStream(fps);
      var tracks = cstream.getVideoTracks();
      var ac = null;
      if (sound) {
        try {
          var AC = window.AudioContext || window.webkitAudioContext;
          ac = new AC();
          var srcNode = ac.createMediaElementSource(video);
          var dest = ac.createMediaStreamDestination();
          srcNode.connect(dest); // to recorder only, not to speakers → silent playback
          dest.stream.getAudioTracks().forEach(function (t) { tracks.push(t); });
        } catch (e) { /* no audio track / not allowed — encode video only */ ac = null; }
      }
      var stream = new MediaStream(tracks);

      var recOpts = { mimeType: mime, videoBitsPerSecond: videoBps };
      if (sound) recOpts.audioBitsPerSecond = audioBps;
      var rec;
      try { rec = new MediaRecorder(stream, recOpts); }
      catch (e) { rec = new MediaRecorder(stream, { mimeType: mime }); }

      var chunks = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      var stopped = new Promise(function (res) { rec.onstop = res; });

      var raf = 0;
      function draw() {
        ctx.save();
        ctx.translate(cw / 2, ch / 2);
        ctx.rotate(rot * Math.PI / 180);
        ctx.drawImage(video, -sw / 2, -sh / 2, sw, sh);
        ctx.restore();
        if (isFinite(dur) && dur > 0) setProgress(0.02 + 0.95 * Math.min(1, video.currentTime / dur), "Encoding video…");
        raf = requestAnimationFrame(draw);
      }

      rec.start(200);
      var startPlay = ac && ac.state === "suspended" ? ac.resume() : Promise.resolve();
      return startPlay.then(function () { return video.play(); }).then(function () {
        draw();
        return new Promise(function (res) { video.onended = res; });
      }).then(function () {
        cancelAnimationFrame(raf);
        if (rec.state !== "inactive") rec.stop();
        return stopped;
      }).then(function () {
        if (ac) { try { ac.close(); } catch (e) {} }
        URL.revokeObjectURL(url);
        var outType = mime.split(";")[0];
        var blob = new Blob(chunks, { type: outType });
        return { blob: blob, w: cw, h: ch, ext: outType.indexOf("mp4") >= 0 ? "mp4" : "webm" };
      });
    }).catch(function (e) { URL.revokeObjectURL(url); throw e; });
  }

  // ---------- run ----------
  els.runBtn.addEventListener("click", function () {
    if (!state.file) return;
    clearError(); resetResults();
    els.runBtn.disabled = true;
    setProgress(0.02, state.kind === "image" ? "Processing image…" : "Preparing video…");

    var job = state.kind === "image" ? compressImage() : compressVideo();
    job.then(function (out) {
      setProgress(1, "Done");
      showResult(out);
      hideProgress();
      els.runBtn.disabled = false;
    }).catch(function (e) {
      console.error(e);
      hideProgress();
      showError(e && e.message ? e.message : "Something went wrong while compressing.");
      els.runBtn.disabled = false;
    });
  });

  function showResult(out) {
    var origSize = state.file.size, newSize = out.blob.size;
    state.outUrl = URL.createObjectURL(out.blob);

    els.preview.innerHTML = "";
    if (state.kind === "image") {
      var im = document.createElement("img"); im.src = state.outUrl; els.preview.appendChild(im);
    } else {
      var v = document.createElement("video"); v.src = state.outUrl; v.controls = true; els.preview.appendChild(v);
    }

    els.stOrig.textContent = fmtBytes(origSize);
    els.stNew.textContent = fmtBytes(newSize);
    var pct = origSize > 0 ? (1 - newSize / origSize) * 100 : 0;
    els.stSaved.textContent = (pct >= 0 ? "−" : "+") + Math.abs(pct).toFixed(1) + "%";
    els.stSaved.className = "v " + (pct >= 0 ? "good" : "bad");
    els.stNew.className = "v " + (newSize <= origSize ? "good" : "bad");

    var ext = state.kind === "image"
      ? (state.imgFmt === "image/jpeg" ? "jpg" : state.imgFmt === "image/webp" ? "webp" : "png")
      : (out.ext || "webm");
    var outName = stripExt(state.file.name) + "_compressed." + ext;
    els.outMeta.textContent = outName + " · " + out.w + "×" + out.h;
    els.downloadBtn.href = state.outUrl;
    els.downloadBtn.setAttribute("download", outName);
    try { window.__vaultOffer && window.__vaultOffer(out.blob, outName); } catch (e) {}

    els.results.classList.add("show");
    els.results.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  updateImgModeRows();
})();

