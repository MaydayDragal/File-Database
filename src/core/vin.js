/*
 * vin.js — Mercedes vehicle identifiers: finding VINs and datacard FINs in
 * text, telling a real one from an OCR look-alike, the ISO 3779 check digit,
 * and the model year a VIN carries.
 *
 * Moved unchanged out of vault/app.js (the scanner) and ros/index.html (the
 * check digit and year) in REWRITE-PLAN.md Phase 1; both pages carried the
 * same manufacturer list and the same look-alike rules. Standalone: needs no
 * other core file. Classic <script> (window.FDCore.vin) and side-effect
 * import from Node.
 */
(function (global) {
  "use strict";

  const VIN_TEXT_MAX = 1024 * 1024; // read at most 1 MB of a text file
  const VIN_MAX_PER_FILE = 25;      // a datacard can reference several vehicles
  const VIN_RICH_TEXT = 400;        // a PDF text layer this size is a real document,
                                    // not a scan — no VIN in it means there is no VIN

  // A VIN is 17 chars from [A-HJ-NPR-Z0-9] (I, O and Q are never used). PDF and
  // OCR text extraction very often SPLITS a VIN with spaces (e.g. the datacard
  // text comes out "W1KLF4HB1 RA068698", or even one character per cell), so we
  // tolerate up to a couple of spaces/tabs between characters and strip them
  // from the match. The outer lookarounds still require the whole run to be
  // bounded by non-letters/digits, so it can't be a slice of a longer code.
  const VIN_SEP = "[ \\t\\u00A0]{0,2}";

  // Mercedes-Benz World Manufacturer Identifiers (first 3 VIN chars). This is a
  // Mercedes-only tool (LI docs, XENTRY, datacards), and a real MB VIN/FIN always
  // begins with one of these — so requiring a known WMI is the single strongest
  // way to keep REAL vehicle numbers and reject look-alikes (engine numbers like
  // 112600009311006RE, OCR'd prose, padded fields). Add a prefix here if a
  // legitimate VIN is ever missed.
  const MB_WMI = new Set([
    "WDB", "WDD", "WDC", "W1K", "W1N",        // Germany — passenger / SUV
    "WDF", "W1V", "W1W", "W1X", "W1Y",        // Germany — vans / commercial
    "WD3", "WD4",                             // Sprinter / vans
    "WMX", "WME",                             // AMG / Smart
    "4JG", "55S",                             // USA (Alabama / Vance)
    "8AC", "9BM", "MB1",                      // Argentina / Brazil / India
  ]);

  // Reject 17-char strings that only LOOK like a VIN. Real VIN/FIN examples that
  // MUST pass: 4JGFB4GB9SB387878, W1KLF4HB1RA068698, W1K2140471A068698. Junk that
  // MUST fail: FREEMAPUPDATES50A ("...free map updates 50A"), OCR'd blank fields
  // 000000000000000ER, and engine numbers like 112600009311006RE.
  function looksLikeVin(v) {
    if (!MB_WMI.has(v.slice(0, 3))) return false; // must start with a real MB WMI
    const digits = (v.match(/\d/g) || []).length;
    if (digits < 4) return false;               // a real VIN/FIN has a numeric serial
    if (17 - digits < 2) return false;          // ...but keeps its WMI letters too
    if (/[A-Z]{7,}/.test(v)) return false;      // 7+ letters in a row => a word, not a VIN
    if (new Set(v).size < 6) return false;      // too few distinct chars => a padded/blank field
    return true;
  }

  // Mercedes datacards carry BOTH the ISO VIN (labelled "VIN") and a separate
  // Baumuster-based datacard/FIN number (e.g. "W1K2140471A068698", model series
  // 214). They must not be conflated: the VIN drives grouping; the FIN is kept
  // apart but still searchable. Classification, strongest signal first:
  //   - a code immediately preceded by "VIN"                -> VIN (authoritative)
  //   - a code by the datacard header / "FIN"/chassis label -> FIN
  //   - an unlabelled Baumuster-format code (DIGIT at pos 4) seen alongside a
  //     real VIN                                             -> FIN
  //   - anything else                                        -> VIN (keep recall)
  const VIN_PREC = { vin: 3, fin: 2, "?": 1 };
  function findVinsDetailed(text, fuzzy) {
    if (!text) return { vins: [], fins: [] };
    const seen = new Map(); // code -> "vin" | "fin" | "?"
    const consider = (t) => {
      const re = new RegExp("(?<![A-Z0-9])[A-HJ-NPR-Z0-9](?:" + VIN_SEP + "[A-HJ-NPR-Z0-9]){16}(?![A-Z0-9])", "g");
      let m;
      while ((m = re.exec(t)) && seen.size < VIN_MAX_PER_FILE) {
        // space, tab or no-break space — everything VIN_SEP admits
        const v = m[0].replace(/[ \t ]/g, "");
        if (v.length !== 17 || !looksLikeVin(v)) continue;
        const before = t.slice(Math.max(0, m.index - 16), m.index).toUpperCase().replace(/[^A-Z]/g, "");
        let tag = "?";
        if (/VIN$/.test(before)) tag = "vin";
        else if (/DATACARD$|DATENKARTE$|FGSTNR$|FAHRGESTELLNR$/.test(before)) tag = "fin";
        if (!seen.has(v) || VIN_PREC[tag] > VIN_PREC[seen.get(v)]) seen.set(v, tag);
      }
    };
    const up = text.toUpperCase();
    consider(up);
    if (fuzzy) {
      // OCR often misreads 1/0 as I/O/Q. Those letters never occur in a VIN, so
      // normalizing them inside candidate runs recovers the real number — BUT a
      // real VIN keeps genuine serial digits that OCR reads correctly, so only
      // correct runs that already hold >=2 real digits. This stops OCR'd prose
      // ("WITHOUT LIMITATION" -> W1TH0UTL1M1TAT10N) from being fabricated into a VIN.
      const runRe = new RegExp("(?<![A-Z0-9])[A-Z0-9](?:" + VIN_SEP + "[A-Z0-9]){16}(?![A-Z0-9])", "g");
      consider(up.replace(runRe, (run) =>
        (run.match(/[0-9]/g) || []).length < 2 ? run
          : run.replace(/I/g, "1").replace(/[OQ]/g, "0")));
    }
    const vins = [], fins = [];
    const hasVin = Array.from(seen.values()).includes("vin");
    seen.forEach((tag, v) => {
      const isFin = tag === "fin" || (tag === "?" && hasVin && /\d/.test(v[3]));
      (isFin ? fins : vins).push(v);
    });
    return { vins, fins };
  }
  // Back-compat helper - just the VINs (used to decide whether a PDF needs OCR).
  function findVins(text, fuzzy) { return findVinsDetailed(text, fuzzy).vins; }

  /*
   * ISO 3779 puts a check digit at character 9, computed over the whole number.
   * A misread almost never survives it — of the readings a marginal scan gave
   * for one real VIN, "W1NKM4GB9SF382775" checks out and "W1NKMAGB9SF382775",
   * "W1NKM4GB0SF382775" and "W1NKMAGB1SF382775" do not. That makes it the one
   * way to tell a good reading from a plausible-looking wrong one.
   *
   * It is used to PREFER a reading, never to reject the only one there is: a
   * vehicle built for a market that does not compute the digit would fail it
   * while being perfectly correct.
   */
  var VIN_VALUE = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
  var VIN_WEIGHT = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  function vinCheckOk(v) {
    if (!v || v.length !== 17) return false;
    var sum = 0;
    for (var i = 0; i < 17; i++) {
      var c = v.charAt(i);
      var n = /[0-9]/.test(c) ? +c : VIN_VALUE[c];
      if (n == null) return false;
      sum += n * VIN_WEIGHT[i];
    }
    var r = sum % 11;
    return v.charAt(8) === (r === 10 ? "X" : String(r));
  }

  // A VIN carries its own model year (position 10). Position 7 says which
  // 30-year cycle that letter belongs to: a letter there means 2010 onwards.
  // Worth having because "Year:" is a two-character cell that OCR often loses.
  var VIN_YEAR = "ABCDEFGHJKLMNPRSTVWXY";   // 1980.. / 2010.. ; digits 1-9 are 2001-2009
  function yearFromVin(vin) {
    if (!vin || vin.length !== 17) return "";
    var c = vin.charAt(9), modern = /[A-Z]/.test(vin.charAt(6));
    if (/[1-9]/.test(c)) return String(2000 + parseInt(c, 10));
    var i = VIN_YEAR.indexOf(c);
    if (i < 0) return "";
    return String((modern ? 2010 : 1980) + i);
  }

  var core = global.FDCore = global.FDCore || {};
  core.vin = {
    VIN_TEXT_MAX: VIN_TEXT_MAX, VIN_MAX_PER_FILE: VIN_MAX_PER_FILE, VIN_RICH_TEXT: VIN_RICH_TEXT, VIN_SEP: VIN_SEP,
    MB_WMI: MB_WMI, looksLikeVin: looksLikeVin, findVinsDetailed: findVinsDetailed, findVins: findVins,
    vinCheckOk: vinCheckOk, yearFromVin: yearFromVin,
  };
})(typeof self !== "undefined" ? self : globalThis);
