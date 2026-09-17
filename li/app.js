/* ===== LI Document Database app (moved out of li/index.html, REWRITE-PLAN.md Phase 3) ===== */
/* ===== LI Document Database app ===== */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  // PDF.js is the shared, on-demand copy (src/services/pdf.js → vendor/):
  // every path that parses a PDF waits for FDServices.pdf.load() first.
  var loadPdf = function () { return FDServices.pdf.load(); };

  // ---------- tiny helpers ----------
  function fmtBytes(b) { if (!b) return "0 B"; var u = ["B", "KB", "MB", "GB"], i = Math.floor(Math.log(b) / Math.log(1024)); i = Math.min(i, u.length - 1); return (b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + " " + u[i]; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var toastT = 0;
  function toast(msg) {
    // Relay to the platform shell so background-tab events (imports, sync,
    // OCR) still surface; the shell only shows relays for background tabs.
    try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: "shell-toast", app: "li", msg: String(msg) }, "*"); } catch (e) {}
    var t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  // ---------- LI extraction (shared: ../src/core) ----------
  // Text normalization, the document-number matchers, line assembly and field
  // extraction moved to src/core/{text,ids,li-parse}.js (REWRITE-PLAN.md
  // Phase 1). These aliases keep the rest of this file reading as before.
  var normChars = FDCore.text.normChars, normText = FDCore.text.normText, normLI = FDCore.text.normLI, reEsc = FDCore.text.reEsc;
  var sanitize = FDCore.text.sanitize, cleanTitle = FDCore.text.cleanTitle, WIN_RESERVED = FDCore.text.WIN_RESERVED;
  var DOCNUM = FDCore.ids.DOCNUM, FUZZY = FDCore.ids.FUZZY, toDigits = FDCore.ids.toDigits, toAlpha = FDCore.ids.toAlpha;
  var canonLI = FDCore.ids.canonLI, liKey = FDCore.ids.liKey, detectLI = FDCore.ids.detectLI, detectLIFuzzy = FDCore.ids.detectLIFuzzy, detectVersion = FDCore.ids.detectVersion;
  var rlName = FDCore.li.rlName, itemsToLines = FDCore.li.itemsToLines, joinHyphen = FDCore.li.joinHyphen;
  var HEADER_RE = FDCore.li.HEADER_RE, FIELD_RE = FDCore.li.FIELD_RE, LABEL_RE = FDCore.li.LABEL_RE, DATE_VAL = FDCore.li.DATE_VAL;
  var titleFromStructure = FDCore.li.titleFromStructure, detectTitle = FDCore.li.detectTitle, normDate = FDCore.li.normDate, fieldFromLines = FDCore.li.fieldFromLines;

  // OCR runs automatically for any PDF with no real text layer. The engine
  // loader and the worker pool are the shared service (src/services/ocr.js):
  // workers are created on demand up to a cap, reused across files, and lent
  // out one at a time so several scanned PDFs recognize on different cores
  // while text PDFs never spin one up. tessAcquire() waits for a free worker
  // when all are busy; tessFreeAll() releases the memory.
  var tessPool = FDServices.ocrPool.create();
  var tessAcquire = tessPool.acquire, tessRelease = tessPool.release, tessFreeAll = tessPool.freeAll;
  // Recognize the first pages of a doc with the given worker.
  //
  // Reading goes through ../ocr.js, which fixes two things the raw engine gets
  // wrong on scanned documents: it defaults to treating a page as ONE block of
  // text (losing most of a structured LI print-out), and it has no idea when a
  // page was scanned sideways — it returns a handful of nonsense words rather
  // than failing. So page 1 is read in document mode and, if no LI number came
  // out of it, checked for which way up it is and read again; later pages
  // follow page 1's answer.
  function ocrPages(doc, w) {
    var pages = Math.min(doc.numPages, 2), text = "", lines = [], i = 1, angle = 0;
    function collect(r) {
      text += (r.text || "") + "\n";
      var got = (r.data && r.data.lines) || [];
      got.forEach(function (ln) { var s = (ln.text || "").replace(/\s+/g, " ").trim(); if (s) lines.push({ text: s, h: ln.bbox ? ln.bbox.y1 - ln.bbox.y0 : 0, y: ln.bbox ? ln.bbox.y0 : 0 }); });
    }
    function step() {
      if (i > pages) return Promise.resolve({ text: text, lines: lines });
      return doc.getPage(i).then(function (page) {
        var vp = page.getViewport({ scale: 3 }); var c = document.createElement("canvas"); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        var ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
        return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
          var orient = window.OcrOrient;
          var opts = orient && { readEdge: function (s) { return Math.max(s.width, s.height); } };
          var read = !orient
            ? w.recognize(c).then(function (r) { return { text: (r.data && r.data.text) || "", data: r.data, angle: 0 }; })
            : i === 1
              ? orient.readSmart(w, c, Object.assign({ accept: function (t) { return !!(detectLI(t) || detectLIFuzzy(t)); } }, opts))
              : orient.readAt(w, c, angle, opts);
          return read.then(function (r) {
            if (i === 1) angle = r.angle || 0;
            collect(r);
            c.width = c.height = 0; // release the (large, scale-3) canvas promptly
            i++; return step();
          });
        });
      });
    }
    return step();
  }
  // Borrow a pooled OCR worker, recognize, and always return it to the pool.
  function ocrPdf(doc) {
    return tessAcquire().then(function (w) {
      return ocrPages(doc, w).then(
        function (r) { tessRelease(w); return r; },
        function (e) { tessRelease(w); throw e; }
      );
    });
  }

  function extract(file, worker) {
    return loadPdf().then(function () { return file.arrayBuffer(); }).then(function (buf) {
      // worker (optional): a dedicated PDF.js worker from the import pool, so
      // several PDFs parse on different cores at once. Omitted elsewhere (the
      // shared global PDF worker is used).
      var task = pdfjsLib.getDocument(worker ? { data: buf.slice(0), worker: worker } : { data: buf.slice(0) });
      return task.promise.then(function (doc) {
        var pages = Math.min(doc.numPages, 10), text = "", page1Lines = [], allLines = [], i = 1;
        function pg() {
          if (i > pages) return Promise.resolve();
          return doc.getPage(i).then(function (page) { return page.getTextContent().then(function (tc) { tc.items.forEach(function (it) { text += normText(it.str) + " "; }); var pl = itemsToLines(tc.items); if (i === 1) page1Lines = pl; allLines = allLines.concat(pl); if (i < pages) allLines.push({ text: "\f" }); text += "\n"; i++; return pg(); }); });
        }
        return pg().then(function () {
          // A real text layer? use it. Otherwise (no text / a stamp-or-watermark
          // only layer of a few dozen chars) it's a scanned doc — OCR it
          // automatically, falling back to filename-only if OCR is unavailable.
          var plainLen = text.replace(/\s+/g, "").length;
          if (plainLen >= 60) return finish(text, page1Lines, allLines, false);
          return ocrPdf(doc).then(function (o) { return finish(o.text, o.lines, o.lines, true); }).catch(function () {
            if (plainLen > 0) return finish(text, page1Lines, allLines, false);
            var li1 = detectLI(file.name) || detectLIFuzzy(file.name);
            return { li: li1, ver: detectVersion(file.name, li1), title: "", reason: "", fgroup: "", date: "", validity: "", text: "", pages: doc.numPages, ocr: false, noText: true };
          });
        });
        function finish(flat, p1, all, ocr) { return FDCore.li.buildRecord(flat, p1, all, ocr, file.name, doc.numPages); }
      }).then(
        function (r) { try { task.destroy(); } catch (e) {} return r; },
        function (e) { try { task.destroy(); } catch (e2) {} throw e; });
    }).catch(function () { var li0 = detectLI(file.name) || detectLIFuzzy(file.name); return { li: li0, ver: detectVersion(file.name, li0), title: "", reason: "", fgroup: "", date: "", validity: "", text: "", pages: 0, ocr: false, noText: true, err: true }; });
  }

  // ---------- storage (shared: ../src/data) ----------
  // Documents, their PDFs and this app's settings live in the platform
  // database (REWRITE-PLAN.md Phase 2). A document's PDF is a `files`
  // record it owns (hidden from the Files app until "Add to File Vault").
  var R = function () { return FDData.repos; };
  function putDoc(meta, blob) { return R().documents.putWithFile(meta, blob || null); }
  // Re-key a document (a corrected LI/version) atomically with the old record's removal.
  function migrateDoc(oldId, meta, blob) { return R().documents.putWithFile(meta, blob || null, { oldId: oldId }); }
  function allDocs() { return R().documents.list(); }
  function getFile(id) { return R().documents.getBlob(id); }
  function delDoc(id) { return R().documents.removeWithFile(id); }
  function getSetting(k) { return R().settings.getValue("li." + k, null); }
  function putSetting(k, v) { return R().settings.setValue("li." + k, v); }
  function delSetting(k) { return R().settings.removeKey("li." + k).catch(function () {}); }
  function estimate() { return navigator.storage && navigator.storage.estimate ? navigator.storage.estimate() : Promise.resolve(null); }

  // ---------- state / render ----------
  var docs = [], view = [], groupsByKey = {}, sortCol = "date", sortDir = -1, selected = {};
  var COLS = [
    { k: "sel", label: "", w: "34px" },
    { k: "star", label: "★", w: "30px" },
    { k: "li", label: "LI number" }, { k: "ver", label: "Version" },
    { k: "title", label: "Title" }, { k: "fgroup", label: "Function group" },
    { k: "date", label: "Date" }, { k: "validity", label: "Validity" }, { k: "size", label: "Size" }
  ];
  function refresh() { return allDocs().then(function (d) { docs = d; applyView(); updateStore(); try { if (window.parent !== window) window.parent.postMessage({ type: "li-changed" }, "*"); } catch (e) {} }); }
  function updateStore() {
    estimate().then(function (e) {
      var tot = docs.reduce(function (s, d) { return s + (d.size || 0); }, 0);
      $("storeInfo").textContent = Object.keys(groupsByKey).length + " documents · " + docs.length + " files · " + fmtBytes(tot);
    });
    // function-group filter options
    var fgs = {}; docs.forEach(function (d) { if (d.fgroup) fgs[d.fgroup] = 1; });
    var sel = $("fgFilter"), cur = sel.value; sel.innerHTML = '<option value="">All function groups</option>';
    Object.keys(fgs).sort().forEach(function (g) { var o = document.createElement("option"); o.value = g; o.textContent = g.length > 46 ? g.slice(0, 46) + "…" : g; sel.appendChild(o); });
    sel.value = cur;
    if (sel.value !== cur) { sel.value = ""; applyView(); }
    // model-series filter options
    var mods = {}; docs.forEach(function (d) { modelsOf(d).forEach(function (m) { mods[m] = 1; }); });
    var msel = $("modelFilter"), mcur = msel.value; msel.innerHTML = '<option value="">All models</option>';
    Object.keys(mods).sort(function (a, b) { return (+a) - (+b); }).forEach(function (m) { var o = document.createElement("option"); o.value = m; o.textContent = "Model " + m; msel.appendChild(o); });
    msel.value = mcur;
    if (msel.value !== mcur) { msel.value = ""; applyView(); } // selected model gone — reset and refresh the view
  }
  // Model series a document applies to, parsed from its Validity field:
  // explicit "MODEL 166" / "Model series 221", plus bare comma-listed 3-digit
  // series ("118, 177, 247, …"). Codes (489, letter-suffixed like 101A) are
  // not comma-list members, so they're not picked up.
  var _modelMemo = {}; // memoized by validity string — avoids re-parsing every row on each applyView
  function modelsOf(d) {
    var s = d.validity || "";
    if (Object.prototype.hasOwnProperty.call(_modelMemo, s)) return _modelMemo[s];
    var seen = {}, out = [], m;
    function add(k) { if (/^\d{3}$/.test(k) && !seen[k]) { seen[k] = 1; out.push(k); } }
    var re1 = /model(?:\s+series)?\s+(\d{3})\b/gi; while ((m = re1.exec(s))) add(m[1]);
    var re2 = /(?:^|,)\s*(\d{3})\s*(?=,|$)/g; while ((m = re2.exec(s))) add(m[1]);
    _modelMemo[s] = out;
    return out;
  }
  function verNum(d) { return parseFloat(d.ver) || 0; }
  // A sortable YYYYMMDD number from a date string. Handles ISO YYYY/M/D, US
  // M/D/YY(YY) (the app's default), and day-first D/M/YYYY when the first field
  // can't be a month (>12). Unparseable/empty dates sort together at the low
  // end. 2-digit years pivot at 70 (→19xx/20xx).
  function dateVal(s) {
    var t = String(s || "").match(/\d+/g); if (!t || t.length < 3) return 0;
    var y, mo, d;
    if (t[0].length === 4) { y = +t[0]; mo = +t[1]; d = +t[2]; }
    else if (+t[0] > 12) { d = +t[0]; mo = +t[1]; y = +t[2]; }
    else { mo = +t[0]; d = +t[1]; y = +t[2]; }
    if (y < 100) y += (y < 70 ? 2000 : 1900);
    return y * 10000 + mo * 100 + d;
  }
  function isStarred(g) { return g.versions.some(function (v) { return v.star; }); }
  var starOnly = false;
  function groupDocs(list) {
    var map = {}, order = [];
    list.forEach(function (d) { var key = d.li ? liKey(d.li) : "id:" + d.id; if (!map[key]) { map[key] = { key: key, li: d.li, versions: [] }; order.push(key); } map[key].versions.push(d); });
    order.forEach(function (k) { map[k].versions.sort(function (a, b) { return verNum(b) - verNum(a); }); });
    return order.map(function (k) { return map[k]; });
  }
  function applyView() {
    var q = $("search").value.trim().toLowerCase(), fg = $("fgFilter").value, model = $("modelFilter").value;
    var groups = groupDocs(docs);
    groupsByKey = {}; groups.forEach(function (g) { groupsByKey[g.key] = g; });
    Object.keys(selected).forEach(function (k) { if (!groupsByKey[k]) delete selected[k]; });
    view = groups.filter(function (g) {
      if (starOnly && !isStarred(g)) return false;
      if (needsOnly && !needsReview(g)) return false;
      if (fg && !g.versions.some(function (d) { return d.fgroup === fg; })) return false;
      if (model && !g.versions.some(function (d) { return modelsOf(d).indexOf(model) !== -1; })) return false;
      if (!q) return true;
      return g.versions.some(function (d) { return (d.li + " " + d.title + " " + d.fgroup + " " + (d.reason || "") + " " + d.text).toLowerCase().indexOf(q) !== -1; });
    });
    view.sort(function (a, b) {
      if (sortCol === "star") return sortDir * ((isStarred(b) ? 1 : 0) - (isStarred(a) ? 1 : 0));
      var da = a.versions[0], db = b.versions[0], x = da[sortCol], y = db[sortCol];
      if (sortCol === "size" || sortCol === "ver") { x = parseFloat(x) || 0; y = parseFloat(y) || 0; return sortDir * (x - y); }
      if (sortCol === "date") { return sortDir * (dateVal(x) - dateVal(y)); }
      return sortDir * String(x || "").localeCompare(String(y || ""));
    });
    render();
  }
  function render() {
    var nGroups = Object.keys(groupsByKey).length;
    $("count").textContent = view.length + (view.length === nGroups ? "" : " of " + nGroups) + " documents";
    $("empty").style.display = docs.length ? "none" : "block";
    $("table").style.display = docs.length ? "" : "none";
    $("head").innerHTML = COLS.map(function (c) { var cls = c.k === sortCol ? (sortDir === 1 ? "asc" : "desc") : ""; return '<th class="' + cls + '" data-c="' + c.k + '"' + (c.w ? ' style="width:' + c.w + '"' : "") + ">" + c.label + "</th>"; }).join("");
    var html = "";
    view.forEach(function (g) {
      var d = g.versions[0], nv = g.versions.length;
      var st = isStarred(g);
      html += '<tr data-key="' + esc(g.key) + '"' + (selected[g.key] ? ' class="sel"' : "") + ">" +
        '<td><input type="checkbox" class="chk rowchk" ' + (selected[g.key] ? "checked" : "") + " /></td>" +
        '<td class="starcell"><span class="star' + (st ? " on" : "") + '" title="' + (st ? "Unstar" : "Star") + '">' + (st ? "★" : "☆") + "</span></td>" +
        '<td class="li-num">' + esc(d.li || "—") + "</td>" +
        '<td>' + (d.ver ? '<span class="ver-badge">v' + esc(d.ver) + "</span>" : "") + (nv > 1 ? ' <span class="muted" style="font-size:11px">· ' + nv + " versions</span>" : "") + "</td>" +
        '<td class="title-cell">' + (d.title ? esc(d.title) : '<span class="muted">(no title)</span>') + (d.err ? ' <span class="muted">· unreadable</span>' : d.noText ? ' <span class="muted">· scanned</span>' : "") + "</td>" +
        '<td class="muted">' + esc(d.fgroup) + "</td>" +
        '<td class="muted">' + esc(d.date) + "</td>" +
        '<td class="muted">' + esc(d.validity) + "</td>" +
        '<td class="muted">' + fmtBytes(d.size) + "</td></tr>";
    });
    $("rows").innerHTML = html;
  }
  $("head").addEventListener("click", function (e) { var th = e.target.closest("th[data-c]"); if (!th) return; var c = th.getAttribute("data-c"); if (c === "sel") return; if (sortCol === c) sortDir = -sortDir; else { sortCol = c; sortDir = 1; } applyView(); });
  // Debounce search: a big library's full-text filter is heavy, so don't re-run
  // it on every keystroke — coalesce rapid typing into one pass.
  var searchTimer = 0;
  $("search").addEventListener("input", function () { clearTimeout(searchTimer); searchTimer = setTimeout(applyView, 140); });
  $("fgFilter").addEventListener("change", applyView);
  $("modelFilter").addEventListener("change", applyView);
  $("rows").addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-key]"); if (!tr) return; var key = tr.getAttribute("data-key");
    if (e.target.classList.contains("rowchk")) { if (e.target.checked) selected[key] = 1; else delete selected[key]; tr.classList.toggle("sel", !!selected[key]); return; }
    if (e.target.classList.contains("star")) { toggleStar(key); return; }
    openDetail(key);
  });
  function toggleStar(key) {
    var g = groupsByKey[key]; if (!g) return;
    var on = !isStarred(g), was = g.versions.map(function (v) { return !!v.star; });
    g.versions.forEach(function (v) { v.star = on; });
    applyView(); updDStar();
    Promise.all(g.versions.map(function (v) { return putDoc(v, null); }))
      .then(function () { scheduleAutosave(); }, function () {
        g.versions.forEach(function (v, i) { v.star = was[i]; }); // revert on write failure
        applyView(); updDStar(); toast("Couldn't save the star — storage may be full.");
      });
  }
  $("starFilter").addEventListener("click", function () {
    starOnly = !starOnly;
    this.classList.toggle("on", starOnly);
    this.textContent = (starOnly ? "★" : "☆") + " Starred";
    applyView();
  });
  var needsOnly = false;
  // A document wants a look if the parser left a key field empty (or couldn't
  // read the file). Checked on the latest version.
  // Flag when a key field is empty. (Not err/noText: those reflect the file, not
  // the metadata, and would keep a hand-corrected scanned doc flagged forever.)
  function needsReview(g) { var d = g.versions[0]; return !d.li || !d.title || !d.fgroup || !d.date; }
  $("needsFilter").addEventListener("click", function () {
    needsOnly = !needsOnly;
    this.classList.toggle("on", needsOnly);
    applyView();
  });
  $("selAll").addEventListener("click", function () { var all = view.every(function (g) { return selected[g.key]; }); view.forEach(function (g) { if (all) delete selected[g.key]; else selected[g.key] = 1; }); render(); });
  $("delSel").addEventListener("click", function () {
    var keys = Object.keys(selected); if (!keys.length) { toast("No documents selected."); return; }
    var ids = []; keys.forEach(function (k) { var g = groupsByKey[k]; if (g) g.versions.forEach(function (v) { ids.push(v.id); }); });
    if (!confirm("Delete " + keys.length + " document(s) (" + ids.length + " file(s)) from the database?")) return;
    var fails = 0;
    // Tolerate an individual failed delete so one error can't skip the refresh
    // and leave docs[] out of sync with storage.
    Promise.all(ids.map(function (id) { return delDoc(id).catch(function () { fails++; }); }))
      .then(function () { selected = {}; return refresh(); })
      .then(function () { toast(fails ? ("Deleted, but " + fails + " item(s) failed.") : "Deleted."); scheduleAutosave(); });
  });

  // ---------- detail modal (versions + compare) ----------
  var curGroup = null, curDoc = null, curVerIdx = 0, curUrl = null, dDirty = false, navStack = [];
  // fromNav: called from a reference-follow or the Back button, which manage
  // the history stack themselves. A plain open (row click, permalink) is a
  // fresh start, so the stack is cleared.
  function openDetail(key, fromNav) {
    if (!groupsByKey[key]) return;
    if (!fromNav) navStack = [];
    curGroup = groupsByKey[key];
    var sel = $("dVerSel"); sel.innerHTML = "";
    curGroup.versions.forEach(function (d, i) { var o = document.createElement("option"); o.value = i; o.textContent = "Version " + (d.ver || "?"); sel.appendChild(o); });
    var multi = curGroup.versions.length > 1;
    $("dVerPick").style.display = multi ? "flex" : "none";
    $("dCmp").style.display = multi ? "block" : "none";
    if (multi) fillCmp();
    loadVersion(0);
    updDStar();
    $("dBack").style.display = navStack.length ? "" : "none";
    setHash(curGroup.li || "");
    $("detailOverlay").classList.add("show");
  }
  $("dBack").addEventListener("click", function () {
    if (!navStack.length) return;
    if (dDirty && !confirm("Discard unsaved changes to this document?")) return;
    dDirty = false;
    openDetail(navStack.pop(), true);
  });
  function updDStar() {
    if (!curGroup) return;
    var on = isStarred(curGroup);
    $("dStar").textContent = on ? "★" : "☆";
    $("dStar").classList.toggle("on", on);
    $("dStar").title = on ? "Unstar this document" : "Star this document";
  }
  $("dStar").addEventListener("click", function () { if (curGroup) toggleStar(curGroup.key); });
  function loadVersion(i) {
    curVerIdx = i; curDoc = curGroup.versions[i]; var d = curDoc;
    $("dVerSel").value = i;
    $("dTitle").textContent = (d.li || d.filename || "Document") + (d.ver ? " · v" + d.ver : "");
    $("dLi").value = d.li || ""; $("dVer").value = d.ver || ""; $("dTitleIn").value = d.title || "";
    $("dReason").value = d.reason || ""; $("dFg").value = d.fgroup || ""; $("dDate").value = d.date || ""; $("dValid").value = d.validity || "";
    updNewName();
    renderRefs(d);
    renderCrossApps(d);
    dDirty = false;
    getFile(d.id).then(function (blob) { if (curDoc !== d || !$("detailOverlay").classList.contains("show")) return; if (curUrl) URL.revokeObjectURL(curUrl); curUrl = blob ? URL.createObjectURL(asPdf(blob)) : null; $("dFrame").src = curUrl || "about:blank"; });
  }
  // Other LI documents cited in this one's text/reason — shown as chips that
  // jump to that document if it's in the library.
  function findRefs(d) {
    var hay = normText((d.reason || "") + "\n" + (d.text || ""));
    var re = FDCore.ids.docnumGlobal(), m, seen = {}, out = [], self = (d.li || "").toUpperCase();
    while ((m = re.exec(hay))) { var x = m[0].toUpperCase(); if (x === self || seen[x]) continue; seen[x] = 1; out.push(x); }
    return out;
  }
  function renderRefs(d) {
    var refs = findRefs(d), box = $("dRefs"), chips = $("dRefChips");
    chips.innerHTML = "";
    if (!refs.length) { box.style.display = "none"; return; }
    refs.forEach(function (li) {
      var have = !!groupsByKey[liKey(li)];
      var el = document.createElement("span");
      el.className = "refchip " + (have ? "have" : "miss");
      el.textContent = li;
      el.title = have ? "Open " + li : li + " — not in your library";
      if (have) el.addEventListener("click", function () { openRef(liKey(li)); });
      chips.appendChild(el);
    });
    box.style.display = "block";
  }
  function openRef(key) {
    if (!groupsByKey[key]) { toast("That document isn't in your library."); return; }
    if (dDirty && !confirm("Discard unsaved changes to this document?")) return;
    dDirty = false;
    if (curGroup) navStack.push(curGroup.key); // remember where we came from
    openDetail(key, true);
  }
  // Cross-app: this repair document → the special tools it calls for, by the
  // function group embedded in its LI number (LI54.30-… = group 54) and its
  // model-series validity. Jumps into the Tool Inventory pre-filtered.
  function crossNav(app, payload, hashPath) {
    var emb = false; try { emb = window.parent && window.parent !== window; } catch (e) { emb = true; }
    if (emb) { try { window.parent.postMessage({ type: "shell-nav", app: app, payload: payload }, "*"); return; } catch (x) {} }
    window.open("../index.html#" + hashPath);
  }
  function liGroupOf(d) {
    var m = String(d.li || "").match(/^[A-Z]{2}(\d{2})\./i);
    if (m) return m[1];
    m = String(d.fgroup || "").match(/^(\d{2})/);
    return m ? m[1] : "";
  }
  function renderCrossApps(d) {
    var box = $("dXApps"), chips = $("dXAppChips");
    chips.innerHTML = "";
    var grp = liGroupOf(d), models = modelsOf(d);
    function chip(txt, title, go) {
      var el = document.createElement("span");
      el.className = "refchip have";
      el.textContent = txt; el.title = title;
      el.addEventListener("click", go);
      chips.appendChild(el);
    }
    if (grp) chip("🔧 Tools · group " + grp, "Special tools for function group " + grp + " — bin locations, photos, prices", function () {
      crossNav("inventory", { type: "inventory-filter", grp: grp }, "inventory/group/" + grp);
    });
    models.forEach(function (s) {
      chip("🔧 Tools · model " + s, "Special tools valid for model series " + s, function () {
        crossNav("inventory", { type: "inventory-filter", model: s }, "inventory/model/" + s);
      });
    });
    box.style.display = (grp || models.length) ? "block" : "none";
  }
  $("dVerSel").addEventListener("change", function () { loadVersion(+this.value); });
  // Fold/trim the document number as it is saved, so a value pasted out of a
  // PDF is stored in the same shape the extractor produces (and the record id
  // derived from it matches on re-import).
  function collectDetail() { return { li: canonLI($("dLi").value), ver: $("dVer").value, title: $("dTitleIn").value, reason: $("dReason").value, fgroup: $("dFg").value, date: $("dDate").value, validity: $("dValid").value }; }
  function updNewName() { $("dNewName").textContent = rlName(collectDetail()); }
  ["dLi", "dVer", "dTitleIn"].forEach(function (id) { $(id).addEventListener("input", updNewName); });
  ["dLi", "dVer", "dTitleIn", "dReason", "dFg", "dDate", "dValid"].forEach(function (id) { $(id).addEventListener("input", function () { dDirty = true; }); });
  $("dSave").addEventListener("click", function () {
    if (!curDoc) return; var e = collectDetail();
    // Snapshot so a failed write can be rolled back (keeps docs[] consistent
    // with what's actually stored, and doesn't silently drop the user's edits).
    var FIELDS = ["li", "ver", "title", "reason", "fgroup", "date", "validity"];
    var snap = { id: curDoc.id }; FIELDS.forEach(function (k) { snap[k] = curDoc[k]; }); snap.edited = curDoc.edited;
    var ed = {}; var prevEd = curDoc.edited || {}; for (var pk in prevEd) ed[pk] = prevEd[pk];
    FIELDS.forEach(function (k) { if (String(curDoc[k] || "") !== String(e[k] || "")) ed[k] = 1; });
    curDoc.edited = ed;
    curDoc.li = e.li; curDoc.ver = e.ver; curDoc.title = e.title; curDoc.reason = e.reason; curDoc.fgroup = e.fgroup; curDoc.date = e.date; curDoc.validity = e.validity;
    // the record id encodes LI+version — migrate it when they change, so
    // re-imports dedupe against the corrected values, not the old ones
    var oldId = snap.id, newId = curDoc.li ? (curDoc.li + "_" + (curDoc.ver || "0")) : oldId;
    var save;
    if (newId !== oldId && !docs.some(function (d) { return d.id === newId; })) {
      curDoc.id = newId; save = migrateDoc(oldId, curDoc, null);
    } else {
      save = putDoc(curDoc, null);
    }
    save.then(function () {
      dDirty = false;
      setHash(curDoc.li || ""); // keep the permalink pointing at the new LI
      applyView(); updateStore();
      var key = curDoc.li ? liKey(curDoc.li) : "id:" + curDoc.id;
      curGroup = groupsByKey[key] || curGroup;
      var idx = curGroup.versions.indexOf(curDoc); if (idx < 0) idx = 0;
      var sel = $("dVerSel"); sel.innerHTML = "";
      curGroup.versions.forEach(function (d, i2) { var o = document.createElement("option"); o.value = i2; o.textContent = "Version " + (d.ver || "?"); sel.appendChild(o); });
      var multi = curGroup.versions.length > 1;
      $("dVerPick").style.display = multi ? "flex" : "none";
      $("dCmp").style.display = multi ? "block" : "none";
      if (multi) fillCmp();
      curVerIdx = idx; sel.value = idx;
      $("dTitle").textContent = (curDoc.li || curDoc.filename || "Document") + (curDoc.ver ? " · v" + curDoc.ver : "");
      updDStar();
      toast("Saved."); scheduleAutosave();
    }).catch(function () {
      // Roll back the in-memory record so docs[] matches storage (nothing was
      // committed — the migration is atomic), but leave the form inputs alone so
      // the user's typed edits stay visible to retry.
      curDoc.id = snap.id; FIELDS.forEach(function (k) { curDoc[k] = snap[k]; }); curDoc.edited = snap.edited;
      dDirty = true;
      toast("Couldn't save — storage may be full. Your changes are still shown; try again.");
    });
  });
  // Blobs restored from a .lidb backup come back through JSZip without a MIME
  // type, so the browser's built-in PDF viewer would render their raw bytes as
  // text. Guarantee the application/pdf type before we show or store one.
  function asPdf(blob) { return (blob && blob.type === "application/pdf") ? blob : new Blob([blob], { type: "application/pdf" }); }
  function dlBlob(blob, name) { var u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); }
  $("dDownload").addEventListener("click", function () { if (!curDoc) return; getFile(curDoc.id).then(function (b) { if (b) dlBlob(b, rlName(collectDetail())); }); });
  $("dDownloadOrig").addEventListener("click", function () { if (!curDoc) return; getFile(curDoc.id).then(function (b) { if (b) dlBlob(b, sanitize(curDoc.filename) || rlName(collectDetail())); }); });
  // Re-extract metadata from the stored PDF in place — lets entries imported
  // with an older extractor pick up improvements without re-importing files.
  // Re-extract a single stored doc in place, keeping hand-edited fields.
  // Returns true if re-read, false if it has no stored PDF. worker (optional):
  // a pooled PDF.js worker, for the concurrent "Re-read all" pass.
  function rereadDoc(d, worker) {
    return getFile(d.id).then(function (blob) {
      if (!blob) return false;
      var shim = { arrayBuffer: function () { return blob.arrayBuffer(); }, name: d.filename || "", size: d.size || blob.size };
      return extract(shim, worker).then(function (m) {
        // Don't let a re-read that produced nothing (e.g. a scanned doc re-read
        // while OCR is unavailable) wipe fields/text we already had. Only refresh
        // when the new parse yielded real text, or when there was nothing before.
        var gotText = !!(m.text && m.text.replace(/\s+/g, "").length);
        if (gotText || !(d.text && d.text.replace(/\s+/g, "").length)) {
          var ed = d.edited || {};
          ["li", "ver"].forEach(function (k) { if (!ed[k] && m[k] && !d[k]) d[k] = m[k]; });
          ["title", "reason", "fgroup", "date", "validity"].forEach(function (k) { if (!ed[k]) d[k] = m[k]; });
          d.text = m.text; d.pages = m.pages || 0; d.noText = m.noText; d.err = !!m.err;
        }
        return putDoc(d, null).then(function () { return true; });
      });
    });
  }
  $("dReread").addEventListener("click", function () {
    if (!curDoc) return;
    // Hold the import mutex so a concurrent import/re-read-all can't call
    // tessFreeAll() and terminate this re-read's live OCR worker mid-recognize.
    if (importing) { toast("Busy — wait for the current operation to finish."); return; }
    importing = true;
    var d = curDoc;
    toast("Re-reading PDF…");
    rereadDoc(d).then(function (ok) {
      if (!ok) { toast("No stored PDF for this entry."); return; }
      if (curDoc === d) loadVersion(curVerIdx);
      applyView(); updateStore(); scheduleAutosave();
      toast("Re-read complete — fields refreshed.");
    }, function () { toast("Couldn't re-read this PDF."); }).then(function () { tessFreeAll(); importing = false; });
  });
  // Re-run the parser over every stored PDF (keeps hand-edited fields), across
  // the worker pool. Useful after the extractor improves.
  function rereadAll() {
    if (importing) { toast("Busy — wait for the current operation to finish."); return; }
    if (!docs.length) { toast("No documents to re-read."); return; }
    if (!confirm("Re-read all " + docs.length + " document(s) from their stored PDFs?\nFields you edited by hand are kept.")) return;
    importing = true;
    loadPdf().catch(function () {}).then(function () { rereadAllLoaded(); });
  }
  function rereadAllLoaded() {
    var list = docs.slice(), pool = pdfPool(Math.min(list.length, 8)), cursor = 0, done = 0, failed = 0;
    toast("Re-reading… 0 / " + list.length);
    function lane(worker) {
      function next() {
        var idx = cursor++;
        if (idx >= list.length) return Promise.resolve();
        return rereadDoc(list[idx], worker).then(function (ok) { if (!ok) failed++; }, function () { failed++; }).then(function () {
          done++;
          if (done % 5 === 0 || done === list.length) toast("Re-reading… " + done + " / " + list.length);
        }).then(next);
      }
      return next();
    }
    Promise.all(pool.map(lane)).then(function () {
      tessFreeAll();
      importing = false;
      applyView(); updateStore(); scheduleAutosave();
      toast("Re-read " + (list.length - failed) + " document(s)." + (failed ? " ⚠ " + failed + " had no stored PDF." : ""));
    });
  }
  $("rereadAllBtn").addEventListener("click", rereadAll);
  $("dDelete").addEventListener("click", function () { if (!curDoc) return; if (!confirm("Delete this version from the database?")) return; delDoc(curDoc.id).then(function () { closeOverlays(); return refresh(); }).then(function () { toast("Deleted."); scheduleAutosave(); }); });

  // compare / diff
  function fillCmp() {
    [$("dCmpA"), $("dCmpB")].forEach(function (sel) { sel.innerHTML = ""; curGroup.versions.forEach(function (d, i) { var o = document.createElement("option"); o.value = i; o.textContent = "v" + (d.ver || "?"); sel.appendChild(o); }); });
    $("dCmpA").value = Math.min(1, curGroup.versions.length - 1); $("dCmpB").value = 0;
  }
  function lcs(a, b) {
    var n = a.length, m = b.length, dp = []; for (var i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
    for (i = n - 1; i >= 0; i--) for (var j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var ops = [], x = 0, y = 0;
    while (x < n && y < m) { if (a[x] === b[y]) { ops.push(["eq", x, y]); x++; y++; } else if (dp[x + 1][y] >= dp[x][y + 1]) { ops.push(["del", x]); x++; } else { ops.push(["ins", y]); y++; } }
    while (x < n) { ops.push(["del", x]); x++; } while (y < m) { ops.push(["ins", y]); y++; }
    return ops;
  }
  // Semantic cleanup: a 1-2 token equal run sandwiched between two larger
  // changed runs is a coincidental match (e.g. one shared word between a
  // rewritten filename and a rewritten description) — absorb it into the
  // change so the whole rewritten region highlights coherently.
  function cleanupOps(ops) {
    var changed = true, guard = 0, runs;
    // eq / mv (moved, from line-anchored move detection) / ch (real del+ins).
    function typeOf(op) { return op[0] === "eq" ? "eq" : (op[0] === "mvd" || op[0] === "mvi") ? "mv" : "ch"; }
    function toRuns(list) {
      var rs = [];
      list.forEach(function (op) { var t = typeOf(op); var last = rs[rs.length - 1]; if (last && last.t === t) last.ops.push(op); else rs.push({ t: t, ops: [op] }); });
      return rs;
    }
    while (changed && guard++ < 6) {
      changed = false;
      runs = toRuns(ops);
      for (var i = 1; i < runs.length - 1; i++) {
        var r = runs[i];
        if (r.t !== "eq" || runs[i - 1].t !== "ch" || runs[i + 1].t !== "ch") continue;
        if (r.ops.some(function (op) { return op[3]; })) continue; // never dissolve a whole-line match
        var L = r.ops.length, s1 = runs[i - 1].ops.length, s2 = runs[i + 1].ops.length;
        if (L <= 2 && s1 >= 2 && s2 >= 2 && s1 + s2 >= 6) {
          var conv = [];
          r.ops.forEach(function (op) { conv.push(["del", op[1]]); });
          r.ops.forEach(function (op) { conv.push(["ins", op[2]]); });
          r.t = "ch"; r.ops = conv; changed = true;
        }
      }
      ops = [];
      runs.forEach(function (r) { r.ops.forEach(function (op) { ops.push(op); }); });
    }
    // group each changed region as removals-then-additions for clean rendering;
    // eq and moved runs pass through unchanged (moves must not be dropped).
    var out = [];
    toRuns(ops).forEach(function (r) {
      if (r.t !== "ch") { r.ops.forEach(function (op) { out.push(op); }); return; }
      r.ops.forEach(function (op) { if (op[0] === "del") out.push(op); });
      r.ops.forEach(function (op) { if (op[0] === "ins") out.push(op); });
    });
    return out;
  }
  // Move detection: text removed in one place and re-inserted verbatim
  // somewhere else (reordered table rows, shuffled paragraphs) is movement,
  // not change. Find common runs (2+ tokens) between the removed and added
  // streams and mark them mvd/mvi so they aren't highlighted; then sweep up
  // stray single tokens sandwiched inside moved regions and bare punctuation.
  function dropMoves(ops, an, bn) {
    var delIdx = [], insIdx = [];
    ops.forEach(function (op, i) { if (op[0] === "del") delIdx.push(i); else if (op[0] === "ins") insIdx.push(i); });
    if (!delIdx.length || !insIdx.length || delIdx.length * insIdx.length > 250000) return ops;
    var D = delIdx.map(function (i) { return an[ops[i][1]]; });
    var I = insIdx.map(function (i) { return bn[ops[i][1]]; });
    // tokens count as one run only when adjacent in the ops stream (i.e. the
    // same removed/added region of the document) — otherwise scattered small
    // deletions could chain into a fake "moved block"
    var adjD = delIdx.map(function (oi, x) { return x > 0 && delIdx[x - 1] === oi - 1; });
    var adjI = insIdx.map(function (oi, x) { return x > 0 && insIdx[x - 1] === oi - 1; });
    var usedD = new Array(D.length), usedI = new Array(I.length);
    var guard = 0;
    while (guard++ < 40) {
      var best = 0, bi = -1, bj = -1, dp = [];
      for (var i = 0; i <= D.length; i++) dp.push(new Int32Array(I.length + 1));
      for (i = 1; i <= D.length; i++) for (var j = 1; j <= I.length; j++) {
        if (!usedD[i - 1] && !usedI[j - 1] && D[i - 1] === I[j - 1]) {
          dp[i][j] = (i > 1 && j > 1 && adjD[i - 1] && adjI[j - 1] && dp[i - 1][j - 1] > 0) ? dp[i - 1][j - 1] + 1 : 1;
          if (dp[i][j] > best) { best = dp[i][j]; bi = i; bj = j; }
        }
      }
      if (best < 3) break;
      for (var k = 0; k < best; k++) { usedD[bi - 1 - k] = 1; usedI[bj - 1 - k] = 1; }
    }
    function punct(s) { return /^[^A-Za-z0-9]+$/.test(s); }
    var changed = true, g2 = 0;
    while (changed && g2++ < 5) {
      changed = false;
      for (var x = 0; x < D.length; x++) {
        if (usedD[x]) continue;
        var sandD = (x > 0 && usedD[x - 1] && adjD[x]) || (x < D.length - 1 && usedD[x + 1] && adjD[x + 1]);
        if (!sandD) continue;
        for (var y = 0; y < I.length; y++) {
          if (usedI[y] || I[y] !== D[x]) continue;
          var sandI = (y > 0 && usedI[y - 1] && adjI[y]) || (y < I.length - 1 && usedI[y + 1] && adjI[y + 1]);
          if (punct(D[x]) || sandI) { usedD[x] = 1; usedI[y] = 1; changed = true; break; }
        }
      }
    }
    // when the diff is dominated by confirmed moved blocks (a reordered
    // document), stray equal fragments left over from LCS cross-matching
    // belong to those moves too; otherwise they are real changes and stay
    var usedCnt = 0;
    usedD.forEach(function (u) { if (u) usedCnt++; });
    usedI.forEach(function (u) { if (u) usedCnt++; });
    if (usedCnt >= 0.6 * (D.length + I.length)) {
      for (var x2 = 0; x2 < D.length; x2++) {
        if (usedD[x2]) continue;
        for (var y2 = 0; y2 < I.length; y2++) {
          if (!usedI[y2] && I[y2] === D[x2]) { usedD[x2] = 1; usedI[y2] = 1; break; }
        }
      }
    }
    usedD.forEach(function (u, k) { if (u) ops[delIdx[k]] = ["mvd", ops[delIdx[k]][1]]; });
    usedI.forEach(function (u, k) { if (u) ops[insIdx[k]] = ["mvi", ops[insIdx[k]][1]]; });
    return ops;
  }
  function words(s) { return String(s || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean); }
  // Compare words ignoring hyphens (so "equip-" + "ment." wrapped at a line
  // break equals its unwrapped form) and ignoring leading/trailing punctuation
  // (so "290:" equals "290," when a list grows and the colon shifts). A token
  // that is nothing but punctuation keeps its text so dashes don't collapse to "".
  function normTok(s) { var t = String(s).replace(/[-‐‑­]/g, "").replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""); return t || s; }
  function chunkTokens(w, size) { if (size <= 1) return w; var t = []; for (var i = 0; i < w.length; i += size) t.push(w.slice(i, i + size).join(" ")); return t; }
  // Line signature for header/footer detection: digits normalized so
  // "Page 2 / 4" matches "Page 3 / 4"; needs a few letters to qualify so
  // plain number lines (list values) never count as furniture.
  function lineSig(l) { var s = String(l).toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim(); return s.replace(/[^a-z]/g, "").length >= 4 ? s : ""; }
  // Furniture = a signature that repeats on 2+ DIFFERENT pages (page breaks
  // are "\f" lines in the stored text). Repeating same-shape content rows on
  // one page (torque tables: "Bolt M8 25 Nm" / "Bolt M10 30 Nm") never
  // qualify, so real changes in them are still diffed. Text extracted before
  // page markers existed has no "\f" — no furniture is dropped for it.
  function sigCounts(text) {
    var c = {}, pg = 0;
    String(text || "").split("\n").forEach(function (l) {
      if (l === "\f") { pg++; return; }
      var s = lineSig(l); if (s) (c[s] = c[s] || {})[pg] = 1;
    });
    var out = {};
    Object.keys(c).forEach(function (s2) { if (Object.keys(c[s2]).length >= 2) out[s2] = 1; });
    return out;
  }
  function contentWords(text, fa, fb) {
    var kept = String(text || "").split("\n").filter(function (l) { if (l === "\f") return false; var s = lineSig(l); return !(s && (fa[s] || fb[s])); }).join("\n");
    // rejoin words hyphenated across a line break so re-wrapped text matches
    var out = { w: [], ln: [] };
    kept.replace(/([A-Za-zÀ-ɏ])[-‐‑­]\n(\S+)/g, "$1$2").split("\n").forEach(function (l, li) {
      words(l).forEach(function (wd) { out.w.push(wd); out.ln.push(li); });
    });
    return out;
  }
  // Token-level diff ops shared by both views. Common prefix/suffix are
  // trimmed, and when a region is too large for an exact word LCS (~8M cells,
  // ~32MB) it is compared in fixed chunks first and each changed region is
  // recursively refined — so one inserted word can't misalign every later
  // chunk and paint thousands of unchanged words.
  function tokenOps(A, B) {
    var n = A.length, m = B.length, pre = 0, suf = 0;
    while (pre < n && pre < m && A[pre] === B[pre]) pre++;
    while (suf < n - pre && suf < m - pre && A[n - 1 - suf] === B[m - 1 - suf]) suf++;
    var ops = [];
    for (var i = 0; i < pre; i++) ops.push(["eq", i, i]);
    tokenOpsCore(A, B, pre, n - suf, pre, m - suf, ops, 0);
    for (i = 0; i < suf; i++) ops.push(["eq", n - suf + i, m - suf + i]);
    return ops;
  }
  function tokenOpsCore(A, B, a0, a1, b0, b1, ops, depth) {
    var la = a1 - a0, lb = b1 - b0, i, k, q;
    if (!la && !lb) return;
    if (!la) { for (i = b0; i < b1; i++) ops.push(["ins", i]); return; }
    if (!lb) { for (i = a0; i < a1; i++) ops.push(["del", i]); return; }
    var size = 1;
    while ((Math.ceil(la / size) + 1) * (Math.ceil(lb / size) + 1) > 8e6) size *= 2;
    if (size === 1) {
      lcs(A.slice(a0, a1), B.slice(b0, b1)).forEach(function (op) {
        if (op[0] === "eq") ops.push(["eq", a0 + op[1], b0 + op[2]]);
        else if (op[0] === "del") ops.push(["del", a0 + op[1]]);
        else ops.push(["ins", b0 + op[1]]);
      });
      return;
    }
    var ca = chunkTokens(A.slice(a0, a1), size), cb = chunkTokens(B.slice(b0, b1), size);
    var cops = lcs(ca, cb);
    function coarse(op) {
      if (op[0] === "eq") { var ai = a0 + op[1] * size, bi = b0 + op[2] * size, len = ca[op[1]].split(" ").length; for (q = 0; q < len; q++) ops.push(["eq", ai + q, bi + q]); }
      else if (op[0] === "del") { for (var x = a0 + op[1] * size, ex = Math.min(x + size, a1); x < ex; x++) ops.push(["del", x]); }
      else { for (var y = b0 + op[1] * size, ey = Math.min(y + size, b1); y < ey; y++) ops.push(["ins", y]); }
    }
    if (depth >= 5) { cops.forEach(coarse); return; }
    k = 0;
    while (k < cops.length) {
      if (cops[k][0] === "eq") { coarse(cops[k]); k++; continue; }
      var d0 = -1, d1 = -1, s0 = -1, s1 = -1;
      while (k < cops.length && cops[k][0] !== "eq") {
        if (cops[k][0] === "del") { if (d0 < 0) d0 = cops[k][1]; d1 = cops[k][1]; }
        else { if (s0 < 0) s0 = cops[k][1]; s1 = cops[k][1]; }
        k++;
      }
      var ra0 = d0 < 0 ? a0 : a0 + d0 * size, ra1 = d0 < 0 ? a0 : Math.min(a0 + (d1 + 1) * size, a1);
      var rb0 = s0 < 0 ? b0 : b0 + s0 * size, rb1 = s0 < 0 ? b0 : Math.min(b0 + (s1 + 1) * size, b1);
      if (ra0 === a0 && ra1 === a1 && rb0 === b0 && rb1 === b1) {
        // nothing matched at this granularity — emit coarse, recursing would not converge
        for (var x2 = ra0; x2 < ra1; x2++) ops.push(["del", x2]);
        for (var y2 = rb0; y2 < rb1; y2++) ops.push(["ins", y2]);
      } else {
        tokenOpsCore(A, B, ra0, ra1, rb0, rb1, ops, depth + 1);
      }
    }
  }
  // Two-level diff: align whole LINES first (unique lines anchor the match,
  // so a block of near-identical boilerplate sentences can't cross-match
  // word runs from unrelated parts of the document), then word-diff inside
  // each changed line region for word-precise highlights.
  function lineAnchoredOps(An, La, Bn, Lb) {
    function toLines(N, L) {
      var arr = [], cur = null, last;
      for (var i = 0; i < N.length; i++) {
        if (!cur || L[i] !== last) { cur = { s: i, e: i + 1 }; arr.push(cur); last = L[i]; }
        else cur.e = i + 1;
      }
      arr.forEach(function (r) { r.str = N.slice(r.s, r.e).join(" "); });
      return arr;
    }
    var ra = toLines(An, La), rb = toLines(Bn, Lb);
    var lops = tokenOps(ra.map(function (r) { return r.str; }), rb.map(function (r) { return r.str; }));
    // Whole-line move detection: a deleted line whose exact text reappears as an
    // inserted line elsewhere is a reordered line (a sorted/shuffled list), not
    // a change. Pair them so they're marked moved instead of removed+added —
    // this stops a re-sorted list (e.g. Validity model rows) from lighting up.
    var insByStr = {}, moved = {};
    for (var li = 0; li < lops.length; li++) if (lops[li][0] === "ins") { var s0 = rb[lops[li][1]].str; if (s0) (insByStr[s0] = insByStr[s0] || []).push(li); }
    for (li = 0; li < lops.length; li++) if (lops[li][0] === "del") { var s1 = ra[lops[li][1]].str, bucket = s1 && insByStr[s1]; if (bucket && bucket.length) { moved[li] = 1; moved[bucket.shift()] = 1; } }
    var ops = [], k = 0;
    while (k < lops.length) {
      if (lops[k][0] === "eq") {
        var a = ra[lops[k][1]], b = rb[lops[k][2]];
        // 4th element marks a whole-line match — cleanupOps must not dissolve it.
        for (var q = 0; a.s + q < a.e; q++) ops.push(["eq", a.s + q, b.s + q, 1]);
        k++; continue;
      }
      if (moved[k]) {
        if (lops[k][0] === "del") { var rd = ra[lops[k][1]]; for (var qd = rd.s; qd < rd.e; qd++) ops.push(["mvd", qd]); }
        else { var rin = rb[lops[k][1]]; for (var qi = rin.s; qi < rin.e; qi++) ops.push(["mvi", qi]); }
        k++; continue;
      }
      // A contiguous run of changed, non-moved lines — refine to word level.
      var aS = -1, aE = -1, bS = -1, bE = -1;
      while (k < lops.length && lops[k][0] !== "eq" && !moved[k]) {
        if (lops[k][0] === "del") { var r1 = ra[lops[k][1]]; if (aS < 0) aS = r1.s; aE = r1.e; }
        else { var r2 = rb[lops[k][1]]; if (bS < 0) bS = r2.s; bE = r2.e; }
        k++;
      }
      if (aS >= 0 || bS >= 0) tokenOpsCore(An, Bn, aS < 0 ? 0 : aS, aS < 0 ? 0 : aE, bS < 0 ? 0 : bS, bS < 0 ? 0 : bE, ops, 0);
    }
    return ops;
  }
  // Word-level diff as [type, text, wordCount(, mvSide)] runs for the text view.
  function diffRuns(A, B, La, Lb) {
    var An = A.map(normTok), Bn = B.map(normTok);
    var raw = La ? lineAnchoredOps(An, La, Bn, Lb) : tokenOps(An, Bn);
    var ops = dropMoves(cleanupOps(raw), An, Bn), runs = [], i = 0;
    while (i < ops.length) {
      var t = ops[i][0], acc = [];
      if (t === "eq") { while (i < ops.length && ops[i][0] === "eq") { acc.push(A[ops[i][1]]); i++; } runs.push(["eq", acc.join(" "), acc.length]); continue; }
      if (t === "mvd") { while (i < ops.length && ops[i][0] === "mvd") { acc.push(A[ops[i][1]]); i++; } runs.push(["mv", acc.join(" "), acc.length, "d"]); continue; }
      if (t === "mvi") { while (i < ops.length && ops[i][0] === "mvi") { acc.push(B[ops[i][1]]); i++; } runs.push(["mv", acc.join(" "), acc.length, "i"]); continue; }
      if (t === "del") { while (i < ops.length && ops[i][0] === "del") { acc.push(A[ops[i][1]]); i++; } runs.push(["del", acc.join(" "), acc.length]); continue; }
      while (i < ops.length && ops[i][0] === "ins") { acc.push(B[ops[i][1]]); i++; }
      runs.push(["ins", acc.join(" "), acc.length]);
    }
    return runs;
  }
  // Same diff, but as sets of changed token indices (for page highlighting).
  function diffIndexSets(A, B, La, Lb) {
    var raw = La ? lineAnchoredOps(A, La, B, Lb) : tokenOps(A, B);
    var ops = dropMoves(cleanupOps(raw), A, B), del = {}, ins = {};
    ops.forEach(function (op) { if (op[0] === "del") del[op[1]] = 1; else if (op[0] === "ins") ins[op[1]] = 1; });
    return { del: del, ins: ins };
  }

  // ---- side-by-side page view with changes painted on the pages ----
  var vSeq = 0;
  function showDiffMode(m) {
    $("vDiff").style.display = m === "pages" ? "grid" : "none";
    $("diffOut").style.display = m === "pages" ? "none" : "";
    $("diffModePages").classList.toggle("on", m === "pages");
    $("diffModeText").classList.toggle("on", m !== "pages");
  }
  $("diffModePages").addEventListener("click", function () { showDiffMode("pages"); });
  $("diffModeText").addEventListener("click", function () { showDiffMode("text"); });
  var vSync = false;
  function syncScroll(src, dst) {
    if (vSync) return; vSync = true;
    var f = src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight);
    dst.scrollTop = f * Math.max(0, dst.scrollHeight - dst.clientHeight);
    requestAnimationFrame(function () { vSync = false; });
  }
  $("vColA").addEventListener("scroll", function () { syncScroll(this, $("vColB")); });
  $("vColB").addEventListener("scroll", function () { syncScroll(this, $("vColA")); });

  // Render every page of one PDF into a column; return one entry per word
  // with its pixel rectangle and the canvas context it was drawn on.
  function renderSide(pdf, col, seq) {
    var MAXP = Math.min(pdf.numPages, 25), out = [], i = 1;
    var cw = col.clientWidth;
    if (!cw) { var mo = document.querySelector("#diffOverlay .modal"); cw = mo && mo.clientWidth ? Math.max(mo.clientWidth / 2 - 40, 300) : 620; }
    var colW = Math.max(cw - 20, 200);
    function step() {
      if (seq !== vSeq) return Promise.resolve(out);
      if (i > MAXP) {
        if (pdf.numPages > MAXP) col.insertAdjacentHTML("beforeend", '<div class="vnote">… ' + (pdf.numPages - MAXP) + " more page(s) not shown</div>");
        return Promise.resolve(out);
      }
      return pdf.getPage(i).then(function (page) {
        if (seq !== vSeq) return out;
        var scale = Math.min(colW / page.getViewport({ scale: 1 }).width * (window.devicePixelRatio || 1), 3);
        var vp = page.getViewport({ scale: scale });
        var c = document.createElement("canvas"); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        col.appendChild(c);
        var ctx = c.getContext("2d");
        return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () { return page.getTextContent(); }).then(function (tc) {
          if (seq !== vSeq) return out;
          tc.items.forEach(function (it) {
            var s = normChars(it.str); if (!s || !s.trim()) return;
            var t = pdfjsLib.Util.transform(vp.transform, it.transform);
            var fh = Math.hypot(t[2], t[3]) || 10, wpx = (it.width || 0) * vp.scale;
            // Position words inside the run by measured glyph widths (with the
            // font family PDF.js reports), not by character count — char-count
            // fractions drift on proportional fonts and misplace highlights.
            var st = tc.styles && tc.styles[it.fontName];
            ctx.font = fh + "px " + ((st && st.fontFamily) || "sans-serif");
            var wFull = ctx.measureText(s).width;
            var re = /\S+/g, mm;
            while ((mm = re.exec(s))) {
              var f0, f1;
              if (wFull > 0) { f0 = ctx.measureText(s.slice(0, mm.index)).width / wFull; f1 = ctx.measureText(s.slice(0, mm.index + mm[0].length)).width / wFull; }
              else { f0 = mm.index / s.length; f1 = (mm.index + mm[0].length) / s.length; }
              out.push({ w: mm[0], ctx: ctx, x: t[4] + wpx * f0, y: t[5] - fh, wd: Math.max(wpx * (f1 - f0), 2), ht: fh * 1.2, pg: i, lk: Math.round(t[5] / 4), ry: t[5] / c.height });
            }
          });
          i++; return step();
        });
      });
    }
    return step();
  }
  // Words broken across a line break reflow into one word when the other
  // version wraps differently — merge the fragments into a single comparison
  // token that highlights both halves if it really changed.
  //
  // Two shapes of break occur. A hyphen ("equip-" / "ment."), and — in
  // XENTRY's newer exports — a break straight after a typographic apostrophe
  // ("…extend the vehicle’" / "s warranty in any way."). The second used to
  // leave "vehicle’" and "s" as separate tokens against the other version's
  // whole "vehicle’s", reporting a deletion and an insertion of text nobody
  // touched. Rejoin it only when what follows is an English possessive or
  // contraction suffix, so a line that genuinely ends on a closing quote is
  // left alone.
  var WRAP_HYPHEN = /[-‐‑­]$/;
  var WRAP_APOS = /['’ʼ′]$/;
  var APOS_SUFFIX = /^(?:s|t|d|m|ll|re|ve)\b/i;
  function wrapsInto(txt, next) {
    return WRAP_HYPHEN.test(txt) || (WRAP_APOS.test(txt) && APOS_SUFFIX.test(next.w));
  }
  function mergeHyphens(list) {
    var toks = [];
    for (var i = 0; i < list.length; i++) {
      var txt = list[i].w, rs = [list[i]];
      while (i + 1 < list.length && (list[i].pg !== list[i + 1].pg || list[i].lk !== list[i + 1].lk) && wrapsInto(txt, list[i + 1])) {
        i++; txt += list[i].w; rs.push(list[i]);
      }
      toks.push({ w: txt, rs: rs });
    }
    return toks;
  }
  function paintWords(toks, idx, color, rects) {
    var n = 0;
    toks.forEach(function (t, i) {
      if (!idx[i]) return; n++;
      t.rs.forEach(function (w) { w.ctx.fillStyle = color; w.ctx.fillRect(w.x - 1.5, w.y - 1.5, w.wd + 3, w.ht + 3); if (rects) rects.push({ w: w.w, x: w.x, y: w.y, wd: w.wd, pg: w.pg }); });
    });
    return n;
  }
  // Lines that repeat on 2+ pages at the same height (headers, footers, page
  // numbers, print dates) reflow across page breaks between versions and would
  // show as false differences — tag each word with its line signature (digits
  // normalized) and collect the repeating ones so they can sit out the diff.
  // "09-09-2026 22:30:49", "9/8/26 10:14 PM" — a line made only of a date
  // and/or a clock time, with nothing else on it.
  function isStampLine(txt) {
    var rest = String(txt)
      .replace(/\d{1,4}[-.\/]\d{1,2}[-.\/]\d{1,4}/g, "")
      .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, "")
      .replace(/\b[AP]\.?M\.?\b/gi, "")
      .replace(/[\s,]+/g, "");
    return rest === "" && /\d/.test(txt);
  }
  function furnSigs(list) {
    var lines = {};
    list.forEach(function (w) { var k = w.pg + "|" + w.lk; (lines[k] = lines[k] || []).push(w); });
    var pages = {};
    Object.keys(lines).forEach(function (k) {
      var ws = lines[k].sort(function (a, b) { return a.x - b.x; });
      var raw = ws.map(function (w) { return w.w; }).join(" ");
      var sig = raw.toLowerCase().replace(/\d+/g, "#");
      // A signature needs some letters to be worth trusting — except for the
      // print stamp, a footer line that is nothing but a date and/or time and
      // so has no letters at all. Without this it never qualified as
      // furniture, and since two versions are exported at different moments it
      // reported a change on every page of every comparison.
      if (sig.replace(/[^a-z]/g, "").length < 4 && !isStampLine(raw)) sig = "";
      ws.forEach(function (w) { w.sig = sig; });
      var band = Math.round(ws[0].ry * 40);
      ws.forEach(function (w) { w.band = band; });
      if (!sig) return;
      var bk = sig + "@" + band;
      (pages[bk] = pages[bk] || {})[ws[0].pg] = 1;
    });
    var out = {};
    Object.keys(pages).forEach(function (b) { if (Object.keys(pages[b]).length >= 2) out[b] = 1; });
    return out;
  }
  function isFurn(furn, w) {
    if (!w.sig) return false;
    return !!(furn[w.sig + "@" + w.band] || furn[w.sig + "@" + (w.band - 1)] || furn[w.sig + "@" + (w.band + 1)]);
  }
  var vDocs = [];
  function vCleanDocs() { vDocs.forEach(function (d) { try { d.destroy(); } catch (e) {} }); vDocs = []; }
  function visualDiff(a, b) {
    var seq = ++vSeq, colA = $("vColA"), colB = $("vColB");
    vCleanDocs();
    colA.innerHTML = colB.innerHTML = '<div class="vnote">Rendering pages…</div>';
    $("vHeadA").innerHTML = "v" + esc(a.ver || "?") + ' <span class="sw" style="background:#3a1d22">removed highlighted</span>';
    $("vHeadB").innerHTML = "v" + esc(b.ver || "?") + ' <span class="sw" style="background:#16321f">added highlighted</span>';
    Promise.all([getFile(a.id), getFile(b.id), loadPdf().catch(function () { return null; })]).then(function (bl) {
      if (seq !== vSeq) return;
      if (!bl[0] || !bl[1]) { colA.innerHTML = colB.innerHTML = '<div class="vnote">Couldn\'t load the PDF files.</div>'; return; }
      return Promise.all([bl[0].arrayBuffer(), bl[1].arrayBuffer()]).then(function (bufs) {
        if (seq !== vSeq) return;
        // Tolerate one side failing to parse so the other's loaded proxy is
        // still destroyed rather than leaked.
        return Promise.all([pdfjsLib.getDocument({ data: bufs[0], isEvalSupported: false }).promise.catch(function () { return null; }), pdfjsLib.getDocument({ data: bufs[1], isEvalSupported: false }).promise.catch(function () { return null; })]);
      }).then(function (pdfs) {
        if (!pdfs) return;
        if (seq !== vSeq || !pdfs[0] || !pdfs[1]) {
          pdfs.forEach(function (d) { if (d) try { d.destroy(); } catch (e) {} });
          if (seq === vSeq) colA.innerHTML = colB.innerHTML = '<div class="vnote">Couldn\'t render the pages.</div>';
          return;
        }
        vDocs = pdfs.slice();
        colA.innerHTML = ""; colB.innerHTML = "";
        return Promise.all([renderSide(pdfs[0], colA, seq), renderSide(pdfs[1], colB, seq)]);
      }).then(function (sides) {
        if (!sides || seq !== vSeq) return;
        var wa = sides[0], wb = sides[1];
        if (!wa.length || !wb.length) {
          // a one-sided compare would mark EVERY word on the other side as
          // changed — show the notes and skip highlighting entirely
          if (!wa.length) colA.insertAdjacentHTML("afterbegin", '<div class="vnote">No text layer (scanned PDF) — changes can\'t be highlighted.</div>');
          if (!wb.length) colB.insertAdjacentHTML("afterbegin", '<div class="vnote">No text layer (scanned PDF) — changes can\'t be highlighted.</div>');
          window.__vdiffInfo = { wordsA: wa.length, wordsB: wb.length, del: 0, ins: 0, rects: { del: [], ins: [] } };
          vCleanDocs();
          return;
        }
        var furn = furnSigs(wa), furnB = furnSigs(wb);
        Object.keys(furnB).forEach(function (k) { furn[k] = 1; });
        var fa = wa.filter(function (w) { return !isFurn(furn, w); }), fb = wb.filter(function (w) { return !isFurn(furn, w); });
        var ta = mergeHyphens(fa), tb = mergeHyphens(fb);
        var sets = diffIndexSets(
          ta.map(function (t) { return normTok(t.w); }), tb.map(function (t) { return normTok(t.w); }),
          ta.map(function (t) { return t.rs[0].pg + ":" + t.rs[0].lk; }), tb.map(function (t) { return t.rs[0].pg + ":" + t.rs[0].lk; }));
        var rects = { del: [], ins: [] };
        var nd = paintWords(ta, sets.del, "rgba(255,90,110,0.34)", rects.del);
        var ni = paintWords(tb, sets.ins, "rgba(80,220,140,0.32)", rects.ins);
        window.__vdiffInfo = { wordsA: wa.length, wordsB: wb.length, del: nd, ins: ni, rects: rects };
        vCleanDocs();
      });
    }).catch(function () { if (seq === vSeq) { colA.innerHTML = colB.innerHTML = '<div class="vnote">Couldn\'t render the pages.</div>'; vCleanDocs(); } });
  }

  $("dCmpGo").addEventListener("click", function () {
    if (!curGroup) return;
    var a = curGroup.versions[+$("dCmpA").value], b = curGroup.versions[+$("dCmpB").value];
    var ca = sigCounts(a.text), cb = sigCounts(b.text);
    var cwA = contentWords(a.text, ca, cb), cwB = contentWords(b.text, ca, cb);
    var A = cwA.w, B = cwB.w;
    var runs = diffRuns(A, B, cwA.ln, cwB.ln), out = [], adds = 0, dels = 0, moved = 0;
    runs.forEach(function (r) {
      if (r[0] === "eq") out.push('<span class="d-eq">' + esc(r[1]) + "</span>");
      else if (r[0] === "mv") { if (r[3] === "d") moved += r[2]; out.push('<span class="d-eq">' + esc(r[1]) + "</span>"); }
      else if (r[0] === "del") { dels += r[2]; out.push('<span class="d-del">' + esc(r[1]) + "</span>"); }
      else { adds += r[2]; out.push('<span class="d-ins">' + esc(r[1]) + "</span>"); }
    });
    var same = adds === 0 && dels === 0;
    $("diffOut").innerHTML = !A.length && !B.length ? '<div style="padding:14px" class="muted">No extracted text to compare (scanned without OCR).</div>'
      : same ? '<div style="padding:14px" class="muted">' + (moved ? "No wording changes — content was only reordered." : "The two versions have identical extracted text.") + "</div>" : '<div class="wdiff">' + out.join(" ") + "</div>";
    $("diffSum").innerHTML = '<span class="rem">−' + dels + " word(s) removed</span> · <span class=\"add\">+" + adds + " word(s) added</span>"
      + (moved ? ' · <span class="muted">' + moved + " word(s) moved (not highlighted)</span>" : "")
      + '<span class="diff-legend"><span class="sw d-del" style="background:#3a1d22">removed</span><span class="sw d-ins" style="background:#16321f">added</span></span>';
    if ((a.pages || 0) > 10 || (b.pages || 0) > 10) $("diffSum").innerHTML += ' · <span class="muted">text view covers the first 10 pages</span>';
    $("diffTitle").textContent = "Changes · " + (curGroup.li || "") + " · v" + (a.ver || "?") + " → v" + (b.ver || "?");
    showDiffMode("pages");
    $("diffOverlay").classList.add("show");
    visualDiff(a, b);
  });

  function closeOverlays() {
    if ($("detailOverlay").classList.contains("show") && dDirty && !confirm("Discard unsaved changes to this document?")) return;
    var wasDetail = $("detailOverlay").classList.contains("show");
    dDirty = false; vSeq++; vCleanDocs(); curDoc = null; curGroup = null; navStack = [];
    $("detailOverlay").classList.remove("show"); $("importOverlay").classList.remove("show"); $("diffOverlay").classList.remove("show"); $("installOverlay").classList.remove("show");
    if (curUrl) { URL.revokeObjectURL(curUrl); curUrl = null; } $("dFrame").src = "about:blank";
    if (wasDetail) setHash("");
  }
  // ---------- permalinks + quick copy ----------
  // Reflect the open document in the URL (#LI…) via replaceState so it's
  // shareable/bookmarkable without cluttering browser history.
  function setHash(li) { try { history.replaceState(null, "", li ? ("#" + encodeURIComponent(li)) : (location.pathname + location.search)); } catch (e) {} }
  function openFromHash() {
    var h = (location.hash || "").replace(/^#/, ""); if (!h) return;
    try { h = decodeURIComponent(h); } catch (e) {}
    if (!groupsByKey[liKey(h)] || (curGroup && curGroup.key === liKey(h))) return;
    // Don't silently discard unsaved edits when a link is pasted mid-edit.
    if (dDirty && !confirm("Discard unsaved changes to this document?")) { setHash(curGroup ? (curGroup.li || "") : ""); return; }
    dDirty = false; navStack = [];
    openDetail(liKey(h));
  }
  // React to a link pasted/opened while the app is already running. Our own
  // URL updates use replaceState, which doesn't fire this — so no loop.
  window.addEventListener("hashchange", openFromHash);
  function copyText(txt, okMsg) {
    if (!txt) { toast("Nothing to copy."); return; }
    var done = function () { toast(okMsg || "Copied."); };
    var fb = function () { try { var ta = document.createElement("textarea"); ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); var ok = document.execCommand("copy"); document.body.removeChild(ta); ok ? done() : toast("Couldn't copy."); } catch (e) { toast("Couldn't copy."); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, fb); else fb();
  }
  $("dCopyLi").addEventListener("click", function () { copyText($("dLi").value.trim(), "LI number copied."); });
  $("dCopyName").addEventListener("click", function () { copyText(rlName(collectDetail()), "Filename copied."); });
  $("dCopyLink").addEventListener("click", function () {
    var li = ($("dLi").value || "").trim(); if (!li) { toast("This document has no LI number to link to."); return; }
    copyText(location.href.split("#")[0] + "#" + encodeURIComponent(li), "Link copied.");
  });
  document.querySelectorAll("[data-close]").forEach(function (b) { b.addEventListener("click", closeOverlays); });
  // Close the diff overlay from every path (button, backdrop, Escape) through
  // one function, so the rendered PDF.js documents are always destroyed.
  function closeDiff() { vSeq++; vCleanDocs(); $("diffOverlay").classList.remove("show"); }
  $("diffClose").addEventListener("click", closeDiff);
  document.querySelectorAll(".overlay").forEach(function (o) { o.addEventListener("click", function (e) { if (e.target !== o) return; if (o.id === "diffOverlay") closeDiff(); else closeOverlays(); }); });
  document.addEventListener("keydown", function (e) { if (e.key !== "Escape") return; if ($("diffOverlay").classList.contains("show")) closeDiff(); else closeOverlays(); });

  // ---------- PWA: offline cache + native install ----------
  // Only possible when served over http(s) — double-clicked file:// copies
  // keep working exactly as before, via the manual install options below.
  var nativeInstall = null;
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register("sw.js").then(function (reg) {
      reg.addEventListener("updatefound", function () {
        var w = reg.installing;
        if (!w) return;
        w.addEventListener("statechange", function () {
          if (w.state === "installed" && navigator.serviceWorker.controller) toast("App updated — reload to get the newest version.");
        });
      });
    }).catch(function () {});
  }
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); nativeInstall = e; });
  window.addEventListener("appinstalled", function () { nativeInstall = null; updInstallBtn(); toast("Installed — look for “LI Document Database” in your Start menu / desktop."); });

  // Launched from an installed icon (PWA, Edge app, or a --app shortcut/.bat)?
  // Those all run in an app/standalone display mode — hide the Install button.
  function isAppMode() {
    if (navigator.standalone === true) return true; // iOS home-screen
    return !!(window.matchMedia && ["standalone", "minimal-ui", "fullscreen"].some(function (m) {
      return window.matchMedia("(display-mode: " + m + ")").matches;
    }));
  }
  function updInstallBtn() { var hide = isAppMode() || document.documentElement.classList.contains("embedded"); $("installBtn").style.display = hide ? "none" : ""; $("menuSepInstall").style.display = hide ? "none" : ""; }
  updInstallBtn();
  if (window.matchMedia) ["standalone", "minimal-ui", "fullscreen"].forEach(function (m) {
    var mq = window.matchMedia("(display-mode: " + m + ")");
    (mq.addEventListener ? mq.addEventListener.bind(mq, "change") : mq.addListener.bind(mq))(updInstallBtn);
  });

  // ---------- header overflow menu ----------
  function closeMenu() { $("appMenu").hidden = true; $("menuBtn").setAttribute("aria-expanded", "false"); }
  $("menuBtn").addEventListener("click", function (e) {
    e.stopPropagation();
    var willOpen = $("appMenu").hidden;
    $("appMenu").hidden = !willOpen;
    $("menuBtn").setAttribute("aria-expanded", String(willOpen));
  });
  // Choosing any item runs its own handler, then closes the menu.
  $("appMenu").addEventListener("click", function (e) { if (e.target.closest(".menu-item")) closeMenu(); });
  document.addEventListener("click", function (e) { if (!$("appMenu").hidden && !$("appMenu").contains(e.target) && e.target !== $("menuBtn")) closeMenu(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("appMenu").hidden) closeMenu(); });
  $("debugBtn").addEventListener("click", function () { if (window.FVDebug) window.FVDebug.open(); });

  // ---------- install as desktop app ----------
  // Windows .ico (16/32/48/256) of the app icon, for desktop shortcuts
  var ICO_B64 = "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F/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRfPKx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/zEgGP9CKB3/Qigd/0IoHf9CKB3/Qigd/0IoHf9CKB3/Qigd/0IoHf9CKB3/Qigd/0IoHf9CKB3/Qigd/0IoHf9CKB3/MSAY/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/ajwn/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv9qPCf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/9vPyj/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/28/KP8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/28/KP+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/bz8o/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/bz8o/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv9vPyj/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/9vPyj/hkou/4ZKLv+GSi7/hkou/4ZKLv9nOiX/KhkS/yQWEP8kFhD/KhkS/2c6Jf+GSi7/hkou/4ZKLv+GSi7/hkou/28/KP8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/28/KP+GSi7/hkou/4ZKLv+GSi7/hkou/3RAKP9VMB//VTAf/1UwH/9VMB//dEAo/4ZKLv+GSi7/hkou/4ZKLv+GSi7/bz8o/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/bz8o/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv9vPyj/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/9vPyj/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/28/KP8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/142JP+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/XjYk/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/zwlG/9CKB3/Qigd/0IoHf9CKB3/Qigd/0IoHf9CKB3/Qigd/0IoHf9CKB3/Qigd/0IoHf9CKB3/Qigd/zwlG/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/UzIk/2A5KP9gOSj/YDko/2A5KP9gOSj/YDko/2A5KP9gOSj/YDko/2A5KP9gOSj/YDko/2A5KP9gOSj/UzIk/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/6JbPf//jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv/ols9/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/ynBK//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW//KcEr/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF//KcEr//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb/8pwSv8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/8pwSv//jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv/ynBK/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/ynBK//+MW///jFv//4xb//+MW///jFv/u2dE/1s0I/9bNCP/WzQj/1s0I/+7Z0T//4xb//+MW///jFv//4xb//+MW//KcEr/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF//KcEr//4xb//+MW///jFv//4xb//+MW//Wdk3/aDsn/1s0I/9bNCP/aDsn/9Z2Tf//jFv//4xb//+MW///jFv//4xb/8pwSv8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/8pwSv//jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv/ynBK/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/ynBK//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW//KcEr/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/+9aUb//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb/71pRv8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/zgkG/9gOSj/YDko/2A5KP9gOSj/YDko/2A5KP9gOSj/YDko/2A5KP9gOSj/YDko/2A5KP9gOSj/YDko/2A5KP9gOSj/OCQb/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRfPKx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0XzysdF3ArHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRdwAAAAACsdF88rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0XzwAAAAAAAAAAKx0XECsdF88rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF88rHRcQAAAAAAAAAAAAAAAAAAAAACsdF3ArHRfPKx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF88rHRdwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAoAAAAMAAAAGAAAAABACAAAAAAAAAkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAArHRdAKx0XnysdF98rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF98rHRefKx0XQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKx0XMCsdF78rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF78rHRcwAAAAAAAAAAAAAAAAAAAAAAAAAAArHRcwKx0X7ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRfvKx0XMAAAAAAAAAAAAAAAACsdFzArHRfvKx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X7ysdFzAAAAAAAAAAACsdF78rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF78AAAAAKx0XQCsdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRdAKx0XnysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRefKx0X3ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRffKx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8xIBj/TS4g/1k0I/9ZNCP/WTQj/1k0I/9ZNCP/WTQj/1k0I/9ZNCP/WTQj/1k0I/9ZNCP/WTQj/1k0I/9ZNCP/WTQj/1k0I/9ZNCP/WTQj/1k0I/9ZNCP/WTQj/1k0I/9NLiD/MSAY/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/97RCv/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/e0Qr/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/zwlG/+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/zwlG/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/0IoHf+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/0IoHf8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/0IoHf+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/0IoHf8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/0IoHf+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/0IoHf8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/0IoHf+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/0IoHf8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/0IoHf+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv9hNyP/PSMY/z0jGP89Ixj/PSMY/z0jGP89Ixj/YTcj/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/0IoHf8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/0IoHf+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv9DJhn/JBYQ/yQWEP8kFhD/JBYQ/yQWEP8kFhD/QyYZ/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/0IoHf8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/0IoHf+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+ARyz/bj0n/249J/9uPSf/bj0n/249J/9uPSf/gEcs/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/0IoHf8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/0IoHf+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/0IoHf8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/0IoHf+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/0IoHf8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/0IoHf+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/0IoHf8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/4ZKLv+GSi7/hkou/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/9HKx7/bz8o/28/KP9vPyj/bz8o/28/KP9vPyj/bz8o/28/KP9vPyj/bz8o/28/KP9vPyj/bz8o/28/KP9vPyj/bz8o/28/KP9vPyj/bz8o/28/KP9vPyj/bz8o/28/KP9vPyj/Ryse/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/9tQCz/ynBK/8pwSv/KcEr/ynBK/8pwSv/KcEr/ynBK/8pwSv/KcEr/ynBK/8pwSv/KcEr/ynBK/8pwSv/KcEr/ynBK/8pwSv/KcEr/ynBK/8pwSv/KcEr/ynBK/8pwSv/KcEr/bUAs/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/2A5KP//jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb/2A5KP8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/2A5KP//jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb/2A5KP8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/2A5KP//jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb/2A5KP8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/2A5KP//jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb/2A5KP8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/2A5KP//jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv/1nZN/8hvSP/Ib0j/yG9I/8hvSP/Wdk3//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb/2A5KP8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/2A5KP//jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW/92Qiz/JBYQ/yQWEP8kFhD/JBYQ/yQWEP8kFhD/dkIs//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb/2A5KP8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/2A5KP//jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW/+SUTb/JBYQ/yQWEP8kFhD/JBYQ/yQWEP8kFhD/klE2//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb/2A5KP8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/2A5KP//jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb/2A5KP8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/2A5KP//jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb/2A5KP8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/2A5KP//jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb/2A5KP8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/1MyJP//jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb/1MyJP8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF//lflP//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv//4xb//+MW///jFv/5X5T/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/84JBv/e0cx/5VVOf+VVTn/lVU5/5VVOf+VVTn/lVU5/5VVOf+VVTn/lVU5/5VVOf+VVTn/lVU5/5VVOf+VVTn/lVU5/5VVOf+VVTn/lVU5/5VVOf+VVTn/lVU5/5VVOf97RzH/OCQb/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X3ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRffKx0XnysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRefKx0XQCsdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRdAAAAAACsdF78rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF78AAAAAAAAAACsdFzArHRfvKx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X7ysdFzAAAAAAAAAAAAAAAAArHRcwKx0X7ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRfvKx0XMAAAAAAAAAAAAAAAAAAAAAAAAAAAKx0XMCsdF78rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysdF/8rHRf/Kx0X/ysd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";
  $("installBtn").addEventListener("click", function () {
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) { toast("Already running as an installed app."); return; }
    // Hosted as a PWA: the browser can install it natively in one click.
    // The event's prompt() only works once — if the user dismisses it, the
    // next click falls through to the manual instructions below.
    if (nativeInstall) {
      var p = nativeInstall; nativeInstall = null;
      p.prompt();
      return;
    }
    // "start <name>" resolves chrome/msedge via the registry no matter where
    // the browser is installed, so the shortcut needs no hard-coded paths
    var br = /Edg\//.test(navigator.userAgent) ? "msedge" : "chrome";
    $("installCmd").value = 'cmd /c start "" ' + br + ' --app="' + location.href.split("#")[0].replace(/'/g, "%27") + '"';
    $("installOverlay").classList.add("show");
  });
  $("installCopy").addEventListener("click", function () {
    var inp = $("installCmd"); inp.select(); inp.setSelectionRange(0, 99999);
    var done = function () { toast("Copied — paste it into the New Shortcut wizard."); };
    var fb = function () { var ok = false; try { ok = document.execCommand("copy"); } catch (e2) {} if (ok) done(); else toast("Couldn't copy automatically — the text is selected, press Ctrl+C."); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(inp.value).then(done, fb);
    else fb();
  });
  $("installIco").addEventListener("click", function () {
    var bin = atob(ICO_B64), u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    dlBlob(new Blob([u8], { type: "image/x-icon" }), "LI-Database.ico");
    toast("Save it next to index.html, then: shortcut → Properties → Change Icon… → Browse.");
  });
  $("installDl").addEventListener("click", function () {
    // % must be doubled in .bat files or cmd treats it as a variable
    // %27-encode apostrophes (they break the PowerShell quoting below), then
    // double % signs for cmd
    var url = location.href.split("#")[0].replace(/'/g, "%27").replace(/%/g, "%%");
    var lines = [
      "@echo off",
      "setlocal",
      "rem Creates a desktop shortcut that opens the LI Document Database in its own app window.",
      'set "URL=' + url + '"',
      'set "BROWSER="',
      'if not defined BROWSER if exist "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" set "BROWSER=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"',
      'if not defined BROWSER if exist "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"',
      'if not defined BROWSER if exist "%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe" set "BROWSER=%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe"',
      'if not defined BROWSER if exist "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"',
      'if not defined BROWSER if exist "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe" set "BROWSER=%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe"',
      'if not defined BROWSER if exist "%LocalAppData%\\Microsoft\\Edge\\Application\\msedge.exe" set "BROWSER=%LocalAppData%\\Microsoft\\Edge\\Application\\msedge.exe"',
      "if not defined BROWSER (",
      "  echo Could not find Google Chrome or Microsoft Edge on this PC.",
      "  pause",
      "  exit /b 1",
      ")",
      "powershell -NoProfile -Command \"$ws=New-Object -ComObject WScript.Shell;$l=$ws.CreateShortcut([Environment]::GetFolderPath('Desktop')+'\\LI Document Database.lnk');$l.TargetPath='%BROWSER%';$l.Arguments='--app=%URL%';$ico='';try{$ico=Join-Path (Split-Path ([uri]'%URL%').LocalPath) 'LI-Database.ico'}catch{};if($ico -and (Test-Path $ico)){$l.IconLocation=$ico}else{$l.IconLocation='%BROWSER%,0'};$l.Save()\"",
      "echo.",
      "if errorlevel 1 (echo Could not create the shortcut automatically.) else (echo Done. Look for \"LI Document Database\" on your desktop.)",
      "echo If it did not work, create a shortcut manually with this target:",
      "echo   \"%BROWSER%\" --app=\"%URL%\"",
      'start "" "%BROWSER%" --app="%URL%"',
      "pause"
    ];
    dlBlob(new Blob([lines.join("\r\n")], { type: "application/octet-stream" }), "Install LI Database.bat");
  });

  // ---------- import ----------
  $("importBtn").addEventListener("click", function () { $("impProg").style.display = "none"; $("importOverlay").classList.add("show"); });
  $("impDrop").addEventListener("click", function () { ($("optFolder").checked ? $("folderInput") : $("fileInput")).click(); });
  ["dragenter", "dragover"].forEach(function (ev) { $("impDrop").addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); $("impDrop").classList.add("drag"); }); });
  ["dragleave", "drop"].forEach(function (ev) { $("impDrop").addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); $("impDrop").classList.remove("drag"); }); });
  $("impDrop").addEventListener("drop", function (e) { importFiles(e.dataTransfer.files); });
  $("fileInput").addEventListener("change", function (e) { importFiles(e.target.files); e.target.value = ""; });
  $("folderInput").addEventListener("change", function (e) { importFiles(e.target.files); e.target.value = ""; });

  var importing = false;
  // A pool of PDF.js workers so several PDFs parse on different CPU cores at
  // once. Created lazily and kept for the session. Capped to leave the OS/UI a
  // core; OCR is much heavier (its own workers + memory) so it stays serial.
  var pdfWorkers = [];
  function pdfPool(n) {
    if (!window.pdfjsLib) return [null]; // not loaded yet — extract() loads it on demand, single-lane
    n = Math.max(1, Math.min(n, (navigator.hardwareConcurrency || 4) - 1, 8));
    while (pdfWorkers.length < n) {
      try { pdfWorkers.push(new pdfjsLib.PDFWorker({ name: "li-pdf-" + pdfWorkers.length })); }
      catch (e) { break; }
    }
    // If no dedicated workers could be created (e.g. a strict CSP that blocks
    // blob: workers), return a single null "lane" so the import still runs on
    // the shared / main-thread fallback worker instead of silently doing nothing.
    if (!pdfWorkers.length) return [null];
    return pdfWorkers.slice(0, Math.max(1, Math.min(n, pdfWorkers.length)));
  }

  // Returns a promise that settles when this import batch has committed and the
  // view refreshed — the bridge relies on it to acknowledge delivered files.
  function importFiles(fileList) {
    var arr = Array.prototype.slice.call(fileList).filter(function (f) { return /pdf/i.test(f.type) || /\.pdf$/i.test(f.name); });
    if (!arr.length) { toast("No PDF files found."); return Promise.resolve(); }
    if (importing) { toast("An import is already running — wait for it to finish."); return Promise.reject(new Error("import busy")); }
    return runImport(arr.map(function (f) { return { file: f }; }));
  }
  // PDFs that are already stored (handed over by the platform intake or the
  // Files app as an "li-import" job): read each from the shared store and
  // file the document against that same record — no second copy of the bytes.
  function importStored(ids) {
    return R().files.getMany(ids).then(function (recs) {
      var have = recs.filter(Boolean);
      return Promise.all(have.map(function (r) { return R().files.getBlob(r.id); })).then(function (blobs) {
        var srcs = [];
        have.forEach(function (r, i) {
          if (!blobs[i]) return;
          srcs.push({ file: new File([blobs[i]], r.name || "document.pdf", { type: "application/pdf", lastModified: r.updatedAt || 0 }), fileId: r.id, fileRec: r });
        });
        if (!srcs.length) return null;
        return waitIdle().then(function () { return runImport(srcs); });
      });
    });
  }
  function waitIdle() { return new Promise(function (res) { (function poll() { if (!importing) res(); else setTimeout(poll, 150); })(); }); }
  function runImport(srcs) {
    importing = true;
    $("impProg").style.display = "block";
    return loadPdf().then(function () { return runImportLoaded(srcs); }, function (e) {
      importing = false;
      $("impProg").style.display = "none";
      toast((e && e.message) || "Couldn't load the PDF reader.");
      throw e;
    });
  }
  function runImportLoaded(srcs) {
    var arr = srcs.map(function (x) { return x.file; });
    var added = 0, updated = 0, failed = 0, quota = false, cursor = 0, done = 0, aborted = false;
    // The progress bar lives in the import modal; when an import runs without it
    // (folder sync), show progress as a toast instead so it isn't invisible.
    var quiet = !$("importOverlay").classList.contains("show");
    // Process files concurrently, one PDF.js worker per lane. Scanned files that
    // need OCR borrow from the separate (smaller) OCR worker pool on demand.
    var pool = pdfPool(Math.min(arr.length, 8));

    // Commits are chained so the shared docs[]/counters mutate one-at-a-time on
    // the main thread — dedupe (same LI+version) stays correct under concurrency.
    var commitChain = Promise.resolve();
    function commit(f, m, err) {
      commitChain = commitChain.then(function () {
        done++;
        $("impBar").style.width = (done / arr.length * 100) + "%";
        $("impLabel").textContent = "Read " + done + " / " + arr.length;
        if (quiet && arr.length > 1 && (done % 5 === 0 || done === arr.length)) toast("Importing… " + done + " / " + arr.length);
        if (err) { failed++; if (err.name === "QuotaExceededError") { quota = true; aborted = true; } return; }
        var id = m.li ? (m.li + "_" + (m.ver || "0")) : ("file:" + f.name + ":" + f.size);
        var prev = null; docs.forEach(function (d) { if (d.id === id) prev = d; });
        var meta = { id: id, li: m.li, ver: m.ver, title: m.title, reason: m.reason, fgroup: m.fgroup, date: m.date, validity: m.validity, text: m.text, pages: m.pages || 0, filename: f.name, size: f.size, mtime: f.lastModified || 0, noText: m.noText, err: !!m.err, star: !!(prev && prev.star), added: Date.now() };
        // Re-importing the same LI+version must not wipe manual corrections —
        // keep the previous entry's hand-edited fields regardless of the file's
        // name (a re-download/rename shouldn't discard edits). Non-edited fields
        // still refresh from the new parse.
        if (prev) {
          var ed = prev.edited || {};
          ["title", "reason", "fgroup", "date", "validity"].forEach(function (k) { if (ed[k] && prev[k]) meta[k] = prev[k]; });
          if (prev.edited) meta.edited = prev.edited;
        }
        var src = srcs[arr.indexOf(f)] || {};
        if (src.fileId) meta.fileId = src.fileId;
        // Re-importing an existing LI/version replaces its PDF: a manual
        // import stores the new bytes as a new file record, and the previous
        // one is dropped if it was ours (hidden), unhooked if it is a
        // Files-app record — never left orphaned.
        var stale = (prev && prev.fileId && prev.fileId !== (src.fileId || null)) ? prev.fileId : null;
        return putDoc(meta, src.fileId ? null : f).then(function () {
          if (prev) { updated++; var di = docs.indexOf(prev); if (di >= 0) docs[di] = meta; }
          else { added++; docs.push(meta); }
          if (!stale) return null;
          return R().files.get(stale).then(function (old) {
            if (!old) return null;
            return old.inFiles ? R().files.update(stale, { docId: null }) : R().files.removeFull(stale);
          }).catch(function () {});
        }, function (e) { failed++; if (e && e.name === "QuotaExceededError") { quota = true; aborted = true; } });
      });
      return commitChain;
    }

    // Each lane owns a PDF.js worker and pulls the next file until done.
    function lane(worker) {
      function nextInLane() {
        if (aborted) return Promise.resolve();
        var idx = cursor++;
        if (idx >= arr.length) return Promise.resolve();
        var f = arr[idx];
        return extract(f, worker)
          .then(function (m) { return commit(f, m, null); }, function (e) { return commit(f, null, e); })
          .then(nextInLane);
      }
      return nextInLane();
    }

    return Promise.all(pool.map(lane)).then(function () { return commitChain; }).then(function () {
      tessFreeAll(); // free any memory-heavy OCR workers used for scanned files
      if (aborted) failed += arr.length - done; // files skipped after storage filled up
      importing = false;
      $("impProg").style.display = "none"; $("importOverlay").classList.remove("show");
      return refresh().then(function () {
        var msg = "Imported " + added + " new, updated " + updated + ".";
        if (failed) msg += " ⚠ " + failed + " file(s) failed" + (quota ? " — browser storage is full" : "") + ".";
        toast(msg); scheduleAutosave();
      });
    }).catch(function (err) {
      // Never leave the app wedged with importing=true on an unexpected error.
      tessFreeAll(); importing = false;
      $("impProg").style.display = "none";
      return refresh().then(function () { toast("Import stopped — " + ((err && err.message) || "unexpected error") + "."); throw err; });
    });
  }

  // ---------- export selected / all as renamed ZIP ----------
  $("exportSelBtn").addEventListener("click", function () {
    var keys = Object.keys(selected);
    var groups = keys.length ? keys.map(function (k) { return groupsByKey[k]; }).filter(Boolean) : view;
    var list = groups.map(function (g) { return g.versions[0]; });
    if (!list.length) { toast("Nothing to export."); return; }
    if (!keys.length && !confirm("Export the latest version of all " + list.length + " shown document(s) as a renamed ZIP?")) return;
    var zip = new JSZip(), used = {}, i = 0;
    (function next() {
      if (i >= list.length) { toast("Zipping…"); zip.generateAsync({ type: "blob", compression: "STORE" }).then(function (b) { dlBlob(b, "LI_documents.zip"); }, function () { toast("Couldn't build the export."); }); return; }
      var d = list[i];
      getFile(d.id).then(function (blob) { if (blob) { var n = rlName(d), k = 2, base = n.replace(/\.pdf$/i, ""); while (used[n]) { n = base + " (" + k + ").pdf"; k++; } used[n] = true; zip.file(n, blob); } i++; next(); });
    })();
  });

  // ---------- backup / restore ----------
  function buildBackup() {
    // Clone each doc for the manifest so the backup-only "fname" field isn't
    // written onto the live records in docs[] (which a later putDoc would then
    // persist). Snapshot guards against imports/deletes mutating docs mid-backup.
    var list = docs.map(function (d, i2) { var c = {}; for (var k in d) c[k] = d[k]; c.fname = d.id.replace(/[^A-Za-z0-9._-]/g, "_") + "__" + i2 + ".pdf"; return c; });
    var zip = new JSZip(); zip.file("manifest.json", JSON.stringify({ v: 1, docs: list }, null, 1));
    var folder = zip.folder("files"), i = 0;
    return new Promise(function (res, rej) {
      (function next() {
        if (i >= list.length) { zip.generateAsync({ type: "blob", compression: "STORE" }).then(res, rej); return; }
        getFile(list[i].id).then(function (blob) { if (blob) folder.file(list[i].fname, blob); i++; next(); }).catch(rej);
      })();
    });
  }
  function runBackup() {
    if (!docs.length) { toast("Database is empty."); return; }
    toast("Building backup…");
    buildBackup().then(function (b) { dlBlob(b, "LI-database-backup.lidb"); }, function () { toast("Couldn't build the backup."); });
  }
  $("backupBtn").addEventListener("click", runBackup);

  // ---------- auto-save to a chosen file (e.g. on a flash drive) ----------
  var asHandle = null, asOn = false, asTimer = 0, asBusy = false, asAgain = false, asFailed = false, asPending = false;
  function asLabel(txt, cls) { var b = $("autosaveBtn"); b.textContent = txt; b.classList.toggle("on", cls === "on"); b.classList.toggle("warn", cls === "warn"); $("menuBtn").classList.toggle("attn", cls === "warn"); }
  function scheduleAutosave() { if (!asOn || !asHandle) return; asPending = true; clearTimeout(asTimer); asTimer = setTimeout(runAutosave, 1500); }
  function runAutosave() {
    if (!asOn || !asHandle) return;
    // Never write a half-finished database: defer until an import completes
    // (the import's own scheduleAutosave will then persist the full result).
    if (importing) { clearTimeout(asTimer); asTimer = setTimeout(runAutosave, 1500); return; }
    if (asBusy) { asAgain = true; return; }
    var h = asHandle;
    asBusy = true;
    asLabel("🔄 Auto-save: saving…", "on");
    buildBackup()
      .then(function (blob) {
        if (!asOn || asHandle !== h) return false;
        return h.createWritable().then(function (w) { return w.write(blob).then(function () { return w.close(); }); }).then(function () { return true; });
      })
      .then(function (wrote) {
        if (!wrote || !asOn || asHandle !== h) return;
        asFailed = false; asPending = false;
        asLabel("🔄 Auto-save: on", "on");
        $("autosaveBtn").title = "Last saved " + new Date().toLocaleTimeString() + " to “" + (h.name || "chosen file") + "”. Click to turn off.";
      })
      .catch(function () { if (asOn && asHandle === h) { asFailed = true; asLabel("🔄 Auto-save: failed — click to retry", "warn"); } })
      .then(function () { asBusy = false; if (asAgain) { asAgain = false; scheduleAutosave(); } });
  }
  function enableAutosave() {
    if (!window.showSaveFilePicker) { toast("Auto-save needs Microsoft Edge or Chrome."); return; }
    window.showSaveFilePicker({ suggestedName: "LI-database.lidb", types: [{ description: "LI Database file", accept: { "application/zip": [".lidb"] } }] })
      .then(function (h) {
        if (!h) return;
        // Guard against clobbering an existing backup: enabling auto-save on an
        // empty database would immediately overwrite the chosen file with nothing.
        if (!docs.length && !confirm("Your database is empty.\n\nTurn on auto-save anyway? It will OVERWRITE “" + (h.name || "the chosen file") + "” with an empty database.\n\nIf you meant to load that file, click Cancel and use ↥ Restore instead.")) return;
        asHandle = h; asOn = true;
        putSetting("autosave", h).catch(function () {});
        putSetting("autosaveOn", true).catch(function () {});
        asLabel("🔄 Auto-save: on", "on");
        toast("Auto-save on — the database will be written to “" + (h.name || "the chosen file") + "” after every change.");
        scheduleAutosave();
      })
      .catch(function () {});
  }
  $("autosaveBtn").addEventListener("click", function () {
    if (asOn && asFailed) { asFailed = false; runAutosave(); return; }
    if (asOn) {
      if (!confirm("Turn off auto-save? The saved file stays where it is.")) return;
      asOn = false; asHandle = null; asFailed = false; asPending = false; asAgain = false; clearTimeout(asTimer);
      delSetting("autosave"); delSetting("autosaveOn");
      asLabel("🔄 Auto-save: off", "");
      return;
    }
    getSetting("autosave").then(function (h) {
      if (h && h.requestPermission) {
        return h.requestPermission({ mode: "readwrite" }).then(function (p) {
          if (p === "granted") { asHandle = h; asOn = true; putSetting("autosaveOn", true).catch(function () {}); asLabel("🔄 Auto-save: on", "on"); scheduleAutosave(); }
          else enableAutosave();
        }).catch(function () { enableAutosave(); });
      }
      enableAutosave();
    }).catch(function () { enableAutosave(); });
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden" && asOn && asPending && !asBusy) { clearTimeout(asTimer); runAutosave(); }
  });
  function resumeAutosave() {
    return getSetting("autosaveOn").then(function (on) {
      if (!on) return;
      return getSetting("autosave").then(function (h) {
        if (!h) { asLabel("🔄 Auto-save: was on — click to re-enable", "warn"); return; }
        var q = h.queryPermission ? h.queryPermission({ mode: "readwrite" }) : Promise.resolve("granted");
        return q.then(function (p) {
          if (p === "granted") { asHandle = h; asOn = true; asLabel("🔄 Auto-save: on", "on"); }
          else asLabel("🔄 Auto-save: click to resume", "warn");
        });
      });
    }).catch(function () {});
  }
  $("restoreBtn").addEventListener("click", function () { $("restoreInput").click(); });
  function restoreBackupFile(f) {
    JSZip.loadAsync(f).then(function (zip) {
      var mf = zip.file("manifest.json"); if (!mf) { toast("Not a valid backup file."); return; }
      return mf.async("string").then(function (s) {
        var man = JSON.parse(s), list = man.docs || [], i = 0, fails = 0;
        if (docs.length && !confirm("Restore " + list.length + " document(s) from this backup? Existing entries with the same ID will be overwritten by the backup's version.")) return;
        (function next() {
          if (i >= list.length) { refresh().then(function () { toast("Restored " + (list.length - fails) + " documents." + (fails ? " ⚠ " + fails + " failed." : "")); scheduleAutosave(); }); return; }
          var d = list[i], fe = zip.file("files/" + (d.fname || String(d.id).replace(/[^A-Za-z0-9._-]/g, "_") + ".pdf"));
          (fe ? fe.async("blob") : Promise.resolve(null)).then(function (blob) { return putDoc(d, blob ? asPdf(blob) : null); }).catch(function () { fails++; }).then(function () { i++; next(); });
        })();
      });
    }).catch(function () { toast("Couldn't read that backup."); });
  }
  $("restoreInput").addEventListener("change", function (e) {
    var f = e.target.files[0]; e.target.value = ""; if (!f) return;
    restoreBackupFile(f);
  });

  // ---------- folder sync (optional) ----------
  // Link a folder once; one click then imports any new or changed PDFs from it.
  // Manual Import still works exactly as before — this is purely additive.
  // The scan / dedup / auto-sync machinery is the shared service
  // (src/services/folder-sync.js, one copy for this app and the Files app);
  // this app supplies where the handle is kept, what is already stored and
  // how synced PDFs are imported (the normal import: dedupe + edit-preservation).
  var folderSync = FDServices.folderSync.create({
    pickerId: "li-sync",
    load: function () {
      var out = { dir: null, auto: false };
      return getSetting("syncDir").then(function (h) { if (h) out.dir = h; }, function () {})
        .then(function () { return getSetting("autoSyncOn"); })
        .then(function (on) { out.auto = !!on; }, function () {})
        .then(function () { return out; });
    },
    save: function (key, value) { return putSetting(key === "dir" ? "syncDir" : "autoSyncOn", value); },
    accept: function (entry) { return /\.pdf$/i.test(entry.name); },
    // A folder file counts as "new or changed" unless a stored doc has the
    // same name, size AND modified-time. Docs imported before mtime was
    // tracked fall back to name+size so they aren't all re-imported once.
    known: function () {
      var known = {};
      docs.forEach(function (d) { (known[d.filename] = known[d.filename] || []).push({ size: d.size, mtime: d.mtime }); });
      return Promise.resolve(known);
    },
    import: function (files) { return importFiles(files); },
    busy: function () { return importing; },
    busyMessage: "An import is already running — wait for it to finish.",
    toast: toast,
    onChange: function () { syncLabel(); autoSyncLabel(); },
  });
  function syncLabel() {
    var b = $("syncBtn"), dir = folderSync.dir;
    if (dir) { b.textContent = "📂 Sync: " + (dir.name || "folder"); b.classList.add("on"); b.title = "Re-scan “" + (dir.name || "folder") + "” and import new or changed PDFs (hold Shift to link a different folder)"; }
    else { b.textContent = "📂 Sync folder"; b.classList.remove("on"); b.title = "Link a folder — one click imports any new or changed PDFs from it"; }
  }
  function autoSyncLabel() {
    var b = $("autoSyncBtn"); if (!b) return;
    b.textContent = "⏱ Auto-sync: " + (folderSync.auto ? "on" : "off");
    b.classList.toggle("on", folderSync.auto);
  }
  $("syncBtn").addEventListener("click", function (e) {
    if (e.shiftKey) { folderSync.pick().then(function (h) { if (h) folderSync.run(); }); return; }
    folderSync.run();
  });
  $("autoSyncBtn").addEventListener("click", function () { folderSync.toggleAuto(); });
  function resumeSyncDir() { return folderSync.resume(); }

  // ---------- keyboard (platform parity) ----------
  // "/" focuses search (like the other apps); Alt+1–4 forwards platform-wide
  // app switching up to the shell when embedded.
  document.addEventListener("keydown", function (e) {
    var emb = false; try { emb = window.parent && window.parent !== window; } catch (x) { emb = true; }
    if (emb && e.altKey && !e.ctrlKey && !e.metaKey && e.key >= "1" && e.key <= "9") {
      e.preventDefault();
      try { window.parent.postMessage({ type: "shell-switch", n: +e.key }, "*"); } catch (x) {}
      return;
    }
    if (emb && (e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      try { window.parent.postMessage({ type: "shell-quickopen" }, "*"); } catch (x) {}
      return;
    }
    var el = document.activeElement;
    if (e.key === "/" && el && el.tagName !== "INPUT" && el.tagName !== "TEXTAREA" && el.tagName !== "SELECT") {
      e.preventDefault();
      $("search").focus();
    }
  });

  // ---------- boot ----------
  // Messages from the platform shell: theme + cross-app navigation (deep links
  // and "related" jumps from the other apps). Nav messages that arrive before
  // the database has loaded are replayed after boot.
  var bootReady = false, pendingNav = [];
  // A cross-app jump means "show me THIS" — hidden toggles (★ Starred,
  // ⚠ Needs review) would otherwise silently empty the results.
  function resetViewFilters() {
    $("search").value = ""; $("fgFilter").value = ""; $("modelFilter").value = "";
    if (starOnly) { starOnly = false; var sb = $("starFilter"); sb.classList.remove("on"); sb.textContent = "☆ Starred"; }
    if (needsOnly) { needsOnly = false; $("needsFilter").classList.remove("on"); }
  }
  function handleShellNav(d) {
    if (!bootReady) { pendingNav.push(d); return; }
    if (d.type === "platform-backup") {
      runBackup();
    } else if (d.type === "li-restore" && d.file) {
      restoreBackupFile(d.file);
    } else if (d.type === "li-open" && d.li) {
      if (groupsByKey[liKey(d.li)]) {
        if (dDirty && !confirm("Discard unsaved changes to this document?")) return;
        dDirty = false; navStack = [];
        openDetail(liKey(d.li));
      } else {
        resetViewFilters();
        $("search").value = d.li;
        applyView();
        if (!view.length) toast("No LI document " + d.li + " in this database.");
      }
    } else if (d.type === "li-search" && d.q != null) {
      resetViewFilters();
      $("search").value = String(d.q);
      applyView();
    } else if (d.type === "li-filter" && d.model != null) {
      resetViewFilters();
      var msel = $("modelFilter");
      msel.value = String(d.model);
      if (d.model && msel.value !== String(d.model)) { msel.value = ""; toast("No LI documents for model " + d.model + "."); }
      applyView();
    }
  }
  window.addEventListener("message", function (ev) {
    var d = ev && ev.data;
    if (!d) return;
    if (d.type === "platform-theme") {
      if (d.mode === "light" || d.mode === "dark") document.documentElement.setAttribute("data-theme", d.mode);
      else document.documentElement.removeAttribute("data-theme");
      return;
    }
    if (d.type === "li-open" || d.type === "li-search" || d.type === "li-filter" || d.type === "li-restore" || d.type === "platform-backup") handleShellNav(d);
  });
  FDData.boot().then(function () { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); return refresh(); }).then(function () {
    bootReady = true;
    if (pendingNav.length) pendingNav.splice(0).forEach(handleShellNav);
    else if (!docs.length) $("importOverlay").classList.add("show");
    openFromHash(); // deep-link: open the document named in #LI… if present
    return Promise.all([resumeAutosave(), resumeSyncDir()]);
  }).catch(function (e) { $("empty").innerHTML = '<div class="empty">Couldn\'t open the local database.<br><span class="muted">' + esc(e && e.message) + "</span></div>"; });
  // ===== Platform integration (shared database) =====
  (function () {
    if (!window.FDData) return;
    var embedded = false;
    try { embedded = window.parent && window.parent !== window; } catch (e) { embedded = true; }
    // PDFs handed over by the platform's unified "Add files" or the Files
    // app arrive as "li-import" jobs naming stored records; one job is one
    // batch through the same import path as a manual import. The job is
    // acknowledged only once importFiles() has committed — a failed file is
    // never reported as filed.
    FDData.jobs.register("li-import", function (job) { return importStored(job.inputIds); });
    // Other tabs' changes: reload the list (own writes already refreshed it).
    var refreshT = null;
    FDData.bus.on("documents:changed", function (d) { if (!d.remote) return; clearTimeout(refreshT); refreshT = setTimeout(function () { refresh(); }, 200); });
    // "Add to File Vault" from the document view: the same record becomes
    // visible in the Files app (collection LI Documents, tagged) — nothing is
    // copied.
    var sv = $("dSendVault");
    if (sv) sv.addEventListener("click", function () {
      if (!curDoc) { toast("Open a document first."); return; }
      if (!curDoc.fileId) { toast("No file stored for this document."); return; }
      var d = collectDetail();
      var models = [];
      try { models = modelsOf(curDoc) || []; } catch (e) {}
      var tags = [d.li, d.fgroup].filter(Boolean).concat(models.map(function (m) { return "Model " + m; }));
      R().files.update(curDoc.fileId, {
        inFiles: 1, collection: FDData.repos.LI_COLLECTION, name: rlName(d),
        tags: Array.from(new Set(tags)), note: d.title ? ("LI: " + d.title) : "",
      }).then(function () { toast("Added to File Vault ✓"); }, function (e) { toast("Couldn't add to File Vault — " + ((e && e.message) || e)); });
    });
    // Back link: inside the shell, switch views instead of navigating the iframe.
    var back = $("backToVault");
    if (back && embedded) back.addEventListener("click", function (e) {
      e.preventDefault();
      try { window.parent.postMessage({ type: "vault-nav", to: "files" }, "*"); } catch (x) {}
    });
    // Embedded, files intake is unified: a file dropped over the LI panel is
    // handed to the shell's one router (which files it here or in the Vault),
    // instead of the browser navigating the iframe to the dropped PDF.
    if (embedded) {
      ["dragover", "drop"].forEach(function (ev) {
        window.addEventListener(ev, function (e) {
          if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") === -1) return;
          e.preventDefault();
          if (ev === "drop" && e.dataTransfer.files && e.dataTransfer.files.length) {
            var files = Array.prototype.slice.call(e.dataTransfer.files);
            try { window.parent.postMessage({ type: "shell-add-files", files: files }, "*"); }
            catch (x) { importFiles(files); }
          }
        });
      });
    }
  })();
})();

// Spell-check every text field, including ones created after load — flipping
// the flag at focus time covers them all without touching each creation site.
document.addEventListener("focusin", function (e) {
  var t = e.target;
  if (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && (t.type === "text" || t.type === "search"))) t.spellcheck = true;
});
