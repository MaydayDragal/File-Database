/* ===== Image Tools ===== */
// This tool's panel markup and its wiring; the Toolbox feature mounts every
// tool's markup into its shadow root, then calls init(root) for each.
export const markup = `
<section class="tool" id="tool-img">
<div class="wrap">
  <header>
    <h1>🖼️ Image Tools</h1>
    <p>Convert image formats, crop / rotate / resize with a visual box, and view or strip photo metadata (EXIF). Everything stays on your device.</p>
  </header>

  <div class="card">
    <div class="seg elec-nav" id="g-nav" role="tablist">
      <button type="button" data-p="convert" class="active">Convert</button>
      <button type="button" data-p="crop">Crop &amp; Resize</button>
      <button type="button" data-p="exif">EXIF Viewer / Stripper</button>
    </div>
  </div>

  <!-- Convert -->
  <div class="card g-panel active" id="gp-convert">
    <h2>Format Converter</h2>
    <div class="drop" id="g-cv-drop">
      <div class="big">Drop images here or click to browse</div>
      <div class="sub">Convert many at once · JPEG · PNG · WebP · AVIF</div>
    </div>
    <input type="file" id="g-cv-file" accept="image/*" multiple />
    <div class="field" style="margin-top:16px">
      <label class="lbl">Output format</label>
      <div class="seg" id="g-cv-fmt">
        <button type="button" data-v="image/jpeg" class="active">JPEG</button>
        <button type="button" data-v="image/png">PNG</button>
        <button type="button" data-v="image/webp">WebP</button>
        <button type="button" data-v="image/avif">AVIF</button>
      </div>
    </div>
    <div class="row" id="g-cv-qrow" style="margin-bottom:14px">
      <label class="lbl" style="margin:0">Quality</label>
      <input type="range" id="g-cv-q" min="10" max="100" value="85" style="flex:1; min-width:160px" />
      <span id="g-cv-qd" style="font-size:14px; min-width:42px">85%</span>
    </div>
    <div class="row" style="margin-bottom:16px">
      <label class="lbl" style="margin:0">Max size (longest edge, optional)</label>
      <input type="number" id="g-cv-max" min="16" step="1" placeholder="px" style="width:120px" />
    </div>
    <button class="btn btn-primary" id="g-cv-go" disabled>Convert</button>
    <div class="progress-wrap" id="g-cv-prog"><div class="bar"><div id="g-cv-bar"></div></div><div class="progress-label" id="g-cv-lbl"></div></div>
    <div class="err" id="g-cv-err"></div>
    <div class="results-head" id="g-cv-head" style="display:none; margin-top:16px">
      <h2 style="margin:0">Converted</h2>
      <button class="btn btn-download" id="g-cv-all">⬇ Download all (ZIP)</button>
    </div>
    <div id="g-cv-list"></div>
  </div>

  <!-- Crop & Resize -->
  <div class="card g-panel" id="gp-crop">
    <h2>Crop, Rotate &amp; Resize</h2>
    <div class="drop" id="g-cr-drop">
      <div class="big">Drop an image here or click to browse</div>
      <div class="sub">Drag the box to crop; corners resize it</div>
    </div>
    <input type="file" id="g-cr-file" accept="image/*" />
    <div id="g-cr-editor" style="display:none; margin-top:16px">
      <div class="g-cropstage"><div class="g-cropwrap" id="g-cr-wrap"><img id="g-cr-img" alt="" /><div class="g-crop" id="g-cr-box"><span class="g-h nw"></span><span class="g-h ne"></span><span class="g-h sw"></span><span class="g-h se"></span></div></div></div>
      <div class="field" style="margin-top:14px">
        <label class="lbl">Aspect ratio</label>
        <div class="seg" id="g-cr-aspect">
          <button type="button" data-v="free" class="active">Free</button>
          <button type="button" data-v="1">1:1</button>
          <button type="button" data-v="1.3333">4:3</button>
          <button type="button" data-v="1.7778">16:9</button>
          <button type="button" data-v="0.75">3:4</button>
        </div>
      </div>
      <div class="field">
        <label class="lbl">Transform</label>
        <div class="row">
          <button type="button" class="btn btn-ghost" id="g-cr-rl">⟲ 90°</button>
          <button type="button" class="btn btn-ghost" id="g-cr-rr">⟳ 90°</button>
          <button type="button" class="btn btn-ghost" id="g-cr-fh">Flip ↔</button>
          <button type="button" class="btn btn-ghost" id="g-cr-fv">Flip ↕</button>
          <button type="button" class="btn btn-ghost" id="g-cr-reset">Reset crop</button>
        </div>
      </div>
      <div class="e-grid">
        <div class="e-field"><label>Output width (px)</label><input type="number" id="g-cr-ow" step="1" min="1" /></div>
        <div class="e-field"><label>Output height (px)</label><input type="number" id="g-cr-oh" step="1" min="1" /></div>
      </div>
      <div class="field" style="margin-top:14px">
        <label class="lbl">Output format</label>
        <div class="seg" id="g-cr-fmt">
          <button type="button" data-v="image/png" class="active">PNG</button>
          <button type="button" data-v="image/jpeg">JPEG</button>
          <button type="button" data-v="image/webp">WebP</button>
        </div>
      </div>
      <div class="e-muted" id="g-cr-info" style="margin:6px 0 14px"></div>
      <a class="btn btn-download" id="g-cr-dl" href="#">⬇ Download</a>
    </div>
  </div>

  <!-- EXIF -->
  <div class="card g-panel" id="gp-exif">
    <h2>EXIF Viewer &amp; Stripper</h2>
    <div class="drop" id="g-ex-drop">
      <div class="big">Drop a photo here or click to browse</div>
      <div class="sub">See camera info &amp; GPS — then strip it for privacy</div>
    </div>
    <input type="file" id="g-ex-file" accept="image/*" />
    <div id="g-ex-view" style="display:none; margin-top:16px">
      <div class="preview" style="text-align:center; margin-bottom:14px"><img id="g-ex-thumb" style="max-width:100%; max-height:300px; border-radius:10px; border:1px solid var(--border)" alt="" /></div>
      <div id="g-ex-summary" style="margin-bottom:12px"></div>
      <table class="exif-table"><tbody id="g-ex-out"></tbody></table>
      <div class="row" style="margin-top:16px">
        <a class="btn btn-download" id="g-ex-strip" href="#">⬇ Download without metadata</a>
      </div>
    </div>
  </div>

  <div class="foot">Everything runs client-side — no uploads. AVIF output appears only if your browser can encode it.</div>
</div>
</section>
`;

export function init(root) {
  "use strict";
  var $ = function (id) { return root.getElementById(id); };
  function fmtBytes(b) { if (b === 0) return "0 B"; var u = ["B", "KB", "MB", "GB"], i = Math.floor(Math.log(b) / Math.log(1024)); i = Math.min(i, u.length - 1); return (b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2) + " " + u[i]; }
  function toBlob(c, t, q) { return new Promise(function (r) { c.toBlob(r, t, q); }); }
  function loadImg(file) { return new Promise(function (res, rej) { var u = URL.createObjectURL(file); var im = new Image(); im.onload = function () { res({ im: im, url: u }); }; im.onerror = function () { URL.revokeObjectURL(u); rej(new Error("Could not read image.")); }; im.src = u; }); }
  function extFor(t) { return t === "image/jpeg" ? "jpg" : t === "image/png" ? "png" : t === "image/webp" ? "webp" : t === "image/avif" ? "avif" : "img"; }
  function stripExt(n) { return (n || "image").replace(/\.[^.]+$/, ""); }
  function dl(blob, name) { var u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(u); }, 3000); try { window.__vaultOffer && window.__vaultOffer(blob, name); } catch (e) {} }
  function seg(container, cb) { container.addEventListener("click", function (e) { var b = e.target.closest("button[data-v]"); if (!b) return; Array.prototype.forEach.call(container.children, function (c) { c.classList.toggle("active", c === b); }); cb(b.getAttribute("data-v"), b); }); }
  function wireDrop(drop, input, onFiles) {
    drop.addEventListener("click", function () { input.click(); });
    input.addEventListener("change", function (e) { if (e.target.files.length) onFiles(e.target.files); });
    ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.add("drag"); }); });
    ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.remove("drag"); }); });
    drop.addEventListener("drop", function (e) { if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files); });
  }

  // sub-nav
  var nav = $("g-nav");
  nav.addEventListener("click", function (e) { var b = e.target.closest("button[data-p]"); if (!b) return; Array.prototype.forEach.call(nav.children, function (c) { c.classList.toggle("active", c === b); }); ["convert", "crop", "exif"].forEach(function (p) { $("gp-" + p).classList.toggle("active", p === b.getAttribute("data-p")); }); });

  // ============ CONVERT ============
  var cvFiles = [], cvFmt = "image/jpeg", cvOut = [];
  // AVIF encode support
  (function () { var c = document.createElement("canvas"); c.width = c.height = 2; c.toBlob(function (b) { if (!b || b.type !== "image/avif") { var btn = root.querySelector('#g-cv-fmt button[data-v="image/avif"]'); if (btn) { btn.disabled = true; btn.style.opacity = ".4"; btn.title = "Your browser can't encode AVIF"; } } }, "image/avif"); })();
  wireDrop($("g-cv-drop"), $("g-cv-file"), function (files) { for (var i = 0; i < files.length; i++) if (/^image\//.test(files[i].type) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(files[i].name)) cvFiles.push(files[i]); $("g-cv-go").disabled = !cvFiles.length; $("g-cv-drop").querySelector(".big").textContent = cvFiles.length ? cvFiles.length + " image(s) ready" : "Drop images here or click to browse"; });
  seg($("g-cv-fmt"), function (v) { cvFmt = v; $("g-cv-qrow").style.display = v === "image/png" ? "none" : "flex"; });
  $("g-cv-q").addEventListener("input", function () { $("g-cv-qd").textContent = $("g-cv-q").value + "%"; });
  $("g-cv-go").addEventListener("click", function () {
    if (!cvFiles.length) return;
    $("g-cv-err").classList.remove("show"); cvOut = []; $("g-cv-list").innerHTML = ""; $("g-cv-head").style.display = "none";
    var q = parseInt($("g-cv-q").value, 10) / 100, maxE = parseInt($("g-cv-max").value, 10) || 0;
    var i = 0;
    (function next() {
      if (i >= cvFiles.length) { $("g-cv-prog").classList.remove("show"); $("g-cv-head").style.display = "flex"; renderCv(); return; }
      $("g-cv-prog").classList.add("show"); $("g-cv-bar").style.width = (i / cvFiles.length * 100) + "%"; $("g-cv-lbl").textContent = "Converting " + (i + 1) + " / " + cvFiles.length + "…";
      var f = cvFiles[i];
      loadImg(f).then(function (r) {
        var w = r.im.naturalWidth, h = r.im.naturalHeight, sw = w, sh = h;
        if (maxE && Math.max(w, h) > maxE) { var s = maxE / Math.max(w, h); sw = Math.round(w * s); sh = Math.round(h * s); }
        var c = document.createElement("canvas"); c.width = sw; c.height = sh; c.getContext("2d").drawImage(r.im, 0, 0, sw, sh);
        URL.revokeObjectURL(r.url);
        return toBlob(c, cvFmt, cvFmt === "image/png" ? undefined : q).then(function (blob) { cvOut.push({ name: stripExt(f.name) + "." + extFor(cvFmt), blob: blob, orig: f.size, w: sw, h: sh }); });
      }).catch(function () { cvOut.push({ name: f.name, blob: null, orig: f.size, err: true }); }).then(function () { i++; next(); });
    })();
  });
  function renderCv() {
    var html = "";
    cvOut.forEach(function (o, idx) {
      html += '<div class="g-item"><div class="n-info"><div class="nm">' + o.name + '</div><div class="st">' + (o.err ? "failed" : fmtBytes(o.orig) + " → " + fmtBytes(o.blob.size) + " · " + o.w + "×" + o.h) + '</div></div>' + (o.err ? "" : '<button class="btn btn-download" data-i="' + idx + '">⬇ Save</button>') + "</div>";
    });
    $("g-cv-list").innerHTML = html;
    $("g-cv-list").querySelectorAll("button[data-i]").forEach(function (b) { b.addEventListener("click", function () { var o = cvOut[+b.getAttribute("data-i")]; dl(o.blob, o.name); }); });
  }
  $("g-cv-all").addEventListener("click", function () {
    var ok = cvOut.filter(function (o) { return !o.err; }); if (!ok.length) return;
    var zip = new JSZip(); ok.forEach(function (o) { zip.file(o.name, o.blob); });
    zip.generateAsync({ type: "blob", compression: "STORE" }).then(function (b) { dl(b, "converted-images.zip"); });
  });

  // ============ CROP & RESIZE ============
  var cr = { orig: null, work: null, rot: 0, fh: false, fv: false, fmt: "image/png", aspect: null, box: null, scale: 1 };
  wireDrop($("g-cr-drop"), $("g-cr-file"), function (files) { crLoad(files[0]); });
  function crLoad(file) {
    if (!file) return;
    loadImg(file).then(function (r) { cr.orig = r.im; cr.name = stripExt(file.name); cr.rot = 0; cr.fh = cr.fv = false; buildWork(); $("g-cr-editor").style.display = "block"; URL.revokeObjectURL(r.url); }).catch(function () {});
  }
  function buildWork() {
    var im = cr.orig, r = ((cr.rot % 360) + 360) % 360, swap = r === 90 || r === 270;
    var w = im.naturalWidth, h = im.naturalHeight, cw = swap ? h : w, ch = swap ? w : h;
    var c = document.createElement("canvas"); c.width = cw; c.height = ch; var ctx = c.getContext("2d");
    ctx.translate(cw / 2, ch / 2); ctx.rotate(r * Math.PI / 180); ctx.scale(cr.fh ? -1 : 1, cr.fv ? -1 : 1); ctx.drawImage(im, -w / 2, -h / 2, w, h);
    cr.work = c;
    var img = $("g-cr-img"); img.onload = function () { cr.scale = img.clientWidth / cw; resetBox(); }; img.src = c.toDataURL();
  }
  function resetBox() { cr.box = { x: 0, y: 0, w: $("g-cr-img").clientWidth, h: $("g-cr-img").clientHeight }; if (cr.aspect) fitAspect(); drawBox(); }
  function fitAspect() { var dw = $("g-cr-img").clientWidth, dh = $("g-cr-img").clientHeight, ar = cr.aspect; var w = dw, h = w / ar; if (h > dh) { h = dh; w = h * ar; } cr.box = { x: (dw - w) / 2, y: (dh - h) / 2, w: w, h: h }; }
  function drawBox() {
    var b = cr.box, el = $("g-cr-box"); el.style.left = b.x + "px"; el.style.top = b.y + "px"; el.style.width = b.w + "px"; el.style.height = b.h + "px";
    var ow = Math.round(b.w / cr.scale), oh = Math.round(b.h / cr.scale);
    $("g-cr-ow").value = ow; $("g-cr-oh").value = oh;
    $("g-cr-info").textContent = "Crop: " + ow + " × " + oh + " px (source " + cr.work.width + " × " + cr.work.height + ")";
  }
  seg($("g-cr-aspect"), function (v) { cr.aspect = v === "free" ? null : parseFloat(v); if (cr.aspect) fitAspect(); drawBox(); });
  seg($("g-cr-fmt"), function (v) { cr.fmt = v; });
  $("g-cr-rl").addEventListener("click", function () { cr.rot -= 90; buildWork(); });
  $("g-cr-rr").addEventListener("click", function () { cr.rot += 90; buildWork(); });
  $("g-cr-fh").addEventListener("click", function () { cr.fh = !cr.fh; buildWork(); });
  $("g-cr-fv").addEventListener("click", function () { cr.fv = !cr.fv; buildWork(); });
  $("g-cr-reset").addEventListener("click", resetBox);

  // drag / resize
  (function () {
    var drag = null;
    function pt(e) { var r = $("g-cr-wrap").getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function clampBox() {
      var W = $("g-cr-img").clientWidth, H = $("g-cr-img").clientHeight, b = cr.box;
      b.w = Math.max(10, Math.min(b.w, W)); b.h = Math.max(10, Math.min(b.h, H));
      b.x = Math.max(0, Math.min(b.x, W - b.w)); b.y = Math.max(0, Math.min(b.y, H - b.h));
    }
    $("g-cr-box").addEventListener("pointerdown", function (e) {
      e.preventDefault();
      var handle = e.target.classList.contains("g-h") ? e.target.className.split(" ")[1] : null;
      drag = { handle: handle, start: pt(e), box: Object.assign({}, cr.box) };
      e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId);
    });
    window.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var p = pt(e), dx = p.x - drag.start.x, dy = p.y - drag.start.y, o = drag.box;
      if (!drag.handle) { cr.box = { x: o.x + dx, y: o.y + dy, w: o.w, h: o.h }; clampBox(); drawBox(); return; }
      var b = { x: o.x, y: o.y, w: o.w, h: o.h };
      var east = drag.handle === "ne" || drag.handle === "se", south = drag.handle === "sw" || drag.handle === "se";
      if (east) b.w = o.w + dx; else { b.x = o.x + dx; b.w = o.w - dx; }
      if (south) b.h = o.h + dy; else { b.y = o.y + dy; b.h = o.h - dy; }
      if (cr.aspect) { b.h = b.w / cr.aspect; if (!south) b.y = o.y + o.h - b.h; }
      if (b.w < 10) b.w = 10; if (b.h < 10) b.h = 10;
      cr.box = b; clampBox(); drawBox();
    });
    window.addEventListener("pointerup", function () { drag = null; });
  })();

  $("g-cr-dl").addEventListener("click", function (e) {
    e.preventDefault();
    if (!cr.work) return;
    var b = cr.box, sx = b.x / cr.scale, sy = b.y / cr.scale, sw = b.w / cr.scale, sh = b.h / cr.scale;
    var ow = parseInt($("g-cr-ow").value, 10) || Math.round(sw), oh = parseInt($("g-cr-oh").value, 10) || Math.round(sh);
    var c = document.createElement("canvas"); c.width = ow; c.height = oh;
    c.getContext("2d").drawImage(cr.work, sx, sy, sw, sh, 0, 0, ow, oh);
    toBlob(c, cr.fmt, cr.fmt === "image/png" ? undefined : 0.92).then(function (blob) { dl(blob, cr.name + "_edited." + extFor(cr.fmt)); });
  });

  // ============ EXIF ============
  var exLast = null;
  wireDrop($("g-ex-drop"), $("g-ex-file"), function (files) { exLoad(files[0]); });
  var TAGS = { 0x010F: "Make", 0x0110: "Model", 0x0112: "Orientation", 0x0131: "Software", 0x9003: "Date taken", 0x9004: "Date digitized", 0x829A: "Exposure", 0x829D: "F-number", 0x8827: "ISO", 0x920A: "Focal length", 0xA002: "Width", 0xA003: "Height", 0xA434: "Lens" };
  var GPSN = { 1: "latRef", 2: "lat", 3: "lonRef", 4: "lon", 5: "altRef", 6: "alt" };
  function exLoad(file) {
    if (!file) return;
    exLast = file;
    $("g-ex-thumb").src = URL.createObjectURL(file);
    $("g-ex-view").style.display = "block";
    file.arrayBuffer().then(function (buf) {
      var res = /jpe?g/i.test(file.type) || /\.jpe?g$/i.test(file.name) ? parseExif(buf) : null;
      renderExif(res);
    });
  }
  function parseExif(buf) {
    var d = new DataView(buf), n = d.byteLength;
    if (d.getUint16(0) !== 0xFFD8) return null;
    var off = 2, app1 = -1;
    while (off < n) {
      if (d.getUint16(off) !== 0xFFE1 && (d.getUint16(off) >> 8) !== 0xFF) break;
      var marker = d.getUint16(off), len = d.getUint16(off + 2);
      if (marker === 0xFFE1) {
        if (d.getUint32(off + 4) === 0x45786966) { app1 = off + 10; break; } // "Exif"
      }
      if (marker === 0xFFDA) break;
      off += 2 + len;
    }
    if (app1 < 0) return { tags: {}, gps: null, has: false };
    var t = app1, le = d.getUint16(t) === 0x4949;
    function u16(o) { return d.getUint16(o, le); } function u32(o) { return d.getUint32(o, le); }
    function readIFD(base) {
      var out = {}, count = u16(base), p = base + 2;
      for (var i = 0; i < count; i++, p += 12) {
        var tag = u16(p), type = u16(p + 2), cnt = u32(p + 4);
        var sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }, bytes = (sizes[type] || 1) * cnt;
        var vo = bytes <= 4 ? p + 8 : t + u32(p + 8);
        out[tag] = readVal(type, cnt, vo);
      }
      return { entries: out, next: u32(base + count * 12 + 2) };
    }
    function readVal(type, cnt, o) {
      if (type === 2) { var s = ""; for (var i = 0; i < cnt; i++) { var ch = d.getUint8(o + i); if (ch === 0) break; s += String.fromCharCode(ch); } return s; }
      if (type === 3) { var a = []; for (i = 0; i < cnt; i++) a.push(u16(o + i * 2)); return a.length === 1 ? a[0] : a; }
      if (type === 4 || type === 9) { a = []; for (i = 0; i < cnt; i++) a.push(u32(o + i * 4)); return a.length === 1 ? a[0] : a; }
      if (type === 5 || type === 10) { a = []; for (i = 0; i < cnt; i++) { var num = u32(o + i * 8), den = u32(o + i * 8 + 4); a.push(den ? num / den : 0); } return a.length === 1 ? a[0] : a; }
      return d.getUint8(o);
    }
    var ifd0 = readIFD(t + u32(t + 4));
    var tags = {}, k;
    for (k in ifd0.entries) if (TAGS[k]) tags[TAGS[k]] = ifd0.entries[k];
    var exifPtr = ifd0.entries[0x8769];
    if (exifPtr) { var ex = readIFD(t + exifPtr).entries; for (k in ex) if (TAGS[k]) tags[TAGS[k]] = ex[k]; }
    var gps = null, gpsPtr = ifd0.entries[0x8825];
    if (gpsPtr) {
      var g = readIFD(t + gpsPtr).entries, gg = {};
      for (k in g) if (GPSN[k]) gg[GPSN[k]] = g[k];
      if (gg.lat && gg.lon) {
        var la = dms(gg.lat) * (gg.latRef === "S" ? -1 : 1), lo = dms(gg.lon) * (gg.lonRef === "W" ? -1 : 1);
        gps = { lat: la, lon: lo };
      }
    }
    return { tags: tags, gps: gps, has: Object.keys(tags).length > 0 || !!gps };
  }
  function dms(a) { return (a[0] || 0) + (a[1] || 0) / 60 + (a[2] || 0) / 3600; }
  function fmtTag(name, v) {
    if (name === "Exposure" && v && v < 1) return "1/" + Math.round(1 / v) + " s";
    if (name === "F-number") return "f/" + v;
    if (name === "Focal length") return v + " mm";
    if (name === "Orientation") return ["", "Normal", "Mirror H", "Rotate 180", "Mirror V", "Mirror+90CW", "Rotate 90CW", "Mirror+90CCW", "Rotate 90CCW"][v] || v;
    return Array.isArray(v) ? v.join(", ") : String(v);
  }
  function renderExif(res) {
    var out = $("g-ex-out"), sum = $("g-ex-summary");
    if (!res || !res.has) {
      out.innerHTML = ""; sum.innerHTML = '<div class="e-muted">No EXIF metadata found' + (res ? "" : " (not a JPEG)") + ". The image is already clean, but you can still re-save a copy below.</div>";
      $("g-ex-strip").textContent = "⬇ Download a copy"; return;
    }
    var rows = "";
    Object.keys(res.tags).forEach(function (k) { rows += "<tr><td>" + k + "</td><td>" + String(fmtTag(k, res.tags[k])).replace(/[<>]/g, "") + "</td></tr>"; });
    if (res.gps) rows += '<tr><td>GPS location</td><td class="exif-gps"><a class="inline" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=' + res.gps.lat + "&mlon=" + res.gps.lon + "#map=15/" + res.gps.lat + "/" + res.gps.lon + '">' + res.gps.lat.toFixed(6) + ", " + res.gps.lon.toFixed(6) + " — show on map ↗</a></td></tr>";
    out.innerHTML = rows;
    sum.innerHTML = res.gps ? '<div class="e-err">⚠ This photo contains GPS location data.</div>' : '<div class="e-muted">Metadata found — strip it below to remove it.</div>';
    $("g-ex-strip").textContent = "⬇ Download without metadata";
  }
  $("g-ex-strip").addEventListener("click", function (e) {
    e.preventDefault();
    if (!exLast) return;
    var isJpg = /jpe?g/i.test(exLast.type) || /\.jpe?g$/i.test(exLast.name);
    exLast.arrayBuffer().then(function (buf) {
      if (isJpg) {
        var clean = stripJpeg(buf);
        if (clean) { dl(new Blob([clean], { type: "image/jpeg" }), stripExt(exLast.name) + "_clean.jpg"); return; }
      }
      // fallback: re-encode via canvas (drops all metadata)
      loadImg(exLast).then(function (r) { var c = document.createElement("canvas"); c.width = r.im.naturalWidth; c.height = r.im.naturalHeight; c.getContext("2d").drawImage(r.im, 0, 0); URL.revokeObjectURL(r.url); return toBlob(c, isJpg ? "image/jpeg" : "image/png", 0.95); }).then(function (b) { dl(b, stripExt(exLast.name) + "_clean." + (isJpg ? "jpg" : "png")); });
    });
  });
  // Remove APPn metadata segments (EXIF/XMP/etc.) losslessly from a JPEG.
  function stripJpeg(buf) {
    var d = new DataView(buf), n = d.byteLength;
    if (d.getUint16(0) !== 0xFFD8) return null;
    var keep = [0, 2], off = 2; // SOI
    while (off < n) {
      var marker = d.getUint16(off);
      if ((marker & 0xFF00) !== 0xFF00) break;
      if (marker === 0xFFDA) { keep.push(off, n); break; } // SOS → copy rest
      var len = d.getUint16(off + 2);
      var isMeta = (marker >= 0xFFE0 && marker <= 0xFFEF) || marker === 0xFFFE; // APPn + COM
      if (!isMeta) keep.push(off, off + 2 + len);
      off += 2 + len;
    }
    var total = 0, i; for (i = 0; i < keep.length; i += 2) total += keep[i + 1] - keep[i];
    var out = new Uint8Array(total), pos = 0, src = new Uint8Array(buf);
    for (i = 0; i < keep.length; i += 2) { out.set(src.subarray(keep[i], keep[i + 1]), pos); pos += keep[i + 1] - keep[i]; }
    return out;
  }
}
