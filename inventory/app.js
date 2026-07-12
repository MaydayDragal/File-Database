/*
 * app.js — Tool Inventory. A private, offline database of special tools.
 * Data lives in this browser (IndexedDB). Ships with a bundled list that
 * loads on first run; you can edit, star, import a CSV, and back up/restore.
 */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var DB_NAME = "tool-inventory", STORE = "tools", META = "meta";
  var db = null, all = [], view = [];
  var state = { q: "", grp: "", ct: "", note: "", starred: false, offered: false, sort: "toolNo", dir: 1 };
  var curId = null, embedded = false;
  try { embedded = window.parent && window.parent !== window; } catch (e) { embedded = true; }

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function money(n) { return (n || n === 0) ? "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"; }
  var toastT;
  function toast(m) { var t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("show"); }, 2600); }

  // ---------- IndexedDB ----------
  function open() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = function () {
        var d = r.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: "id" });
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
  function clearStore() { var t = db.transaction(STORE, "readwrite"); t.objectStore(STORE).clear(); return txDone(t); }
  function getMeta(k) { return reqP(db.transaction(META, "readonly").objectStore(META).get(k)).then(function (r) { return r ? r.v : null; }); }
  function setMeta(k, v) { var t = db.transaction(META, "readwrite"); t.objectStore(META).put({ k: k, v: v }); return txDone(t); }

  // ---------- seed ----------
  var SEED_VERSION = 2;   // bump to push a refreshed bundled list (edits/stars preserved)
  function normalize(t, i) {
    return {
      id: t.id || ("t" + i),
      no: t.no || "", qty: t.qty || "", toolNo: (t.toolNo || "").trim(),
      svcGrp: (t.svcGrp || "").trim(), ct: (t.ct || "").trim().toUpperCase(),
      desc: t.desc || "", location: t.location || "", year: t.year || "",
      price: (t.price === 0 || t.price) ? Number(t.price) : null,
      note: (t.note || "").trim(), note2: (t.note2 || "").trim(), comment: t.comment || "",
      star: !!t.star,
      // XENTRY catalog fields
      offered: !!t.offered, photo: t.photo || "", wis: t.wis || "", version: t.version || "",
      catalogName: t.catalogName || "", catalogDesc: t.catalogDesc || "",
      validities: Array.isArray(t.validities) ? t.validities : [],
    };
  }
  function fetchSeed() { return fetch("tools.json").then(function (r) { return r.json(); }); }
  function loadSeed() {
    return fetchSeed().then(function (d) {
      var list = (d.tools || []).map(normalize);
      return setMeta("source", { name: d.source || "", updated: d.updated || "", count: list.length })
        .then(function () { return setMeta("seedVersion", d.seedVersion || SEED_VERSION); })
        .then(function () { return putMany(list); }).then(function () { return list; });
    });
  }
  // Re-seed to a newer bundled list, carrying over the user's stars and edits.
  function upgradeSeed(existing) {
    return fetchSeed().then(function (d) {
      var fresh = (d.tools || []).map(normalize);
      var prev = {};
      existing.forEach(function (t) { (prev[t.toolNo] = prev[t.toolNo] || []).push(t); });
      fresh.forEach(function (t) {
        var arr = prev[t.toolNo]; if (!arr || !arr.length) return;
        var old = arr.shift();               // pair up rows with the same tool number
        if (old.star) t.star = true;
        ["location", "qty", "note", "comment"].forEach(function (f) {
          if (old[f] && !t[f]) t[f] = old[f]; // keep a user's entry where the seed is blank
        });
      });
      return clearStore()
        .then(function () { return setMeta("source", { name: d.source || "", updated: d.updated || "", count: fresh.length }); })
        .then(function () { return setMeta("seedVersion", d.seedVersion || SEED_VERSION); })
        .then(function () { return putMany(fresh); })
        .then(function () { return fresh; });
    });
  }

  // ---------- filtering / sorting ----------
  function apply() {
    var q = state.q.toLowerCase();
    view = all.filter(function (t) {
      if (state.starred && !t.star) return false;
      if (state.offered && !t.offered) return false;
      if (state.grp && t.svcGrp !== state.grp) return false;
      if (state.ct && t.ct !== state.ct) return false;
      if (state.note && t.note !== state.note) return false;
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
      $("#empty").style.display = "block";
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
    if (t.photo) return '<img class="thumb" loading="lazy" src="img/' + esc(t.photo) + '.png" alt="" onerror="this.style.display=\'none\';this.parentNode.classList.add(\'noimg\')">';
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

  // ---------- filter option population ----------
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

  // ---------- detail ----------
  function openDetail(id) {
    var t = all.find(function (x) { return x.id === id; });
    if (!t) return;
    curId = id;
    $("#dTitle").textContent = t.toolNo;
    $("#dStar").textContent = t.star ? "★" : "☆";
    $("#dStar").classList.toggle("on", t.star);
    // Photo
    var photo = $("#dPhoto");
    if (t.photo) { photo.style.display = ""; photo.innerHTML = '<img src="img/' + esc(t.photo) + '.png" alt="Photo of ' + esc(t.toolNo) + '">'; }
    else { photo.style.display = "none"; photo.innerHTML = ""; }
    // Key/value facts
    $("#dGrid").innerHTML =
      kv("Name", (t.desc || t.catalogName || "—"), "big") +
      kv("Tool number", t.toolNo, "mono") +
      kv("Service group", t.svcGrp || "—") + kv("Category (Ct)", t.ct || "—") +
      kv("Year", t.year || "—") + kv("Dealer net", money(t.price)) +
      kv("Note", (t.note || "—") + (t.note2 ? " / " + t.note2 : "")) +
      kv("Offered", t.offered ? "Yes — in the tools we offer" : "Not in the catalog") +
      (t.wis ? kv("WIS reference", t.wis, "mono") : "") +
      (t.version ? kv("Catalog version", t.version) : "");
    // Rich catalog description + validities
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
    $("#detail").classList.add("show");
  }
  function kv(k, v, cls) {
    return '<div class="kv"><span class="k">' + esc(k) + '</span><span class="v ' + (cls || "") + '">' + esc(v) + '</span></div>';
  }
  function closeDetail() { $("#detail").classList.remove("show"); curId = null; }
  function saveDetail() {
    var t = all.find(function (x) { return x.id === curId; });
    if (!t) return;
    t.qty = $("#eQty").value.trim();
    t.location = $("#eLoc").value.trim();
    t.note = $("#eNote").value.trim();
    t.comment = $("#eComment").value.trim();
    putOne(t).then(function () { apply(); closeDetail(); toast("Saved."); });
  }
  function toggleStar(id) {
    var t = all.find(function (x) { return x.id === id; });
    if (!t) return Promise.resolve();
    t.star = !t.star;
    return putOne(t).then(function () { apply(); });
  }

  // ---------- CSV import / export ----------
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
      // Locate the header row (contains "Tool Number").
      var hi = 0;
      for (var r = 0; r < Math.min(rows.length, 5); r++) {
        if (rows[r].join(" ").toLowerCase().indexOf("tool number") !== -1) { hi = r; break; }
      }
      var head = rows[hi].map(function (h) { return h.trim().toLowerCase(); });
      function col() { for (var a = 0; a < arguments.length; a++) { var idx = head.indexOf(arguments[a]); if (idx !== -1) return idx; } return -1; }
      var ci = { no: col("no.", "no"), qty: col("qty"), toolNo: col("tool number"), svcGrp: col("svc grp", "service group"),
        ct: col("ct"), desc: col("description"), location: col("location", "bin"), year: col("year"),
        price: col("dlr net($)", "dlr net", "price"), note: col("note"), comment: col("comment") };
      if (ci.toolNo === -1) { toast("No 'Tool Number' column found."); return; }
      var byTool = {};
      all.forEach(function (t) { if (!byTool[t.toolNo]) byTool[t.toolNo] = t; });
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
        var ex = byTool[tn];
        if (ex) { for (var kk in rec) if (rec[kk] !== "" && rec[kk] != null) ex[kk] = rec[kk]; toPut.push(ex); updated++; }
        else { rec.id = "t" + (++maxIdN); rec.star = false; var nn = normalize(rec, maxIdN); all.push(nn); byTool[tn] = nn; toPut.push(nn); added++; }
      }
      putMany(toPut).then(function () { fillFilters(); apply(); toast("Imported CSV: " + added + " added, " + updated + " updated."); });
    });
  }
  function exportCSV() {
    var head = ["No.", "Qty", "Tool Number", "Svc Grp", "Ct", "Description", "Location", "Year", "Dlr Net($)", "Note", "Comment"];
    var lines = [head.join(",")];
    var q = function (s) { s = String(s == null ? "" : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    view.forEach(function (t) {
      lines.push([t.no, t.qty, t.toolNo, t.svcGrp, t.ct, t.desc, t.location, t.year, (t.price == null ? "" : t.price), t.note, t.comment].map(q).join(","));
    });
    dl(new Blob([lines.join("\n")], { type: "text/csv" }), "tool-inventory.csv");
    toast("Exported " + view.length + " rows to CSV.");
  }
  function backup() {
    dl(new Blob([JSON.stringify({ format: "tool-inventory", version: 1, tools: all })], { type: "application/json" }), "tool-inventory-backup.json");
    toast("Backup saved.");
  }
  function restore(file) {
    file.text().then(function (txt) {
      var d = JSON.parse(txt);
      if (!d || d.format !== "tool-inventory" || !Array.isArray(d.tools)) { toast("Not a Tool Inventory backup."); return; }
      var list = d.tools.map(normalize);
      clearStore().then(function () { return putMany(list); }).then(function () { all = list; fillFilters(); apply(); toast("Restored " + list.length + " tools."); });
    }).catch(function () { toast("Restore failed — file may be corrupt."); });
  }
  function resetSeed() {
    if (!confirm("Reset to the bundled tool list? This replaces your current data (stars and edits are lost).")) return;
    clearStore().then(loadSeed).then(function (list) { all = list; fillFilters(); apply(); toast("Reset to the bundled list."); });
  }
  function dl(blob, name) { var u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); }

  // ---------- events ----------
  function wire() {
    var st;
    $("#search").addEventListener("input", function (e) { clearTimeout(st); st = setTimeout(function () { state.q = e.target.value.trim(); apply(); }, 130); });
    $("#fGrp").addEventListener("change", function (e) { state.grp = e.target.value; apply(); });
    $("#fCt").addEventListener("change", function (e) { state.ct = e.target.value; apply(); });
    $("#fNote").addEventListener("change", function (e) { state.note = e.target.value; apply(); });
    $("#starFilter").addEventListener("click", function () { state.starred = !state.starred; $("#starFilter").classList.toggle("on", state.starred); apply(); });
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

    // menu
    var mb = $("#menuBtn"), mn = $("#appMenu");
    mb.addEventListener("click", function (e) { e.stopPropagation(); mn.hidden = !mn.hidden; });
    document.addEventListener("click", function (e) { if (!mn.hidden && !mn.contains(e.target) && e.target !== mb) mn.hidden = true; });
    $("#exportCsvBtn").addEventListener("click", function () { mn.hidden = true; exportCSV(); });
    $("#importCsvBtn").addEventListener("click", function () { mn.hidden = true; $("#csvInput").click(); });
    $("#backupBtn").addEventListener("click", function () { mn.hidden = true; backup(); });
    $("#restoreBtn").addEventListener("click", function () { mn.hidden = true; $("#restoreInput").click(); });
    $("#resetBtn").addEventListener("click", function () { mn.hidden = true; resetSeed(); });
    $("#legendBtn").addEventListener("click", function () { mn.hidden = true; $("#legend").classList.add("show"); });
    $("#csvInput").addEventListener("change", function (e) { if (e.target.files[0]) importCSV(e.target.files[0]); e.target.value = ""; });
    $("#restoreInput").addEventListener("change", function (e) { if (e.target.files[0]) restore(e.target.files[0]); e.target.value = ""; });

    // install
    var deferred = null;
    window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferred = e; $("#installBtn").hidden = false; });
    $("#installBtn").addEventListener("click", function () {
      if (deferred) { deferred.prompt(); deferred.userChoice.then(function () { deferred = null; $("#installBtn").hidden = true; }); }
      else toast("Use the browser menu (⋮) → Install / Create shortcut.");
    });

    // back to File Vault (when embedded, switch the shell; else navigate)
    var back = $("#backBtn");
    if (back) back.addEventListener("click", function (e) {
      if (embedded) { e.preventDefault(); try { window.parent.postMessage({ type: "vault-nav", to: "files" }, "*"); } catch (x) {} }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { $$(".overlay.show").forEach(function (o) { o.classList.remove("show"); }); if (!mn.hidden) mn.hidden = true; }
      else if (e.key === "/" && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") { e.preventDefault(); $("#search").focus(); }
    });
  }

  // ---------- boot ----------
  open().then(function () {
    return Promise.all([getAll(), getMeta("seedVersion")]);
  }).then(function (r) {
    var list = r[0], ver = r[1];
    if (list && list.length) {
      if (ver !== SEED_VERSION) {
        // A newer bundled list shipped — refresh it, keeping stars and edits.
        return upgradeSeed(list.map(normalize)).then(function (fresh) { all = fresh; setTimeout(function () { toast("Tool list updated to the latest catalog."); }, 400); });
      }
      all = list.map(normalize); return null;
    }
    return loadSeed().then(function (seed) { all = seed; });
  }).then(function () {
    return getMeta("source");
  }).then(function (src) {
    var offeredN = all.filter(function (t) { return t.offered; }).length;
    var photoN = all.filter(function (t) { return t.photo; }).length;
    $("#sub").textContent = all.length.toLocaleString() + " tools · " + offeredN.toLocaleString() + " offered · " + photoN.toLocaleString() + " with photo";
    if (src && src.updated) $("#legendUpdated").textContent = "Pricing reference: " + src.updated;
    if (embedded) $("#backBtn").hidden = false;
    fillFilters();
    wire();
    apply();
    if ("serviceWorker" in navigator) { try { navigator.serviceWorker.register("sw.js"); } catch (e) {} }
  }).catch(function (e) {
    $("#empty").style.display = "block";
    $("#empty").innerHTML = "Couldn't load the inventory.<br><span class='muted'>" + esc(e && e.message) + "</span>";
  });
})();
