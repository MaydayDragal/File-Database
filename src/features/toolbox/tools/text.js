/* ===== Text tools ===== */
// This tool's panel markup and its wiring; the Toolbox feature mounts every
// tool's markup into its shadow root, then calls init(root) for each.
export const markup = `
<section class="tool" id="tool-text">
<div class="wrap">
  <header>
    <h1>📝 Text</h1>
    <p>Transform, count, search and compare text — all locally in your browser.</p>
  </header>

  <div class="card">
    <div class="seg elec-nav" id="t-nav" role="tablist">
      <button type="button" data-p="editor" class="active">Editor &amp; Count</button>
      <button type="button" data-p="diff">Diff</button>
    </div>
  </div>

  <!-- Editor -->
  <div class="card t-panel active" id="tp-editor">
    <h2>Editor, Counter &amp; Find/Replace</h2>
    <textarea id="t-input" class="t-area" spellcheck="true" placeholder="Paste or type text here…"></textarea>
    <div class="t-stats" id="t-stats"></div>

    <div class="t-btns">
      <button type="button" class="btn btn-ghost" data-case="upper">UPPER</button>
      <button type="button" class="btn btn-ghost" data-case="lower">lower</button>
      <button type="button" class="btn btn-ghost" data-case="title">Title Case</button>
      <button type="button" class="btn btn-ghost" data-case="sentence">Sentence case</button>
      <button type="button" class="btn btn-ghost" data-case="camel">camelCase</button>
      <button type="button" class="btn btn-ghost" data-case="snake">snake_case</button>
      <button type="button" class="btn btn-ghost" data-case="kebab">kebab-case</button>
      <button type="button" class="btn btn-ghost" data-case="constant">CONSTANT_CASE</button>
      <button type="button" class="btn btn-ghost" data-case="invert">iNVERT</button>
    </div>
    <div class="t-btns">
      <button type="button" class="btn btn-ghost" data-line="sort">Sort A→Z</button>
      <button type="button" class="btn btn-ghost" data-line="rsort">Sort Z→A</button>
      <button type="button" class="btn btn-ghost" data-line="unique">Remove duplicates</button>
      <button type="button" class="btn btn-ghost" data-line="reverse">Reverse lines</button>
      <button type="button" class="btn btn-ghost" data-line="shuffle">Shuffle</button>
      <button type="button" class="btn btn-ghost" data-line="trim">Trim lines</button>
      <button type="button" class="btn btn-ghost" data-line="dropblank">Remove blank lines</button>
      <button type="button" class="btn btn-ghost" data-line="collapse">Collapse spaces</button>
    </div>

    <h2 style="margin-top:6px">Find &amp; Replace</h2>
    <div class="t-fr">
      <input type="text" id="t-find" placeholder="Find…" />
      <input type="text" id="t-replace" placeholder="Replace with…" />
    </div>
    <div class="t-fropts">
      <label class="chk"><input type="checkbox" id="t-fr-regex" /> Regex</label>
      <label class="chk"><input type="checkbox" id="t-fr-ci" /> Ignore case</label>
      <button type="button" class="btn btn-ghost" id="t-fr-go">Replace all</button>
      <span id="t-fr-count"></span>
    </div>

    <div class="t-btns" style="margin-top:4px">
      <button type="button" class="btn btn-download" id="t-copy">📋 Copy</button>
      <button type="button" class="btn btn-ghost" id="t-clear">Clear</button>
    </div>
    <div class="err" id="t-err"></div>
  </div>

  <!-- Diff -->
  <div class="card t-panel" id="tp-diff">
    <h2>Compare two texts</h2>
    <div class="t-diffgrid">
      <textarea id="t-diff-a" class="t-area" spellcheck="true" placeholder="Original…"></textarea>
      <textarea id="t-diff-b" class="t-area" spellcheck="true" placeholder="Changed…"></textarea>
    </div>
    <div class="t-fropts" style="margin-top:12px">
      <label class="chk"><input type="checkbox" id="t-diff-ci" /> Ignore case</label>
      <label class="chk"><input type="checkbox" id="t-diff-ws" /> Ignore whitespace</label>
      <button type="button" class="btn btn-primary" id="t-diff-go" style="width:auto; padding:9px 18px">Compare</button>
    </div>
    <div class="t-diffsummary" id="t-diff-summary"></div>
    <div class="t-diffout" id="t-diff-out"></div>
  </div>

  <div class="foot">Everything runs client-side — no network needed, nothing leaves your device.</div>
</div>
</section>
`;

export function init(root) {
  "use strict";
  var $ = function (id) { return root.getElementById(id); };

  // sub-nav
  var nav = $("t-nav");
  nav.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-p]"); if (!b) return;
    Array.prototype.forEach.call(nav.children, function (c) { c.classList.toggle("active", c === b); });
    ["editor", "diff"].forEach(function (p) { $("tp-" + p).classList.toggle("active", p === b.getAttribute("data-p")); });
  });

  // ---- counts ----
  var input = $("t-input");
  function updateStats() {
    var s = input.value;
    var chars = s.length;
    var noSpace = s.replace(/\s/g, "").length;
    var words = (s.match(/\S+/g) || []).length;
    var lines = s === "" ? 0 : s.split(/\r\n|\r|\n/).length;
    var sentences = (s.match(/[^.!?]+[.!?]+(\s|$)/g) || []).length;
    var paras = (s.split(/\n\s*\n/).filter(function (p) { return p.trim() !== ""; })).length;
    var mins = words / 200;
    var read = words === 0 ? "0s" : mins < 1 ? Math.max(1, Math.round(mins * 60)) + "s" : mins.toFixed(1) + " min";
    $("t-stats").innerHTML = [
      ["Words", words], ["Characters", chars], ["Chars (no spaces)", noSpace],
      ["Lines", lines], ["Sentences", sentences], ["Paragraphs", paras], ["Reading time", read]
    ].map(function (r) { return '<span class="t-stat">' + r[0] + ": <b>" + r[1] + "</b></span>"; }).join("");
  }
  input.addEventListener("input", updateStats);

  // ---- case transforms ----
  function titleCase(s) { return s.replace(/\w\S*/g, function (w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); }); }
  function sentenceCase(s) { return s.toLowerCase().replace(/(^\s*\w|[.!?]\s+\w)/g, function (m) { return m.toUpperCase(); }); }
  function words(s) { return s.replace(/[_\-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/\s+/).filter(Boolean); }
  function toCamel(s) { var w = words(s); return w.map(function (x, i) { x = x.toLowerCase(); return i === 0 ? x : x.charAt(0).toUpperCase() + x.slice(1); }).join(""); }
  function toSnake(s) { return words(s).map(function (x) { return x.toLowerCase(); }).join("_"); }
  function toKebab(s) { return words(s).map(function (x) { return x.toLowerCase(); }).join("-"); }
  function toConstant(s) { return words(s).map(function (x) { return x.toUpperCase(); }).join("_"); }
  function invert(s) { return s.replace(/[a-zA-Z]/g, function (c) { return c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase(); }); }
  var CASES = {
    upper: function (s) { return s.toUpperCase(); }, lower: function (s) { return s.toLowerCase(); },
    title: titleCase, sentence: sentenceCase, camel: toCamel, snake: toSnake, kebab: toKebab, constant: toConstant, invert: invert
  };
  root.querySelectorAll('#tp-editor [data-case]').forEach(function (b) {
    b.addEventListener("click", function () { input.value = CASES[b.getAttribute("data-case")](input.value); updateStats(); });
  });

  // ---- line ops ----
  function lines(s) { return s.split(/\r\n|\r|\n/); }
  var LINES = {
    sort: function (a) { return a.slice().sort(function (x, y) { return x.localeCompare(y); }); },
    rsort: function (a) { return a.slice().sort(function (x, y) { return y.localeCompare(x); }); },
    unique: function (a) { var seen = {}, out = []; a.forEach(function (l) { if (!seen[l]) { seen[l] = 1; out.push(l); } }); return out; },
    reverse: function (a) { return a.slice().reverse(); },
    shuffle: function (a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; },
    trim: function (a) { return a.map(function (l) { return l.trim(); }); },
    dropblank: function (a) { return a.filter(function (l) { return l.trim() !== ""; }); },
    collapse: function (a) { return a.map(function (l) { return l.replace(/[ \t]+/g, " ").trim(); }); }
  };
  root.querySelectorAll('#tp-editor [data-line]').forEach(function (b) {
    b.addEventListener("click", function () { input.value = LINES[b.getAttribute("data-line")](lines(input.value)).join("\n"); updateStats(); });
  });

  // ---- find & replace ----
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  $("t-fr-go").addEventListener("click", function () {
    var find = $("t-find").value; if (find === "") return;
    $("t-err").classList.remove("show");
    var flags = "g" + ($("t-fr-ci").checked ? "i" : "");
    var re;
    try { re = new RegExp($("t-fr-regex").checked ? find : escapeRe(find), flags); }
    catch (e) { $("t-err").textContent = "Invalid regex: " + e.message; $("t-err").classList.add("show"); return; }
    var count = (input.value.match(re) || []).length;
    input.value = input.value.replace(re, $("t-replace").value);
    updateStats();
    $("t-fr-count").textContent = count + " replaced";
  });

  $("t-copy").addEventListener("click", function () {
    var b = $("t-copy"), o = b.textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(input.value).then(function () { b.textContent = "✓ Copied"; setTimeout(function () { b.textContent = o; }, 1200); });
    else { input.select(); document.execCommand("copy"); }
  });
  $("t-clear").addEventListener("click", function () { input.value = ""; updateStats(); $("t-fr-count").textContent = ""; });
  updateStats();

  // ---- diff (line-level LCS) ----
  function normLines(text, ci, ws) {
    return text.split(/\r\n|\r|\n/).map(function (l) {
      var k = l; if (ws) k = k.replace(/\s+/g, " ").trim(); if (ci) k = k.toLowerCase(); return k;
    });
  }
  function lcsDiff(a, b) {
    var n = a.length, m = b.length;
    // DP table of LCS lengths
    var dp = []; for (var i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
    for (i = n - 1; i >= 0; i--) for (var j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
    var ops = [], x = 0, y = 0;
    while (x < n && y < m) {
      if (a[x] === b[y]) { ops.push(["eq", x, y]); x++; y++; }
      else if (dp[x + 1][y] >= dp[x][y + 1]) { ops.push(["del", x, -1]); x++; }
      else { ops.push(["ins", -1, y]); y++; }
    }
    while (x < n) { ops.push(["del", x, -1]); x++; }
    while (y < m) { ops.push(["ins", -1, y]); y++; }
    return ops;
  }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }
  $("t-diff-go").addEventListener("click", function () {
    var rawA = $("t-diff-a").value.split(/\r\n|\r|\n/), rawB = $("t-diff-b").value.split(/\r\n|\r|\n/);
    var ci = $("t-diff-ci").checked, ws = $("t-diff-ws").checked;
    var ka = normLines($("t-diff-a").value, ci, ws), kb = normLines($("t-diff-b").value, ci, ws);
    var ops = lcsDiff(ka, kb);
    var html = "", adds = 0, dels = 0;
    ops.forEach(function (op) {
      if (op[0] === "eq") {
        html += row(op[1] + 1, esc(rawA[op[1]]), op[2] + 1, esc(rawB[op[2]]), "", "");
      } else if (op[0] === "del") {
        dels++; html += row(op[1] + 1, esc(rawA[op[1]]), "", "", "t-del", "");
      } else {
        adds++; html += row("", "", op[2] + 1, esc(rawB[op[2]]), "", "t-ins");
      }
    });
    $("t-diff-out").innerHTML = html || '<div style="padding:12px" class="e-muted">Enter text in both boxes.</div>';
    $("t-diff-summary").innerHTML = ops.length ?
      ('<span class="rem">−' + dels + " removed</span> · <span class=\"add\">+" + adds + " added</span> · " +
       (ops.length - adds - dels) + " unchanged") : "";
  });
  function row(la, ta, lb, tb, ca, cb) {
    return '<div class="t-diffrow"><div class="t-ln">' + la + '</div><div class="' + ca + '">' + ta +
      '</div><div class="t-ln">' + lb + '</div><div class="' + cb + '">' + tb + "</div></div>";
  }
}
