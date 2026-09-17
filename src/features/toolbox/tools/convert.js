/* ===== Unit Converter ===== */
// This tool's panel markup and its wiring; the Toolbox feature mounts every
// tool's markup into its shadow root, then calls init(root) for each.
export const markup = `
<section class="tool" id="tool-convert">
<div class="wrap">
  <header>
    <h1>📐 Unit Converter</h1>
    <p>Convert between units of length, weight, temperature, volume, area, speed, time, digital storage, pressure, energy, and angle. Everything is computed locally in your browser.</p>
  </header>

  <div class="card">
    <h2>1 · Category</h2>
    <select id="c-cat"></select>
  </div>

  <div class="card">
    <h2>2 · Convert</h2>
    <div class="field">
      <label class="lbl">From</label>
      <div class="conv-row">
        <input type="number" id="c-from-val" class="cv" value="1" step="any" />
        <select id="c-from-unit" class="cu"></select>
      </div>
    </div>

    <div class="conv-mid">
      <button type="button" id="c-swap" title="Swap units" aria-label="Swap units">⇅</button>
    </div>

    <div class="field">
      <label class="lbl">To</label>
      <div class="conv-row">
        <input type="text" id="c-to-val" class="cv" readonly />
        <select id="c-to-unit" class="cu"></select>
      </div>
    </div>

    <div class="conv-eq" id="c-eq"></div>
    <div class="conv-common" id="c-common"></div>
  </div>

  <div class="foot">
    All conversions run client-side — no network needed. Factors use internationally
    defined values (e.g. 1 in = 2.54 cm exactly). Digital storage uses decimal
    (KB = 1000 bytes) and binary (KiB = 1024 bytes) units separately.
  </div>
</div>
</section>
`;

export function init(root) {
  "use strict";
  var $ = function (id) { return root.getElementById(id); };
  var els = {
    cat: $("c-cat"), fromVal: $("c-from-val"), fromUnit: $("c-from-unit"),
    toVal: $("c-to-val"), toUnit: $("c-to-unit"), swap: $("c-swap"),
    eq: $("c-eq"), common: $("c-common")
  };

  // Each unit: [label, symbol, factor] where value_in_base = value * factor.
  // "def" = [fromIndex, toIndex] default selection.
  var CATS = [
    { id: "length", name: "Length", def: [0, 8], units: [
      ["Meter", "m", 1], ["Kilometer", "km", 1000], ["Centimeter", "cm", 0.01],
      ["Millimeter", "mm", 0.001], ["Micrometer", "µm", 1e-6], ["Nanometer", "nm", 1e-9],
      ["Mile", "mi", 1609.344], ["Yard", "yd", 0.9144], ["Foot", "ft", 0.3048],
      ["Inch", "in", 0.0254], ["Nautical mile", "nmi", 1852]
    ]},
    { id: "mass", name: "Weight / Mass", def: [0, 5], units: [
      ["Kilogram", "kg", 1], ["Gram", "g", 0.001], ["Milligram", "mg", 1e-6],
      ["Microgram", "µg", 1e-9], ["Metric ton", "t", 1000], ["Pound", "lb", 0.45359237],
      ["Ounce", "oz", 0.028349523125], ["Stone", "st", 6.35029318]
    ]},
    { id: "temp", name: "Temperature", def: [0, 1], temp: true, units: [
      ["Celsius", "°C"], ["Fahrenheit", "°F"], ["Kelvin", "K"]
    ]},
    { id: "volume", name: "Volume", def: [0, 4], units: [
      ["Liter", "L", 1], ["Milliliter", "mL", 0.001], ["Cubic meter", "m³", 1000],
      ["Cubic centimeter", "cm³", 0.001], ["US gallon", "gal", 3.785411784],
      ["US quart", "qt", 0.946352946], ["US pint", "pt", 0.473176473],
      ["US cup", "cup", 0.2365882365], ["US fluid ounce", "fl oz", 0.0295735295625],
      ["US tablespoon", "tbsp", 0.01478676478125], ["US teaspoon", "tsp", 0.00492892159375],
      ["Imperial gallon", "gal (UK)", 4.54609]
    ]},
    { id: "area", name: "Area", def: [0, 5], units: [
      ["Square meter", "m²", 1], ["Square kilometer", "km²", 1e6], ["Square centimeter", "cm²", 1e-4],
      ["Square millimeter", "mm²", 1e-6], ["Hectare", "ha", 1e4], ["Acre", "acre", 4046.8564224],
      ["Square mile", "mi²", 2589988.110336], ["Square yard", "yd²", 0.83612736],
      ["Square foot", "ft²", 0.09290304], ["Square inch", "in²", 0.00064516]
    ]},
    { id: "speed", name: "Speed", def: [1, 2], units: [
      ["Meter/second", "m/s", 1], ["Kilometer/hour", "km/h", 0.2777777777777778],
      ["Mile/hour", "mph", 0.44704], ["Foot/second", "ft/s", 0.3048], ["Knot", "kn", 0.5144444444444445]
    ]},
    { id: "time", name: "Time", def: [0, 3], units: [
      ["Second", "s", 1], ["Millisecond", "ms", 0.001], ["Minute", "min", 60],
      ["Hour", "h", 3600], ["Day", "day", 86400], ["Week", "week", 604800],
      ["Year (365.25 d)", "yr", 31557600]
    ]},
    { id: "data", name: "Digital storage", def: [2, 3], units: [
      ["Bit", "bit", 0.125], ["Byte", "B", 1], ["Kilobyte", "KB", 1e3], ["Megabyte", "MB", 1e6],
      ["Gigabyte", "GB", 1e9], ["Terabyte", "TB", 1e12], ["Petabyte", "PB", 1e15],
      ["Kibibyte", "KiB", 1024], ["Mebibyte", "MiB", 1048576], ["Gibibyte", "GiB", 1073741824],
      ["Tebibyte", "TiB", 1099511627776]
    ]},
    { id: "pressure", name: "Pressure", def: [0, 3], units: [
      ["Pascal", "Pa", 1], ["Kilopascal", "kPa", 1000], ["Bar", "bar", 1e5],
      ["Pound/inch² (psi)", "psi", 6894.757293168], ["Atmosphere", "atm", 101325],
      ["mm of mercury", "mmHg", 133.322387415], ["Torr", "torr", 133.3223684210526]
    ]},
    { id: "energy", name: "Energy", def: [0, 2], units: [
      ["Joule", "J", 1], ["Kilojoule", "kJ", 1000], ["Calorie", "cal", 4.184],
      ["Kilocalorie", "kcal", 4184], ["Watt-hour", "Wh", 3600], ["Kilowatt-hour", "kWh", 3.6e6],
      ["British thermal unit", "BTU", 1055.05585262], ["Electronvolt", "eV", 1.602176634e-19]
    ]},
    { id: "torque", name: "Torque", def: [0, 7], units: [
      ["Newton meter", "N·m", 1], ["Newton centimeter", "N·cm", 0.01], ["Kilonewton meter", "kN·m", 1000],
      ["Dyne centimeter", "dyn·cm", 1e-7], ["Kilogram-force meter", "kgf·m", 9.80665],
      ["Kilogram-force centimeter", "kgf·cm", 0.0980665], ["Gram-force centimeter", "gf·cm", 9.80665e-5],
      ["Pound-force foot", "lbf·ft", 1.3558179483314004], ["Pound-force inch", "lbf·in", 0.1129848290276167],
      ["Ounce-force inch", "ozf·in", 0.0070615518142260]
    ]},
    { id: "angle", name: "Angle", def: [0, 1], units: [
      ["Degree", "°", 1], ["Radian", "rad", 57.29577951308232], ["Gradian", "grad", 0.9],
      ["Arcminute", "′", 0.0166666666666667], ["Arcsecond", "″", 0.0002777777777778],
      ["Turn", "turn", 360]
    ]}
  ];

  var cur = CATS[0];

  function tempTo(v, from) { // to Celsius
    return from === "°C" ? v : from === "°F" ? (v - 32) * 5 / 9 : v - 273.15;
  }
  function tempFrom(c, to) { // from Celsius
    return to === "°C" ? c : to === "°F" ? c * 9 / 5 + 32 : c + 273.15;
  }
  function convert(cat, val, fromSym, toSym) {
    if (cat.temp) return tempFrom(tempTo(val, fromSym), toSym);
    var f = unitBySym(cat, fromSym)[2], t = unitBySym(cat, toSym)[2];
    return val * f / t;
  }
  function unitBySym(cat, sym) {
    for (var i = 0; i < cat.units.length; i++) if (cat.units[i][1] === sym) return cat.units[i];
    return cat.units[0];
  }

  function fmt(n) {
    if (n == null || !isFinite(n)) return "—";
    if (n === 0) return "0";
    var abs = Math.abs(n);
    if (abs < 1e-6 || abs >= 1e15) {
      return n.toExponential(6).replace(/\.?0+e/, "e").replace("e+", "e");
    }
    // Trim to ~10 significant digits and strip float noise / trailing zeros.
    var r = parseFloat(n.toPrecision(10));
    var s = r.toString();
    if (s.indexOf("e") === -1 && s.indexOf(".") !== -1) {
      // add thousands separators to the integer part for readability
      var parts = s.split(".");
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      s = parts.join(".");
    } else if (s.indexOf("e") === -1) {
      s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
    return s;
  }

  function fillUnits(sel, cat) {
    sel.innerHTML = "";
    cat.units.forEach(function (u) {
      var o = document.createElement("option");
      o.value = u[1];
      o.textContent = u[0] + " (" + u[1] + ")";
      sel.appendChild(o);
    });
  }

  function loadCategory(cat) {
    cur = cat;
    fillUnits(els.fromUnit, cat);
    fillUnits(els.toUnit, cat);
    els.fromUnit.selectedIndex = cat.def ? cat.def[0] : 0;
    els.toUnit.selectedIndex = cat.def ? cat.def[1] : Math.min(1, cat.units.length - 1);
    recompute();
  }

  function recompute() {
    var raw = parseFloat(els.fromVal.value);
    var fromSym = els.fromUnit.value, toSym = els.toUnit.value;
    if (isNaN(raw)) { els.toVal.value = ""; els.eq.innerHTML = ""; renderCommon(); return; }
    var out = convert(cur, raw, fromSym, toSym);
    els.toVal.value = fmt(out);
    // one-unit equivalence line
    var one = convert(cur, 1, fromSym, toSym);
    els.eq.innerHTML = "<b>1 " + escapeHtml(fromSym) + "</b> = <b>" + fmt(one) + " " + escapeHtml(toSym) + "</b>";
    renderCommon();
  }

  // Quick chips: convert current "from" value into every other unit.
  function renderCommon() {
    els.common.innerHTML = "";
    var raw = parseFloat(els.fromVal.value);
    if (isNaN(raw)) return;
    var fromSym = els.fromUnit.value;
    cur.units.forEach(function (u) {
      if (u[1] === fromSym) return;
      var chip = document.createElement("button");
      chip.type = "button"; chip.className = "conv-chip";
      chip.textContent = fmt(convert(cur, raw, fromSym, u[1])) + " " + u[1];
      chip.title = "Switch “to” to " + u[0];
      chip.addEventListener("click", function () { els.toUnit.value = u[1]; recompute(); });
      els.common.appendChild(chip);
    });
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // populate category dropdown
  CATS.forEach(function (c, i) {
    var o = document.createElement("option");
    o.value = c.id; o.textContent = c.name;
    els.cat.appendChild(o);
  });

  els.cat.addEventListener("change", function () {
    var c = CATS.filter(function (x) { return x.id === els.cat.value; })[0] || CATS[0];
    loadCategory(c);
  });
  els.fromVal.addEventListener("input", recompute);
  els.fromUnit.addEventListener("change", recompute);
  els.toUnit.addEventListener("change", recompute);
  els.swap.addEventListener("click", function () {
    var fu = els.fromUnit.value;
    els.fromUnit.value = els.toUnit.value;
    els.toUnit.value = fu;
    // carry the current result into the input so the swap reads naturally
    var out = parseFloat(String(els.toVal.value).replace(/,/g, ""));
    if (!isNaN(out)) els.fromVal.value = out;
    recompute();
  });

  loadCategory(CATS[0]);
}
