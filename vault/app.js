/*
 * app.js — File Vault application logic.
 *
 * A dependency-free, offline-first personal file database. All state lives in
 * IndexedDB (see db.js). This file wires up the UI: importing files, generating
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

  // ---- In-memory index of metadata (no blobs) for fast rendering ----
  let items = [];               // array of meta records
  const objectUrls = new Set(); // track for revocation

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
        const lib = window.pdfjsLib;
        if (!lib) { reject(new Error("pdf.js unavailable")); return; }
        try { lib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js"; } catch (e) {}
        _pdfjs = lib; resolve(lib);
      };
      s.onerror = () => { _pdfjsLoading = null; reject(new Error("pdf.js failed to load")); };
      document.head.appendChild(s);
    });
    return _pdfjsLoading;
  }
  async function makePdfThumb(file) {
    const lib = await ensurePdfjs();
    const buf = await file.arrayBuffer();
    const doc = await lib.getDocument({ data: buf, disableAutoFetch: true, disableStream: true }).promise;
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

  // Generate missing previews for PDFs already in the vault, gently in the
  // background: one at a time, persisted as we go (without touching updatedAt
  // so nothing jumps in "Recent"), and drawn into any card on screen.
  let _thumbRunning = false, _thumbT = null;
  function scheduleThumbBackfill() {
    if (_thumbRunning) return;
    clearTimeout(_thumbT);
    _thumbT = setTimeout(runThumbBackfill, 400);
  }
  async function runThumbBackfill() {
    if (_thumbRunning) return;
    const pending = items.filter((it) => it.kind === "pdf" && !it.thumb && !it._noThumb).map((it) => it.id);
    if (!pending.length) return;
    _thumbRunning = true;
    try {
      for (const id of pending) {
        const it = items.find((x) => x.id === id);
        if (!it || it.thumb || it._noThumb) continue;
        let rec = null;
        try { rec = await DB.get(id); } catch (e) {}
        if (!rec || !rec.blob) { it._noThumb = true; continue; }
        if (rec.thumb) { it.thumb = rec.thumb; refreshCardThumb(id, rec.thumb); continue; }
        let thumb = null;
        try { thumb = await makePdfThumb(rec.blob); } catch (e) {}
        if (!thumb) { it._noThumb = true; continue; } // encrypted / broken — keep the icon
        rec.thumb = thumb;
        try { await DB.put(rec); } catch (e) {} // put, not update: preserves updatedAt
        it.thumb = thumb;
        refreshCardThumb(id, thumb);
        await new Promise((r) => setTimeout(r, 25)); // breathe between pages
      }
    } finally { _thumbRunning = false; }
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
  async function addFiles(fileList) {
    const files = Array.from(fileList).filter(Boolean);
    if (!files.length) return;
    const collection = state.filter.startsWith("collection:") ? state.filter.slice(11) : "";
    let added = 0;
    toast(`Adding ${files.length} file${files.length > 1 ? "s" : ""}…`);
    for (const file of files) {
      const kind = classify(file);
      const thumb = await makeThumb(file, kind);
      const now = Date.now();
      const record = {
        id: uid(),
        name: file.name || "Untitled",
        type: file.type || "application/octet-stream",
        kind,
        size: file.size,
        blob: file,
        thumb,
        tags: [],
        collection,
        note: "",
        starred: false,
        createdAt: now,
        updatedAt: now,
      };
      record.searchText = DB.buildSearchText(record);
      try {
        await DB.put(record);
        items.push(stripBlob(record));
        added++;
      } catch (e) {
        console.error(e);
        toast("Couldn't save “" + file.name + "”. Storage may be full.");
      }
    }
    render();
    updateStorage();
    if (added) toast(`Added ${added} file${added > 1 ? "s" : ""}${collection ? " to " + collection : ""}.`);
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
        [i.name, i.collection, i.note, (i.tags || []).join(" "), (i.vins || []).join(" ")].join(" ").toLowerCase().includes(q));
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
        head.innerHTML = `<span class="group-head__icon">🚗</span><span class="group-head__vin">${esc(v)}</span><span class="group-head__count">${groups.get(v).length}</span>`;
        head.title = "Show only " + v;
        head.onclick = () => setFilter("vin:" + v);
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
    scheduleThumbBackfill(); // fill in any missing PDF previews in the background
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
    const vins = it.vins || [];
    if ((it.tags && it.tags.length) || vins.length) {
      const tw = document.createElement("div");
      tw.className = "card__tags";
      vins.slice(0, 2).forEach((v) => {
        const s = document.createElement("span");
        s.className = "tag tag--vin"; s.textContent = v; s.title = "VIN";
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
    card.onclick = () => openDetail(it.id);
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
    (it.tags || []).slice(0, 3).forEach((t) => {
      const s = document.createElement("span");
      s.className = "tag"; s.textContent = t;
      tags.append(s);
    });

    const size = document.createElement("div");
    size.className = "row__size";
    size.textContent = fmtBytes(it.size);

    row.append(star, icon, name, type, coll, tags, size);
    row.onclick = () => openDetail(it.id);
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
    $("#d-note").value = rec.note || "";
    const starBtn = $("#d-star");
    starBtn.textContent = rec.starred ? "★" : "☆";
    starBtn.classList.toggle("on", !!rec.starred);

    // "Send to LI" only makes sense for PDFs.
    $("#d-send-li").hidden = !(rec.kind === "pdf" && window.VaultBridge);
    // "Send to Toolbox" only when a Toolbox tool exists for this file.
    $("#d-send-toolbox").hidden = !(window.VaultBridge && toolboxTabFor(rec));

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
    const url = objUrl(rec.blob);
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
  function releasePreviewUrls() { previewUrls.forEach((u) => URL.revokeObjectURL(u)); previewUrls.clear(); }

  function closeDetail() {
    const d = $("#detail");
    d.hidden = true;
    d.setAttribute("aria-hidden", "true");
    releasePreviewUrls();
    state.currentId = null;
  }

  let detailVinOrig = "";
  async function saveDetail() {
    const id = state.currentId;
    if (!id) return;
    const tags = $("#d-tags").value.split(",").map((s) => s.trim()).filter(Boolean);
    const uniqueTags = Array.from(new Set(tags));
    const vins = Array.from(new Set($("#d-vin").value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)));
    const patch = {
      name: $("#d-name").value.trim() || "Untitled",
      collection: $("#d-collection").value.trim(),
      tags: uniqueTags,
      vins,
      note: $("#d-note").value.trim(),
    };
    // A hand-edited VIN counts as scanned — the bulk scan won't overwrite it.
    if (vins.join(", ") !== detailVinOrig) patch.vinScan = Date.now();
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
    if (!window.VaultBridge) { toast("The LI bridge isn't available."); return; }
    const rec = await DB.get(state.currentId);
    if (!rec) return;
    if (rec.kind !== "pdf") { toast("Only PDFs can go to the LI Database."); return; }
    try {
      await window.VaultBridge.send("li", { name: rec.name, type: rec.type || "application/pdf", blob: rec.blob });
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
  async function sendCurrentToToolbox() {
    if (!window.VaultBridge) { toast("The Toolbox bridge isn't available."); return; }
    const rec = await DB.get(state.currentId);
    if (!rec) return;
    const tab = toolboxTabFor(rec);
    if (!tab) { toast("The Toolbox has no tool for this file type."); return; }
    try {
      await window.VaultBridge.send("toolbox", { name: rec.name, type: rec.type, blob: rec.blob, meta: { tab } });
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

  // ---------- Cross-app: receive a file handed over from another app ----------
  const LI_COLLECTION = "LI Documents";
  async function addIncomingFile(item) {
    const blob = item.blob;
    const name = item.name || "document.pdf";
    const file = new File([blob], name, { type: item.type || blob.type || "application/pdf" });
    const kind = classify(file);
    const thumb = await makeThumb(file, kind);
    const now = Date.now();
    const m = item.meta || {};
    const collection = m.collection || LI_COLLECTION;
    const tags = [];
    if (m.li) tags.push(m.li);
    if (m.fgroup) tags.push(m.fgroup);
    (m.modelSeries || []).forEach && (m.modelSeries || []).forEach((s) => tags.push("Model " + s));
    const record = {
      id: uid(),
      name,
      type: file.type,
      kind,
      size: file.size,
      blob: file,
      thumb,
      tags: Array.from(new Set(tags)),
      collection,
      note: m.title ? ("LI: " + m.title) : "",
      starred: false,
      createdAt: now,
      updatedAt: now,
    };
    record.searchText = DB.buildSearchText(record);
    await DB.put(record);
    items.push(stripBlob(record));
    render();
    updateStorage();
    toast('Added “' + name + '” to File Vault (' + collection + ').');
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
  async function exportVault() {
    toast("Preparing backup…");
    const records = [];
    await DB.each((r) => records.push(r));
    // Build a JSON container with base64 blobs. Simple and portable.
    const out = { format: "file-vault", version: 1, exportedAt: Date.now(), files: [] };
    for (const r of records) {
      const b64 = await blobToBase64(r.blob);
      const thumb64 = r.thumb ? await blobToBase64(r.thumb) : null;
      out.files.push({
        id: r.id, name: r.name, type: r.type, kind: r.kind, size: r.size,
        tags: r.tags, collection: r.collection, note: r.note, starred: r.starred,
        vins: r.vins || [], vinScan: r.vinScan || 0,
        createdAt: r.createdAt, updatedAt: r.updatedAt,
        blob: b64, blobType: r.blob.type, thumb: thumb64,
      });
    }
    const json = JSON.stringify(out);
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = URL.createObjectURL(blob);
    a.download = `file-vault-backup-${stamp}.fvault`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`Exported ${out.files.length} files.`);
  }

  async function importVault(file) {
    try {
      toast("Reading backup…");
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || data.format !== "file-vault" || !Array.isArray(data.files)) {
        toast("That doesn't look like a File Vault backup.");
        return;
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
          vins: f.vins || [], vinScan: f.vinScan || 0,
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
    } catch (e) {
      console.error(e);
      toast("Import failed — the file may be corrupted.");
    }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1] || "");
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
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
      if (e.dataTransfer.files && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    });
    // Paste files/images
    window.addEventListener("paste", (e) => {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
      if (files.length) { e.preventDefault(); addFiles(files); }
    });
  }

  // ---------- Sidebar (mobile) ----------
  function openSidebarMobile() { $("#sidebar").classList.add("open"); $("#sidebar-scrim").hidden = false; }
  function closeSidebarMobile() { $("#sidebar").classList.remove("open"); $("#sidebar-scrim").hidden = true; }

  // ---------- Event wiring ----------
  function wire() {
    $("#add-btn").onclick = () => $("#file-input").click();
    $("#empty-add").onclick = () => $("#file-input").click();
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
      if (e.key === "Escape") {
        if (!$("#about").hidden) return hide($("#about"));
        if (!$("#detail").hidden) return closeDetail();
        if (!moreMenu.hidden) return (moreMenu.hidden = true);
      }
      const typing = document.activeElement && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName);
      if (typing) return;
      if (e.key === "/") { e.preventDefault(); $("#search-input").focus(); }
      else if (e.key.toLowerCase() === "a") { $("#file-input").click(); }
      else if (e.key.toLowerCase() === "g") setView("grid");
      else if (e.key.toLowerCase() === "l") setView("list");
    });

    // Modal closers
    $$("#about [data-close]").forEach((el) => { el.onclick = () => hide($("#about")); });
  }

  function handleMenu(action, e) {
    if (action === "export") exportVault();
    else if (action === "import") $("#import-input").click();
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
  async function syncImport(files, collection) {
    let added = 0;
    for (const file of files) {
      const kind = classify(file);
      let thumb = null; try { thumb = await makeThumb(file, kind); } catch (e) {}
      const now = Date.now();
      const record = {
        id: uid(),
        name: file.name || "Untitled",
        type: file.type || "application/octet-stream",
        kind, size: file.size, blob: file, thumb,
        tags: [], collection, note: "", starred: false,
        createdAt: now, updatedAt: now,
        srcMtime: file.lastModified || 0, srcSync: true,
      };
      record.searchText = DB.buildSearchText(record);
      try { await DB.put(record); items.push(stripBlob(record)); added++; }
      catch (e) { console.error(e); }
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
  const VIN_TEXT_MAX = 1024 * 1024; // read at most 1 MB of a text file
  const VIN_MAX_PER_FILE = 8;

  // A VIN is 17 chars from [A-HJ-NPR-Z0-9] (I, O and Q are never used). The
  // lookarounds stop matches inside longer alphanumeric runs (hashes, IDs).
  function findVins(text, fuzzy) {
    const out = new Set();
    if (!text) return [];
    const scan = (t) => {
      const re = /(?<![A-Z0-9])[A-HJ-NPR-Z0-9]{17}(?![A-Z0-9])/g;
      let m;
      while ((m = re.exec(t)) && out.size < VIN_MAX_PER_FILE) {
        const v = m[0];
        const digits = (v.match(/\d/g) || []).length;
        // Real VINs mix letters and digits — this rejects 17-letter words
        // and bare 17-digit numbers.
        if (digits >= 2 && 17 - digits >= 2) out.add(v);
      }
    };
    const up = text.toUpperCase();
    scan(up);
    if (fuzzy) {
      // OCR often misreads 1/0 as I/O/Q. Those letters never occur in a VIN,
      // so normalizing them inside candidate runs recovers the real number.
      scan(up.replace(/(?<![A-Z0-9])[A-Z0-9]{17}(?![A-Z0-9])/g,
        (run) => run.replace(/I/g, "1").replace(/[OQ]/g, "0")));
    }
    return Array.from(out);
  }

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

  // Text of a PDF: the real text layer when it has one, OCR of the first
  // pages otherwise. Broken/encrypted PDFs come back empty (filename-only, so
  // they still count as scanned). When a scanned PDF needs OCR but `allowOcr`
  // is false, or the engine won't load, it throws a tagged ocrErr so the
  // caller leaves the file unscanned and retries it on a later (online) run.
  async function pdfVinText(blob, allowOcr, getWorker) {
    let doc = null;
    try {
      const lib = await ensurePdfjs();
      const buf = await blob.arrayBuffer();
      doc = await lib.getDocument({ data: buf, disableAutoFetch: true, disableStream: true }).promise;
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
      if (text.replace(/\s+/g, "").length >= 40) return { text, ocr: false };
      // No real text layer — a scanned document. OCR is needed.
      if (!allowOcr) throw ocrErr("ocrUnavailable");
      let w;
      try { w = await getWorker(); }
      catch (e) { throw ocrErr(e && e.ocrCancel ? "ocrCancel" : "ocrUnavailable"); } // engine won't load — stop OCR for this run
      let out = "";
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
          const r = await vinGuard(w.recognize(canvas), OCR_RECOGNIZE_MS);
          out += ((r.data && r.data.text) || "") + "\n";
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
      const r = await pdfVinText(rec.blob, allowOcr, getWorker);
      text += "\n" + r.text;
      fuzzy = r.ocr;
    } else if (rec.kind === "image") {
      if (!allowOcr) throw ocrErr("ocrUnavailable");
      let w;
      try { w = await getWorker(); }
      catch (e) { throw ocrErr(e && e.ocrCancel ? "ocrCancel" : "ocrUnavailable"); } // engine won't load — stop OCR for this run
      try {
        const cv = await blobToCanvas(rec.blob, 2200);
        const r = await vinGuard(w.recognize(cv || rec.blob), OCR_RECOGNIZE_MS);
        text += "\n" + ((r.data && r.data.text) || "");
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
  async function scanVins(force) {
    if (vinScanning) { toast("A VIN scan is already running…"); return; }
    const todo = items.filter((it) => force || !it.vinScan);
    if (!todo.length) {
      toast("Every file has already been scanned for VINs. Shift-click the menu item to rescan everything.");
      return;
    }
    vinScanning = true; vinCancel = false; ocrGaveUp = false;
    const total = todo.length;
    let found = 0, done = 0, needOcr = 0, failed = 0, lastP = 0;
    const progress = () => {
      const t = Date.now();
      if (t - lastP < 150 && done < total) return; // throttle DOM churn on big vaults
      lastP = t;
      toast(`Scanning for VINs… ${done}/${total}`, "Stop", () => { vinCancel = true; });
    };

    // Process one file using this lane's OCR worker (created on first need).
    async function handle(it, ctx) {
      done++; progress();
      let rec = null;
      try { rec = await DB.get(it.id); } catch (e) {}
      if (!rec || !rec.blob) return;
      let vins;
      try {
        const getWorker = () => vinGuard(laneWorker(ctx), OCR_LOAD_MS);
        const r = await extractVinText(rec, !ocrGaveUp, getWorker);
        vins = findVins(r.text, r.fuzzy);
      } catch (e) {
        if (e && e.ocrCancel) return;                   // Stop pressed mid-OCR
        if (e && e.ocrUnavailable) { ocrGaveUp = true; needOcr++; return; } // engine down: skip OCR from here on
        if (e && e.ocrSkip) { needOcr++; return; }      // this file's OCR stalled — retry later
        failed++; return;                               // anything else — leave unscanned
      }
      rec.vins = vins;
      rec.vinScan = Date.now();
      rec.searchText = DB.buildSearchText(rec);
      try { await DB.put(rec); } catch (e) { return; }  // put, not update: preserves updatedAt
      it.vins = vins; it.vinScan = rec.vinScan;
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
        while (!vinCancel && (it = nextItem())) await handle(it, ctx);
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
    let msg = `VIN scan ${vinCancel ? "stopped" : "finished"} — ${found} file${found === 1 ? "" : "s"} with a VIN`;
    if (needOcr) msg += ` · ${needOcr} need OCR (unavailable now — reconnect and scan again)`;
    if (failed) msg += ` · ${failed} unreadable`;
    toast(msg + ".");
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
      const vins = findVins(r.text, r.fuzzy);
      const existing = $("#d-vin").value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
      $("#d-vin").value = Array.from(new Set(existing.concat(vins))).join(", ");
      toast(vins.length ? `Found ${vins.length} VIN${vins.length > 1 ? "s" : ""} — Save to keep.` : "No VIN found in this file.");
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

    // Cross-app bridge: receive files handed over from other apps.
    if (window.VaultBridge) {
      window.VaultBridge.receive("vault", (item) => addIncomingFile(item));
    }
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

  document.addEventListener("DOMContentLoaded", boot);
})();
