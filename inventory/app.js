/*
 * app.js — Tool Inventory. A private, offline database of special tools.
 *
 * Like the File Vault and LI Database, the data is NOT built into the app: it
 * lives in this browser (IndexedDB) and travels as a single self-contained
 * database file (.tidb) that holds every tool AND its photo. Open a .tidb to
 * load a database, save one to back it up or move it to another machine.
 */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var DB_NAME = "tool-inventory", DB_VERSION = 2, STORE = "tools", PHOTOS = "photos", META = "meta";
  var db = null, all = [], view = [];
  var bundledCatalog = null; // .tidb shipped with the standalone/USB builds (probed at boot)
  var photoBlobs = {};   // id -> Blob
  var photoUrls = {};    // id -> object URL
  var srcMeta = { source: "", updated: "" };
  // model/xgrp are cross-app filters (set by links from LI / the vault, or
  // #inventory/model|group deep links) — shown as a clearable chip, separate
  // from the exact-match svcGrp dropdown.
  var state = { q: "", grp: "", ct: "", note: "", model: "", xgrp: "", starred: false, offered: false, sort: "toolNo", dir: 1 };
  var curId = null, embedded = false;
  try { embedded = window.parent && window.parent !== window; } catch (e) { embedded = true; }

  // Messages from the platform shell: theme + cross-app navigation (deep links
  // and "related" jumps from the other apps). Nav that arrives before boot is
  // replayed once the database has loaded.
  var bootReady = false, pendingNav = [];
  function normToolNo(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
  // A cross-app jump means "show me THIS" — every other active filter would
  // silently hide the results ("No tools match group 54" with the starred
  // toggle secretly on), so reset the whole view state first.
  function resetFilters() {
    state.q = ""; $("#search").value = "";
    state.grp = ""; $("#fGrp").value = "";
    state.ct = ""; $("#fCt").value = "";
    state.note = ""; $("#fNote").value = "";
    state.model = ""; state.xgrp = "";
    if (state.starred) { state.starred = false; $("#starFilter").classList.remove("on"); }
    if (state.offered) { state.offered = false; $("#offeredFilter").classList.remove("on"); }
  }
  function handleShellNav(d) {
    if (!bootReady) { pendingNav.push(d); return; }
    if (d.type === "platform-backup") {
      exportDb();
    } else if (d.type === "inventory-import" && d.file) {
      importDb(d.file);
    } else if (d.type === "inventory-filter") {
      resetFilters();
      if (d.grp != null) state.xgrp = String(d.grp);
      if (d.model != null) state.model = String(d.model);
      apply();
      if (!view.length) toast("No tools match" + (d.grp != null ? " group " + d.grp : "") + (d.model != null ? " model " + d.model : "") + ".");
    } else if (d.type === "inventory-open" && d.toolNo) {
      var want = normToolNo(d.toolNo);
      var t = all.find(function (x) { return normToolNo(x.toolNo) === want; });
      resetFilters();
      if (t) { apply(); openDetail(t.id); }
      else { state.q = want; $("#search").value = want; apply(); }
    } else if (d.type === "inventory-search" && d.q != null) {
      resetFilters();
      state.q = String(d.q).trim(); $("#search").value = String(d.q);
      apply();
    }
  }
  window.addEventListener("message", function (ev) {
    var d = ev.data;
    if (!d) return;
    if (d.type === "platform-theme") {
      if (d.mode === "light" || d.mode === "dark") document.documentElement.setAttribute("data-theme", d.mode);
      else document.documentElement.removeAttribute("data-theme");
      return;
    }
    if (d.type === "inventory-filter" || d.type === "inventory-open" || d.type === "inventory-search" || d.type === "inventory-import" || d.type === "platform-backup") handleShellNav(d);
  });

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function money(n) { return (n || n === 0) ? "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"; }
  var toastT;
  function toast(m) {
    // Relay to the platform shell (shown there only when this tab is in the background).
    if (embedded) { try { window.parent.postMessage({ type: "shell-toast", app: "inventory", msg: String(m) }, "*"); } catch (e) {} }
    var t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }
  function dl(blob, name) { var u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 8000); }

  // ---------- IndexedDB ----------
  function open() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = function () {
        var d = r.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: "id" });
        if (!d.objectStoreNames.contains(PHOTOS)) d.createObjectStore(PHOTOS, { keyPath: "id" });
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META, { keyPath: "k" });
      };
      r.onsuccess = function () { db = r.result; res(db); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function txDone(t) { return new Promise(function (res, rej) { t.oncomplete = function () { res(); }; t.onerror = function () { rej(t.error); }; t.onabort = function () { rej(t.error); }; }); }
  function reqP(rq) { return new Promise(function (res, rej) { rq.onsuccess = function () { res(rq.result); }; rq.onerror = function () { rej(rq.error); }; }); }
  function getAll() { return reqP(db.transaction(STORE, "readonly").objectStore(STORE).getAll()); }
  function putMany(list) { var t = db.transaction(STORE, "readwrite"), os = t.objectStore(STORE); list.forEach(function (x) { os.put(x); }); return txDone(t); }
  function putOne(x) { var t = db.transaction(STORE, "readwrite"); t.objectStore(STORE).put(x); return txDone(t); }
  function getAllPhotos() { return reqP(db.transaction(PHOTOS, "readonly").objectStore(PHOTOS).getAll()); }
  function putPhotos(list) { if (!list.length) return Promise.resolve(); var t = db.transaction(PHOTOS, "readwrite"), os = t.objectStore(PHOTOS); list.forEach(function (p) { os.put(p); }); return txDone(t); }
  function clearData() { var t = db.transaction([STORE, PHOTOS], "readwrite"); t.objectStore(STORE).clear(); t.objectStore(PHOTOS).clear(); return txDone(t); }
  function getMeta(k) { return reqP(db.transaction(META, "readonly").objectStore(META).get(k)).then(function (r) { return r ? r.v : null; }); }
  function setMeta(k, v) { var t = db.transaction(META, "readwrite"); t.objectStore(META).put({ k: k, v: v }); return txDone(t); }

  var EDIT_FIELDS = ["location", "qty", "note", "comment"];
  function normalize(t, i) {
    return {
      id: t.id || ("t" + i),
      no: t.no || "", qty: t.qty || "", toolNo: (t.toolNo || "").trim(),
      svcGrp: (t.svcGrp || "").trim(), ct: (t.ct || "").trim().toUpperCase(),
      desc: t.desc || "", location: t.location || "", year: t.year || "",
      price: (t.price === 0 || t.price) ? Number(t.price) : null,
      note: (t.note || "").trim(), note2: (t.note2 || "").trim(), comment: t.comment || "",
      star: !!t.star,
      edited: (t.edited && typeof t.edited === "object") ? t.edited : {},
      offered: !!t.offered, photo: t.photo || "", wis: t.wis || "", version: t.version || "",
      catalogName: t.catalogName || "", catalogDesc: t.catalogDesc || "",
      validities: Array.isArray(t.validities) ? t.validities : [],
    };
  }

  // ---------- photos (blobs -> object URLs) ----------
  function releasePhotoUrls() { Object.keys(photoUrls).forEach(function (k) { try { URL.revokeObjectURL(photoUrls[k]); } catch (e) {} }); photoUrls = {}; }
  function loadPhotos() {
    releasePhotoUrls(); photoBlobs = {};
    return getAllPhotos().then(function (list) {
      (list || []).forEach(function (p) { if (p && p.id && p.blob) { photoBlobs[p.id] = p.blob; photoUrls[p.id] = URL.createObjectURL(p.blob); } });
    });
  }

  // ---------- filtering / sorting ----------
  // Cross-app filters ("tools for model 214" / "tools for group 54"):
  // model matches 3-digit series lists inside the validity strings; group
  // matches MEMBERSHIP in svcGrp (which can be multi-valued, e.g. "00, 54").
  function matchesModel(t, model) {
    var re = new RegExp("\\b" + model + "\\b");
    return (t.validities || []).some(function (v) { return re.test(String(v)); });
  }
  function matchesGroup(t, grp) {
    return String(t.svcGrp || "").split(/[,\/\s]+/).indexOf(grp) !== -1;
  }
  function syncModelChip() {
    var chip = $("#modelChip");
    if (!chip) return;
    var parts = [];
    if (state.xgrp) parts.push("Group " + state.xgrp);
    if (state.model) parts.push("Model " + state.model);
    chip.hidden = !parts.length;
    if (parts.length) chip.textContent = "🔗 " + parts.join(" · ") + " ✕";
  }
  function apply() {
    var q = state.q.toLowerCase();
    syncModelChip();
    view = all.filter(function (t) {
      if (state.starred && !t.star) return false;
      if (state.offered && !t.offered) return false;
      if (state.grp && t.svcGrp !== state.grp) return false;
      if (state.ct && t.ct !== state.ct) return false;
      if (state.note && t.note !== state.note) return false;
      if (state.model && !matchesModel(t, state.model)) return false;
      if (state.xgrp && !matchesGroup(t, state.xgrp)) return false;
      if (q) {
        var hay = (t.toolNo + " " + t.desc + " " + t.catalogName + " " + t.catalogDesc + " " + t.location + " " + t.svcGrp + " " + t.wis + " " + t.comment).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    var key = state.sort, dir = state.dir;
    view.sort(function (a, b) {
      var x = a[key], y = b[key];
      if (key === "price") { x = x == null ? -1 : x; y = y == null ? -1 : y; return (x - y) * dir; }
      if (key === "star") return ((b.star ? 1 : 0) - (a.star ? 1 : 0)) * dir;
      x = String(x == null ? "" : x); y = String(y == null ? "" : y);
      return x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" }) * dir;
    });
    render();
  }

  function render() {
    var tb = $("#tbody");
    tb.innerHTML = "";
    $("#count").textContent = view.length.toLocaleString() + (view.length === 1 ? " tool" : " tools");
    if (!view.length) {
      var em = $("#empty");
      if (!all.length) {
        em.innerHTML = "No tool database loaded.<br><span class='muted'>Use <b>☰ Menu → Open database…</b> to load a <code>.tidb</code> file, or <b>Import CSV</b>.</span>" +
          (bundledCatalog ? "<br><button class='btn btn-primary' id='loadBuiltinBtn' style='margin-top:14px'>⬇ Load the built-in tool catalog</button>" : "");
      } else {
        em.textContent = "No tools match your search or filters.";
      }
      em.style.display = "block";
      $("#table").style.display = "none";
      return;
    }
    $("#empty").style.display = "none";
    $("#table").style.display = "";
    var frag = document.createDocumentFragment();
    view.forEach(function (t) {
      var tr = document.createElement("tr");
      tr.dataset.id = t.id;
      var descText = t.desc || t.catalogName || "";
      tr.innerHTML =
        '<td class="photocell">' + thumb(t) + '</td>' +
        '<td class="starcell"><button class="star' + (t.star ? " on" : "") + '" title="Star">' + (t.star ? "★" : "☆") + '</button></td>' +
        '<td class="tool-num">' + esc(t.toolNo) + '</td>' +
        '<td class="desc-cell">' + esc(descText) + (t.offered ? ' <span class="badge badge-offer" title="In the tools we offer">offered</span>' : '') + '</td>' +
        '<td class="col-grp">' + esc(t.svcGrp) + '</td>' +
        '<td>' + (t.ct ? '<span class="badge badge-ct">' + esc(t.ct) + '</span>' : '') + '</td>' +
        '<td>' + esc(t.location || "—") + '</td>' +
        '<td class="num">' + money(t.price) + '</td>' +
        '<td>' + noteBadge(t.note) + '</td>';
      frag.appendChild(tr);
    });
    tb.appendChild(frag);
    syncSortHeaders();
  }
  function thumb(t) {
    if (t.photo && photoUrls[t.photo]) return '<img class="thumb" loading="lazy" src="' + photoUrls[t.photo] + '" alt="">';
    return '<span class="noimg-dot" aria-hidden="true">🔧</span>';
  }
  function noteBadge(n) {
    if (!n) return "";
    var cls = "badge badge-note" + (n === "MM" ? " mm" : (n === "A" ? " a" : ""));
    return '<span class="' + cls + '">' + esc(n) + '</span>';
  }
  function syncSortHeaders() {
    $$("#thead th[data-sort]").forEach(function (th) {
      th.classList.remove("asc", "desc");
      if (th.dataset.sort === state.sort) th.classList.add(state.dir === 1 ? "asc" : "desc");
    });
  }

  function fillFilters() {
    var grps = {}, cts = {}, notes = {};
    all.forEach(function (t) {
      if (t.svcGrp) grps[t.svcGrp] = (grps[t.svcGrp] || 0) + 1;
      if (t.ct) cts[t.ct] = (cts[t.ct] || 0) + 1;
      if (t.note) notes[t.note] = (notes[t.note] || 0) + 1;
    });
    fillSelect($("#fGrp"), grps, "All service groups", true);
    fillSelect($("#fCt"), cts, "All categories", false);
    fillSelect($("#fNote"), notes, "All notes", false);
  }
  function fillSelect(sel, counts, allLabel, numeric) {
    var keys = Object.keys(counts).sort(numeric
      ? function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); }
      : function (a, b) { return a.localeCompare(b); });
    sel.innerHTML = '<option value="">' + allLabel + '</option>' +
      keys.map(function (k) { return '<option value="' + esc(k) + '">' + esc(k) + " (" + counts[k] + ")</option>"; }).join("");
  }
  function updateSub() {
    if (!all.length) { $("#sub").textContent = "No database loaded"; return; }
    var offeredN = all.filter(function (t) { return t.offered; }).length;
    var photoN = all.filter(function (t) { return t.photo && photoUrls[t.photo]; }).length;
    $("#sub").textContent = all.length.toLocaleString() + " tools · " + offeredN.toLocaleString() + " offered · " + photoN.toLocaleString() + " with photo";
    if (srcMeta.updated) $("#legendUpdated").textContent = "Pricing reference: " + srcMeta.updated;
  }

  // ---------- detail ----------
  function openDetail(id) {
    var t = all.find(function (x) { return x.id === id; });
    if (!t) return;
    curId = id;
    $("#dTitle").textContent = t.toolNo;
    $("#dStar").textContent = t.star ? "★" : "☆";
    $("#dStar").classList.toggle("on", t.star);
    var photo = $("#dPhoto");
    if (t.photo && photoUrls[t.photo]) { photo.style.display = ""; photo.innerHTML = '<img src="' + photoUrls[t.photo] + '" alt="Photo of ' + esc(t.toolNo) + '">'; }
    else { photo.style.display = "none"; photo.innerHTML = ""; }
    $("#dGrid").innerHTML =
      kv("Name", (t.desc || t.catalogName || "—"), "big") +
      kv("Tool number", t.toolNo, "mono") +
      kv("Service group", t.svcGrp || "—") + kv("Category (Ct)", t.ct || "—") +
      kv("Year", t.year || "—") + kv("Dealer net", money(t.price)) +
      kv("Note", (t.note || "—") + (t.note2 ? " / " + t.note2 : "")) +
      kv("Offered", t.offered ? "Yes — in the tools we offer" : "Not in the catalog") +
      (t.wis ? kv("WIS reference", t.wis, "mono") : "") +
      (t.version ? kv("Catalog version", t.version) : "");
    var extra = $("#dExtra"); extra.innerHTML = "";
    if (t.catalogDesc) extra.innerHTML += '<div class="detail-sec"><div class="detail-sec-h">Details</div><div class="detail-desc">' + esc(t.catalogDesc) + '</div></div>';
    if (t.validities && t.validities.length) {
      extra.innerHTML += '<div class="detail-sec"><div class="detail-sec-h">Model validities</div><ul class="valid-list">' +
        t.validities.map(function (v) { return '<li>' + esc(v) + '</li>'; }).join("") + '</ul></div>';
    }
    $("#eQty").value = t.qty || "";
    $("#eLoc").value = t.location || "";
    $("#eNote").value = t.note || "";
    $("#eComment").value = t.comment || "";
    var g = firstGroup(t);
    $("#dLiGroup").hidden = !g;
    if (g) { $("#dLiGroup").textContent = "🗄️ LI docs · grp " + g; $("#dLiGroup").title = "LI documents for function group " + g; }
    $("#detail").classList.add("show");
  }
  function kv(k, v, cls) {
    return '<div class="kv"><span class="k">' + esc(k) + '</span><span class="v ' + (cls || "") + '">' + esc(v) + '</span></div>';
  }
  function closeDetail() { $("#detail").classList.remove("show"); curId = null; }
  function saveDetail() {
    var t = all.find(function (x) { return x.id === curId; });
    if (!t) return;
    t.edited = t.edited || {};
    var next = { qty: $("#eQty").value.trim(), location: $("#eLoc").value.trim(), note: $("#eNote").value.trim(), comment: $("#eComment").value.trim() };
    EDIT_FIELDS.forEach(function (f) { if (String(t[f] || "") !== String(next[f] || "")) t.edited[f] = 1; });
    t.qty = next.qty; t.location = next.location; t.note = next.note; t.comment = next.comment;
    putOne(t).then(function () { apply(); closeDetail(); toast("Saved."); });
  }
  function toggleStar(id) {
    var t = all.find(function (x) { return x.id === id; });
    if (!t) return Promise.resolve();
    t.star = !t.star;
    return putOne(t).then(function () { apply(); });
  }

  // ---------- cross-app links ----------
  function crossNav(app, payload, hashPath) {
    if (embedded) { try { window.parent.postMessage({ type: "shell-nav", app: app, payload: payload }, "*"); return; } catch (e) {} }
    window.open("../index.html#" + hashPath);
  }
  // A tool's most SPECIFIC function group: svcGrp is often multi-valued and
  // led by the generic "00" bucket ("00, 54") — prefer the first non-00 group
  // so cross-links land on the repair docs the tool actually belongs to.
  function firstGroup(t) {
    var gs = String(t.svcGrp || "").match(/\d{2}/g) || [];
    for (var i = 0; i < gs.length; i++) if (gs[i] !== "00") return gs[i];
    return gs[0] || "";
  }

  // ---------- database file (.tidb) — the whole inventory + photos ----------
  var TIDB_MAGIC = [0x54, 0x49, 0x44, 0x42]; // "TIDB"
  function exportDb() {
    if (!all.length) { toast("Nothing to save — the database is empty."); return; }
    var ids = [], bufs = [], seen = {};
    all.forEach(function (t) { if (t.photo && photoBlobs[t.photo] && !seen[t.photo]) { seen[t.photo] = 1; ids.push(t.photo); bufs.push(photoBlobs[t.photo]); } });
    var meta = {
      format: "tool-inventory-db", version: 1, exportedAt: Date.now(),
      source: srcMeta.source || "", updated: srcMeta.updated || "",
      tools: all, photos: ids.map(function (id, i) { return { id: id, len: bufs[i].size }; }),
    };
    var metaBytes = new TextEncoder().encode(JSON.stringify(meta));
    var header = new ArrayBuffer(12); var dv = new DataView(header);
    TIDB_MAGIC.forEach(function (b, i) { dv.setUint8(i, b); });
    dv.setUint32(4, 1, true); dv.setUint32(8, metaBytes.length, true);
    var blob = new Blob([header, metaBytes].concat(bufs), { type: "application/octet-stream" });
    var stamp = new Date().toISOString().slice(0, 10);
    dl(blob, "tool-inventory-" + stamp + ".tidb");
    toast("Saved database: " + all.length + " tools, " + ids.length + " photos.");
  }
  var importingDb = false;
  function importDb(file) {
    // Re-entrancy guard: two overlapping clear→put chains (double-click on
    // "Load the built-in catalog", two .tidb files dropped) could interleave
    // into a mix of both databases.
    if (importingDb) { toast("An import is already running — wait for it to finish."); return Promise.resolve(); }
    importingDb = true;
    return file.slice(0, 12).arrayBuffer().then(function (buf) {
      var head = new DataView(buf);
      var isTidb = head.byteLength >= 12 && TIDB_MAGIC.every(function (b, i) { return head.getUint8(i) === b; });
      if (!isTidb) return importLegacyJson(file);
      var metaLen = head.getUint32(8, true);
      return file.slice(12, 12 + metaLen).text().then(function (txt) {
        var meta = JSON.parse(txt);
        if (!meta || meta.format !== "tool-inventory-db" || !Array.isArray(meta.tools)) { toast("That isn't a Tool Inventory database file."); return; }
        if (all.length && !confirm("Load this database file? It replaces the current inventory (" + all.length + " tools).")) return;
        var tools = meta.tools.map(normalize);
        var off = 12 + metaLen, photoRecs = [];
        (meta.photos || []).forEach(function (p) { var b = file.slice(off, off + p.len, "image/png"); off += p.len; photoRecs.push({ id: p.id, blob: b }); });
        srcMeta = { source: meta.source || "", updated: meta.updated || "" };
        return clearData()
          .then(function () { return putMany(tools); })
          .then(function () { return putPhotos(photoRecs); })
          .then(function () { return setMeta("source", srcMeta); })
          .then(function () { all = tools; return loadPhotos(); })
          .then(function () { fillFilters(); apply(); updateSub(); toast("Loaded database: " + tools.length + " tools, " + photoRecs.length + " photos."); });
      });
    }).catch(function (e) { console.error(e); toast("Couldn't open the database file — it may be corrupt."); })
      .finally(function () { importingDb = false; });
  }
  // Back-compat: the old plain-JSON backup (tools only, no photos).
  function importLegacyJson(file) {
    return file.text().then(function (txt) {
      var d = JSON.parse(txt);
      if (!d || d.format !== "tool-inventory" || !Array.isArray(d.tools)) { toast("Not a Tool Inventory database file."); return; }
      if (all.length && !confirm("Load this backup? It replaces the current inventory.")) return;
      var tools = d.tools.map(normalize);
      return clearData().then(function () { return putMany(tools); }).then(function () {
        all = tools; return loadPhotos();
      }).then(function () { fillFilters(); apply(); updateSub(); toast("Loaded " + tools.length + " tools (no photos in this backup)."); });
    });
  }

  // ---------- CSV import / export (tool data only, no photos) ----------
  function parseCSV(text) {
    var rows = [], row = [], cur = "", i = 0, q = false, ch;
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (; i < text.length; i++) {
      ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += ch;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return c.trim() !== ""; }); });
  }
  function importCSV(file) {
    file.text().then(function (txt) {
      var rows = parseCSV(txt);
      if (rows.length < 2) { toast("CSV looks empty."); return; }
      var hi = 0;
      for (var r = 0; r < Math.min(rows.length, 5); r++) {
        if (rows[r].join(" ").toLowerCase().indexOf("tool number") !== -1) { hi = r; break; }
      }
      var head = rows[hi].map(function (h) { return h.trim().toLowerCase(); });
      function col() { for (var a = 0; a < arguments.length; a++) { var idx = head.indexOf(arguments[a]); if (idx !== -1) return idx; } return -1; }
      var ci = { id: col("id"), no: col("no.", "no"), qty: col("qty"), toolNo: col("tool number"), svcGrp: col("svc grp", "service group"),
        ct: col("ct"), desc: col("description"), location: col("location", "bin"), year: col("year"),
        price: col("dlr net($)", "dlr net", "price"), note: col("note"), comment: col("comment") };
      if (ci.toolNo === -1) { toast("No 'Tool Number' column found."); return; }
      var byId = {}, byTool = {};
      all.forEach(function (t) { byId[t.id] = t; if (!byTool[t.toolNo]) byTool[t.toolNo] = t; });
      var added = 0, updated = 0, maxIdN = all.reduce(function (m, t) { var n = parseInt((t.id || "t0").slice(1), 10); return isNaN(n) ? m : Math.max(m, n); }, 0);
      var toPut = [];
      for (var k = hi + 1; k < rows.length; k++) {
        var row = rows[k]; var get = function (i) { return i >= 0 && i < row.length ? row[i].trim() : ""; };
        var tn = get(ci.toolNo); if (!tn || tn.toLowerCase() === "tool number") continue;
        var priceRaw = get(ci.price).replace(/[$,]/g, "");
        var rec = { toolNo: tn, qty: get(ci.qty), no: get(ci.no), svcGrp: get(ci.svcGrp), ct: get(ci.ct),
          desc: get(ci.desc), location: get(ci.location), year: get(ci.year),
          price: priceRaw === "" ? null : (isNaN(parseFloat(priceRaw)) ? null : parseFloat(priceRaw)),
          note: get(ci.note), comment: get(ci.comment) };
        var rid = get(ci.id);
        var ex = (rid && byId[rid]) ? byId[rid] : byTool[tn];
        if (ex) { for (var kk in rec) if (rec[kk] !== "" && rec[kk] != null) ex[kk] = rec[kk]; toPut.push(ex); updated++; }
        else { rec.id = "t" + (++maxIdN); rec.star = false; var nn = normalize(rec, maxIdN); all.push(nn); byId[nn.id] = nn; byTool[tn] = nn; toPut.push(nn); added++; }
      }
      putMany(toPut).then(function () { fillFilters(); apply(); updateSub(); toast("Imported CSV: " + added + " added, " + updated + " updated."); });
    });
  }
  function exportCSV() {
    if (!view.length) { toast("Nothing to export."); return; }
    var head = ["ID", "No.", "Qty", "Tool Number", "Svc Grp", "Ct", "Description", "Location", "Year", "Dlr Net($)", "Note", "Comment"];
    var lines = [head.join(",")];
    var q = function (s) { s = String(s == null ? "" : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    view.forEach(function (t) {
      lines.push([t.id, t.no, t.qty, t.toolNo, t.svcGrp, t.ct, t.desc, t.location, t.year, (t.price == null ? "" : t.price), t.note, t.comment].map(q).join(","));
    });
    dl(new Blob([lines.join("\n")], { type: "text/csv" }), "tool-inventory.csv");
    toast("Exported " + view.length + " rows to CSV.");
  }

  // ---------- events ----------
  function wire() {
    var st;
    $("#search").addEventListener("input", function (e) { clearTimeout(st); st = setTimeout(function () { state.q = e.target.value.trim(); apply(); }, 130); });
    $("#fGrp").addEventListener("change", function (e) { state.grp = e.target.value; apply(); });
    $("#fCt").addEventListener("change", function (e) { state.ct = e.target.value; apply(); });
    $("#fNote").addEventListener("change", function (e) { state.note = e.target.value; apply(); });
    $("#starFilter").addEventListener("click", function () { state.starred = !state.starred; $("#starFilter").classList.toggle("on", state.starred); apply(); });
    $("#modelChip").addEventListener("click", function () { state.model = ""; state.xgrp = ""; apply(); });
    $("#offeredFilter").addEventListener("click", function () { state.offered = !state.offered; $("#offeredFilter").classList.toggle("on", state.offered); apply(); });

    $$("#thead th[data-sort]").forEach(function (th) {
      th.addEventListener("click", function () {
        var s = th.dataset.sort;
        if (state.sort === s) state.dir = -state.dir; else { state.sort = s; state.dir = 1; }
        apply();
      });
    });

    $("#tbody").addEventListener("click", function (e) {
      var tr = e.target.closest("tr"); if (!tr) return;
      if (e.target.classList.contains("star")) { e.stopPropagation(); toggleStar(tr.dataset.id); return; }
      openDetail(tr.dataset.id);
    });

    $$("[data-close]").forEach(function (el) { el.addEventListener("click", function () { el.closest(".overlay").classList.remove("show"); }); });
    $("#dSave").addEventListener("click", saveDetail);
    $("#dStar").addEventListener("click", function () { if (curId) toggleStar(curId).then(function () { var t = all.find(function (x) { return x.id === curId; }); $("#dStar").textContent = t.star ? "★" : "☆"; $("#dStar").classList.toggle("on", t.star); }); });
    $("#dCopy").addEventListener("click", function () {
      var t = all.find(function (x) { return x.id === curId; }); if (!t) return;
      navigator.clipboard && navigator.clipboard.writeText(t.toolNo).then(function () { toast("Copied " + t.toolNo); }, function () {});
    });
    // Cross-app: this tool → the LI documents that need it.
    $("#dLiGroup").addEventListener("click", function () {
      var t = all.find(function (x) { return x.id === curId; }); if (!t) return;
      var g = firstGroup(t);
      // Every LI number embeds its group (LI54.30-…), so "LI54." is a precise
      // full-library search for group-54 documents.
      if (g) crossNav("li", { type: "li-search", q: "LI" + g + "." }, "li/group/" + g);
    });
    $("#dLiFind").addEventListener("click", function () {
      var t = all.find(function (x) { return x.id === curId; }); if (!t) return;
      var q = normToolNo(t.toolNo);
      crossNav("li", { type: "li-search", q: q }, "li/search/" + encodeURIComponent(q));
    });

    // menu
    var mb = $("#menuBtn"), mn = $("#appMenu");
    mb.addEventListener("click", function (e) { e.stopPropagation(); mn.hidden = !mn.hidden; });
    document.addEventListener("click", function (e) { if (!mn.hidden && !mn.contains(e.target) && e.target !== mb) mn.hidden = true; });
    $("#openDbBtn").addEventListener("click", function () { mn.hidden = true; $("#dbInput").click(); });
    $("#saveDbBtn").addEventListener("click", function () { mn.hidden = true; exportDb(); });
    $("#importCsvBtn").addEventListener("click", function () { mn.hidden = true; $("#csvInput").click(); });
    $("#exportCsvBtn").addEventListener("click", function () { mn.hidden = true; exportCSV(); });
    $("#legendBtn").addEventListener("click", function () { mn.hidden = true; $("#legend").classList.add("show"); });
    if ($("#debugBtn")) $("#debugBtn").addEventListener("click", function () { mn.hidden = true; if (window.FVDebug) window.FVDebug.open(); });
    $("#dbInput").addEventListener("change", function (e) { if (e.target.files[0]) importDb(e.target.files[0]); e.target.value = ""; });
    $("#csvInput").addEventListener("change", function (e) { if (e.target.files[0]) importCSV(e.target.files[0]); e.target.value = ""; });

    // install
    var deferred = null;
    window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferred = e; if (!embedded) $("#installBtn").hidden = false; });
    $("#installBtn").addEventListener("click", function () {
      if (deferred) { deferred.prompt(); deferred.userChoice.then(function () { deferred = null; $("#installBtn").hidden = true; }); }
      else toast("Use the browser menu (⋮) → Install / Create shortcut.");
    });

    // Drag-and-drop a .tidb onto the window to load it.
    ["dragover", "drop"].forEach(function (ev) {
      window.addEventListener(ev, function (e) {
        if (!e.dataTransfer) return;
        e.preventDefault();
        if (ev === "drop" && e.dataTransfer.files && e.dataTransfer.files[0]) {
          // Partition the WHOLE drop: inventory formats import here, anything
          // else goes to the platform's unified intake (a mixed drop must not
          // silently discard the non-inventory files).
          var files = Array.prototype.slice.call(e.dataTransfer.files);
          var local = [], rest = [];
          files.forEach(function (f) { (/\.(tidb|json|csv)$/i.test(f.name) ? local : rest).push(f); });
          if (local.length) {
            var f = local[0];
            if (/\.csv$/i.test(f.name)) importCSV(f); else importDb(f);
            if (local.length > 1) toast("One database/CSV at a time — " + (local.length - 1) + " skipped.");
          }
          if (rest.length) {
            if (embedded) { try { window.parent.postMessage({ type: "shell-add-files", files: rest }, "*"); } catch (x) {} }
            else toast(rest.length + " file(s) aren't Tool Inventory formats (.tidb/.json/.csv) — ignored.");
          }
        }
      });
    });

    document.addEventListener("keydown", function (e) {
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
      if (e.key === "Escape") { $$(".overlay.show").forEach(function (o) { o.classList.remove("show"); }); if (!mn.hidden) mn.hidden = true; }
      else if (e.key === "/" && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") { e.preventDefault(); $("#search").focus(); }
    });

    // One-click load of the catalog shipped with the standalone/USB builds.
    $("#empty").addEventListener("click", function (e) {
      if (e.target && e.target.id === "loadBuiltinBtn" && bundledCatalog) importDb(bundledCatalog);
    });
  }

  // The standalone/USB builds ship the full catalog at ../data/FileInventory.tidb.
  // If the database is empty and that file exists, offer a one-click load.
  function probeBundledCatalog() {
    if (all.length) return;
    fetch("../data/FileInventory.tidb").then(function (r) {
      if (!r || !r.ok) return null;
      return r.blob();
    }).then(function (b) {
      if (b && b.size > 12 && !all.length) { bundledCatalog = b; render(); }
    }).catch(function () {});
  }

  // ---------- boot ----------
  open().then(function () {
    return Promise.all([getAll(), loadPhotos(), getMeta("source")]);
  }).then(function (r) {
    all = (r[0] || []).map(normalize);
    var src = r[2]; if (src) srcMeta = { source: src.source || "", updated: src.updated || "" };
    if (!embedded) $("#backBtn").hidden = false;   // standalone: offer a way into the platform
    fillFilters();
    wire();
    apply();
    updateSub();
    bootReady = true;
    pendingNav.splice(0).forEach(handleShellNav);
    probeBundledCatalog();
    if ("serviceWorker" in navigator) { try { navigator.serviceWorker.register("sw.js"); } catch (e) {} }
  }).catch(function (e) {
    $("#empty").style.display = "block";
    $("#empty").innerHTML = "Couldn't open the inventory.<br><span class='muted'>" + esc(e && e.message) + "</span>";
  });
})();
