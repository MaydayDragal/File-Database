/* ===== Electrical calculators ===== */
// This tool's panel markup and its wiring; the Toolbox feature mounts every
// tool's markup into its shadow root, then calls init(root) for each.
export const markup = `
<section class="tool" id="tool-elec">
<div class="wrap">
  <header>
    <h1>⚡ Electrical</h1>
    <p>A set of everyday electronics calculators — Ohm's law &amp; power, resistor networks, voltage dividers, LED resistors, resistor color codes, reactance, energy cost, and dBm. All computed locally in your browser.</p>
  </header>

  <div class="card">
    <div class="seg elec-nav" id="e-nav" role="tablist">
      <button type="button" data-p="ohm" class="active">Ohm's Law</button>
      <button type="button" data-p="rll">Resistors</button>
      <button type="button" data-p="vdiv">Voltage Divider</button>
      <button type="button" data-p="led">LED Resistor</button>
      <button type="button" data-p="color">Color Code</button>
      <button type="button" data-p="react">Reactance</button>
      <button type="button" data-p="cost">Energy Cost</button>
      <button type="button" data-p="dbm">dBm ⇄ Watts</button>
      <button type="button" data-p="cc5">5/6-Band Code</button>
      <button type="button" data-p="smd">SMD Code</button>
      <button type="button" data-p="awg">Wire Gauge (AWG)</button>
      <button type="button" data-p="batt">Battery Life</button>
    </div>
  </div>

  <!-- Ohm's Law & Power -->
  <div class="card e-panel active" id="ep-ohm">
    <h2>Ohm's Law &amp; Power</h2>
    <p class="desc">Enter <b>any two</b> values — the other two are calculated (V = I·R, P = V·I).</p>
    <div class="e-grid">
      <div class="e-field"><label>Voltage (V)</label><input type="number" id="e-ohm-v" step="any" placeholder="volts" /></div>
      <div class="e-field"><label>Current (I)</label><input type="number" id="e-ohm-i" step="any" placeholder="amps" /></div>
      <div class="e-field"><label>Resistance (R)</label><input type="number" id="e-ohm-r" step="any" placeholder="ohms" /></div>
      <div class="e-field"><label>Power (P)</label><input type="number" id="e-ohm-p" step="any" placeholder="watts" /></div>
    </div>
    <div class="e-out" id="e-ohm-out"></div>
  </div>

  <!-- Resistors series/parallel -->
  <div class="card e-panel" id="ep-rll">
    <h2>Resistors in Series &amp; Parallel</h2>
    <p class="desc">List resistor values separated by spaces or commas. Use <code>k</code> and <code>M</code> suffixes, e.g. <code>100 220 4.7k 1M</code>.</p>
    <div class="e-field"><label>Resistor values (Ω)</label><input type="text" id="e-rll-in" value="100 220 4.7k" /></div>
    <div class="e-out" id="e-rll-out"></div>
  </div>

  <!-- Voltage divider -->
  <div class="card e-panel" id="ep-vdiv">
    <h2>Voltage Divider</h2>
    <p class="desc">V<sub>out</sub> = V<sub>in</sub> · R2 / (R1 + R2). R values accept <code>k</code>/<code>M</code> suffixes.</p>
    <div class="e-grid">
      <div class="e-field"><label>Input voltage V<sub>in</sub> (V)</label><input type="number" id="e-vd-vin" step="any" value="12" /></div>
      <div class="e-field"><label>R1 (Ω, top)</label><input type="text" id="e-vd-r1" value="10k" /></div>
      <div class="e-field"><label>R2 (Ω, bottom)</label><input type="text" id="e-vd-r2" value="4.7k" /></div>
    </div>
    <div class="e-out" id="e-vd-out"></div>
  </div>

  <!-- LED resistor -->
  <div class="card e-panel" id="ep-led">
    <h2>LED Series Resistor</h2>
    <p class="desc">Find the resistor to drive an LED safely from a supply voltage.</p>
    <div class="e-grid">
      <div class="e-field"><label>Supply voltage (V)</label><input type="number" id="e-led-vs" step="any" value="5" /></div>
      <div class="e-field"><label>LED forward voltage (V)</label><input type="number" id="e-led-vf" step="any" value="2" /></div>
      <div class="e-field"><label>LED current (mA)</label><input type="number" id="e-led-i" step="any" value="20" /></div>
    </div>
    <div class="e-out" id="e-led-out"></div>
  </div>

  <!-- Resistor color code -->
  <div class="card e-panel" id="ep-color">
    <h2>Resistor Color Code (4-band)</h2>
    <p class="desc">Pick the band colors to read the resistance and tolerance.</p>
    <div class="res-vis"><span class="res-lead"></span><div class="res-body" id="e-res-body"></div><span class="res-lead"></span></div>
    <div class="e-grid">
      <div class="e-field"><label>Band 1</label><select id="e-cc-b1"></select></div>
      <div class="e-field"><label>Band 2</label><select id="e-cc-b2"></select></div>
      <div class="e-field"><label>Multiplier</label><select id="e-cc-m"></select></div>
      <div class="e-field"><label>Tolerance</label><select id="e-cc-t"></select></div>
    </div>
    <div class="e-out" id="e-cc-out"></div>
  </div>

  <!-- Reactance -->
  <div class="card e-panel" id="ep-react">
    <h2>Capacitive / Inductive Reactance</h2>
    <p class="desc">X<sub>C</sub> = 1 / (2πfC), X<sub>L</sub> = 2πfL. Fill frequency plus C and/or L.</p>
    <div class="e-grid">
      <div class="e-field"><label>Frequency (Hz)</label><input type="number" id="e-rx-f" step="any" value="1000" /></div>
      <div class="e-field"><label>Capacitance (µF)</label><input type="number" id="e-rx-c" step="any" value="1" /></div>
      <div class="e-field"><label>Inductance (mH)</label><input type="number" id="e-rx-l" step="any" value="10" /></div>
    </div>
    <div class="e-out" id="e-rx-out"></div>
  </div>

  <!-- Energy cost -->
  <div class="card e-panel" id="ep-cost">
    <h2>Energy Cost</h2>
    <p class="desc">How much a device costs to run.</p>
    <div class="e-grid">
      <div class="e-field"><label>Power (W)</label><input type="number" id="e-ec-w" step="any" value="100" /></div>
      <div class="e-field"><label>Hours per day</label><input type="number" id="e-ec-h" step="any" value="5" /></div>
      <div class="e-field"><label>Rate (per kWh)</label><input type="number" id="e-ec-r" step="any" value="0.15" /></div>
    </div>
    <div class="e-out" id="e-ec-out"></div>
  </div>

  <!-- dBm -->
  <div class="card e-panel" id="ep-dbm">
    <h2>dBm ⇄ Watts</h2>
    <p class="desc">Edit either field; the other updates. 0 dBm = 1 mW.</p>
    <div class="e-grid">
      <div class="e-field"><label>Power (dBm)</label><input type="number" id="e-db-dbm" step="any" value="30" /></div>
      <div class="e-field"><label>Power (mW)</label><input type="number" id="e-db-mw" step="any" /></div>
    </div>
    <div class="e-out" id="e-db-out"></div>
  </div>

  <!-- 5/6-band color code -->
  <div class="card e-panel" id="ep-cc5">
    <h2>Resistor Color Code (5 / 6-band)</h2>
    <div class="seg" id="e-cc5-mode" style="margin-bottom:14px">
      <button type="button" data-v="5" class="active">5-band</button>
      <button type="button" data-v="6">6-band</button>
    </div>
    <div class="res-vis"><span class="res-lead"></span><div class="res-body" id="e-cc5-body"></div><span class="res-lead"></span></div>
    <div class="e-grid">
      <div class="e-field"><label>Band 1</label><select id="e-cc5-b1"></select></div>
      <div class="e-field"><label>Band 2</label><select id="e-cc5-b2"></select></div>
      <div class="e-field"><label>Band 3</label><select id="e-cc5-b3"></select></div>
      <div class="e-field"><label>Multiplier</label><select id="e-cc5-m"></select></div>
      <div class="e-field"><label>Tolerance</label><select id="e-cc5-t"></select></div>
      <div class="e-field" id="e-cc5-tcwrap"><label>Temp. coeff.</label><select id="e-cc5-tc"></select></div>
    </div>
    <div class="e-out" id="e-cc5-out"></div>
  </div>

  <!-- SMD code -->
  <div class="card e-panel" id="ep-smd">
    <h2>SMD Resistor Code</h2>
    <p class="desc">Enter the printed code — 3-digit (<code>473</code>), 4-digit (<code>1002</code>), R-notation (<code>4R7</code>), or EIA-96 (<code>01C</code>).</p>
    <div class="e-field"><label>SMD code</label><input type="text" id="e-smd-in" value="473" /></div>
    <div class="e-out" id="e-smd-out"></div>
  </div>

  <!-- AWG -->
  <div class="card e-panel" id="ep-awg">
    <h2>Wire Gauge (AWG)</h2>
    <p class="desc">American Wire Gauge → diameter, area, copper resistance, and approximate ampacity.</p>
    <div class="e-field"><label>Gauge</label><select id="e-awg-sel"></select></div>
    <div class="e-out" id="e-awg-out"></div>
    <div class="e-muted" style="margin-top:10px; font-size:12.5px">Ampacity is a rough guide for copper (insulated, chassis/power wiring) and varies with insulation, bundling, and ambient temperature — always follow the applicable electrical code.</div>
  </div>

  <!-- Battery life -->
  <div class="card e-panel" id="ep-batt">
    <h2>Battery Life Estimator</h2>
    <div class="e-grid">
      <div class="e-field"><label>Capacity (mAh)</label><input type="number" id="e-bt-cap" step="any" value="2000" /></div>
      <div class="e-field"><label>Average load (mA)</label><input type="number" id="e-bt-load" step="any" value="150" /></div>
      <div class="e-field"><label>Battery voltage (V, optional)</label><input type="number" id="e-bt-v" step="any" value="3.7" /></div>
      <div class="e-field"><label>Derating (%)</label><input type="number" id="e-bt-dr" step="any" value="85" /></div>
    </div>
    <div class="e-out" id="e-bt-out"></div>
  </div>

  <div class="foot">
    All calculations run client-side — no network needed. Values are for reference /
    hobbyist use; always double-check against component datasheets and local codes for
    anything that matters.
  </div>
</div>
</section>
`;

export function init(root) {
  "use strict";
  var $ = function (id) { return root.getElementById(id); };

  // ---- helpers ----
  function num(id) { var v = parseFloat($(id).value); return isNaN(v) ? null : v; }
  function parseR(str) {
    if (str == null) return null;
    str = String(str).trim().replace(/Ω|ohms?/gi, "").replace(/,/g, "").trim();
    if (!str) return null;
    var m = /^([0-9]*\.?[0-9]+)\s*([kKmMgG]?)$/.exec(str);
    if (!m) return null;
    var s = m[2].toLowerCase();
    var mult = s === "k" ? 1e3 : s === "m" ? 1e6 : s === "g" ? 1e9 : 1;
    return parseFloat(m[1]) * mult;
  }
  function trim(x) { if (x == null || !isFinite(x)) return null; return parseFloat(Number(x).toPrecision(6)); }
  function fmt(n, unit) {
    var t = trim(n);
    if (t == null) return "—";
    var s = Math.abs(t) !== 0 && (Math.abs(t) < 1e-4 || Math.abs(t) >= 1e7) ? t.toExponential(4).replace("e+", "e") : String(t);
    return s + (unit ? " " + unit : "");
  }
  function fmtOhm(n) {
    if (n == null || !isFinite(n)) return "—";
    var a = Math.abs(n);
    if (a >= 1e6) return trim(n / 1e6) + " MΩ";
    if (a >= 1e3) return trim(n / 1e3) + " kΩ";
    return trim(n) + " Ω";
  }
  // Scale a base-unit value (F, H, Ω…) to a friendly SI-prefixed string.
  function fmtSI(n, unit) {
    if (n == null || !isFinite(n)) return "—";
    var a = Math.abs(n), p = "", d = 1;
    if (a >= 1e9) { p = "G"; d = 1e9; } else if (a >= 1e6) { p = "M"; d = 1e6; }
    else if (a >= 1e3) { p = "k"; d = 1e3; } else if (a >= 1) { p = ""; d = 1; }
    else if (a >= 1e-3) { p = "m"; d = 1e-3; } else if (a >= 1e-6) { p = "µ"; d = 1e-6; }
    else if (a >= 1e-9) { p = "n"; d = 1e-9; } else { p = "p"; d = 1e-12; }
    return trim(n / d) + " " + p + unit;
  }
  function tiles(rows) {
    var h = '<div class="e-out-grid">';
    rows.forEach(function (r) { h += '<div class="e-tile"><div class="k">' + r[0] + '</div><div class="v">' + r[1] + "</div></div>"; });
    return h + "</div>";
  }
  function msg(el, text, isErr) { el.innerHTML = '<div class="' + (isErr ? "e-err" : "e-muted") + '">' + text + "</div>"; }

  // ---- sub-panel nav ----
  var nav = $("e-nav");
  nav.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-p]"); if (!b) return;
    Array.prototype.forEach.call(nav.children, function (c) { c.classList.toggle("active", c === b); });
    ["ohm", "rll", "vdiv", "led", "color", "react", "cost", "dbm", "cc5", "smd", "awg", "batt"].forEach(function (p) {
      $("ep-" + p).classList.toggle("active", p === b.getAttribute("data-p"));
    });
  });

  // ---- Ohm's law & power ----
  function calcOhm() {
    var V = num("e-ohm-v"), I = num("e-ohm-i"), R = num("e-ohm-r"), P = num("e-ohm-p");
    var out = $("e-ohm-out");
    var count = [V, I, R, P].filter(function (x) { return x != null; }).length;
    if (count < 2) { msg(out, "Enter any two values."); return; }
    if (count > 2) { msg(out, "Enter exactly two values (clear the extras).", true); return; }
    if (V != null && I != null) { R = V / I; P = V * I; }
    else if (V != null && R != null) { I = V / R; P = V * V / R; }
    else if (V != null && P != null) { I = P / V; R = V * V / P; }
    else if (I != null && R != null) { V = I * R; P = I * I * R; }
    else if (I != null && P != null) { V = P / I; R = P / (I * I); }
    else { V = Math.sqrt(P * R); I = Math.sqrt(P / R); }
    out.innerHTML = tiles([
      ["Voltage", fmt(V, "V")], ["Current", fmt(I, "A")], ["Resistance", fmtOhm(R)], ["Power", fmt(P, "W")]
    ]);
  }
  ["e-ohm-v", "e-ohm-i", "e-ohm-r", "e-ohm-p"].forEach(function (id) { $(id).addEventListener("input", calcOhm); });

  // ---- resistors series/parallel ----
  function calcRLL() {
    var vals = ($("e-rll-in").value || "").split(/[\s,]+/).map(parseR).filter(function (x) { return x != null && x > 0; });
    var out = $("e-rll-out");
    if (!vals.length) { msg(out, "Enter one or more resistor values, e.g. 100 220 4.7k"); return; }
    var series = vals.reduce(function (a, b) { return a + b; }, 0);
    var par = 1 / vals.reduce(function (a, b) { return a + 1 / b; }, 0);
    out.innerHTML = tiles([
      ["Count", String(vals.length)], ["Series (Σ)", fmtOhm(series)], ["Parallel", fmtOhm(par)]
    ]);
  }
  $("e-rll-in").addEventListener("input", calcRLL);

  // ---- voltage divider ----
  function calcVDiv() {
    var vin = num("e-vd-vin"), r1 = parseR($("e-vd-r1").value), r2 = parseR($("e-vd-r2").value);
    var out = $("e-vd-out");
    if (vin == null || r1 == null || r2 == null) { msg(out, "Enter Vₑₙ, R1 and R2."); return; }
    if (r1 + r2 === 0) { msg(out, "R1 + R2 can't be zero.", true); return; }
    var vout = vin * r2 / (r1 + r2);
    var i = vin / (r1 + r2);
    out.innerHTML = tiles([
      ["Output Vₒᵤₜ", fmt(vout, "V")], ["Current", fmtSI(i, "A")],
      ["Power in R1", fmtSI(i * i * r1, "W")], ["Power in R2", fmtSI(i * i * r2, "W")]
    ]);
  }
  ["e-vd-vin", "e-vd-r1", "e-vd-r2"].forEach(function (id) { $(id).addEventListener("input", calcVDiv); });

  // ---- LED resistor ----
  var E12 = [1, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
  function nearestE12Up(r) {
    if (r <= 0) return r;
    var dec = Math.floor(Math.log10(r));
    for (var e = dec - 1; e <= dec + 2; e++) {
      for (var i = 0; i < E12.length; i++) {
        var v = E12[i] * Math.pow(10, e);
        if (v >= r - 1e-9) return v;
      }
    }
    return r;
  }
  function wattRating(p) {
    var stds = [0.125, 0.25, 0.5, 1, 2, 5];
    for (var i = 0; i < stds.length; i++) if (stds[i] >= p * 2) return stds[i]; // 2× headroom
    return ">5";
  }
  function calcLED() {
    var vs = num("e-led-vs"), vf = num("e-led-vf"), i = num("e-led-i");
    var out = $("e-led-out");
    if (vs == null || vf == null || i == null) { msg(out, "Enter supply, forward voltage and current."); return; }
    if (vs <= vf) { msg(out, "Supply voltage must be greater than the LED forward voltage.", true); return; }
    if (i <= 0) { msg(out, "LED current must be greater than zero.", true); return; }
    var amps = i / 1000;
    var r = (vs - vf) / amps;
    var p = (vs - vf) * amps;
    var std = nearestE12Up(r);
    out.innerHTML = tiles([
      ["Resistor", fmtOhm(r)], ["Nearest E12 ≥", fmtOhm(std)],
      ["Power in R", fmtSI(p, "W")], ["Use rating ≥", (typeof wattRating(p) === "number" ? wattRating(p) + " W" : wattRating(p) + " W")]
    ]);
  }
  ["e-led-vs", "e-led-vf", "e-led-i"].forEach(function (id) { $(id).addEventListener("input", calcLED); });

  // ---- resistor color code ----
  var COLORS = [
    ["Black", "#222", 0], ["Brown", "#7a3b10", 1], ["Red", "#e02424", 2], ["Orange", "#f37021", 3],
    ["Yellow", "#f4d000", 4], ["Green", "#1a9a3c", 5], ["Blue", "#1f5fd0", 6], ["Violet", "#7a3fb0", 7],
    ["Grey", "#8a8a8a", 8], ["White", "#f2f2f2", 9]
  ];
  var MULT = [
    ["Black", "#222", 1], ["Brown", "#7a3b10", 10], ["Red", "#e02424", 100], ["Orange", "#f37021", 1e3],
    ["Yellow", "#f4d000", 1e4], ["Green", "#1a9a3c", 1e5], ["Blue", "#1f5fd0", 1e6], ["Violet", "#7a3fb0", 1e7],
    ["Grey", "#8a8a8a", 1e8], ["White", "#f2f2f2", 1e9], ["Gold", "#c8a032", 0.1], ["Silver", "#b8b8b8", 0.01]
  ];
  var TOL = [
    ["Brown", "#7a3b10", "±1%"], ["Red", "#e02424", "±2%"], ["Green", "#1a9a3c", "±0.5%"],
    ["Blue", "#1f5fd0", "±0.25%"], ["Violet", "#7a3fb0", "±0.1%"], ["Grey", "#8a8a8a", "±0.05%"],
    ["Gold", "#c8a032", "±5%"], ["Silver", "#b8b8b8", "±10%"]
  ];
  function fillColorSel(sel, arr, val) {
    sel.innerHTML = "";
    arr.forEach(function (c, i) {
      var o = document.createElement("option");
      o.value = i; o.textContent = c[0] + (typeof val === "function" ? val(c) : "");
      sel.appendChild(o);
    });
  }
  fillColorSel($("e-cc-b1"), COLORS, function (c) { return " (" + c[2] + ")"; });
  fillColorSel($("e-cc-b2"), COLORS, function (c) { return " (" + c[2] + ")"; });
  fillColorSel($("e-cc-m"), MULT, function (c) { return " (×" + (c[2] >= 1 ? c[2] : c[2]) + ")"; });
  fillColorSel($("e-cc-t"), TOL, function (c) { return " (" + c[2] + ")"; });
  $("e-cc-b1").value = "2"; $("e-cc-b2").value = "2"; $("e-cc-m").value = "2"; $("e-cc-t").value = "6"; // 2.2k ±5%
  function band(color) { return '<span class="res-band" style="background:' + color + '"></span>'; }
  function calcColor() {
    var b1 = COLORS[+$("e-cc-b1").value], b2 = COLORS[+$("e-cc-b2").value],
        m = MULT[+$("e-cc-m").value], t = TOL[+$("e-cc-t").value];
    var value = (b1[2] * 10 + b2[2]) * m[2];
    $("e-res-body").innerHTML = band(b1[1]) + band(b2[1]) + band(m[1]) + '<span style="width:12px"></span>' + band(t[1]);
    $("e-cc-out").innerHTML = tiles([["Resistance", fmtOhm(value)], ["Tolerance", t[2]]]);
  }
  ["e-cc-b1", "e-cc-b2", "e-cc-m", "e-cc-t"].forEach(function (id) { $(id).addEventListener("change", calcColor); });

  // ---- reactance ----
  function calcReact() {
    var f = num("e-rx-f"), c = num("e-rx-c"), l = num("e-rx-l");
    var out = $("e-rx-out");
    if (f == null || (c == null && l == null)) { msg(out, "Enter a frequency plus C and/or L."); return; }
    var rows = [];
    if (c != null && f > 0 && c > 0) rows.push(["Xᴄ (capacitive)", fmtSI(1 / (2 * Math.PI * f * c * 1e-6), "Ω")]);
    if (l != null && l > 0) rows.push(["Xʟ (inductive)", fmtSI(2 * Math.PI * f * l * 1e-3, "Ω")]);
    if (c != null && l != null && c > 0 && l > 0) {
      rows.push(["Resonant f₀", fmtSI(1 / (2 * Math.PI * Math.sqrt(l * 1e-3 * c * 1e-6)), "Hz")]);
    }
    if (!rows.length) { msg(out, "Enter positive values.", true); return; }
    out.innerHTML = tiles(rows);
  }
  ["e-rx-f", "e-rx-c", "e-rx-l"].forEach(function (id) { $(id).addEventListener("input", calcReact); });

  // ---- energy cost ----
  function calcCost() {
    var w = num("e-ec-w"), h = num("e-ec-h"), r = num("e-ec-r");
    var out = $("e-ec-out");
    if (w == null || h == null || r == null) { msg(out, "Enter power, hours per day, and rate."); return; }
    var kwhDay = w / 1000 * h;
    out.innerHTML = tiles([
      ["Energy / day", fmt(kwhDay, "kWh")], ["Cost / day", fmt(kwhDay * r)],
      ["Cost / month", fmt(kwhDay * r * 30)], ["Cost / year", fmt(kwhDay * r * 365)]
    ]);
  }
  ["e-ec-w", "e-ec-h", "e-ec-r"].forEach(function (id) { $(id).addEventListener("input", calcCost); });

  // ---- dBm <-> watts ----
  var dbmLock = false;
  function fromDbm() {
    if (dbmLock) return; dbmLock = true;
    var d = num("e-db-dbm");
    if (d != null) $("e-db-mw").value = trim(Math.pow(10, d / 10));
    dbmLock = false; showDbm();
  }
  function fromMw() {
    if (dbmLock) return; dbmLock = true;
    var mw = num("e-db-mw");
    if (mw != null && mw > 0) $("e-db-dbm").value = trim(10 * Math.log10(mw));
    dbmLock = false; showDbm();
  }
  function showDbm() {
    var d = num("e-db-dbm"), out = $("e-db-out");
    if (d == null) { msg(out, "Enter a value in dBm or mW."); return; }
    var mw = Math.pow(10, d / 10);
    out.innerHTML = tiles([["dBm", fmt(d, "dBm")], ["Milliwatts", fmt(mw, "mW")], ["Watts", fmtSI(mw / 1000, "W")]]);
  }
  $("e-db-dbm").addEventListener("input", fromDbm);
  $("e-db-mw").addEventListener("input", fromMw);

  // initial computations
  // ---- 5/6-band color code ----
  var TEMPCO = [
    ["Brown", "#7a3b10", 100], ["Red", "#e02424", 50], ["Orange", "#f37021", 15],
    ["Yellow", "#f4d000", 25], ["Blue", "#1f5fd0", 10], ["Violet", "#7a3fb0", 5]
  ];
  var cc5bands = 5;
  fillColorSel($("e-cc5-b1"), COLORS, function (c) { return " (" + c[2] + ")"; });
  fillColorSel($("e-cc5-b2"), COLORS, function (c) { return " (" + c[2] + ")"; });
  fillColorSel($("e-cc5-b3"), COLORS, function (c) { return " (" + c[2] + ")"; });
  fillColorSel($("e-cc5-m"), MULT, function (c) { return " (×" + c[2] + ")"; });
  fillColorSel($("e-cc5-t"), TOL, function (c) { return " (" + c[2] + ")"; });
  fillColorSel($("e-cc5-tc"), TEMPCO, function (c) { return " (" + c[2] + " ppm)"; });
  $("e-cc5-b1").value = "1"; $("e-cc5-b2").value = "0"; $("e-cc5-b3").value = "0"; $("e-cc5-m").value = "2"; $("e-cc5-t").value = "0"; // 100×100=10k ±1%
  $("e-cc5-mode").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-v]"); if (!b) return;
    Array.prototype.forEach.call(this.children, function (c) { c.classList.toggle("active", c === b); });
    cc5bands = +b.getAttribute("data-v");
    $("e-cc5-tcwrap").style.display = cc5bands === 6 ? "" : "none";
    calcCC5();
  });
  function calcCC5() {
    var b1 = COLORS[+$("e-cc5-b1").value], b2 = COLORS[+$("e-cc5-b2").value], b3 = COLORS[+$("e-cc5-b3").value],
        m = MULT[+$("e-cc5-m").value], t = TOL[+$("e-cc5-t").value], tc = TEMPCO[+$("e-cc5-tc").value];
    var value = (b1[2] * 100 + b2[2] * 10 + b3[2]) * m[2];
    var html = band(b1[1]) + band(b2[1]) + band(b3[1]) + band(m[1]) + '<span style="width:10px"></span>' + band(t[1]);
    if (cc5bands === 6) html += band(tc[1]);
    $("e-cc5-body").innerHTML = html;
    var rows = [["Resistance", fmtOhm(value)], ["Tolerance", t[2]]];
    if (cc5bands === 6) rows.push(["Temp. coeff.", tc[2] + " ppm/°C"]);
    $("e-cc5-out").innerHTML = tiles(rows);
  }
  ["e-cc5-b1", "e-cc5-b2", "e-cc5-b3", "e-cc5-m", "e-cc5-t", "e-cc5-tc"].forEach(function (id) { $(id).addEventListener("change", calcCC5); });
  $("e-cc5-tcwrap").style.display = "none";

  // ---- SMD resistor code ----
  var EIA96 = [100, 102, 105, 107, 110, 113, 115, 118, 121, 124, 127, 130, 133, 137, 140, 143, 147, 150, 154, 158,
    162, 165, 169, 174, 178, 182, 187, 191, 196, 200, 205, 210, 215, 221, 226, 232, 237, 243, 249, 255,
    261, 267, 274, 280, 287, 294, 301, 309, 316, 324, 332, 340, 348, 357, 365, 374, 383, 392, 402, 412,
    422, 432, 442, 453, 464, 475, 487, 499, 511, 523, 536, 549, 562, 576, 590, 604, 619, 634, 649, 665,
    681, 698, 715, 732, 750, 768, 787, 806, 825, 845, 866, 887, 909, 931, 953, 976];
  var EIA_MULT = { Z: 0.001, Y: 0.01, R: 0.01, X: 0.1, S: 0.1, A: 1, B: 10, H: 10, C: 100, D: 1000, E: 10000, F: 100000 };
  function decodeSMD(codeRaw) {
    var code = (codeRaw || "").trim();
    if (!code) return null;
    // R-notation, e.g. 4R7, R47, 0R5
    if (/[rR]/.test(code)) {
      var v = parseFloat(code.replace(/[rR]/, "."));
      return isNaN(v) ? null : { ohms: v, note: "R-notation" };
    }
    // EIA-96: 2 digits + letter
    var e = /^(\d{2})([A-Za-z])$/.exec(code);
    if (e) {
      var idx = parseInt(e[1], 10) - 1, mult = EIA_MULT[e[2].toUpperCase()];
      if (idx >= 0 && idx < 96 && mult != null) return { ohms: EIA96[idx] * mult, note: "EIA-96" };
      return null;
    }
    if (/^\d{3}$/.test(code)) { return { ohms: parseInt(code.slice(0, 2), 10) * Math.pow(10, +code[2]), note: "3-digit" }; }
    if (/^\d{4}$/.test(code)) { return { ohms: parseInt(code.slice(0, 3), 10) * Math.pow(10, +code[3]), note: "4-digit" }; }
    return null;
  }
  function calcSMD() {
    var r = decodeSMD($("e-smd-in").value), out = $("e-smd-out");
    if (!r) { msg(out, "Unrecognized code. Try 473, 1002, 4R7, or 01C.", true); return; }
    out.innerHTML = tiles([["Resistance", fmtOhm(r.ohms)], ["Format", r.note]]);
  }
  $("e-smd-in").addEventListener("input", calcSMD);

  // ---- AWG wire gauge ----
  var AWG_AMP = { "0000": 302, "000": 239, "00": 190, "0": 150, "1": 119, "2": 94, "4": 60, "6": 37, "8": 24, "10": 15, "12": 9.3, "14": 5.9, "16": 3.7, "18": 2.3, "20": 1.5, "22": 0.92, "24": 0.577, "26": 0.361, "28": 0.226, "30": 0.142 };
  var AWG_LIST = ["0000", "000", "00", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "16", "18", "20", "22", "24", "26", "28", "30", "32", "36", "40"];
  function awgToN(g) { return g === "0000" ? -3 : g === "000" ? -2 : g === "00" ? -1 : parseInt(g, 10); }
  (function () {
    var sel = $("e-awg-sel");
    AWG_LIST.forEach(function (g) { var o = document.createElement("option"); o.value = g; o.textContent = "AWG " + g; sel.appendChild(o); });
    sel.value = "12";
  })();
  function calcAWG() {
    var g = $("e-awg-sel").value, n = awgToN(g), out = $("e-awg-out");
    var dmm = 0.127 * Math.pow(92, (36 - n) / 39);      // diameter mm
    var area = Math.PI / 4 * dmm * dmm;                  // mm^2
    var kcmil = area * 1973.53 / 1000;                   // 1 mm^2 = 1973.53 cmil
    var rho = 1.724e-8;                                  // copper Ω·m
    var rPerKm = rho / (area * 1e-6) * 1000;             // Ω per km
    var rows = [
      ["Diameter", trim(dmm) + " mm / " + trim(dmm / 25.4) + " in"],
      ["Area", trim(area) + " mm² / " + trim(kcmil) + " kcmil"],
      ["Copper R", trim(rPerKm) + " Ω/km"],
      ["≈ R per 1000 ft", trim(rPerKm * 0.3048) + " Ω"]
    ];
    if (AWG_AMP[g] != null) rows.push(["≈ Ampacity", AWG_AMP[g] + " A"]);
    out.innerHTML = tiles(rows);
  }
  $("e-awg-sel").addEventListener("change", calcAWG);

  // ---- battery life ----
  function calcBatt() {
    var cap = num("e-bt-cap"), load = num("e-bt-load"), v = num("e-bt-v"), dr = num("e-bt-dr"), out = $("e-bt-out");
    if (cap == null || load == null || load <= 0) { msg(out, "Enter capacity and a load current > 0."); return; }
    var derate = (dr == null ? 100 : dr) / 100;
    var hours = cap / load * derate;
    var hh = Math.floor(hours), mm = Math.round((hours - hh) * 60);
    var rows = [["Runtime", trim(hours) + " h"], ["≈", hh + " h " + mm + " min"]];
    if (v != null) rows.push(["Energy", trim(cap * v / 1000) + " Wh"]);
    out.innerHTML = tiles(rows);
  }
  ["e-bt-cap", "e-bt-load", "e-bt-v", "e-bt-dr"].forEach(function (id) { $(id).addEventListener("input", calcBatt); });

  calcOhm(); calcRLL(); calcVDiv(); calcLED(); calcColor(); calcReact(); calcCost(); fromDbm();
  calcCC5(); calcSMD(); calcAWG(); calcBatt();
}
