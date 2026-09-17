/*
 * app.js — File Vault application logic.
 *
 * A dependency-free, offline-first personal file database. All state lives in
 * the platform's shared database (db.js adapts it to this app's verbs). This file wires up the UI: importing files, generating
 * thumbnails, searching/filtering, previewing, editing metadata and backups.
 */
(function () {
  "use strict";

  const DB = window.VaultDB;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Running inside the platform shell (as an iframe)?
  let embedded = false;
  try { embedded = window.parent !== window; } catch (e) { embedded = true; }

  // Cross-app navigation from the shell (deep links, "related" jumps) can
  // arrive before boot finishes — queue until init installs the real handler.
  let shellNavQueue = [];
  let onShellNav = (d) => { shellNavQueue.push(d); };
  window.addEventListener("message", (e) => {
    const d = e.data || {};
    if (d.type === "vault-filter" || d.type === "vault-search" || d.type === "vault-restore" || d.type === "platform-backup" || d.type === "vault-ro-import") onShellNav(d);
  });

  // ---- In-memory index of metadata (no blobs) for fast rendering ----
  let items = [];               // array of meta records
  const objectUrls = new Set(); // track for revocation

  // ---- Multi-select (bulk actions) ----
  const selection = new Set();  // selected record ids (survives filter changes)
  let lastRenderIds = [];       // current view order, for Shift+click ranges
  let lastClickedId = null;

  const state = {
    filter: "all",              // all | starred | recent | kind:xxx | collection:xxx
    tag: null,
    query: "",
    sort: "updated-desc",
    view: "grid",
    currentId: null,
  };

  // ---------- File type classification ----------
  const KINDS = {
    image: { label: "Images", glyph: "🖼️", badge: "IMG", color: "#0ea5e9" },
    video: { label: "Videos", glyph: "🎬", badge: "VIDEO", color: "#e11d48" },
    audio: { label: "Audio", glyph: "🎵", badge: "AUDIO", color: "#8b5cf6" },
    pdf: { label: "PDFs", glyph: "📕", badge: "PDF", color: "#dc2626" },
    document: { label: "Documents", glyph: "📄", badge: "DOC", color: "#2563eb" },
    spreadsheet: { label: "Spreadsheets", glyph: "📊", badge: "SHEET", color: "#16a34a" },
    presentation: { label: "Presentations", glyph: "📽️", badge: "SLIDES", color: "#ea580c" },
    text: { label: "Text & code", glyph: "📝", badge: "TXT", color: "#475569" },
    archive: { label: "Archives", glyph: "🗜️", badge: "ZIP", color: "#a16207" },
    other: { label: "Other", glyph: "📦", badge: "FILE", color: "#64748b" },
  };
  const KIND_ORDER = ["image", "video", "audio", "pdf", "document", "spreadsheet", "presentation", "text", "archive", "other"];

  function classify(file) {
    const type = (file.type || "").toLowerCase();
    const name = (file.name || "").toLowerCase();
    const ext = name.includes(".") ? name.split(".").pop() : "";
    if (type.startsWith("image/")) return "image";
    if (type.startsWith("video/")) return "video";
    if (type.startsWith("audio/")) return "audio";
    if (type === "application/pdf" || ext === "pdf") return "pdf";
    if (["zip", "rar", "7z", "gz", "tar", "bz2", "xz"].includes(ext) || type.includes("zip") || type.includes("compressed")) return "archive";
    if (["doc", "docx", "odt", "rtf", "pages"].includes(ext) || type.includes("word") || type.includes("opendocument.text")) return "document";
    if (["xls", "xlsx", "ods", "csv", "numbers"].includes(ext) || type.includes("sheet") || type.includes("excel")) return "spreadsheet";
    if (["ppt", "pptx", "odp", "key"].includes(ext) || type.includes("presentation") || type.includes("powerpoint")) return "presentation";
    if (type.startsWith("text/") ||
        ["txt", "md", "markdown", "json", "xml", "yml", "yaml", "js", "ts", "jsx", "tsx", "py", "rb", "go", "rs",
         "c", "cpp", "h", "java", "cs", "php", "sh", "css", "html", "htm", "sql", "log", "ini", "conf", "toml", "env"].includes(ext))
      return "text";
    return "other";
  }

  const TEXT_PREVIEW_MAX = 512 * 1024; // 512KB inline text cap

  // ---------- Utilities ----------
  function uid() {
    return "f_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
  }
  function fmtBytes(n) {
    if (!n && n !== 0) return "—";
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0, v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)) + " " + u[i];
  }
  function fmtDate(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) +
      " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function objUrl(blob) {
    const u = URL.createObjectURL(blob);
    objectUrls.add(u);
    return u;
  }
  function releaseUrls() {
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
    objectUrls.clear();
  }
  let toastTimer = null;
  function toast(msg, actionLabel, actionFn) {
    // Relay to the platform shell so events surface even when this app's tab
    // is in the background (the shell only shows relays for background tabs).
    if (embedded) { try { window.parent.postMessage({ type: "shell-toast", app: "vault", msg: String(msg) }, "*"); } catch (e) {} }
    const el = $("#toast");
    el.innerHTML = "";
    el.append(document.createTextNode(msg));
    if (actionLabel) {
      const b = document.createElement("button");
      b.textContent = actionLabel;
      b.onclick = () => { hide(el); actionFn && actionFn(); };
      el.append(b);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => hide(el), actionLabel ? 7000 : 3200);
  }
  const hide = (el) => { el.hidden = true; };

  // ---------- Thumbnail generation ----------
  function makeImageThumb(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const max = 360;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          canvas.toBlob((b) => { URL.revokeObjectURL(url); resolve(b); }, "image/jpeg", 0.78);
        } catch (e) { URL.revokeObjectURL(url); resolve(null); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }
  function makeVideoThumb(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const v = document.createElement("video");
      v.muted = true; v.preload = "metadata"; v.src = url;
      let done = false;
      const finish = (blob) => { if (done) return; done = true; URL.revokeObjectURL(url); resolve(blob); };
      v.onloadeddata = () => {
        try { v.currentTime = Math.min(1, (v.duration || 2) / 2); } catch (e) { finish(null); }
      };
      v.onseeked = () => {
        try {
          const max = 360;
          const scale = Math.min(1, max / Math.max(v.videoWidth || 1, v.videoHeight || 1));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round((v.videoWidth || 320) * scale));
          canvas.height = Math.max(1, Math.round((v.videoHeight || 180) * scale));
          canvas.getContext("2d").drawImage(v, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((b) => finish(b), "image/jpeg", 0.72);
        } catch (e) { finish(null); }
      };
      v.onerror = () => finish(null);
      setTimeout(() => finish(null), 6000); // safety timeout
    });
  }
  async function makeThumb(file, kind) {
    try {
      if (kind === "image") return await makeImageThumb(file);
      if (kind === "video") return await makeVideoThumb(file);
      if (kind === "pdf") return await makePdfThumb(file);
    } catch (e) { /* ignore */ }
    return null;
  }

  // ---------- PDF thumbnails (first page rendered with a vendored pdf.js) ----------
  // pdf.js is ~1.5 MB, so it's loaded on demand the first time a PDF needs a
  // preview — vaults with no PDFs never pay for it.
  let _pdfjs = null, _pdfjsLoading = null;
  function ensurePdfjs() {
    if (_pdfjs) return Promise.resolve(_pdfjs);
    if (_pdfjsLoading) return _pdfjsLoading;
    _pdfjsLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "vendor/pdf.min.js";
      s.onload = () => {
        // The v4 bundle finishes initializing in a microtask — wait for the
        // readiness promise it publishes instead of reading the global directly.
        Promise.resolve(window.pdfjsLibPromise || window.pdfjsLib).then((lib) => {
          lib = lib || window.pdfjsLib;
          if (!lib) { reject(new Error("pdf.js unavailable")); return; }
          try { lib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js"; } catch (e) {}
          _pdfjs = lib; resolve(lib);
        }).catch(reject);
      };
      s.onerror = () => { _pdfjsLoading = null; reject(new Error("pdf.js failed to load")); };
      document.head.appendChild(s);
    });
    return _pdfjsLoading;
  }
  async function makePdfThumb(file) {
    const lib = await ensurePdfjs();
    const buf = await file.arrayBuffer();
    const doc = await lib.getDocument({ data: buf, isEvalSupported: false, disableAutoFetch: true, disableStream: true }).promise;
    try {
      const page = await doc.getPage(1);
      const unit = page.getViewport({ scale: 1 });
      const max = 360;
      const scale = Math.min(2, max / Math.max(unit.width, unit.height) || 1);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(vp.width));
      canvas.height = Math.max(1, Math.ceil(vp.height));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); // PDFs are transparent
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      return await new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.75));
    } finally {
      try { doc.destroy(); } catch (e) {}
    }
  }

  // Previews are made here, as "thumb" jobs: for files that just arrived
  // (queued by the intake) and, on boot, for PDFs that never got one. One
  // at a time, persisted as we go (a preview never touches updatedAt, so
  // nothing jumps in "Recent"), and drawn into any card on screen.
  let _thumbT = null;
  function scheduleThumbBackfill() {
    clearTimeout(_thumbT);
    _thumbT = setTimeout(async () => {
      const pending = items.filter((it) => it.kind === "pdf" && !it.thumb && !it._noThumb).map((it) => it.id);
      if (!pending.length) return;
      try {
        const queued = new Set();
        (await FDData.jobs.listActive("thumb")).forEach((j) => j.inputIds.forEach((id) => queued.add(id)));
        const todo = pending.filter((id) => !queued.has(id));
        if (todo.length) await FDData.jobs.enqueue("thumb", todo);
      } catch (e) {}
    }, 400);
  }
  async function thumbJob(job, ctl) {
    for (const id of job.inputIds) {
      if (ctl.cancelled()) return;
      await thumbFor(id);
      await new Promise((r) => setTimeout(r, 25)); // breathe between pages
    }
  }
  async function thumbFor(id) {
    const it = items.find((x) => x.id === id);
    if (it && (it.thumb || it._noThumb)) return;
    let rec = null;
    try { rec = await DB.get(id); } catch (e) {}
    if (!rec || !rec.blob) { if (it) it._noThumb = true; return; }
    if (rec.thumb) { if (it) { it.thumb = rec.thumb; refreshCardThumb(id, rec.thumb); } return; }
    let thumb = null;
    try { thumb = await makeThumb(rec.blob, rec.kind); } catch (e) {}
    if (!thumb) { if (it) it._noThumb = true; return; } // encrypted / broken — keep the icon
    try { await FDData.repos.files.setThumb(id, thumb); } catch (e) { return; }
    if (it) { it.thumb = thumb; refreshCardThumb(id, thumb); }
  }
  function refreshCardThumb(id, thumb) {
    const box = document.querySelector('.card[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"] .card__thumb');
    if (!box) return;
    const existing = box.querySelector("img");
    if (existing) { existing.src = objUrl(thumb); return; }
    const img = document.createElement("img");
    img.loading = "lazy"; img.alt = ""; img.src = objUrl(thumb);
    const glyph = box.querySelector(".card__glyph");
    if (glyph) glyph.replaceWith(img); else box.prepend(img);
  }

  // ---------- Import ----------
  // The data layer's intake reads each file's bytes eagerly (a dropped File
  // is a lazy handle — a OneDrive placeholder or a locked file can read as
  // garbage later), stores and verifies them, and queues the thumbnail and
  // quick-VIN jobs this page runs below. A file that fails to read or store
  // is reported and never counted as added. Resolves the ids stored.
  async function storeFiles(files, opts) {
    let out;
    try { out = await FDData.intake.ingest("vault", files, Object.assign({ source: "files" }, opts || {})); }
    catch (e) { console.error(e); toast("Couldn't save the files. Storage may be full."); return []; }
    out.results.filter((r) => !r.ok).forEach((r) => {
      if (opts && opts.quiet) return;
      toast(r.error.indexOf("read") === 0
        ? 'Couldn’t read “' + r.name + '” — if it lives in OneDrive or on a network drive, open it once (or copy it locally), then add it again.'
        : "Couldn't save “" + r.name + "”" + (r.quota ? " — browser storage is full." : " — " + r.error));
    });
    if (out.ids.length) {
      const recs = await FDData.repos.files.getMany(out.ids);
      recs.forEach((r) => { if (r && !items.some((x) => x.id === r.id)) { r.thumb = null; items.push(r); } });
    }
    return out.ids;
  }
  async function addFiles(fileList) {
    const files = Array.from(fileList).filter(Boolean);
    if (!files.length) return;
    const collection = state.filter.startsWith("collection:") ? state.filter.slice(11) : "";
    toast(`Adding ${files.length} file${files.length > 1 ? "s" : ""}…`);
    const ids = await storeFiles(files, { collection });
    render();
    updateStorage();
    if (ids.length) toast(`Added ${ids.length} file${ids.length > 1 ? "s" : ""}${collection ? " to " + collection : ""}.`);
  }

  // ---------- Automatic VIN detection on intake ----------
  // Every file that arrives (add button, unified platform intake, bridge) is
  // read for a VIN immediately using the FAST sources only — filename, text
  // files, a PDF's text layer. No OCR: it's slow, needs a one-time download,
  // and may be unavailable offline. Files that would need OCR (images, scanned
  // PDFs) are left UNSTAMPED so the manual "Scan files for VINs" — which does
  // use OCR — still picks them up later.
  async function autoDetectVins(rec, quiet) {
    if (VIN_SKIP_KIND[rec.kind]) return 0;
    let r;
    try { r = await extractVinText(rec, false, null); } catch (e) { return 0; } // needs OCR — leave for the scan
    const { vins, fins } = findVinsDetailed(r.text, r.fuzzy);
    if (!vins.length && !fins.length) return 0;
    const stored = await DB.get(rec.id);
    if (!stored) return 0;
    // Union, don't clobber: the record may already carry the pinned vehicle's
    // VIN from the unified intake — detection adds evidence on top of it.
    stored.vins = Array.from(new Set(vins.concat(stored.vins || [])));
    stored.fins = Array.from(new Set(fins.concat(stored.fins || [])));
    stored.vinScan = Date.now();
    stored.searchText = DB.buildSearchText(stored);
    await DB.put(stored); // put, not update: preserves updatedAt
    const it = items.find((x) => x.id === rec.id);
    // Mirror the UNIONED arrays — the detected-only set would drop the
    // pinned-vehicle tag from the visible list until the next reload.
    if (it) { it.vins = stored.vins; it.fins = stored.fins; it.vinScan = stored.vinScan; }
    render();
    if (!quiet && vins.length) toast(`Filed “${stored.name}” under ${vins[0]}${vins.length > 1 ? " +" + (vins.length - 1) : ""} — see 🚗 By VIN.`);
    return vins.length ? 1 : 0;
  }
  // The "vin-detect" job: the quick, OCR-free read for files that just
  // arrived (from this page, the shell, the RO tab or another tab).
  async function vinDetectJob(job) {
    let hits = 0;
    const quiet = !!(job.meta && job.meta.quiet);
    for (const id of job.inputIds) {
      const rec = await DB.get(id);
      if (!rec || !rec.blob) continue;
      if (!items.some((x) => x.id === id)) { items.push(stripBlob(rec)); render(); }
      try { hits += await autoDetectVins(rec, quiet); } catch (e) {}
    }
    if (quiet && hits) toast(`Detected VINs in ${hits} of the new files — see 🚗 By VIN.`);
    return { hits };
  }

  function stripBlob(r) {
    const { blob, searchText, ...meta } = r;
    return meta;
  }

  // ---------- Rendering ----------
  function currentSet() {
    let list = items.slice();
    const f = state.filter;
    if (f === "starred") list = list.filter((i) => i.starred);
    else if (f === "recent") {
      list.sort((a, b) => b.updatedAt - a.updatedAt);
      list = list.slice(0, 40);
    } else if (f.startsWith("kind:")) {
      const k = f.slice(5);
      list = list.filter((i) => i.kind === k);
    } else if (f.startsWith("collection:")) {
      const c = f.slice(11);
      list = list.filter((i) => (i.collection || "") === c);
    } else if (f === "vins") {
      list = list.filter((i) => (i.vins || []).length);
    } else if (f.startsWith("vin:")) {
      const v = f.slice(4);
      list = list.filter((i) => (i.vins || []).includes(v));
    }
    if (state.tag) list = list.filter((i) => (i.tags || []).includes(state.tag));
    if (state.query) {
      const q = state.query.toLowerCase();
      list = list.filter((i) =>
        [i.name, i.collection, i.note, (i.tags || []).join(" "), (i.vins || []).join(" "), (i.fins || []).join(" ")].join(" ").toLowerCase().includes(q));
    }
    if (f !== "recent") list = sortList(list);
    return list;
  }

  function sortList(list) {
    const [key, dir] = state.sort.split("-");
    const mul = dir === "asc" ? 1 : -1;
    return list.sort((a, b) => {
      let r = 0;
      if (key === "name") r = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      else if (key === "size") r = (a.size || 0) - (b.size || 0);
      else r = (a.updatedAt || 0) - (b.updatedAt || 0);
      return r * mul;
    });
  }

  function render() {
    renderSidebar();
    syncStaticNav();

    const list = currentSet();
    const results = $("#results");
    results.className = "results " + state.view;
    releaseUrls();
    results.innerHTML = "";
    $("#list-head").hidden = true;

    if (items.length === 0) {
      $("#empty").hidden = false;
      $("#empty-title").textContent = "Your vault is empty";
      $("#empty-text").innerHTML = "Drag files anywhere onto this window, or use <strong>Add files</strong> to start building your database. Everything stays on this computer.";
      results.hidden = true;
      return;
    }
    results.hidden = false;
    if (list.length === 0) {
      $("#empty").hidden = false;
      if (state.filter === "vins" && !state.query) {
        $("#empty-title").textContent = "No VINs detected yet";
        $("#empty-text").innerHTML = "Use <strong>⋮ → Scan files for VINs</strong> to read every file for a 17-character vehicle identification number. Images and scanned PDFs are read with OCR (needs internet the first time).";
      } else {
        $("#empty-title").textContent = "No matches";
        $("#empty-text").textContent = "Nothing here fits the current search or filter. Try clearing filters.";
      }
      results.hidden = true;
    } else {
      $("#empty").hidden = true;
    }

    const frag = document.createDocumentFragment();
    if (state.filter === "vins") {
      // Group the results under one header per VIN (a file that mentions
      // several vehicles appears under each of them).
      const groups = new Map();
      for (const it of list) (it.vins || []).forEach((v) => {
        if (!groups.has(v)) groups.set(v, []);
        groups.get(v).push(it);
      });
      Array.from(groups.keys()).sort().forEach((v) => {
        const head = document.createElement("div");
        head.className = "group-head";
        // Model series (Baumuster digits) from the VIN or any FIN in the
        // group → jump links to the LI docs / special tools for this vehicle.
        let series = seriesOfId(v);
        if (!series) for (const it of groups.get(v)) { for (const f of it.fins || []) { series = seriesOfId(f); if (series) break; } if (series) break; }
        const seriesLinks = series
          ? `<button type="button" class="group-head__link" data-series-li="${series}" title="LI documents for model ${series}">🗄️ LI ${series}</button><button type="button" class="group-head__link" data-series-tools="${series}" title="Special tools for model ${series}">🔧 Tools ${series}</button>`
          : "";
        // Pinning is a platform feature — only offered when the shell hosts us.
        const pinLink = embedded ? `<button type="button" class="group-head__link" data-pin="${esc(v)}" title="Pin ${esc(v)} as the active vehicle — every tab then scopes to this car">📌 Pin</button>` : "";
        const links = (seriesLinks || pinLink) ? `<span class="group-head__links">${seriesLinks}${pinLink}</span>` : "";
        head.innerHTML = `<span class="group-head__icon">🚗</span><span class="group-head__vin">${esc(v)}</span>${links}<span class="group-head__count">${groups.get(v).length}</span>`;
        head.title = "Show only " + v;
        head.onclick = () => setFilter("vin:" + v);
        head.querySelectorAll(".group-head__link").forEach((b) => {
          b.onclick = (e) => {
            e.stopPropagation();
            if (b.dataset.pin) {
              try { window.parent.postMessage({ type: "shell-pin-vehicle", vin: b.dataset.pin }, "*"); } catch (x) {}
              return;
            }
            const s = b.dataset.seriesLi || b.dataset.seriesTools;
            if (b.dataset.seriesLi) crossNav("li", { type: "li-filter", model: s }, "li/model/" + s);
            else crossNav("inventory", { type: "inventory-filter", model: s }, "inventory/model/" + s);
          };
        });
        frag.append(head);
        for (const it of groups.get(v)) frag.append(renderCard(it));
      });
    } else {
      for (const it of list) frag.append(renderCard(it));
    }
    results.append(frag);
    $("#list-head").hidden = state.view !== "list";
    updateTitle(list.length);
    renderActiveFilters();
    lastRenderIds = list.map((it) => it.id);
    for (const id of Array.from(selection)) if (!items.some((it) => it.id === id)) selection.delete(id); // prune deleted
    results.classList.toggle("selecting", selection.size > 0);
    renderBulkBar();
    scheduleThumbBackfill(); // fill in any missing PDF previews in the background
  }

  // ---------- multi-select ----------
  function toggleSelect(id, shiftRange) {
    if (shiftRange && lastClickedId && lastClickedId !== id) {
      const a = lastRenderIds.indexOf(lastClickedId), b = lastRenderIds.indexOf(id);
      if (a !== -1 && b !== -1) {
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) selection.add(lastRenderIds[i]);
        lastClickedId = id;
        render();
        return;
      }
    }
    if (selection.has(id)) selection.delete(id); else selection.add(id);
    lastClickedId = id;
    render();
  }
  function clearSelection() { selection.clear(); lastClickedId = null; render(); }
  function selectAllVisible() { lastRenderIds.forEach((id) => selection.add(id)); render(); }
  // Card/row click: with a selection active (or Ctrl/Cmd held), clicks manage
  // the selection; otherwise they open the detail drawer as always.
  function cardClick(e, id) {
    if (selection.size || e.ctrlKey || e.metaKey || e.shiftKey) toggleSelect(id, e.shiftKey);
    else openDetail(id);
  }
  function selectButton(cls, id) {
    const sel = document.createElement("button");
    sel.type = "button";
    sel.className = cls + (selection.has(id) ? " on" : "");
    sel.textContent = selection.has(id) ? "✓" : "";
    sel.title = "Select (Shift+click selects a range)";
    sel.onclick = (e) => { e.stopPropagation(); toggleSelect(id, e.shiftKey); };
    return sel;
  }

  // ---------- bulk actions ----------
  function renderBulkBar() {
    const bar = $("#bulkbar");
    if (!bar) return;
    bar.hidden = selection.size === 0;
    if (bar.hidden) return;
    $("#bulk-count").textContent = selection.size + " selected";
    // "Add to RO" appears only while the Repair Orders tab has us in import mode.
    const addRo = $("#bulk-add-ro");
    if (addRo) { addRo.hidden = !roImport; if (roImport) addRo.textContent = "➕ Add to RO " + (roImport.roNo || ""); }
    const sel = items.filter((it) => selection.has(it.id));
    const allStarred = sel.length > 0 && sel.every((it) => it.starred);
    $("#bulk-star").textContent = allStarred ? "☆ Unstar" : "★ Star";
    const pdfs = sel.filter((it) => it.kind === "pdf").length;
    $("#bulk-send-li").disabled = !window.FDData || pdfs === 0;
    $("#bulk-send-li").textContent = "🗄️ Send to LI" + (pdfs && pdfs !== sel.length ? " (" + pdfs + ")" : "");
    const tabs = new Set(sel.map((it) => toolboxTabFor(it)).filter(Boolean));
    const oneTab = tabs.size === 1 && !sel.some((it) => !toolboxTabFor(it));
    const tab = oneTab ? tabs.values().next().value : null;
    const tbBtn = $("#bulk-send-toolbox");
    tbBtn.disabled = !window.FDData || !oneTab || !supportsToolboxBulk(tab);
    tbBtn.title = oneTab && !supportsToolboxBulk(tab)
      ? "The " + tab.toUpperCase() + " tool takes one file at a time — open files individually to use it. Bulk sends work for images, video and PDFs."
      : "Send the selection to the matching Toolbox tool (files must be one kind — images, video or PDFs)";
  }
  // Apply a mutation to every selected record: read → change → reindex → write.
  async function bulkMutate(fn, done) {
    const ids = Array.from(selection);
    let n = 0;
    for (const id of ids) {
      const rec = await DB.get(id);
      if (!rec) continue;
      if (fn(rec) === false) continue;
      rec.updatedAt = Date.now();
      rec.searchText = DB.buildSearchText(rec);
      await DB.put(rec);
      const i = items.findIndex((x) => x.id === id);
      if (i !== -1) items[i] = stripBlob(rec);
      n++;
    }
    render();
    if (done) toast(done(n));
  }
  function wireBulkBar() {
    $("#bulk-clear").onclick = clearSelection;
    $("#bulk-all").onclick = selectAllVisible;
    $("#bulk-add-ro").onclick = importSelectionToRo;
    const roCancel = $("#ro-import-cancel"); if (roCancel) roCancel.onclick = exitRoImport;
    $("#bulk-collection").onclick = () => {
      const name = prompt(`Move ${selection.size} file(s) to collection (leave empty to remove from any collection):`);
      if (name === null) return;
      const clean = name.trim();
      if (clean && !extraCollections.includes(clean)) { extraCollections.push(clean); DB.setMeta("collections", extraCollections); }
      bulkMutate((r) => { r.collection = clean; }, (n) => clean ? `Moved ${n} file(s) to “${clean}”.` : `Removed ${n} file(s) from their collections.`);
    };
    $("#bulk-tags").onclick = () => {
      const raw = prompt(`Add tags to ${selection.size} file(s) (comma separated):`);
      if (!raw || !raw.trim()) return;
      const add = raw.split(",").map((s) => s.trim()).filter(Boolean);
      bulkMutate((r) => { r.tags = Array.from(new Set((r.tags || []).concat(add))); }, (n) => `Tagged ${n} file(s).`);
    };
    $("#bulk-vin").onclick = () => {
      const raw = prompt(`VIN to tag onto ${selection.size} file(s):`);
      if (!raw || !raw.trim()) return;
      const vin = raw.trim().toUpperCase().replace(/\s+/g, "");
      bulkMutate((r) => {
        r.vins = Array.from(new Set([vin].concat(r.vins || [])));
        r.vinScan = Date.now();
      }, (n) => `Tagged ${n} file(s) with ${vin} — see 🚗 By VIN.`);
    };
    $("#bulk-star").onclick = () => {
      const sel = items.filter((it) => selection.has(it.id));
      const target = !(sel.length && sel.every((it) => it.starred));
      bulkMutate((r) => { r.starred = target; }, (n) => (target ? "Starred " : "Unstarred ") + n + " file(s).");
    };
    $("#bulk-delete").onclick = async () => {
      if (!confirm(`Delete ${selection.size} file(s) from the vault? This can't be undone.`)) return;
      const ids = Array.from(selection);
      for (const id of ids) {
        try { await DB.remove(id); } catch (e) {}
        const i = items.findIndex((x) => x.id === id);
        if (i !== -1) items.splice(i, 1);
      }
      selection.clear();
      render();
      updateStorage();
      toast(`Deleted ${ids.length} file(s).`);
    };
    $("#bulk-send-li").onclick = async () => {
      if (!window.FDData) return;
      const ids = items.filter((it) => selection.has(it.id) && it.kind === "pdf").map((it) => it.id);
      if (!ids.length) { toast("No PDFs in the selection."); return; }
      // The PDFs are already stored: LI Documents reads them from the same
      // records and files a document against each (no second copy).
      let sent = 0;
      try { await FDData.jobs.enqueue("li-import", ids, { source: "files" }); sent = ids.length; } catch (e) { console.error(e); }
      toast(`Sent ${sent} PDF(s) to LI Documents — it reads and files them automatically.`);
      if (embedded && sent) { try { window.parent.postMessage({ type: "shell-nav", app: "li" }, "*"); } catch (e) {} }
    };
    $("#bulk-send-toolbox").onclick = async () => {
      if (!window.FDData) return;
      const sel = items.filter((it) => selection.has(it.id));
      const tabs = new Set(sel.map((it) => toolboxTabFor(it)).filter(Boolean));
      if (tabs.size !== 1 || sel.some((it) => !toolboxTabFor(it))) { toast("Pick files of one kind — a mixed selection can't target a single tool."); return; }
      const tab = tabs.values().next().value;
      if (!supportsToolboxBulk(tab)) { toast("The " + tab.toUpperCase() + " tool accepts one file at a time. Open files individually to use it."); return; }
      let sent = 0;
      try { await FDData.jobs.enqueue("toolbox-intake", sel.map((it) => it.id), { tab, keep: true }); sent = sel.length; } catch (e) { console.error(e); }
      toast(`Sent ${sent} file(s) to the Toolbox.`);
      if (embedded && sent) { try { window.parent.postMessage({ type: "shell-nav", app: "toolbox", tab }, "*"); } catch (e) {} }
    };
    $("#bulk-download").onclick = bulkDownload;
  }

  // A stored name made safe for Windows: forbidden characters replaced,
  // control characters stripped, and clamped so the full destination path
  // stays under the OS limit.
  function exportName(n, fallback) {
    let s = String(n || "").split("").filter((ch) => ch.charCodeAt(0) >= 32).join("");
    s = s.replace(/[<>:"/\\|?*]/g, "_").replace(/^[. ]+|[. ]+$/g, "");
    if (s.length > 140) {
      const m = s.match(/^(.*?)(\.[A-Za-z0-9]{1,8})?$/);
      const ext = m[2] || "";
      s = m[1].slice(0, 140 - ext.length).replace(/[. ]+$/, "") + ext;
    }
    return s || fallback || "file";
  }
  // Save the selection into a folder the user picks, verifying every file on
  // disk after writing (this machine has corrupted large downloads before).
  // Falls back to one browser download per file where the folder API is missing.
  async function bulkDownload() {
    const ids = Array.from(selection);
    if (!ids.length) return;
    if (window.showDirectoryPicker) {
      let dir;
      try { dir = await window.showDirectoryPicker({ id: "vault-bulk-save", mode: "readwrite" }); }
      catch (e) { return; } // cancelled
      let ok = 0;
      const failed = [];
      const used = new Set();
      for (const id of ids) {
        const rec = await DB.get(id);
        if (!rec) continue;
        let name = exportName(rec.name, "file-" + id);
        try {
          if (!rec.blob) throw new Error("no data stored");
          if (used.has(name.toLowerCase())) {
            const m = name.match(/^(.*?)(\.[A-Za-z0-9]{1,8})?$/);
            let k = 2;
            while (used.has(((m[1] + " (" + k + ")" + (m[2] || "")).toLowerCase()))) k++;
            name = m[1] + " (" + k + ")" + (m[2] || "");
          }
          used.add(name.toLowerCase());
          const fh = await dir.getFileHandle(name, { create: true });
          const w = await fh.createWritable();
          await w.write(rec.blob);
          await w.close();
          const back = await fh.getFile();
          if (back.size !== rec.blob.size) throw new Error("size mismatch after writing");
          ok++;
        } catch (e) {
          failed.push(name + " (" + ((e && e.message) || e) + ")");
        }
      }
      toast(failed.length
        ? `Saved ${ok} of ${ids.length} file(s) — failed: ${failed.slice(0, 3).join("; ")}${failed.length > 3 ? " +" + (failed.length - 3) + " more" : ""}`
        : `Saved ${ok} file(s) to the folder — every file verified on disk.`);
    } else {
      // No folder picker: hand each file to the browser's downloader.
      let ok = 0;
      for (const id of ids) {
        const rec = await DB.get(id);
        if (!rec || !rec.blob) continue;
        const url = URL.createObjectURL(rec.blob);
        const a = document.createElement("a");
        a.href = url; a.download = exportName(rec.name, "file-" + id);
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        ok++;
        await new Promise((r) => setTimeout(r, 350));
      }
      toast(`Downloaded ${ok} file(s).`);
    }
  }

  function renderCard(it) {
    if (state.view === "list") return renderRow(it);
    const meta = KINDS[it.kind] || KINDS.other;
    const card = document.createElement("article");
    card.className = "card";
    card.tabIndex = 0;
    card.dataset.id = it.id;

    const thumb = document.createElement("div");
    thumb.className = "card__thumb";
    if (it.thumb) {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = objUrl(it.thumb);
      img.alt = "";
      thumb.append(img);
    } else {
      const g = document.createElement("div");
      g.className = "card__glyph";
      g.textContent = meta.glyph;
      thumb.append(g);
    }
    const badge = document.createElement("span");
    badge.className = "card__badge";
    badge.style.background = meta.color;
    badge.textContent = meta.badge;
    thumb.append(badge);

    const star = document.createElement("button");
    star.className = "card__star" + (it.starred ? " on" : "");
    star.textContent = it.starred ? "★" : "☆";
    star.title = "Star";
    star.onclick = (e) => { e.stopPropagation(); toggleStar(it.id); };
    thumb.append(star);
    thumb.append(selectButton("card__select", it.id));
    card.classList.toggle("is-selected", selection.has(it.id));

    const body = document.createElement("div");
    body.className = "card__body";
    const name = document.createElement("div");
    name.className = "card__name";
    name.textContent = it.name;
    name.title = it.name;
    const sub = document.createElement("div");
    sub.className = "card__sub";
    sub.innerHTML = `<span>${fmtBytes(it.size)}</span>` + (it.collection ? `<span>· ${esc(it.collection)}</span>` : "");
    body.append(name, sub);
    const vins = it.vins || [], fins = it.fins || [];
    if ((it.tags && it.tags.length) || vins.length || fins.length) {
      const tw = document.createElement("div");
      tw.className = "card__tags";
      vins.slice(0, 2).forEach((v) => {
        const s = document.createElement("span");
        s.className = "tag tag--vin"; s.textContent = v; s.title = "VIN";
        tw.append(s);
      });
      fins.slice(0, 1).forEach((v) => {
        const s = document.createElement("span");
        s.className = "tag tag--fin"; s.textContent = v; s.title = "FIN / datacard number";
        tw.append(s);
      });
      (it.tags || []).slice(0, 4).forEach((t) => {
        const s = document.createElement("span");
        s.className = "tag"; s.textContent = t;
        tw.append(s);
      });
      body.append(tw);
    }

    card.append(thumb, body);
    card.onclick = (e) => cardClick(e, it.id);
    card.onkeydown = (e) => { if (e.key === "Enter") openDetail(it.id); };
    return card;
  }

  // LI-style table row for the list view.
  function renderRow(it) {
    const meta = KINDS[it.kind] || KINDS.other;
    const row = document.createElement("article");
    row.className = "row";
    row.tabIndex = 0;
    row.dataset.id = it.id;

    const star = document.createElement("button");
    star.className = "row__star" + (it.starred ? " on" : "");
    star.textContent = it.starred ? "★" : "☆";
    star.title = "Star";
    star.onclick = (e) => { e.stopPropagation(); toggleStar(it.id); };

    const icon = document.createElement("span");
    icon.className = "row__icon";
    icon.textContent = meta.glyph;

    const name = document.createElement("div");
    name.className = "row__name";
    name.textContent = it.name;
    name.title = it.name;

    const type = document.createElement("span");
    type.className = "row__badge";
    type.style.background = meta.color;
    type.textContent = meta.badge;

    const coll = document.createElement("div");
    coll.className = "row__coll";
    coll.textContent = it.collection || "—";

    const tags = document.createElement("div");
    tags.className = "row__tags";
    (it.vins || []).slice(0, 1).forEach((v) => {
      const s = document.createElement("span");
      s.className = "tag tag--vin"; s.textContent = v; s.title = "VIN";
      tags.append(s);
    });
    if (!(it.vins || []).length) (it.fins || []).slice(0, 1).forEach((v) => {
      const s = document.createElement("span");
      s.className = "tag tag--fin"; s.textContent = v; s.title = "FIN / datacard number";
      tags.append(s);
    });
    (it.tags || []).slice(0, 3).forEach((t) => {
      const s = document.createElement("span");
      s.className = "tag"; s.textContent = t;
      tags.append(s);
    });

    const size = document.createElement("div");
    size.className = "row__size";
    size.textContent = fmtBytes(it.size);

    row.append(selectButton("row__select", it.id), star, icon, name, type, coll, tags, size);
    row.classList.toggle("is-selected", selection.has(it.id));
    row.onclick = (e) => cardClick(e, it.id);
    row.onkeydown = (e) => { if (e.key === "Enter") openDetail(it.id); };
    return row;
  }

  function updateTitle(count) {
    const f = state.filter;
    let title = "All files";
    if (f === "starred") title = "Starred";
    else if (f === "recent") title = "Recent";
    else if (f.startsWith("kind:")) title = (KINDS[f.slice(5)] || {}).label || "Files";
    else if (f.startsWith("collection:")) title = f.slice(11) || "Uncategorized";
    else if (f === "vins") title = "By VIN";
    else if (f.startsWith("vin:")) title = f.slice(4);
    if (state.query) title = `“${state.query}”`;
    $("#view-title").textContent = title;
    document.title = `${title} · File Vault (${count})`;
  }

  function renderActiveFilters() {
    const wrap = $("#active-filters");
    wrap.innerHTML = "";
    const chips = [];
    if (state.tag) chips.push(["tag", "#" + state.tag, () => { state.tag = null; render(); }]);
    if (state.query) chips.push(["q", "search: " + state.query, () => { state.query = ""; $("#search-input").value = ""; render(); }]);
    chips.forEach(([, label, clear]) => {
      const c = document.createElement("span");
      c.className = "chip";
      c.append(document.createTextNode(label));
      const x = document.createElement("button");
      x.textContent = "✕"; x.setAttribute("aria-label", "Remove filter");
      x.onclick = clear;
      c.append(x);
      wrap.append(c);
    });
  }

  // ---------- Sidebar ----------
  function renderSidebar() {
    const counts = { all: items.length, starred: 0, recent: Math.min(items.length, 40), vins: 0 };
    const kindCounts = {};
    const collCounts = {};
    const tagCounts = {};
    const vinCounts = {};
    for (const it of items) {
      if (it.starred) counts.starred++;
      kindCounts[it.kind] = (kindCounts[it.kind] || 0) + 1;
      const c = it.collection || "";
      if (c) collCounts[c] = (collCounts[c] || 0) + 1;
      (it.tags || []).forEach((t) => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
      if ((it.vins || []).length) counts.vins++;
      (it.vins || []).forEach((v) => { vinCounts[v] = (vinCounts[v] || 0) + 1; });
    }
    $$("[data-count]").forEach((el) => {
      const k = el.getAttribute("data-count");
      el.textContent = counts[k] ? counts[k] : "";
    });

    // Types
    const typesNav = $("#nav-types");
    typesNav.innerHTML = "";
    KIND_ORDER.filter((k) => kindCounts[k]).forEach((k) => {
      const m = KINDS[k];
      const b = document.createElement("button");
      b.className = "nav__item" + (state.filter === "kind:" + k ? " is-active" : "");
      b.dataset.filter = "kind:" + k;
      b.innerHTML = `<span class="nav__icon">${m.glyph}</span> ${m.label} <span class="nav__count">${kindCounts[k]}</span>`;
      b.onclick = () => setFilter("kind:" + k);
      typesNav.append(b);
    });

    // Collections
    const collNav = $("#nav-collections");
    collNav.innerHTML = "";
    const collNames = getCollections();
    if (!collNames.length) {
      collNav.innerHTML = `<div class="nav__label" style="text-transform:none;font-weight:400;padding-top:2px">No collections yet</div>`;
    }
    collNames.forEach((c) => {
      const b = document.createElement("button");
      b.className = "nav__item" + (state.filter === "collection:" + c ? " is-active" : "");
      b.innerHTML = `<span class="nav__icon">📂</span> ${esc(c)} <span class="nav__count">${collCounts[c] || 0}</span>`;
      b.onclick = () => setFilter("collection:" + c);
      collNav.append(b);
    });

    // VINs (only shown once a scan has found some)
    const vinNav = $("#nav-vins");
    vinNav.innerHTML = "";
    const vinNames = Object.keys(vinCounts).sort();
    $("#vins-section").hidden = vinNames.length === 0;
    vinNames.forEach((v) => {
      const b = document.createElement("button");
      b.className = "nav__item" + (state.filter === "vin:" + v ? " is-active" : "");
      b.title = v;
      b.innerHTML = `<span class="nav__icon">🚗</span> <span class="nav__vin">${esc(v)}</span> <span class="nav__count">${vinCounts[v]}</span>`;
      b.onclick = () => setFilter("vin:" + v);
      vinNav.append(b);
    });

    // Datalist for collection input
    const dl = $("#collections-list");
    dl.innerHTML = "";
    collNames.forEach((c) => { const o = document.createElement("option"); o.value = c; dl.append(o); });

    // Tags
    const cloud = $("#tag-cloud");
    cloud.innerHTML = "";
    const sortedTags = Object.keys(tagCounts).sort((a, b) => tagCounts[b] - tagCounts[a]).slice(0, 40);
    $("#tags-section").hidden = sortedTags.length === 0;
    sortedTags.forEach((t) => {
      const s = document.createElement("button");
      s.className = "tag" + (state.tag === t ? " is-active" : "");
      s.textContent = t;
      s.onclick = () => { state.tag = state.tag === t ? null : t; render(); };
      cloud.append(s);
    });
  }

  let extraCollections = [];
  function getCollections() {
    const set = new Set(extraCollections);
    items.forEach((i) => { if (i.collection) set.add(i.collection); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  function setFilter(f) {
    state.filter = f;
    state.tag = null;
    render();
    closeSidebarMobile();
  }

  // Keep the fixed sidebar entries in sync with the active view.
  function syncStaticNav() {
    $$("#nav-filters .nav__item").forEach((b) => b.classList.toggle("is-active", b.dataset.filter === state.filter));
  }

  // ---------- Cross-app links (the shared Mercedes vocabulary) ----------
  // Tags stamped by LI hand-offs are LI numbers; VIN/FIN Baumuster digits
  // (chars 4-6) are the model series. Both become live links into the other
  // apps instead of dead strings.
  const LI_TAG_RE = FDCore.ids.DOCNUM_EXACT; // shared: ../src/core/ids.js
  // Newer XENTRY PDFs spell the number with U+2011 non-breaking hyphens and
  // U+00A0 spaces, so a tag pasted straight out of one carries those. Fold
  // them to ASCII before matching (and before handing the number to the LI
  // app) or the tag stays a dead string instead of a cross-app link.
  const liNorm = (t) => FDCore.text.normLI(t).trim();
  const seriesOfId = FDCore.ids.seriesOfVin;
  function crossNav(app, payload, hashPath) {
    if (embedded) {
      try { window.parent.postMessage({ type: "shell-nav", app, payload }, "*"); return; } catch (e) {}
    }
    window.open("../index.html#" + hashPath);
  }
  function renderRelated(rec) {
    const box = $("#d-related");
    box.innerHTML = "";
    const chips = [];
    (rec.tags || []).filter((t) => LI_TAG_RE.test(liNorm(t))).forEach((t) => {
      const li = liNorm(t).toUpperCase();
      chips.push({ label: "🗄️ " + li, title: "Open this document in LI Documents",
        go: () => crossNav("li", { type: "li-open", li }, "li/" + encodeURIComponent(li)) });
    });
    const seen = {};
    [].concat(rec.fins || [], rec.vins || []).forEach((id) => {
      const s = seriesOfId(id);
      if (!s || seen[s]) return;
      seen[s] = 1;
      chips.push({ label: "🗄️ LI docs · model " + s, title: "LI documents valid for model series " + s,
        go: () => crossNav("li", { type: "li-filter", model: s }, "li/model/" + s) });
      chips.push({ label: "🔧 Tools · model " + s, title: "Special tools valid for model series " + s,
        go: () => crossNav("inventory", { type: "inventory-filter", model: s }, "inventory/model/" + s) });
    });
    if (embedded) (rec.vins || []).forEach((v) => {
      chips.push({ label: "📌 Pin " + v.slice(-6), title: "Pin " + v + " as the active vehicle — every tab then scopes to this car",
        go: () => { try { window.parent.postMessage({ type: "shell-pin-vehicle", vin: v }, "*"); } catch (e) {} } });
    });
    $("#d-related-field").hidden = !chips.length;
    chips.forEach((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip chip--link";
      b.textContent = c.label;
      b.title = c.title;
      b.onclick = c.go;
      box.append(b);
    });
  }

  // ---------- Detail drawer ----------
  async function openDetail(id) {
    const rec = await DB.get(id);
    if (!rec) { toast("File not found."); return; }
    state.currentId = id;
    const meta = KINDS[rec.kind] || KINDS.other;
    $("#d-name").value = rec.name;
    $("#d-type").textContent = rec.type || "unknown";
    $("#d-size").textContent = fmtBytes(rec.size);
    $("#d-added").textContent = fmtDate(rec.createdAt);
    $("#d-collection").value = rec.collection || "";
    $("#d-tags").value = (rec.tags || []).join(", ");
    detailVinOrig = (rec.vins || []).join(", ");
    $("#d-vin").value = detailVinOrig;
    detailFinOrig = (rec.fins || []).join(", ");
    $("#d-fin").value = detailFinOrig;
    // Only surface the FIN field once a FIN has actually been found (or for a
    // non-video; videos are never scanned).
    $("#d-fin-field").hidden = !detailFinOrig && !!VIN_SKIP_KIND[rec.kind];
    $("#d-note").value = rec.note || "";
    const starBtn = $("#d-star");
    starBtn.textContent = rec.starred ? "★" : "☆";
    starBtn.classList.toggle("on", !!rec.starred);

    // "Send to LI" only makes sense for PDFs.
    $("#d-send-li").hidden = !(rec.kind === "pdf" && window.FDData);
    // "Send to Toolbox" only when a Toolbox tool exists for this file.
    $("#d-send-toolbox").hidden = !(window.FDData && toolboxTabFor(rec));
    // No VIN "Detect" for videos — the scan skips them too.
    $("#d-scan-vin").hidden = !!VIN_SKIP_KIND[rec.kind];

    renderRelated(rec);
    await renderPreview(rec, meta);

    const d = $("#detail");
    d.hidden = false;
    d.setAttribute("aria-hidden", "false");
    setTimeout(() => $("#d-name").blur(), 0);
  }

  async function renderPreview(rec, meta) {
    const box = $("#d-preview");
    releasePreviewUrls();
    box.innerHTML = "";
    // The preview URL must live on previewUrls ONLY (released when the
    // preview changes or the drawer closes) — objUrl() would put it in the
    // per-render objectUrls set, and the next list render() (auto VIN detect,
    // a bridge delivery, a star toggle) would revoke it while the PDF viewer
    // is still streaming the document → "Failed to load PDF document."
    const url = URL.createObjectURL(rec.blob);
    previewUrls.add(url);
    if (rec.kind === "image") {
      const img = document.createElement("img"); img.src = url; img.alt = rec.name; box.append(img);
    } else if (rec.kind === "video") {
      const v = document.createElement("video"); v.src = url; v.controls = true; v.preload = "metadata"; box.append(v);
    } else if (rec.kind === "audio") {
      const a = document.createElement("audio"); a.src = url; a.controls = true;
      const g = document.createElement("div"); g.className = "glyph-big"; g.textContent = "🎵";
      const wrap = document.createElement("div"); wrap.style.textAlign = "center";
      wrap.append(g, document.createElement("br"), a); box.append(wrap);
    } else if (rec.kind === "pdf") {
      const frame = document.createElement("iframe"); frame.src = url; frame.title = rec.name; box.append(frame);
    } else if (rec.kind === "text" && rec.size <= TEXT_PREVIEW_MAX) {
      try {
        const txt = await rec.blob.text();
        const pre = document.createElement("pre"); pre.textContent = txt; box.append(pre);
      } catch (e) { fallbackGlyph(box, meta); }
    } else {
      fallbackGlyph(box, meta);
    }
  }
  function fallbackGlyph(box, meta) {
    const g = document.createElement("div"); g.className = "glyph-big"; g.textContent = meta.glyph;
    box.append(g);
  }

  const previewUrls = new Set();
  function releasePreviewUrls() {
    previewUrls.forEach((u) => URL.revokeObjectURL(u));
    previewUrls.clear();
  }

  function closeDetail() {
    const d = $("#detail");
    d.hidden = true;
    d.setAttribute("aria-hidden", "true");
    releasePreviewUrls();
    state.currentId = null;
  }

  let detailVinOrig = "", detailFinOrig = "";
  async function saveDetail() {
    const id = state.currentId;
    if (!id) return;
    const tags = $("#d-tags").value.split(",").map((s) => s.trim()).filter(Boolean);
    const uniqueTags = Array.from(new Set(tags));
    const vins = Array.from(new Set($("#d-vin").value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)));
    const fins = Array.from(new Set($("#d-fin").value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)));
    const patch = {
      name: $("#d-name").value.trim() || "Untitled",
      collection: $("#d-collection").value.trim(),
      tags: uniqueTags,
      vins,
      fins,
      note: $("#d-note").value.trim(),
    };
    // A hand-edited VIN/FIN counts as scanned — the bulk scan won't overwrite it.
    if (vins.join(", ") !== detailVinOrig || fins.join(", ") !== detailFinOrig) patch.vinScan = Date.now();
    const merged = await DB.update(id, patch);
    const idx = items.findIndex((i) => i.id === id);
    if (idx >= 0) items[idx] = Object.assign(items[idx], patch, { updatedAt: merged.updatedAt });
    render();
    closeDetail();
    toast("Saved.");
  }

  async function deleteCurrent() {
    const id = state.currentId;
    if (!id) return;
    const rec = items.find((i) => i.id === id);
    const name = rec ? rec.name : "this file";
    if (!confirm(`Delete “${name}”? This can't be undone (the file is removed from the vault).`)) return;
    await DB.remove(id);
    items = items.filter((i) => i.id !== id);
    closeDetail();
    render();
    updateStorage();
    toast("Deleted “" + name + "”.");
  }

  async function toggleStar(id) {
    const it = items.find((i) => i.id === id);
    if (!it) return;
    it.starred = !it.starred;
    await DB.update(id, { starred: it.starred });
    render();
  }

  async function downloadCurrent() {
    const rec = await DB.get(state.currentId);
    if (!rec) return;
    const url = URL.createObjectURL(rec.blob);
    const a = document.createElement("a");
    a.href = url; a.download = rec.name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  async function openCurrent() {
    const rec = await DB.get(state.currentId);
    if (!rec) return;
    const url = URL.createObjectURL(rec.blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ---------- Cross-app: hand a PDF to the LI Database ----------
  async function sendCurrentToLI() {
    if (!window.FDData) { toast("LI Documents isn't available."); return; }
    const rec = await DB.get(state.currentId);
    if (!rec) return;
    if (rec.kind !== "pdf") { toast("Only PDFs can go to the LI Database."); return; }
    try {
      await FDData.jobs.enqueue("li-import", [rec.id], { source: "files" });
      closeDetail();
      // Ask the platform shell to switch to the LI app so the user sees it import.
      if (embedded) {
        try { window.parent.postMessage({ type: "shell-nav", app: "li" }, "*"); } catch (e) {}
      }
      toast("Sent to LI Database — it will read and file the PDF.");
    } catch (e) {
      console.error(e);
      toast("Couldn't send to the LI Database.");
    }
  }

  // ---------- Cross-app: hand a file to the Toolbox ----------
  // Map a record to the Toolbox tool tab that can handle it (null = none).
  function toolboxTabFor(rec) {
    if (rec.kind === "image" || rec.kind === "video") return "media";
    if (rec.kind === "pdf") return "pdf";
    const name = (rec.name || "").toLowerCase();
    if (name.endsWith(".csv")) return "csv";
    if (name.endsWith(".zip")) return "zip";
    return null;
  }
  // Only the media and PDF Toolbox tools accept a multi-file batch; the CSV
  // viewer and ZIP tool are strictly single-file, so a bulk send to them would
  // silently drop all but one file. Bulk is gated to these tabs; individual
  // sends from the detail drawer still work for every mapped type.
  const TOOLBOX_BULK_TABS = new Set(["media", "pdf"]);
  function supportsToolboxBulk(tab) { return TOOLBOX_BULK_TABS.has(tab); }
  async function sendCurrentToToolbox() {
    if (!window.FDData) { toast("The Toolbox isn't available."); return; }
    const rec = await DB.get(state.currentId);
    if (!rec) return;
    const tab = toolboxTabFor(rec);
    if (!tab) { toast("The Toolbox has no tool for this file type."); return; }
    try {
      await FDData.jobs.enqueue("toolbox-intake", [rec.id], { tab, keep: true });
      // Ask the platform shell to switch to the Toolbox on the right tool tab.
      if (embedded) {
        try { window.parent.postMessage({ type: "shell-nav", app: "toolbox", tab }, "*"); } catch (e) {}
      }
      closeDetail();
      toast("Sent to Toolbox.");
    } catch (e) {
      console.error(e);
      toast("Couldn't send to the Toolbox.");
    }
  }

  // ---------- Cross-context changes ----------
  // Files stored by another context (the shell's intake, the RO tab, LI
  // Documents, another tab) announce themselves on the bus; own writes have
  // already updated `items`, so only remote events reload the list.
  let _refreshT = null;
  function onFilesChanged(d) {
    if (!d.remote) return;
    clearTimeout(_refreshT);
    _refreshT = setTimeout(async () => {
      try {
        const fresh = await DB.listMeta();
        const flags = new Map(items.filter((x) => x._noThumb).map((x) => [x.id, true]));
        items = fresh.map((r) => { if (flags.has(r.id)) r._noThumb = true; return r; });
        if (state.currentId && !items.some((x) => x.id === state.currentId)) closeDetail();
        render();
        updateStorage();
      } catch (e) {}
    }, 150);
  }

  // ---------- Storage meter ----------
  async function updateStorage() {
    let used = 0, quota = 0;
    if (navigator.storage && navigator.storage.estimate) {
      try { const e = await navigator.storage.estimate(); used = e.usage || 0; quota = e.quota || 0; } catch (e) {}
    }
    const fill = $("#storage-fill");
    const text = $("#storage-text");
    if (quota) {
      const pct = Math.min(100, (used / quota) * 100);
      fill.style.width = pct.toFixed(1) + "%";
      text.textContent = `${fmtBytes(used)} used · ${fmtBytes(quota)} available`;
    } else {
      fill.style.width = "0%";
      text.textContent = `${fmtBytes(used)} used`;
    }
    const usage = $("#about-usage");
    if (usage) usage.textContent = `${items.length} files · ${fmtBytes(used)} stored${quota ? " of ~" + fmtBytes(quota) : ""}.`;
  }

  // ---------- Export / Import ----------
  // Backup format (v2): a small header + a JSON metadata block + the raw file
  // bytes concatenated. Built as a Blob assembled from parts, so it never holds
  // the whole (multi-GB) vault as one base64 string in memory — that overflowed
  // the JS string limit and crashed the tab on large vaults.
  const FVLT_MAGIC = [0x46, 0x56, 0x4c, 0x54]; // "FVLT"

  async function exportVault() {
    try {
      toast("Preparing backup…");
      const meta = { format: "file-vault", version: 2, exportedAt: Date.now(), files: [] };
      const parts = [];
      await DB.each((r) => {
        const blob = r.blob || null;
        const thumb = r.thumb || null;
        meta.files.push({
          id: r.id, name: r.name, type: r.type, kind: r.kind, size: r.size,
          tags: r.tags, collection: r.collection, note: r.note, starred: r.starred,
          vins: r.vins || [], fins: r.fins || [], vinScan: r.vinScan || 0,
          createdAt: r.createdAt, updatedAt: r.updatedAt,
          blobType: (blob && blob.type) || r.type || "application/octet-stream",
          blobLen: blob ? blob.size : 0,
          thumbType: thumb ? (thumb.type || "image/jpeg") : null,
          thumbLen: thumb ? thumb.size : 0,
        });
        if (blob) parts.push(blob);
        if (thumb) parts.push(thumb);
      });
      const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
      const header = new ArrayBuffer(12);
      const dv = new DataView(header);
      FVLT_MAGIC.forEach((b, i) => dv.setUint8(i, b));
      dv.setUint32(4, 2, true);                 // format version
      dv.setUint32(8, metaBytes.length, true);  // metadata byte length
      // The Blob constructor concatenates parts by reference (disk-backed) —
      // no giant string, no base64, safe for multi-GB vaults.
      const blob = new Blob([header, metaBytes, ...parts], { type: "application/octet-stream" });
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = URL.createObjectURL(blob);
      a.download = `file-vault-backup-${stamp}.fvault`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      toast(`Exported ${meta.files.length} files (${fmtBytes(blob.size)}).`);
    } catch (e) {
      console.error(e);
      toast("Export failed: " + (e && e.message ? e.message : "unknown error"));
    }
  }

  async function importVault(file) {
    try {
      toast("Reading backup…");
      const head = new DataView(await file.slice(0, 12).arrayBuffer());
      const isBinary = head.byteLength >= 12 && FVLT_MAGIC.every((b, i) => head.getUint8(i) === b);
      if (isBinary) return importBinary(file);
      return importLegacyJson(file); // older base64 JSON backups
    } catch (e) {
      console.error(e);
      toast("Import failed — the file may be corrupted.");
    }
  }

  async function importBinary(file) {
    // Validate the WHOLE file before touching the database: a truncated,
    // overrun, size-mismatched or trailing-garbage backup must be rejected
    // with nothing written, so a bad import can't leave a half-filled vault.
    let parsed;
    try {
      parsed = await window.FileVaultBackup.parseBinary(file);
    } catch (e) {
      console.error(e);
      toast(e && e.name === "BackupFormatError"
        ? "Import failed — the backup is invalid (" + e.code + ")."
        : "Import failed — the file may be corrupted.");
      return;
    }
    const existing = new Set(items.map((i) => i.id));
    let imported = 0;
    for (const en of parsed.entries) {
      const f = en.meta;
      const id = existing.has(f.id) ? uid() : f.id;
      const rec = {
        id, name: f.name, type: f.type, kind: f.kind || classify({ name: f.name, type: f.type }),
        size: f.size != null ? f.size : en.blob.size, blob: en.blob, thumb: en.thumb,
        tags: f.tags || [], collection: f.collection || "", note: f.note || "",
        vins: f.vins || [], fins: f.fins || [], vinScan: f.vinScan || 0,
        starred: !!f.starred, createdAt: f.createdAt || Date.now(), updatedAt: f.updatedAt || Date.now(),
      };
      rec.searchText = DB.buildSearchText(rec);
      await DB.put(rec);
      items.push(stripBlob(rec));
      imported++;
    }
    render();
    updateStorage();
    toast(`Imported ${imported} files.`);
  }

  async function importLegacyJson(file) {
    const data = JSON.parse(await file.text());
    if (!data || data.format !== "file-vault" || !Array.isArray(data.files)) {
      toast("That doesn't look like a File Vault backup."); return;
    }
    const existing = new Set(items.map((i) => i.id));
    let imported = 0;
    for (const f of data.files) {
      const blob = base64ToBlob(f.blob, f.blobType || f.type);
      const thumb = f.thumb ? base64ToBlob(f.thumb, "image/jpeg") : null;
      const id = existing.has(f.id) ? uid() : f.id;
      const rec = {
        id, name: f.name, type: f.type, kind: f.kind || classify({ name: f.name, type: f.type }),
        size: f.size != null ? f.size : blob.size, blob, thumb,
        tags: f.tags || [], collection: f.collection || "", note: f.note || "",
        vins: f.vins || [], fins: f.fins || [], vinScan: f.vinScan || 0,
        starred: !!f.starred, createdAt: f.createdAt || Date.now(), updatedAt: f.updatedAt || Date.now(),
      };
      rec.searchText = DB.buildSearchText(rec);
      await DB.put(rec);
      items.push(stripBlob(rec));
      imported++;
    }
    render();
    updateStorage();
    toast(`Imported ${imported} files.`);
  }

  function base64ToBlob(b64, type) {
    const bin = atob(b64 || "");
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: type || "application/octet-stream" });
  }

  // ---------- PWA install ----------
  let deferredPrompt = null;
  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Inside the platform shell the install story belongs to the shell.
    if (!isStandalone() && !embedded) $("#install-btn").hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    $("#install-btn").hidden = true;
    toast("Installed! Look for File Vault in your apps.");
  });

  async function triggerInstall() {
    if (isStandalone()) { toast("File Vault is already installed — you're running the app."); return; }
    if (deferredPrompt) {
      deferredPrompt.prompt();
      let outcome = "dismissed";
      try { ({ outcome } = await deferredPrompt.userChoice); } catch (e) {}
      deferredPrompt = null;
      if (outcome === "accepted") $("#install-btn").hidden = true;
      else toast("You can install anytime from here or the browser menu.");
      return;
    }
    // No prompt available yet (e.g. iOS/Safari, Firefox, or criteria not met).
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua)) {
      toast("On iPhone/iPad: tap the Share button, then “Add to Home Screen”.");
    } else if (/Firefox/.test(ua)) {
      toast("In Firefox: open the ⋯ menu and choose “Install” / “Add to Home screen”.");
    } else {
      toast("Use the browser menu (⋮) → “Install File Vault” / “Create shortcut”. If it's greyed out, reload once and try again.");
    }
  }

  // ---------- Theme ----------
  const THEMES = ["system", "light", "dark"];
  const THEME_LABEL = { system: "System theme", light: "Light theme", dark: "Dark theme" };
  let themeMode = "system";
  function effectiveDark() {
    if (themeMode === "dark") return true;
    if (themeMode === "light") return false;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function applyTheme() {
    const root = document.documentElement;
    if (themeMode === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", themeMode);
    // theme-color meta so the browser UI / titlebar matches
    const tc = document.querySelector('meta[name="theme-color"]');
    if (tc) tc.setAttribute("content", effectiveDark() ? "#16203a" : "#4f46e5");
    // swap the toggle icon
    const dark = effectiveDark();
    const di = document.querySelector(".theme-icon-dark");
    const li = document.querySelector(".theme-icon-light");
    if (di && li) { di.hidden = dark; li.hidden = !dark; }
    const btn = $("#theme-btn");
    if (btn) btn.title = THEME_LABEL[themeMode] + " (click to change)";
  }
  function persistTheme() {
    if (embedded) return; // the shell owns theme persistence while embedded
    DB.setMeta("theme", themeMode);
    try {
      if (themeMode === "system") localStorage.removeItem("fv-theme");
      else localStorage.setItem("fv-theme", themeMode);
    } catch (e) {}
  }
  function cycleTheme() {
    themeMode = THEMES[(THEMES.indexOf(themeMode) + 1) % THEMES.length];
    applyTheme();
    persistTheme();
    toast(THEME_LABEL[themeMode]);
  }

  // ---------- Drag & drop ----------
  // Embedded in the platform, files intake is unified: drops/pastes are handed
  // up to the shell's one router (which files LI docs to LI, the rest here).
  // Standalone, they're added locally.
  function intake(fileList) {
    const files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    if (embedded) {
      // Carry the open collection along, so a drop into "Taxes 2026" still
      // files there after the round-trip through the shell's router.
      const collection = state.filter.startsWith("collection:") ? state.filter.slice(11) : "";
      try { window.parent.postMessage({ type: "shell-add-files", files: files, collection: collection }, "*"); return; } catch (e) {}
    }
    addFiles(files);
  }
  let dragDepth = 0;
  function initDnD() {
    const overlay = $("#drop-overlay");
    window.addEventListener("dragenter", (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes("Files")) return;
      e.preventDefault(); dragDepth++; overlay.hidden = false;
    });
    window.addEventListener("dragover", (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) e.preventDefault(); });
    window.addEventListener("dragleave", (e) => { dragDepth = Math.max(0, dragDepth - 1); if (dragDepth === 0) overlay.hidden = true; });
    window.addEventListener("drop", (e) => {
      if (!e.dataTransfer) return;
      e.preventDefault(); dragDepth = 0; overlay.hidden = true;
      if (e.dataTransfer.files && e.dataTransfer.files.length) intake(e.dataTransfer.files);
    });
    // Paste files/images
    window.addEventListener("paste", (e) => {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
      if (files.length) { e.preventDefault(); intake(files); }
    });
  }

  // ---------- Sidebar (mobile) ----------
  function openSidebarMobile() { $("#sidebar").classList.add("open"); $("#sidebar-scrim").hidden = false; }
  function closeSidebarMobile() { $("#sidebar").classList.remove("open"); $("#sidebar-scrim").hidden = true; }

  // ---------- Event wiring ----------
  function wire() {
    wireBulkBar();
    // Embedded, the platform's top bar owns "Add files" (one front door), so
    // hide the vault's own button; the empty-state prompt opens that picker.
    if (embedded) $("#add-btn").hidden = true;
    $("#add-btn").onclick = () => $("#file-input").click();
    $("#empty-add").onclick = () => {
      if (embedded) { try { window.parent.postMessage({ type: "shell-open-picker" }, "*"); return; } catch (e) {} }
      $("#file-input").click();
    };
    $("#install-btn").onclick = triggerInstall;
    $("#theme-btn").onclick = cycleTheme;
    $("#file-input").onchange = (e) => { addFiles(e.target.files); e.target.value = ""; };
    $("#import-input").onchange = (e) => { if (e.target.files[0]) importVault(e.target.files[0]); e.target.value = ""; };

    // Search (debounced)
    let searchTimer;
    $("#search-input").addEventListener("input", (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.query = e.target.value.trim(); render(); }, 140);
    });

    $("#sort-select").onchange = (e) => { state.sort = e.target.value; render(); };
    $("#view-grid").onclick = () => setView("grid");
    $("#view-list").onclick = () => setView("list");

    $$("#nav-filters .nav__item").forEach((b) => { b.onclick = () => setFilter(b.dataset.filter); });

    // Detail drawer
    $$("#detail [data-close]").forEach((el) => { el.onclick = closeDetail; });
    $("#d-save").onclick = saveDetail;
    $("#d-delete").onclick = deleteCurrent;
    $("#d-download").onclick = downloadCurrent;
    $("#d-open").onclick = openCurrent;
    $("#d-send-li").onclick = sendCurrentToLI;
    $("#d-send-toolbox").onclick = sendCurrentToToolbox;
    $("#d-scan-vin").onclick = detectVinCurrent;
    $("#d-star").onclick = async () => {
      if (!state.currentId) return;
      await toggleStar(state.currentId);
      const it = items.find((i) => i.id === state.currentId);
      const b = $("#d-star"); b.textContent = it.starred ? "★" : "☆"; b.classList.toggle("on", it.starred);
    };

    // More menu
    const moreBtn = $("#more-btn"), moreMenu = $("#more-menu");
    moreBtn.onclick = (e) => { e.stopPropagation(); moreMenu.hidden = !moreMenu.hidden; };
    document.addEventListener("click", (e) => {
      if (!moreMenu.hidden && !moreMenu.contains(e.target) && e.target !== moreBtn) moreMenu.hidden = true;
    });
    moreMenu.querySelectorAll("button").forEach((b) => {
      b.onclick = (e) => { moreMenu.hidden = true; handleMenu(b.dataset.action, e); };
    });

    // New collection buttons
    $("#add-collection").onclick = newCollection;

    // Sidebar VIN rescan shortcut (Shift-click = rescan everything)
    $("#scan-vins-side").onclick = (e) => scanVins(!!e.shiftKey);

    // Mobile sidebar
    $("#menu-toggle").onclick = () => {
      const open = $("#sidebar").classList.contains("open");
      open ? closeSidebarMobile() : openSidebarMobile();
    };
    $("#sidebar-scrim").onclick = closeSidebarMobile;

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      // Alt+1–4 / Ctrl+K: platform-wide shortcuts — forward up to the shell.
      if (embedded && e.altKey && !e.ctrlKey && !e.metaKey && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        try { window.parent.postMessage({ type: "shell-switch", n: +e.key }, "*"); } catch (x) {}
        return;
      }
      if (embedded && (e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        try { window.parent.postMessage({ type: "shell-quickopen" }, "*"); } catch (x) {}
        return;
      }
      if (e.key === "Escape") {
        if (!$("#about").hidden) return hide($("#about"));
        if (!$("#detail").hidden) return closeDetail();
        if (!moreMenu.hidden) return (moreMenu.hidden = true);
        if (selection.size) return clearSelection();
      }
      const typing = document.activeElement && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName);
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") { e.preventDefault(); selectAllVisible(); return; }
      if (e.key === "/") { e.preventDefault(); $("#search-input").focus(); }
      else if (e.key.toLowerCase() === "a") {
        // Embedded, "add" goes through the platform's one front door (routing
        // + pinned-VIN tagging) — same as the hidden Add button would.
        if (embedded) { try { window.parent.postMessage({ type: "shell-open-picker" }, "*"); } catch (x) {} }
        else $("#file-input").click();
      }
      else if (e.key.toLowerCase() === "g") setView("grid");
      else if (e.key.toLowerCase() === "l") setView("list");
    });

    // Modal closers
    $$("#about [data-close]").forEach((el) => { el.onclick = () => hide($("#about")); });
  }

  function handleMenu(action, e) {
    if (action === "export") exportVault();
    else if (action === "import") $("#import-input").click();
    else if (action === "extract") {
      // Inside the platform, the viewer is the shell's Extract tab.
      if (embedded) { try { window.parent.postMessage({ type: "shell-nav", app: "viewer" }, "*"); } catch (x) {} }
      else window.open("../viewer.html");
    }
    else if (action === "new-collection") newCollection();
    else if (action === "scan-vins") scanVins(!!(e && e.shiftKey));
    else if (action === "sync-folder") runFolderSync(false);
    else if (action === "auto-sync") toggleAutoSync();
    else if (action === "persist") requestPersistence();
    else if (action === "debug") { if (window.FVDebug) window.FVDebug.open(); }
    else if (action === "about") { updateStorage(); $("#about").hidden = false; }
  }

  // ---------- Folder sync (import new/changed files from a linked folder) ----------
  // Link a folder once; the handle is stored (and restored on every launch).
  // "Sync a folder" scans it and imports anything new or changed; "Auto-sync"
  // repeats that scan on a timer (and on focus) while the app is open. Files
  // are matched by name + size + modified-time so nothing imports twice.
  let syncDir = null, syncAuto = false, syncTimer = null, syncing = false;
  const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

  function syncMenuLabels() {
    const s = $("#sync-action"), a = $("#autosync-action");
    if (s) s.textContent = syncDir ? "Scan “" + (syncDir.name || "folder") + "” now" : "Sync a folder…";
    if (a) a.textContent = "Auto-sync: " + (syncAuto ? "on" : "off");
  }

  async function pickSyncFolder() {
    if (!window.showDirectoryPicker) { toast("Folder sync needs Microsoft Edge or Chrome."); return null; }
    let h;
    try { h = await window.showDirectoryPicker({ id: "vault-sync", mode: "read" }); }
    catch (e) { return null; } // user cancelled the picker
    syncDir = h;
    try { await DB.setMeta("syncDir", h); } catch (e) {}
    syncMenuLabels();
    return h;
  }

  async function ensureSyncPerm(silent) {
    if (!syncDir) return false;
    const q = syncDir.queryPermission ? await syncDir.queryPermission({ mode: "read" }) : "granted";
    if (q === "granted") return true;
    if (silent) return false; // never prompt without a user gesture (auto path)
    const p = syncDir.requestPermission ? await syncDir.requestPermission({ mode: "read" }) : "denied";
    return p === "granted";
  }

  // Recursively gather file handles, bounded so a huge tree can't hang.
  async function collectFolderFiles(dir, out, depth) {
    out = out || []; depth = depth || 0;
    if (depth > 8 || out.length > 20000) return out;
    try {
      for await (const entry of dir.values()) {
        if (out.length > 20000) break;
        if (entry.kind === "file") out.push(entry);
        else if (entry.kind === "directory") { try { await collectFolderFiles(entry, out, depth + 1); } catch (e) {} }
      }
    } catch (e) {} // unreadable folder — keep what we have
    return out;
  }

  async function runFolderSync(quiet) {
    if (syncing) { if (!quiet) toast("A folder sync is already running…"); return; }
    if (!syncDir) { const h = await pickSyncFolder(); if (!h) return; }
    const ok = await ensureSyncPerm(quiet);
    if (!ok) { if (!quiet) toast("Couldn't read that folder — link it again."); return; }
    syncing = true;
    try {
      if (!quiet) toast("Scanning “" + (syncDir.name || "folder") + "”…");
      const handles = await collectFolderFiles(syncDir, []);
      // Build a name -> [{size, mtime}] index of what's already in the vault.
      // Read straight from the DB (not the in-memory list) so a second open
      // instance's imports are seen and files aren't imported twice.
      let existing = items;
      try { existing = await DB.listMeta(); } catch (e) {}
      const known = {};
      existing.forEach((it) => { (known[it.name] = known[it.name] || []).push({ size: it.size, mtime: it.srcMtime }); });
      const fresh = [];
      for (const fh of handles) {
        let f; try { f = await fh.getFile(); } catch (e) { continue; }
        const cand = known[f.name] || [];
        const dup = cand.some((k) => k.size === f.size && (k.mtime == null || k.mtime === (f.lastModified || 0)));
        if (!dup) fresh.push(f);
      }
      if (!fresh.length) { if (!quiet) toast("“" + (syncDir.name || "folder") + "” is up to date — nothing new."); return; }
      await syncImport(fresh, syncDir.name || "Synced");
    } catch (e) {
      console.error(e);
      if (!quiet) toast("Folder sync failed.");
    } finally { syncing = false; }
  }

  // Import synced files into a collection named after the folder, tracking the
  // source modified-time so a later scan won't re-import an unchanged file.
  // The intake does the eager read + verify (a cloud-placeholder or locked
  // source fails there, not silently as stored garbage).
  async function syncImport(files, collection) {
    let added = 0;
    for (const file of files) {
      const ids = await storeFiles([file], { collection, quiet: true, meta: { srcMtime: file.lastModified || 0, srcSync: true } });
      added += ids.length;
    }
    if (added) {
      if (!extraCollections.includes(collection)) { extraCollections.push(collection); DB.setMeta("collections", extraCollections); }
      render();
      updateStorage();
      toast("Synced " + added + " new file" + (added > 1 ? "s" : "") + " into “" + collection + "”.");
    }
  }

  function startAutoSync() {
    stopAutoSync();
    if (!syncAuto || !syncDir) return;
    syncTimer = setInterval(() => runFolderSync(true), SYNC_INTERVAL);
    // A prompt-free catch-up shortly after enabling / launching.
    setTimeout(() => runFolderSync(true), 1500);
  }
  function stopAutoSync() { if (syncTimer) { clearInterval(syncTimer); syncTimer = null; } }

  async function toggleAutoSync() {
    if (!syncDir) { const h = await pickSyncFolder(); if (!h) return; }
    syncAuto = !syncAuto;
    try { await DB.setMeta("syncAuto", syncAuto); } catch (e) {}
    syncMenuLabels();
    if (syncAuto) { startAutoSync(); toast("Auto-sync on — “" + (syncDir.name || "folder") + "” is checked every 5 minutes while the app is open."); }
    else { stopAutoSync(); toast("Auto-sync off."); }
  }

  async function resumeSync() {
    try {
      syncDir = (await DB.getMeta("syncDir", null)) || null;
      syncAuto = !!(await DB.getMeta("syncAuto", false));
    } catch (e) { syncDir = null; syncAuto = false; }
    syncMenuLabels();
    if (syncAuto && syncDir) startAutoSync();
    // Re-scan when the app regains attention (covers files added while away).
    window.addEventListener("focus", () => { if (syncAuto && syncDir) runFolderSync(true); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && syncAuto && syncDir) runFolderSync(true); });
  }

  // ---------- VIN scan & grouping ----------
  // Finds 17-character Vehicle Identification Numbers inside files so the
  // vault can group them by vehicle. Filenames and text files are read
  // directly, PDFs through the vendored pdf.js text layer, and images or
  // scanned (no-text-layer) PDFs through OCR — Tesseract.js, lazily loaded
  // from a CDN exactly like the LI app (overridable via window.__TESS_*).
  // The VIN / FIN classifier moved to ../src/core/vin.js (REWRITE-PLAN.md
  // Phase 1); the Repair Orders scanner shares it.
  const VIN_TEXT_MAX = FDCore.vin.VIN_TEXT_MAX, VIN_MAX_PER_FILE = FDCore.vin.VIN_MAX_PER_FILE, VIN_RICH_TEXT = FDCore.vin.VIN_RICH_TEXT;
  const findVinsDetailed = FDCore.vin.findVinsDetailed, findVins = FDCore.vin.findVins;

  // OCR engine (lazy, from a CDN — overridable via window.__TESS_*). The VIN
  // scan runs a POOL of Tesseract workers so several images / scanned PDFs are
  // recognized on different CPU cores at once. (Tesseract is WASM on the CPU —
  // there is no browser GPU OCR path, so multi-core is the win here.) Each scan
  // "lane" owns one worker for its lifetime and creates it only when it first
  // meets a file that actually needs OCR; the shared script load (loadTess)
  // means a blocked/offline engine fails once for every lane, not once per file.
  const POOL_MAX = window.__VIN_OCR_WORKERS ||
    Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, 4));
  let _tessLibP = null;
  function loadTess() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (_tessLibP) return _tessLibP;
    const CDN = "https://cdn.jsdelivr.net/npm";
    const lib = window.__TESS_LIB || (CDN + "/tesseract.js@5.1.1/dist/tesseract.min.js");
    _tessLibP = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = lib;
      s.onload = () => (window.Tesseract ? res(window.Tesseract) : rej(new Error("OCR init failed")));
      s.onerror = () => { _tessLibP = null; rej(new Error("OCR engine unavailable (needs internet once).")); };
      document.head.appendChild(s);
    });
    return _tessLibP;
  }
  // One worker per lane (ctx.worker), reused for every file that lane handles.
  // The call site wraps this in vinGuard so a hung load/create can't wedge.
  async function laneWorker(ctx) {
    if (ctx.worker) return ctx.worker;
    const T = await loadTess();
    const CDN = "https://cdn.jsdelivr.net/npm";
    ctx.worker = await T.createWorker("eng", 1, {
      workerPath: window.__TESS_WORK || (CDN + "/tesseract.js@5.1.1/dist/worker.min.js"),
      corePath: window.__TESS_CORE || (CDN + "/tesseract.js-core@5.1.0/tesseract-core-simd.wasm.js"),
      langPath: window.__TESS_LANG || "https://tessdata.projectnaptha.com/4.0.0",
    });
    return ctx.worker;
  }
  function laneFree(ctx) {
    const w = ctx && ctx.worker;
    if (ctx) ctx.worker = null;
    if (w) { try { w.terminate(); } catch (e) {} }
  }

  // OCR (network + recognition) is the only part of a scan that can stall.
  // Every OCR wait goes through vinGuard so it can NEVER wedge the app: it
  // resolves with the underlying promise, but rejects on its own after `ms`
  // OR the moment a running scan is cancelled. The underlying worker keeps
  // going in the background (its lane's worker is terminated) — we just stop waiting.
  const OCR_LOAD_MS = window.__VIN_OCR_LOAD_MS || 15000;       // cap for loading/creating the OCR engine
  const OCR_RECOGNIZE_MS = window.__VIN_OCR_RECOGNIZE_MS || 45000;  // cap for recognizing one image / page
  const OCR_ORIENT_MS = window.__VIN_OCR_ORIENT_MS || 45000;       // ...plus the which-way-up check, when one is needed
  function vinGuard(promise, ms) {
    return new Promise((resolve, reject) => {
      let done = false;
      const settle = (fn, v) => { if (done) return; done = true; clearTimeout(to); clearInterval(iv); fn(v); };
      const to = setTimeout(() => settle(reject, ocrErr("ocrSkip")), ms);
      const iv = setInterval(() => { if (vinCancel) settle(reject, ocrErr("ocrCancel")); }, 120);
      Promise.resolve(promise).then((v) => settle(resolve, v), (e) => settle(reject, e));
    });
  }
  // Tagged OCR errors so the scan can react: unavailable (engine won't load →
  // give up OCR for the rest of the run) vs skip (this one file) vs cancel.
  function ocrErr(kind) { const e = new Error(kind); e[kind] = true; return e; }

  // Recognize one page/image for VIN detection.
  //
  // Two things the raw engine gets wrong on workshop paperwork, both fixed in
  // ../ocr.js: it defaults to reading a page as ONE block of text, which loses
  // most of a datacard or an RO, and it has no idea when a page went through
  // the scanner sideways. So the read runs in document mode, and when it comes
  // back with no VIN in it the page is checked for which way up it is and read
  // again — a cost paid only by files that were going to be a miss anyway.
  //
  // Returns { text, angle }. `angle` lets later pages of the same document skip
  // the check; pass a known angle in to use it.
  async function ocrRead(w, src, soFar, knownAngle) {
    const orient = window.OcrOrient;
    // The helper needs something it can measure and turn. Without it — or when
    // the image couldn't be drawn onto a canvas — read the source as it is.
    if (!orient || !src || !src.width) {
      const r = await vinGuard(w.recognize(src), OCR_RECOGNIZE_MS);
      return { text: (r.data && r.data.text) || "", angle: 0 };
    }
    const opts = { readEdge: (s) => Math.max(s.width || 2200, s.height || 2200), cancelled: () => vinCancel };
    if (knownAngle) {
      const r = await vinGuard(orient.readAt(w, src, knownAngle, opts), OCR_RECOGNIZE_MS);
      return { text: r.text, angle: knownAngle };
    }
    const r = await vinGuard(orient.readSmart(w, src, Object.assign({
      accept: (t) => findVins((soFar || "") + "\n" + t, true).length > 0,
    }, opts)), OCR_RECOGNIZE_MS + OCR_ORIENT_MS);
    return { text: r.text, angle: r.angle };
  }

  // Draw an image blob onto a bounded canvas so huge photos OCR quickly.
  function blobToCanvas(blob, maxSide) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.width * scale));
          c.height = Math.max(1, Math.round(img.height * scale));
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url); resolve(c);
        } catch (e) { URL.revokeObjectURL(url); resolve(null); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  // Text of a PDF for VIN detection. The real text layer is used first — if it
  // (or the filename, `baseText`) already yields a VIN, that's it, NO OCR. OCR
  // is a fallback used only when the easy text has no VIN (it may sit inside a
  // scanned image/stamp) or there's no text layer at all. Broken/encrypted PDFs
  // come back empty (filename-only, still counted as scanned). When OCR is
  // needed but `allowOcr` is false or the engine won't load, it throws a tagged
  // ocrErr so the caller can leave the file to retry on a later (online) run.
  async function pdfVinText(blob, allowOcr, getWorker, baseText) {
    let doc = null;
    try {
      const lib = await ensurePdfjs();
      const buf = await blob.arrayBuffer();
      doc = await lib.getDocument({ data: buf, isEvalSupported: false, disableAutoFetch: true, disableStream: true }).promise;
    } catch (e) { return { text: "", ocr: false }; }
    try {
      let text = "";
      const pages = Math.min(doc.numPages, 10);
      for (let i = 1; i <= pages; i++) {
        try {
          const tc = await (await doc.getPage(i)).getTextContent();
          tc.items.forEach((it) => { text += (it.str || "") + " "; });
          text += "\n";
        } catch (e) { /* unreadable page — keep going */ }
      }
      const plain = text.replace(/\s+/g, "");
      // The searchable text (or filename) already exposes a VIN — trust it, no OCR.
      if (findVins((baseText || "") + "\n" + text, false).length) return { text, ocr: false };
      // A rich text layer with NO VIN means the document genuinely has none — do
      // NOT OCR it. OCR of ordinary prose only manufactures VIN-shaped noise
      // (e.g. a datasheet's "DRIVE APPLICATIONS" → "DR1VEAPPL1CAT10NS"). OCR is
      // reserved for SPARSE / scanned pages, where a VIN can hide inside an image.
      if (plain.length >= VIN_RICH_TEXT) return { text, ocr: false };
      // Sparse text and OCR unavailable: a page that had SOME text still counts
      // as scanned; a truly text-less page is left to retry OCR later.
      if (!allowOcr) {
        if (plain.length >= 40) return { text, ocr: false };
        throw ocrErr("ocrUnavailable");
      }
      let w;
      try { w = await getWorker(); }
      catch (e) { throw ocrErr(e && e.ocrCancel ? "ocrCancel" : "ocrUnavailable"); } // engine won't load — stop OCR for this run
      let out = "", ocrAngle = 0;
      const oPages = Math.min(doc.numPages, 3);
      for (let i = 1; i <= oPages; i++) {
        let canvas = null;
        try {
          const page = await doc.getPage(i);
          const unit = page.getViewport({ scale: 1 });
          const scale = Math.min(3, 1800 / Math.max(unit.width, 1));
          const vp = page.getViewport({ scale });
          canvas = document.createElement("canvas");
          canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
        } catch (e) { if (canvas) canvas.width = canvas.height = 0; continue; } // bad page render — skip it
        try {
          const page1 = i === 1;
          const got = await ocrRead(w, canvas, (baseText || "") + "\n" + text + "\n" + out, page1 ? null : ocrAngle);
          if (page1) ocrAngle = got.angle;
          out += got.text + "\n";
        } catch (e) {
          canvas.width = canvas.height = 0;
          throw ocrErr(e && e.ocrCancel ? "ocrCancel" : "ocrSkip"); // OCR stalled — leave this file for later
        }
        canvas.width = canvas.height = 0; // release the big canvas promptly
      }
      return { text: text + "\n" + out, ocr: true };
    } finally {
      try { doc.destroy(); } catch (e) {}
    }
  }

  // Gather everything worth searching for a VIN in one record. `fuzzy` marks
  // OCR-derived text so findVins() also tries the I/O/Q-corrected reading.
  // `allowOcr` gates the (slow, network-backed) OCR path for images and
  // scanned PDFs; when OCR is needed but unavailable this throws a tagged
  // ocrErr so the scan can skip the file and retry it later.
  async function extractVinText(rec, allowOcr, getWorker) {
    let text = rec.name || "", fuzzy = false;
    const nameLc = text.toLowerCase();
    if (rec.kind === "pdf") {
      const r = await pdfVinText(rec.blob, allowOcr, getWorker, rec.name || "");
      text += "\n" + r.text;
      fuzzy = r.ocr;
    } else if (rec.kind === "image") {
      if (!allowOcr) throw ocrErr("ocrUnavailable");
      let w;
      try { w = await getWorker(); }
      catch (e) { throw ocrErr(e && e.ocrCancel ? "ocrCancel" : "ocrUnavailable"); } // engine won't load — stop OCR for this run
      try {
        const cv = await blobToCanvas(rec.blob, 2200);
        const got = await ocrRead(w, cv || rec.blob, text);
        text += "\n" + got.text;
      } catch (e) {
        throw ocrErr(e && e.ocrCancel ? "ocrCancel" : "ocrSkip"); // OCR stalled — leave this file for later
      }
      fuzzy = true;
    } else if (rec.kind === "text" || /\.(csv|rtf)$/.test(nameLc)) {
      try { text += "\n" + (await rec.blob.slice(0, VIN_TEXT_MAX).text()); } catch (e) {}
    }
    return { text, fuzzy };
  }

  // Scan the whole vault (new/unscanned files only; force = everything).
  // Files are processed across up to POOL_MAX concurrent "lanes", so several
  // images / scanned PDFs OCR on different CPU cores at once — the big speed-up
  // for OCR-heavy vaults. The scan stays fully interruptible and can never
  // wedge: fast sources (filename, text/CSV, PDF text layer) always run, and
  // OCR — the only part that can stall — is time-boxed per file. If OCR proves
  // unavailable (the engine can't load, e.g. a locked-down/offline machine),
  // it's dropped for the rest of the run and those files are left unscanned to
  // retry later, instead of hanging on every one.
  let vinScanning = false, vinCancel = false, ocrGaveUp = false;
  // Kinds a VIN scan never touches — no readable VIN to extract (there's no
  // video-frame OCR here), and loading a big video blob just to skip it is
  // pure waste. Everything else (images, PDFs, text/CSV, filenames) is scanned.
  const VIN_SKIP_KIND = { video: true };
  async function scanVins(force) {
    if ((await FDData.jobs.listActive("vin-scan")).length) { toast("A VIN scan is already running…"); return; }
    const todo = items.filter((it) => !VIN_SKIP_KIND[it.kind] && (force || !it.vinScan)).map((it) => it.id);
    if (!todo.length) {
      toast("Every file has already been scanned for VINs. Shift-click the menu item to rescan everything.");
      return;
    }
    // A job: it resumes after a reload and runs in whichever tab holds the lock.
    await FDData.jobs.enqueue("vin-scan", todo, { force: !!force });
  }
  async function runVinScan(ids, force, ctl) {
    if (vinScanning) return;
    const todo = ids.map((id) => items.find((it) => it.id === id)).filter((it) => it && !VIN_SKIP_KIND[it.kind]);
    if (!todo.length) return { found: 0 };
    vinScanning = true; vinCancel = false; ocrGaveUp = false;
    const total = todo.length;
    let found = 0, done = 0, needOcr = 0, failed = 0, lastP = 0;
    const cancelled = () => vinCancel || (ctl && ctl.cancelled());
    const progress = () => {
      const t = Date.now();
      if (t - lastP < 150 && done < total) return; // throttle DOM churn on big vaults
      lastP = t;
      toast(`Scanning for VINs… ${done}/${total}`, "Stop", () => { vinCancel = true; });
      if (ctl) ctl.progress(done / total, done + "/" + total);
    };

    // Process one file using this lane's OCR worker (created on first need).
    async function handle(it, ctx) {
      done++; progress();
      let rec = null;
      try { rec = await DB.get(it.id); } catch (e) {}
      if (!rec || !rec.blob) return;
      let vins, fins;
      try {
        const getWorker = () => vinGuard(laneWorker(ctx), OCR_LOAD_MS);
        const r = await extractVinText(rec, !ocrGaveUp, getWorker);
        ({ vins, fins } = findVinsDetailed(r.text, r.fuzzy));
      } catch (e) {
        if (e && e.ocrCancel) return;                   // Stop pressed mid-OCR
        if (e && e.ocrUnavailable) { ocrGaveUp = true; needOcr++; return; } // engine down: skip OCR from here on
        if (e && e.ocrSkip) { needOcr++; return; }      // this file's OCR stalled — retry later
        failed++; return;                               // anything else — leave unscanned
      }
      // Union with what's already on the record (e.g. the pinned-vehicle tag
      // from the unified intake) — a scan that finds nothing must not wipe an
      // existing VIN. A forced full rescan (Shift-click) replaces.
      rec.vins = force ? vins : Array.from(new Set(vins.concat(rec.vins || [])));
      rec.fins = force ? fins : Array.from(new Set(fins.concat(rec.fins || [])));
      rec.vinScan = Date.now();
      rec.searchText = DB.buildSearchText(rec);
      try { await DB.put(rec); } catch (e) { return; }  // put, not update: preserves updatedAt
      it.vins = rec.vins; it.fins = rec.fins; it.vinScan = rec.vinScan;
      if (vins.length) found++;
    }

    // Work-stealing lanes share one queue; each keeps pulling the next file
    // until the queue drains or the scan is cancelled.
    let idx = 0;
    const nextItem = () => (idx < todo.length ? todo[idx++] : null);
    const lanes = Math.max(1, Math.min(POOL_MAX, total));
    async function lane() {
      const ctx = { worker: null }; // this lane's OCR worker
      try {
        let it;
        while (!cancelled() && (it = nextItem())) await handle(it, ctx);
      } finally { laneFree(ctx); }
    }
    try {
      const runners = [];
      for (let k = 0; k < lanes; k++) runners.push(lane());
      await Promise.all(runners);
    } finally {
      vinScanning = false;
    }
    render();
    let msg = `VIN scan ${cancelled() ? "stopped" : "finished"} — ${found} file${found === 1 ? "" : "s"} with a VIN`;
    if (needOcr) msg += ` · ${needOcr} need OCR (unavailable now — reconnect and scan again)`;
    if (failed) msg += ` · ${failed} unreadable`;
    toast(msg + ".");
    return { found, needOcr, failed, cancelled: cancelled() };
  }

  // Detail-drawer "Detect" button: scan just the open file and fill the field.
  async function detectVinCurrent() {
    const id = state.currentId;
    if (!id) return;
    const rec = await DB.get(id);
    if (!rec) return;
    const btn = $("#d-scan-vin");
    btn.disabled = true; btn.textContent = "Scanning…";
    const ctx = { worker: null }; // a private one-off OCR worker for this file
    try {
      const getWorker = () => vinGuard(laneWorker(ctx), OCR_LOAD_MS);
      const r = await extractVinText(rec, true, getWorker);
      const { vins, fins } = findVinsDetailed(r.text, r.fuzzy);
      const merge = (sel, add) => {
        const have = $(sel).value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
        $(sel).value = Array.from(new Set(have.concat(add))).join(", ");
      };
      merge("#d-vin", vins);
      if (fins.length) { merge("#d-fin", fins); $("#d-fin-field").hidden = false; }
      toast(vins.length ? `Found ${vins.length} VIN${vins.length > 1 ? "s" : ""}${fins.length ? " + " + fins.length + " FIN" : ""} — Save to keep.`
        : (fins.length ? `Found a FIN (datacard number) but no VIN — Save to keep.` : "No VIN found in this file."));
    } catch (e) {
      toast((e && (e.ocrUnavailable || e.ocrSkip || e.ocrCancel))
        ? "Couldn't run OCR on this file — it needs an internet connection the first time."
        : "Couldn't read this file.");
    } finally {
      btn.disabled = false; btn.textContent = "Detect";
      laneFree(ctx);
    }
  }

  function newCollection() {
    const name = prompt("Name the new collection:");
    if (!name) return;
    const clean = name.trim();
    if (!clean) return;
    if (!extraCollections.includes(clean)) extraCollections.push(clean);
    DB.setMeta("collections", extraCollections);
    setFilter("collection:" + clean);
    toast(`Collection “${clean}” created. Add files or drag them here to fill it.`);
  }

  // Move every file in one collection to another name — used by the Repair
  // Orders app when an RO number is edited, so its files stay linked. Rebuilds
  // searchText through DB.put so the rename is done DB-safely (not a raw write).

  // ---- "Add to RO" import mode (driven from the Repair Orders tab) ----
  // The RO tab sends us here so files are picked with the normal vault screen
  // and its multi-select, then transferred with one button.
  let roImport = null;
  function enterRoImport(d) {
    roImport = {
      coll: String(d.coll || ""),
      vin: d.vin ? String(d.vin).toUpperCase() : "",
      roNo: String(d.roNo || ""),
      roId: String(d.roId || ""),
    };
    clearSelection();
    $("#search-input").value = ""; state.query = "";
    setFilter("all"); // clean slate to pick from
    const b = $("#ro-import-banner");
    if (b) {
      b.hidden = false;
      $("#ro-import-label").textContent = "Importing to RO " + (roImport.roNo || "") + " — select files, then ➕ Add to RO.";
    }
    renderBulkBar();
  }
  function exitRoImport() {
    roImport = null;
    const b = $("#ro-import-banner"); if (b) b.hidden = true;
    renderBulkBar();
  }
  async function importSelectionToRo() {
    if (!roImport) return;
    const target = roImport;
    const sel = items.filter((it) => selection.has(it.id));
    if (!sel.length) { toast("Select some files first."); return; }
    const roVin = target.vin;
    const noVin = [], match = [], mismatch = [];
    sel.forEach((it) => {
      const v = it.vins || [];
      if (!v.length) noVin.push(it);
      else if (roVin && v.includes(roVin)) match.push(it);
      else if (roVin) mismatch.push(it);
      else match.push(it);
    });
    let keep = noVin.concat(match);
    if (mismatch.length && roVin) {
      const addAnyway = confirm(mismatch.length + " selected file(s) have a different VIN than RO " + target.roNo + ".\n\nOK = add them anyway (their own VIN is kept)\nCancel = skip those files");
      if (addAnyway) keep = keep.concat(mismatch);
    } else if (mismatch.length) {
      keep = keep.concat(mismatch);
    }
    let moved = 0;
    for (const it of keep) {
      const rec = await DB.get(it.id);
      if (!rec) continue;
      rec.collection = target.coll;
      if (!(rec.vins && rec.vins.length) && roVin) { rec.vins = Array.from(new Set([roVin].concat(rec.vins || []))); rec.vinScan = Date.now(); } // auto-fill VIN
      rec.updatedAt = Date.now();
      rec.searchText = DB.buildSearchText(rec);
      await DB.put(rec);
      if (target.roId) { try { await FDData.repos.links.link("ro", target.roId, "file", it.id, "attachment"); } catch (e) {} }
      const i = items.findIndex((x) => x.id === it.id);
      if (i !== -1) items[i] = stripBlob(rec);
      moved++;
    }
    if (target.coll && !extraCollections.includes(target.coll)) { extraCollections.push(target.coll); DB.setMeta("collections", extraCollections); }
    clearSelection();
    exitRoImport();
    $("#search-input").value = ""; state.query = ""; // don't leave the pick search lingering
    render();
    updateStorage();
    toast("Added " + moved + " file(s) to RO " + (target.roNo || "") + ".");
    // Go back to the repair order we imported to.
    if (embedded) { try { window.parent.postMessage({ type: "shell-nav", app: "ros", payload: { type: "shell-nav", id: target.roId } }, "*"); } catch (e) {} }
  }

  async function requestPersistence() {
    if (navigator.storage && navigator.storage.persist) {
      const granted = await navigator.storage.persist();
      toast(granted
        ? "Persistent storage granted — your vault is protected from automatic cleanup."
        : "The browser declined persistent storage, but your data is still saved.");
    } else {
      toast("This browser doesn't support the persistence request.");
    }
    updateStorage();
  }

  function setView(v) {
    state.view = v;
    $("#view-grid").classList.toggle("is-active", v === "grid");
    $("#view-list").classList.toggle("is-active", v === "list");
    DB.setMeta("view", v);
    render();
  }

  // ---------- Boot ----------
  async function boot() {
    await FDData.boot();
    wire();
    initDnD();
    // restore prefs
    try {
      // The shared localStorage "fv-theme" key is the platform-wide choice
      // (the shell writes it). Prefer it when set — embedded OR standalone —
      // so opening the vault directly never reverts/clobbers the theme picked
      // in the shell. The vault's own DB meta is the fallback for old
      // standalone installs that predate the key.
      let t = null;
      try { t = localStorage.getItem("fv-theme"); } catch (e) {}
      if (t === "light" || t === "dark") themeMode = t;
      else if (!embedded) themeMode = (await DB.getMeta("theme", "system")) || "system";
      else themeMode = "system";
      if (!THEMES.includes(themeMode)) themeMode = "system";
      applyTheme();
      persistTheme();
      const v = await DB.getMeta("view", "grid");
      state.view = v;
      $("#view-grid").classList.toggle("is-active", v === "grid");
      $("#view-list").classList.toggle("is-active", v === "list");
      extraCollections = (await DB.getMeta("collections", [])) || [];
    } catch (e) {}

    // Keep in sync with the OS when following "System".
    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if (themeMode === "system") applyTheme();
      });
    }

    // Already-installed app: hide the Install button.
    if (isStandalone()) $("#install-btn").hidden = true;

    items = await DB.listMeta();
    render();
    updateStorage();

    // Files stored by other contexts announce themselves on the bus.
    FDData.bus.on("files:changed", onFilesChanged);
    // The follow-up work for new files runs here as jobs (it needs this
    // page's PDF renderer and OCR pool) and resumes after a reload.
    FDData.jobs.register("thumb", thumbJob);
    FDData.jobs.register("vin-detect", vinDetectJob);
    FDData.jobs.register("vin-scan", (job, ctl) => runVinScan(job.inputIds, !!(job.meta && job.meta.force), ctl));
    // Follow the platform shell's theme (the shell persists the choice).
    window.addEventListener("message", (e) => {
      const d = e.data || {};
      if (d && d.type === "platform-theme" && THEMES.includes(d.mode)) {
        themeMode = d.mode;
        applyTheme();
      }
    });

    // Restore a linked sync folder + resume auto-sync if it was on.
    resumeSync();

    // Cross-app navigation (now that data is loaded): apply, then drain any
    // messages that arrived during boot.
    onShellNav = (d) => {
      if (d.type === "vault-filter" && d.filter) { $("#search-input").value = ""; state.query = ""; setFilter(String(d.filter)); }
      else if (d.type === "vault-search" && d.q != null) {
        $("#search-input").value = String(d.q);
        state.query = String(d.q).trim();
        render();
      } else if (d.type === "vault-restore" && d.file) importVault(d.file);
      else if (d.type === "platform-backup") exportVault();
      else if (d.type === "vault-ro-import") enterRoImport(d);
    };
    shellNavQueue.splice(0).forEach(onShellNav);

    // URL actions (from PWA shortcuts)
    const params = new URLSearchParams(location.search);
    if (params.get("view") === "starred") setFilter("starred");
    if (params.get("action") === "add") setTimeout(() => $("#file-input").click(), 300);

    // Service worker for offline + seamless updates.
    if ("serviceWorker" in navigator) {
      try {
        const hadController = !!navigator.serviceWorker.controller;
        let reloading = false;
        // When a freshly-activated worker takes control, reload once so the
        // page runs the new code (skips the first install to avoid a needless
        // reload on the user's very first visit).
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (!hadController || reloading) return;
          reloading = true;
          location.reload();
        });
        const reg = await navigator.serviceWorker.register("sw.js");
        reg.addEventListener("updatefound", () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener("statechange", () => {
            if (sw.state === "installed" && navigator.serviceWorker.controller) {
              toast("Update installed — refreshing…");
            }
          });
        });
        reg.update && reg.update().catch(() => {});
      } catch (e) { /* file:// or blocked */ }
    }
  }

  // Spell-check every text field, including ones created after load —
  // flipping the flag at focus time covers them all without touching each
  // creation site.
  document.addEventListener("focusin", (e) => {
    const t = e.target;
    if (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && (t.type === "text" || t.type === "search"))) t.spellcheck = true;
  });

  document.addEventListener("DOMContentLoaded", boot);
})();
