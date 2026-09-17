/* ===== Calculators ===== */
// This tool's panel markup and its wiring; the Toolbox feature mounts every
// tool's markup into its shadow root, then calls init(root) for each.
export const markup = `
<section class="tool" id="tool-calc">
<div class="wrap">
  <header>
    <h1>🧮 Calculators</h1>
    <p>Quick everyday math — percentages, discounts, date differences, and mileage. All local.</p>
  </header>

  <div class="card">
    <div class="seg elec-nav" id="k-nav" role="tablist">
      <button type="button" data-p="pct" class="active">Percentage</button>
      <button type="button" data-p="disc">Discount</button>
      <button type="button" data-p="date">Date/Time</button>
      <button type="button" data-p="mile">Mileage</button>
    </div>
  </div>

  <!-- Percentage -->
  <div class="card e-panel active" id="kp-pct">
    <div class="k-sub">
      <h3>What is X% of Y?</h3>
      <div class="e-grid">
        <div class="e-field"><label>Percent (%)</label><input type="number" id="k-p1-x" step="any" value="15" /></div>
        <div class="e-field"><label>Of value</label><input type="number" id="k-p1-y" step="any" value="200" /></div>
      </div>
      <div class="e-out" id="k-p1-out"></div>
    </div>
    <div class="k-sub">
      <h3>X is what percent of Y?</h3>
      <div class="e-grid">
        <div class="e-field"><label>Value X</label><input type="number" id="k-p2-x" step="any" value="30" /></div>
        <div class="e-field"><label>Of total Y</label><input type="number" id="k-p2-y" step="any" value="200" /></div>
      </div>
      <div class="e-out" id="k-p2-out"></div>
    </div>
    <div class="k-sub">
      <h3>Percent change from A to B</h3>
      <div class="e-grid">
        <div class="e-field"><label>From A</label><input type="number" id="k-p3-a" step="any" value="120" /></div>
        <div class="e-field"><label>To B</label><input type="number" id="k-p3-b" step="any" value="150" /></div>
      </div>
      <div class="e-out" id="k-p3-out"></div>
    </div>
  </div>

  <!-- Discount -->
  <div class="card e-panel" id="kp-disc">
    <h2>Discount &amp; Sale Price</h2>
    <div class="e-grid">
      <div class="e-field"><label>Original price</label><input type="number" id="k-d-price" step="any" value="80" /></div>
      <div class="e-field"><label>Discount (%)</label><input type="number" id="k-d-off" step="any" value="25" /></div>
      <div class="e-field"><label>Sales tax (%, optional)</label><input type="number" id="k-d-tax" step="any" value="0" /></div>
    </div>
    <div class="e-out" id="k-d-out"></div>
  </div>

  <!-- Date/Time -->
  <div class="card e-panel" id="kp-date">
    <h2>Date Difference &amp; Age</h2>
    <div class="e-grid">
      <div class="e-field"><label>Start date</label><input type="date" id="k-dt-a" /></div>
      <div class="e-field"><label>End date</label><input type="date" id="k-dt-b" /></div>
    </div>
    <div class="e-out" id="k-dt-out"></div>
  </div>

  <!-- Mileage -->
  <div class="card e-panel" id="kp-mile">
    <h2>Mileage &amp; Trip Cost</h2>
    <div class="e-grid">
      <div class="e-field"><label>Odometer start</label><input type="number" id="k-m-start" step="any" value="12000" /></div>
      <div class="e-field"><label>Odometer end</label><input type="number" id="k-m-end" step="any" value="12350" /></div>
      <div class="e-field"><label>Fuel used (gal or L, optional)</label><input type="number" id="k-m-fuel" step="any" value="12" /></div>
      <div class="e-field"><label>Price per gal/L (optional)</label><input type="number" id="k-m-price" step="any" value="3.5" /></div>
    </div>
    <div class="e-out" id="k-m-out"></div>
    <div class="e-muted" style="margin-top:10px; font-size:12.5px">Distance is in whatever unit your odometer uses. Economy shows both MPG-style (dist ÷ fuel) and consumption (fuel ÷ 100 dist).</div>
  </div>

  <div class="foot">Everything runs client-side — no network needed.</div>
</div>
</section>
`;

export function init(root) {
  "use strict";
  var $ = function (id) { return root.getElementById(id); };
  function num(id) { var v = parseFloat($(id).value); return isNaN(v) ? null : v; }
  function trim(x) { if (x == null || !isFinite(x)) return null; return parseFloat(Number(x).toPrecision(8)); }
  function fmt(n, unit) {
    var t = trim(n); if (t == null) return "—";
    var s = String(t);
    if (s.indexOf("e") === -1) { var parts = s.split("."); parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ","); s = parts.join("."); }
    return s + (unit ? " " + unit : "");
  }
  function money(n) { var t = trim(n); if (t == null) return "—"; return t.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function tiles(rows) { return '<div class="e-out-grid">' + rows.map(function (r) { return '<div class="e-tile"><div class="k">' + r[0] + '</div><div class="v">' + r[1] + "</div></div>"; }).join("") + "</div>"; }
  function msg(el, t) { el.innerHTML = '<div class="e-muted">' + t + "</div>"; }

  var nav = $("k-nav");
  nav.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-p]"); if (!b) return;
    Array.prototype.forEach.call(nav.children, function (c) { c.classList.toggle("active", c === b); });
    ["pct", "disc", "date", "mile"].forEach(function (p) { $("kp-" + p).classList.toggle("active", p === b.getAttribute("data-p")); });
  });

  // ---- percentage ----
  function pct1() { var x = num("k-p1-x"), y = num("k-p1-y"), o = $("k-p1-out"); if (x == null || y == null) { msg(o, "Enter both values."); return; } o.innerHTML = tiles([[x + "% of " + y, fmt(x / 100 * y)]]); }
  function pct2() { var x = num("k-p2-x"), y = num("k-p2-y"), o = $("k-p2-out"); if (x == null || y == null || y === 0) { msg(o, "Enter values (Y ≠ 0)."); return; } o.innerHTML = tiles([[x + " of " + y, fmt(x / y * 100) + " %"]]); }
  function pct3() { var a = num("k-p3-a"), b = num("k-p3-b"), o = $("k-p3-out"); if (a == null || b == null || a === 0) { msg(o, "Enter values (A ≠ 0)."); return; } var d = (b - a) / a * 100; o.innerHTML = tiles([["Change", (d >= 0 ? "+" : "") + fmt(d) + " %"], ["Difference", fmt(b - a)]]); }
  ["k-p1-x", "k-p1-y"].forEach(function (id) { $(id).addEventListener("input", pct1); });
  ["k-p2-x", "k-p2-y"].forEach(function (id) { $(id).addEventListener("input", pct2); });
  ["k-p3-a", "k-p3-b"].forEach(function (id) { $(id).addEventListener("input", pct3); });

  // ---- discount ----
  function disc() {
    var pr = num("k-d-price"), off = num("k-d-off"), tax = num("k-d-tax") || 0, o = $("k-d-out");
    if (pr == null || off == null) { msg(o, "Enter a price and discount."); return; }
    var save = pr * off / 100, sale = pr - save, withTax = sale * (1 + tax / 100);
    var rows = [["You save", money(save)], ["Sale price", money(sale)]];
    if (tax) rows.push(["With " + off + "%… tax " + tax + "%", money(withTax)]);
    o.innerHTML = tiles(rows);
  }
  ["k-d-price", "k-d-off", "k-d-tax"].forEach(function (id) { $(id).addEventListener("input", disc); });

  // ---- date difference ----
  function dateDiff() {
    var a = $("k-dt-a").value, b = $("k-dt-b").value, o = $("k-dt-out");
    if (!a || !b) { msg(o, "Pick both dates."); return; }
    var d1 = new Date(a + "T00:00:00"), d2 = new Date(b + "T00:00:00");
    if (isNaN(d1) || isNaN(d2)) { msg(o, "Invalid date."); return; }
    var sign = d2 < d1 ? -1 : 1, lo = sign > 0 ? d1 : d2, hi = sign > 0 ? d2 : d1;
    // Y/M/D breakdown
    var y = hi.getFullYear() - lo.getFullYear(), m = hi.getMonth() - lo.getMonth(), dd = hi.getDate() - lo.getDate();
    if (dd < 0) { m--; var pm = new Date(hi.getFullYear(), hi.getMonth(), 0).getDate(); dd += pm; }
    if (m < 0) { y--; m += 12; }
    var totalDays = Math.round((hi - lo) / 86400000);
    o.innerHTML = tiles([
      ["Duration", (sign < 0 ? "−" : "") + y + "y " + m + "m " + dd + "d"],
      ["Total days", fmt(sign * totalDays)], ["Weeks", fmt(sign * (totalDays / 7))],
      ["Hours", fmt(sign * totalDays * 24)], ["Months (avg)", fmt(sign * (totalDays / 30.4375))]
    ]);
  }
  $("k-dt-a").addEventListener("input", dateDiff); $("k-dt-b").addEventListener("input", dateDiff);

  // ---- mileage ----
  function mile() {
    var s = num("k-m-start"), e = num("k-m-end"), fuel = num("k-m-fuel"), price = num("k-m-price"), o = $("k-m-out");
    if (s == null || e == null) { msg(o, "Enter start and end odometer."); return; }
    var dist = e - s;
    var rows = [["Distance", fmt(dist)]];
    if (fuel != null && fuel > 0) {
      rows.push(["Economy (dist/fuel)", fmt(dist / fuel) + " /unit"]);
      rows.push(["Consumption", fmt(fuel / dist * 100) + " /100"]);
      if (price != null) {
        rows.push(["Fuel cost", money(fuel * price)]);
        if (dist !== 0) rows.push(["Cost per unit dist", money(fuel * price / dist)]);
      }
    } else if (price != null && fuel != null) {
      rows.push(["Fuel cost", money(fuel * price)]);
    }
    o.innerHTML = tiles(rows);
  }
  ["k-m-start", "k-m-end", "k-m-fuel", "k-m-price"].forEach(function (id) { $(id).addEventListener("input", mile); });

  // defaults: today in date fields
  (function () {
    var now = new Date();
    var iso = function (d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
    var past = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    $("k-dt-a").value = iso(past); $("k-dt-b").value = iso(now);
  })();

  pct1(); pct2(); pct3(); disc(); dateDiff(); mile();
}
