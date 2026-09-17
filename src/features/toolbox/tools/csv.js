/* ===== CSV Viewer ===== */
// This tool's panel markup and its wiring; the Toolbox feature mounts every
// tool's markup into its shadow root, then calls init(root) for each.
export const markup = `
<section class="tool" id="tool-csv">
<div class="wrap">
  <header>
    <h1>📊 CSV Viewer</h1>
    <p>Open a CSV/TSV file and browse it as a sortable, searchable table. Big files are handled with virtualized rows. Nothing is uploaded.</p>
  </header>

  <div class="card">
    <h2>1 · Open a file</h2>
    <div class="drop" id="v-drop">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      <div class="big">Drop a .csv / .tsv here or click to browse</div>
      <div class="sub">Parsed locally — quotes, commas-in-quotes and newlines-in-quotes handled</div>
    </div>
    <input type="file" id="v-fileInput" accept=".csv,.tsv,.txt,text/csv" />
  </div>

  <div class="card" id="v-viewcard" style="display:none">
    <div class="csv-toolbar">
      <input type="text" id="v-search" placeholder="Search all columns…" />
      <label class="chk"><input type="checkbox" id="v-header" checked /> Header row</label>
      <select id="v-delim">
        <option value="auto">Auto delimiter</option>
        <option value=",">Comma</option>
        <option value="\\t">Tab</option>
        <option value=";">Semicolon</option>
        <option value="|">Pipe</option>
      </select>
      <button type="button" class="btn btn-ghost" id="v-exp-csv">Export CSV</button>
      <button type="button" class="btn btn-ghost" id="v-exp-json">Export JSON</button>
    </div>
    <div class="csv-count" id="v-count"></div>
    <div class="csv-scroll" id="v-scroll">
      <table class="csv-table" id="v-table"><colgroup id="v-cols"></colgroup><thead id="v-thead"></thead><tbody id="v-tbody"></tbody></table>
    </div>
  </div>

  <div class="foot">Everything runs client-side — your data never leaves your device.</div>
</div>
</section>
`;

export function init(root) {
  "use strict";
  var $ = function (id) { return root.getElementById(id); };
  var ROWH = 30, BUF = 8;
  var state = { text: "", delim: ",", headers: [], rows: [], view: [], sortCol: -1, sortDir: 0, colW: [] };

  // RFC-4180-ish parser
  function parse(text, delim) {
    var rows = [], row = [], field = "", i = 0, n = text.length, inQ = false;
    while (i < n) {
      var c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
        field += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === delim) { row.push(field); field = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    // drop a single trailing empty row
    if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") rows.pop();
    return rows;
  }
  function detectDelim(text) {
    var line = text.split(/\r?\n/).find(function (l) { return l.trim() !== ""; }) || "";
    var cands = [",", "\t", ";", "|"], best = ",", bestC = -1;
    cands.forEach(function (d) { var c = line.split(d).length; if (c > bestC) { bestC = c; best = d; } });
    return best;
  }

  function loadText(text) {
    state.text = text;
    build();
  }
  function build() {
    var dsel = $("v-delim").value;
    state.delim = dsel === "auto" ? detectDelim(state.text) : dsel === "\\t" ? "\t" : dsel;
    var all = parse(state.text, state.delim);
    if (!all.length) { $("v-viewcard").style.display = "none"; return; }
    var hasHeader = $("v-header").checked;
    var ncol = all.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    if (hasHeader) { state.headers = padRow(all[0], ncol).map(function (h, i) { return h || "Column " + (i + 1); }); state.rows = all.slice(1); }
    else { state.headers = []; for (var i = 0; i < ncol; i++) state.headers.push("Column " + (i + 1)); state.rows = all; }
    state.rows = state.rows.map(function (r) { return padRow(r, ncol); });
    state.sortCol = -1; state.sortDir = 0;
    computeWidths(ncol);
    applyView();
    $("v-viewcard").style.display = "";
    renderHead();
    $("v-scroll").scrollTop = 0;
    render();
  }
  function padRow(r, n) { r = r.slice(); while (r.length < n) r.push(""); return r; }
  function computeWidths(ncol) {
    var w = [], sample = state.rows.slice(0, 60);
    for (var c = 0; c < ncol; c++) {
      var max = (state.headers[c] || "").length;
      sample.forEach(function (r) { if (r[c] && r[c].length > max) max = r[c].length; });
      w.push(Math.min(340, Math.max(70, 12 + max * 7.6)));
    }
    state.colW = w;
  }

  function applyView() {
    var q = ($("v-search").value || "").toLowerCase();
    var idx = [];
    for (var i = 0; i < state.rows.length; i++) {
      if (!q) { idx.push(i); continue; }
      var r = state.rows[i], hit = false;
      for (var c = 0; c < r.length; c++) { if (String(r[c]).toLowerCase().indexOf(q) !== -1) { hit = true; break; } }
      if (hit) idx.push(i);
    }
    if (state.sortCol >= 0 && state.sortDir !== 0) {
      var col = state.sortCol, dir = state.sortDir;
      idx.sort(function (a, b) {
        var x = state.rows[a][col], y = state.rows[b][col];
        var nx = parseFloat(x), ny = parseFloat(y);
        var numeric = x !== "" && y !== "" && !isNaN(nx) && !isNaN(ny);
        var cmp = numeric ? nx - ny : String(x).localeCompare(String(y));
        return dir * cmp;
      });
    }
    state.view = idx;
    $("v-count").textContent = state.view.length.toLocaleString() + " of " + state.rows.length.toLocaleString() + " rows · " + state.headers.length + " columns";
  }

  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }
  function renderHead() {
    var cg = "", th = '<th class="num"></th>';
    cg += '<col style="width:54px" />';
    state.headers.forEach(function (h, c) {
      cg += '<col style="width:' + state.colW[c] + 'px" />';
      var cls = state.sortCol === c ? (state.sortDir === 1 ? "asc" : state.sortDir === -1 ? "desc" : "") : "";
      th += '<th class="' + cls + '" data-c="' + c + '" title="' + esc(h) + '">' + esc(h) + "</th>";
    });
    $("v-cols").innerHTML = cg;
    $("v-thead").innerHTML = "<tr>" + th + "</tr>";
  }
  function render() {
    var sc = $("v-scroll"), total = state.view.length;
    var scrollTop = sc.scrollTop, h = sc.clientHeight || 400;
    var start = Math.max(0, Math.floor(scrollTop / ROWH) - BUF);
    var count = Math.ceil(h / ROWH) + BUF * 2;
    var end = Math.min(total, start + count);
    var html = "";
    if (start > 0) html += '<tr class="csv-spacer"><td colspan="' + (state.headers.length + 1) + '" style="height:' + start * ROWH + 'px"></td></tr>';
    for (var v = start; v < end; v++) {
      var r = state.rows[state.view[v]];
      var tds = '<td class="num">' + (v + 1) + "</td>";
      for (var c = 0; c < state.headers.length; c++) tds += "<td title=\"" + esc(r[c]) + '">' + esc(r[c]) + "</td>";
      html += "<tr>" + tds + "</tr>";
    }
    if (end < total) html += '<tr class="csv-spacer"><td colspan="' + (state.headers.length + 1) + '" style="height:' + (total - end) * ROWH + 'px"></td></tr>';
    $("v-tbody").innerHTML = html;
  }

  // header click → sort cycle
  $("v-thead").addEventListener("click", function (e) {
    var th = e.target.closest("th[data-c]"); if (!th) return;
    var c = +th.getAttribute("data-c");
    if (state.sortCol !== c) { state.sortCol = c; state.sortDir = 1; }
    else { state.sortDir = state.sortDir === 1 ? -1 : state.sortDir === -1 ? 0 : 1; if (state.sortDir === 0) state.sortCol = -1; }
    applyView(); renderHead(); $("v-scroll").scrollTop = 0; render();
  });

  var raf = 0;
  $("v-scroll").addEventListener("scroll", function () { if (raf) return; raf = requestAnimationFrame(function () { raf = 0; render(); }); });
  $("v-search").addEventListener("input", function () { applyView(); $("v-scroll").scrollTop = 0; render(); });
  $("v-header").addEventListener("change", build);
  $("v-delim").addEventListener("change", build);

  // file input
  function readFile(file) {
    if (!file) return;
    var fr = new FileReader();
    fr.onload = function () { loadText(String(fr.result)); };
    fr.readAsText(file);
  }
  $("v-drop").addEventListener("click", function () { $("v-fileInput").click(); });
  $("v-fileInput").addEventListener("change", function (e) { if (e.target.files[0]) readFile(e.target.files[0]); });
  ["dragenter", "dragover"].forEach(function (ev) { $("v-drop").addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); $("v-drop").classList.add("drag"); }); });
  ["dragleave", "drop"].forEach(function (ev) { $("v-drop").addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); $("v-drop").classList.remove("drag"); }); });
  $("v-drop").addEventListener("drop", function (e) { if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });

  // export current view
  function csvField(s) { s = String(s); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function dl(blob, name) { var u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(u); }, 3000); try { window.__vaultOffer && window.__vaultOffer(blob, name); } catch (e) {} }
  $("v-exp-csv").addEventListener("click", function () {
    if (!state.view.length) return;
    var lines = [state.headers.map(csvField).join(",")];
    state.view.forEach(function (i) { lines.push(state.rows[i].map(csvField).join(",")); });
    dl(new Blob([lines.join("\r\n")], { type: "text/csv" }), "filtered.csv");
  });
  $("v-exp-json").addEventListener("click", function () {
    if (!state.view.length) return;
    var arr = state.view.map(function (i) { var o = {}; state.headers.forEach(function (h, c) { o[h] = state.rows[i][c]; }); return o; });
    dl(new Blob([JSON.stringify(arr, null, 2)], { type: "application/json" }), "filtered.json");
  });
}
