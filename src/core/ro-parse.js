/*
 * ro-parse.js — reading a paper repair order out of the text and word
 * positions the PDF text layer or the OCR engine hand over: the header
 * fields, the line table cut out by column, the DISPATCH print-out, and the
 * small helpers the closer VIN / cell re-reads use.
 *
 * Moved verbatim out of ros/index.html (REWRITE-PLAN.md Phase 1). Everything
 * here is pure: the page keeps OCR, PDF.js, the scan window and the closer
 * re-reads, and calls in here with what they produced. Requires vin.js.
 * Classic <script> (window.FDCore.ro) and side-effect import from Node.
 */
(function (global) {
  "use strict";
  var FDCore = global.FDCore;

  // ---------- small text helpers ----------
  function squash(s) { return String(s || "").replace(/[ \t]+/g, " ").replace(/ {2,}/g, " ").trim(); }
  function digitsOnly(s) { return String(s || "").replace(/\D/g, ""); }
  function capsRatio(s) {
    var letters = String(s || "").match(/[A-Za-z]/g);
    if (!letters || !letters.length) return 0;
    return (String(s).match(/[A-Z]/g) || []).length / letters.length;
  }
  function titleCase(s) { return String(s || "").toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }); }
  // Two or more real words, no label, no long number: a person or a company,
  // not a row of OCR scrapings like "oR i re jg sl vi esi".
  function nameLike(s) {
    return (String(s || "").match(/[A-Za-z]{3,}/g) || []).length >= 2 &&
      !LABEL_STOP.test(s) && !/\d{4,}/.test(s);
  }
  // The customer, when the "Name:" label itself did not survive the scan — a
  // two-character cell on a form whose labels OCR loses readily, while the name
  // beside it comes through fine. The block is printed Name / Address /
  // City-ST-Zip, so whichever of those lower labels WAS read anchors the
  // search: walk up from it to the nearest lines that read like a name.
  function customerNearAddress(lines) {
    var at = -1, i;
    for (i = 0; i < lines.length; i++) {
      if (/City\s*-?\s*ST\s*-?\s*Zip|\bAddress\s*[:#]/i.test(lines[i])) { at = i; break; }
    }
    if (at < 1) return "";
    var found = [];
    for (i = at - 1; i >= 0 && at - i <= 5; i--) {
      if (nameLike(lines[i])) { found.unshift(squash(lines[i])); if (found.length === 2) break; }
      else if (found.length) break;                  // the run ended
      else if (LABEL_STOP.test(lines[i])) break;     // reached the field above without finding one
    }
    return found.join(", ").slice(0, 80);
  }
  function cleanName(s) {
    var t = squash(String(s || "").replace(/[^A-Za-z,'.\- ]/g, " ")).replace(/\s*,\s*/, ", ").replace(/^[,.\- ]+|[,.\- ]+$/g, "");
    if (t.length < 2 || t.length > 60) return "";
    return capsRatio(t) > 0.8 ? titleCase(t) : t;
  }
  function firstPhone(s, strict) {
    var m = String(s || "").match(strict ? /\b(\d{3})[-.](\d{3})[-.](\d{4})\b/ : /\(?\b(\d{2,3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})\b/);
    return m ? m[1] + "-" + m[2] + "-" + m[3] : "";
  }
  // "25" on a 2026 RO means 2025; a year more than one ahead is last century.
  function fullYear(y) {
    var n = parseInt(y, 10);
    if (!isFinite(n)) return "";
    if (n >= 1900 && n <= 2100) return String(n);
    if (n >= 0 && n < 100) { var cut = (new Date().getFullYear() % 100) + 1; return String(n <= cut ? 2000 + n : 1900 + n); }
    return "";
  }

  // ---------- VIN detection (shared with the Vault: ../src/core/vin.js) ----------
  var looksLikeVin = FDCore.vin.looksLikeVin, vinCheckOk = FDCore.vin.vinCheckOk;

  function findVinIn(text) {
    var up = String(text || "").toUpperCase(), SEP = "[ \\t\\u00A0]{0,2}", hits = [];
    function consider(t) {
      var re = new RegExp("(?<![A-Z0-9])[A-HJ-NPR-Z0-9](?:" + SEP + "[A-HJ-NPR-Z0-9]){16}(?![A-Z0-9])", "g"), m;
      while ((m = re.exec(t))) {
        var v = m[0].replace(/[ \t ]/g, "");
        if (v.length !== 17 || !looksLikeVin(v)) continue;
        var before = t.slice(Math.max(0, m.index - 16), m.index).replace(/[^A-Z]/g, "");
        hits.push({ vin: v, labelled: /VIN$/.test(before) });
      }
    }
    consider(up);
    // OCR reads 1 as I and 0 as O/Q — neither letter ever appears in a VIN. Only
    // fix runs that already hold real digits, so prose can't become a VIN.
    var runRe = new RegExp("(?<![A-Z0-9])[A-Z0-9](?:" + SEP + "[A-Z0-9]){16}(?![A-Z0-9])", "g");
    consider(up.replace(runRe, function (run) {
      return (run.match(/\d/g) || []).length < 2 ? run : run.replace(/I/g, "1").replace(/[OQ]/g, "0");
    }));
    var i;
    for (i = 0; i < hits.length; i++) if (hits[i].labelled && vinCheckOk(hits[i].vin)) return hits[i].vin;
    for (i = 0; i < hits.length; i++) if (vinCheckOk(hits[i].vin)) return hits[i].vin;
    for (i = 0; i < hits.length; i++) if (hits[i].labelled) return hits[i].vin;
    return hits.length ? hits[0].vin : "";
  }

  var yearFromVin = FDCore.vin.yearFromVin;

  // ---------- parsing ----------
  // Every field label the dealer forms and the DISPATCH screen print. A value
  // runs until the next label on the same row, which is how the two-column
  // header of an RO survives being flattened into lines of text.
  var LABEL_WORDS = "R\\.?\\s?O\\.?\\s*(?:No|Number)?|Tag\\s*(?:No)?|Open\\s*Date|Mileage(?:\\s*In)?|Complete\\s*by\\s*Time|Pay\\s*Method|Service\\s*Advisor|Advisor|Name|Address|City\\s*-?\\s*ST\\s*-?\\s*Zip|Home\\s*Ph|Bus\\s*Ph|Cell\\s*Ph|E-?\\s?mail|Year|Model|VIN|Colou?r|Prod\\s*Date|Stock\\s*No|Selling\\s*Dlr|Warr\\s*Exp|Delivery|In\\s*Service|Cust|Options|DLR|Est\\s*Comp|Promised|Estimate|Status|Make|Remarks|Lot\\s*Loc|SDLR|APPT|WAIT|SPEC|RENT|VEH|LIC|MI|SA|P";
  var LABEL_STOP = new RegExp("\\b(?:" + LABEL_WORDS + ")\\s*[:#]", "i");
  function cutAtLabel(s) {
    var m = String(s || "").match(LABEL_STOP);
    if (!m) return squash(s);
    return m.index === 0 ? "" : squash(String(s).slice(0, m.index));
  }
  // OCR renders a table's cell borders as whatever it feels like — "|", "*",
  // "¢", a stray ":" — so a value often carries one, with the NEXT cell of the
  // row behind it.
  var COLUMN_SEP = /\s(?:[|*¢!\u00a5\u00a2]|~~|:)\s/;
  function cutAtColumn(s) { var m = String(s || "").match(COLUMN_SEP); return m ? squash(String(s).slice(0, m.index)) : squash(s); }
  function stripLead(s) { return String(s || "").replace(/^[\s:#.·•|*\-–—]+/, ""); }

  // Every value printed after `re`: on the same row, or — when that cell came
  // out empty — on the row under it. A row that starts with a different label
  // is not this field's value, but a row that merely CONTAINS one later on is:
  // the two-column header of an RO flattens into exactly that.
  function labelValues(lines, re) {
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(re);
      if (!m) continue;
      var rest = cutAtLabel(stripLead(lines[i].slice(m.index + m[0].length)));
      if (rest) out.push(rest);
      for (var j = i + 1; j < Math.min(lines.length, i + 3); j++) {
        if (LABEL_STOP.test(lines[j]) && LABEL_STOP.exec(lines[j]).index === 0) break;
        var nx = cutAtLabel(stripLead(lines[j]));
        if (nx) { out.push(nx); break; }
      }
    }
    return out;
  }
  // The first value that passes `ok` (any value, when no test is given).
  function labelValue(lines, re, ok) {
    var all = labelValues(lines, re);
    for (var i = 0; i < all.length; i++) if (!ok || ok(all[i])) return all[i];
    return ok ? "" : (all[0] || "");
  }

  // A degraded scan loses the small printed labels ("Cell Ph:", "E-mail:")
  // before it loses the values beside them, and then a cell reads as its own
  // value followed by its neighbour's — "08-31-26 678.979.7260". So these two
  // cells are not read as "whatever came after the label" but as the first
  // thing in there shaped like what belongs in them.
  function mileageOf(v) { var m = String(v || "").match(/\d[\d,]{1,8}/); return m ? digitsOnly(m[0]).slice(0, 7) : ""; }
  function dateOf(v) {
    var s = squash(String(v || ""));
    var m = s.match(/\d{1,4}\s?[\/.\-]\s?\d{1,2}\s?[\/.\-]\s?\d{1,4}/) || s.match(/\d{1,2}\s?[A-Za-z]{3}\s?\d{2,4}/);
    return m ? m[0].replace(/\s/g, "") : "";
  }

  function stripMake(v) {
    return squash(String(v || "").replace(/\bMERCEDES[\s-]*BENZ\b/i, "").replace(/\bMERCEDES\b/i, "").replace(/[^A-Za-z0-9 \-]/g, " "));
  }
  // Paint is named, not coded, on an RO. Looking for the word itself recovers
  // the field when OCR turns the "Color:" label into a stray table rule.
  var COLOR_WORD = /\b((?:POLAR|OBSIDIAN|SELENITE|IRIDIUM|MOJAVE|CAVANSITE|DENIM|EMERALD|PATAGONIA|HYACINTH|DESIGNO|MANUFAKTUR|GRAPHITE|MOUNTAIN|LUNAR|DIAMOND|NAUTIC|BRILLIANT|JUPITER|MAGNETITE)\s+)?(WHITE|BLACK|SILVER|GREY|GRAY|BLUE|RED|GREEN|BROWN|BEIGE|GOLD|ORANGE|YELLOW|CHAMPAGNE|BRONZE|COPPER)\b/;
  function colorInHeader(lines) {
    for (var i = 0; i < lines.length; i++) {
      if (/INSTRUCTIONS?\s*AND\s*DESCRIPTIONS?|OP\s*CODE/i.test(lines[i])) break;   // past the header
      // Match capitals only: the form prints SILVER, while "Jill Blue" is a name.
      var m = lines[i].match(COLOR_WORD);
      if (m) return squash(m[0]);
    }
    return "";
  }

  var LETTERS = "ABCDEFGH";
  // Only a hyphen hanging off the end of a WORD is a split word ("con-" +
  // "trol"); a dash standing on its own is punctuation and keeps its spaces.
  function joinWrap(a, b) { return /[A-Za-z][-‐‑]$/.test(a) ? a.replace(/[-‐‑]$/, "") + b : a + " " + b; }
  // Pull the op code off the front of a row: the printed order is
  // "<op code> <pay type> <description>", and the pay type is always present.
  var PAY_TYPE = /^(CC|CP|CS|CW|WW|WC|IC|II|SC|C|W|I)$/;
  var OP_CODE = /^[A-Z][A-Z0-9-]{0,5}$/;
  function splitOp(line) {
    var toks = line.text.split(" ");
    var up = function (t) { return String(t || "").toUpperCase(); };
    if (toks.length > 2 && PAY_TYPE.test(up(toks[1])) && OP_CODE.test(up(toks[0]))) { line.op = up(toks[0]); toks = toks.slice(2); }
    else if (toks.length > 1 && PAY_TYPE.test(up(toks[0]))) toks = toks.slice(1);
    line.text = squash(toks.join(" "));
    return line;
  }
  // The trailing run of SHOUTED words on a row — on a two-column form that is
  // the table's own text, with the neighbouring column's prose in front of it.
  function capsTail(line) {
    var toks = squash(line).split(" ");
    var i = toks.length;
    while (i > 0 && !/[a-z]/.test(toks[i - 1])) i--;         // capitals, digits and punctuation carry on
    if (i === 0) return { text: squash(line), whole: true }; // the row is already all capitals
    var tail = squash(toks.slice(i).join(" ")).replace(/^[^A-Za-z0-9$]+/, "");
    return { text: (tail.match(/[A-Za-z]{2,}/g) || []).length >= 2 ? tail : "", whole: false };
  }
  var LINE_FOOTER = /^(X$|TECH\s*COPY|MOBILE\s*SHOP\s*COPY|CLIENT\s*COPY|ESTIMATE\s*AND\s*AUTH|ORIGINAL\s*ESTIMATE|CLIENT\s*ADVISED|TOTAL\b|SIGNATURE)/i;
  /*
   * The op code for a line, out of whatever the engine read in the cells to the
   * left of its description.
   *
   * A wrong op code is worse than none: the box is two characters, and a blank
   * one is obviously to be filled in while "RIOT" looks like it means something.
   * On a scanned RO these two cells are often illegible while the description
   * beside them comes through fine, so this returns nothing rather than the
   * nearest code-shaped scrap.
   *
   * What separates a real cell from a misread is the LINE cell next to it. The
   * two are printed together, so if the line letter came through, the engine was
   * reading that part of the row and the token beside it is the op code
   * ("# C  cv"). If it did not, whatever is there is noise off the neighbouring
   * column ("ph pn Ya", "i sat tbc I HE") and none of it can be trusted.
   *
   * Two things that look like they would help and do not. Case: the engine reads
   * a printed "CV" as "cv" about as often as not. Confidence: it rated a
   * correctly read "cw" at 18% on a clean scan, so a confidence bar drops real
   * op codes. Once the line letter has vouched for the cell, the token beside it
   * is shown for what it is — a blank box would claim the form had no op code,
   * which is a worse lie than a shaky reading of one the reviewer can see.
   */
  function opCodeFrom(left) {
    var words = (left || []).filter(function (w) { return /[A-Za-z0-9]/.test(w.text); });
    if (!words.length || words.length > 2) return "";       // a cell holds a token or two, not prose
    var marked = false, i, raw;
    for (i = 0; i < words.length; i++) {
      raw = words[i].text.replace(/[^A-Za-z0-9-]/g, "").toUpperCase();
      if (/^\d?[A-H]$/.test(raw)) marked = true;             // the line letter was read
    }
    if (!marked) return "";
    var sorted = words.slice().sort(function (a, b) { return b.x0 - a.x0; });
    for (i = 0; i < sorted.length; i++) {
      var code = sorted[i].text.replace(/[^A-Za-z0-9-]/g, "").toUpperCase();
      // Skip the line letter and the pay-type cell. Only "CC" counts as a pay
      // type: CW and CV are op codes on these ROs (a complimentary wash IS
      // "CW"), and rejecting them would throw away the code we came for.
      if (!code || /^\d?[A-H]$/.test(code) || code === "CC") continue;
      if (OP_CODE.test(code)) return code;
    }
    return "";
  }

  // The dealer RO's line table, read from where things sat on the PAGE.
  //
  // Flat OCR text interleaves the columns of a two-column form: the left-hand
  // block of legal small print lands inside the line descriptions, one row at a
  // time ("Client Advised of Completion ~~ INSPECTION WHICH INCLUDES VIDEO"),
  // and the "# B"/"# C" cells come back as noise, so reading the text alone
  // loses most of the lines. The engine knows where every row sat, so use that:
  // keep the rows under the INSTRUCTIONS heading that begin in its column, and
  // cut them into repair-order lines wherever the table's own row borders left
  // a vertical gap.
  // Where the INSTRUCTIONS column begins, from the heading row's own words.
  //
  // Not the x of the word "INSTRUCTIONS": that heading is centred over a wide
  // column, so its left edge sits well inside the descriptions and would clip
  // the start of every line. The boundary is the right edge of the last heading
  // before it — "OP CODE" — which is exactly where the descriptions start.
  function columnEdge(hdr, pageRight) {
    var words = hdr.words || [], i, at = -1;
    for (i = 0; i < words.length; i++) if (/INSTRUCTION/i.test(words[i].text)) { at = i; break; }
    if (at < 0) return null;
    var before = words.slice(0, at).filter(function (w) { return /[A-Za-z]/.test(w.text); });
    // Nothing read to the left of the heading means its own x is all we have —
    // and that is worth nothing, because "INSTRUCTIONS AND DESCRIPTIONS" is
    // CENTRED over a wide column and starts a word or two into every
    // description. Say so, and let the caller find the text another way.
    if (!before.length) return null;
    var right = 0;
    for (i = 0; i < before.length; i++) if (before[i].x1 > right) right = before[i].x1;
    // The heading row can carry the OTHER column's heading too, so walk left
    // only while the headings keep table-column spacing; a wide gap is the jump
    // back to the neighbouring block of the form, not another cell of this one.
    var pad = Math.max(12, pageRight * 0.02), gap = Math.max(40, pageRight * 0.06);
    var from = before.length - 1;
    while (from > 0 && before[from].x0 - before[from - 1].x1 <= gap) from--;
    return { desc: right + 4, line: before[from].x0 - pad };
  }

  // The dealer RO's line table, read from where things sat on the PAGE.
  //
  // Flat OCR text interleaves the columns of a two-column form: the left-hand
  // block of legal small print lands inside the line descriptions, one row at a
  // time ("Client Advised of Completion ~~ INSPECTION WHICH INCLUDES VIDEO"),
  // and the "# B"/"# C" cells come back as noise, so reading the text alone
  // loses most of the lines. The engine knows where every WORD sat, so the
  // table is read from that instead: each row is cut at the column boundary and
  // only what lies in the descriptions column is kept, which holds whether the
  // engine returned the two columns as one row or as two. The rows that survive
  // are then cut into repair-order lines wherever the table's own row borders
  // left a vertical gap.
  function layoutLines(rows) {
    if (!rows || rows.length < 2) return [];
    var pageRight = 0, hdr = null, i;
    for (i = 0; i < rows.length; i++) if (rows[i].x1 > pageRight) pageRight = rows[i].x1;
    for (i = 0; i < rows.length; i++) {
      if (/INSTRUCTIONS?\s*AND\s*DESCRIPTIONS?/i.test(rows[i].text)) { hdr = rows[i]; break; }
    }
    if (!hdr) return [];
    var hdrH = Math.max(1, hdr.y1 - hdr.y0);
    var edge = columnEdge(hdr, pageRight);
    var descLeft = edge ? edge.desc : 0;
    // The LINE and OP CODE cells live between these two edges; anything further
    // left belongs to the neighbouring column, whatever it says.
    var opLeft = edge ? edge.line : descLeft - pageRight * 0.2;
    var below = rows.filter(function (r) { return r.y0 > hdr.y0 + hdrH * 0.6; });

    // Split every row at the column boundary — or, when the heading could not
    // give one, on the only other thing that separates the two columns: the
    // table's text is SHOUTED and the small print beside it is not.
    var body = [];
    below.forEach(function (r) {
      var desc = "", left = [];
      if (edge && r.words && r.words.length) {
        desc = squash(r.words.filter(function (w) { return w.x0 >= descLeft; }).map(function (w) { return w.text; }).join(" "));
        left = r.words.filter(function (w) { return w.x0 < descLeft && w.x0 >= opLeft; });
      } else if (edge) {
        desc = r.x0 >= descLeft ? r.text : "";                  // no words to go on
      } else {
        desc = capsTail(r.text).text;
      }
      if (desc.length >= 3) body.push({ text: desc, x0: r.x0, y0: r.y0, y1: r.y1, left: left });
    });
    body.sort(function (a, b) { return a.y0 - b.y0; });
    if (!body.length) return [];

    // A word at the end of a row can come back as a fragment of its own — the
    // "CHARGE" closing "…SERVICE WASH - CHARGE" arrives as a separate piece,
    // and in the order the engine found it, which is not the order it is read
    // in. Pieces that sit at the same height are one row of the table, so put
    // them back left to right before any of them is joined to anything.
    var rowed = [];
    body.forEach(function (r) {
      var prev = rowed[rowed.length - 1];
      var share = prev ? (Math.min(prev.y1, r.y1) - Math.max(prev.y0, r.y0)) /
        Math.max(1, Math.min(prev.y1 - prev.y0, r.y1 - r.y0)) : 0;
      if (prev && share >= 0.5) {
        if (r.x0 < prev.x0) { prev.text = joinWrap(r.text, prev.text); prev.x0 = r.x0; }
        else prev.text = joinWrap(prev.text, r.text);
        prev.y0 = Math.min(prev.y0, r.y0); prev.y1 = Math.max(prev.y1, r.y1);
        prev.left = (prev.left || []).concat(r.left || []);
      } else rowed.push(r);
    });
    body = rowed;

    var hs = body.map(function (r) { return Math.max(1, r.y1 - r.y0); }).sort(function (a, b) { return a - b; });
    var h = hs[Math.floor(hs.length / 2)] || hdrH;
    var groups = [], cur = null;
    body.forEach(function (r) {
      if (LINE_FOOTER.test(r.text)) { cur = null; return; }
      if (!cur || r.y0 - cur.y1 > h * 0.75) { cur = { text: r.text, y0: r.y0, y1: r.y1, left: r.left }; groups.push(cur); }
      else { cur.text = joinWrap(cur.text, r.text); cur.y1 = Math.max(cur.y1, r.y1); }
    });

    return groups.filter(function (g) { return g.text.length >= 3; }).map(function (g) {
      var line = { text: g.text, op: opCodeFrom(g.left) };
      // A merged row can still carry the LINE cell at the front of the text.
      line.text = squash(line.text.replace(/^[#*+]\s*\d?\s*[A-H](?![A-Za-z0-9])[\s.):\-|]*/, ""));
      if (!line.op) return splitOp(line);
      var toks = line.text.split(" ");                       // the pay-type cell can still be attached
      if (toks.length > 1 && PAY_TYPE.test(toks[0].toUpperCase())) line.text = squash(toks.slice(1).join(" "));
      return line;
    });
  }

  // The same table read from the flat text, for a scan with no layout to go on.
  // Rows open with "# A", "# B"… and a description can wrap onto the rows under
  // it. Requiring the letters to run in order is what keeps stray prose out.
  function formLines(lines) {
    var start = 0;
    for (var i = 0; i < lines.length; i++) {
      if (/INSTRUCTIONS?\s*AND\s*DESCRIPTIONS?|OP\s*CODE/i.test(lines[i])) { start = i + 1; break; }
    }
    var out = [], cur = null, expect = 0;
    for (var k = start; k < lines.length; k++) {
      var ln = lines[k];
      if (expect < LETTERS.length) {
        // A flattened two-column row puts the marker mid-line ("Original
        // Estimate: # A | MPI …"), so look for it anywhere — but only with its
        // "#", which is what stops an ordinary sentence matching.
        var at = ln.match(new RegExp("(^|\\s)[#*+]\\s*" + LETTERS.charAt(expect) + "(?![A-Za-z0-9])[\\s.):\\-|]*(.+)$"));
        var m = at || ln.match(new RegExp("^\\s*" + LETTERS.charAt(expect) + "(?![A-Za-z0-9])[\\s.):\\-]*(.+)$"));
        var body = m ? squash(m[m.length - 1]) : "";
        if (m && body.length >= 3 && (at || capsRatio(body) >= 0.6)) {
          cur = { text: body, op: "" };
          out.push(cur); expect++;
          continue;
        }
      }
      // A row may be carrying the other column's prose in front of the table's
      // own text; the description is the run of capitals at the end. Only a row
      // that is ENTIRELY the table's text can be a continuation of the line
      // above — on a flattened row there is no telling which line it belongs
      // to, so it is offered separately rather than joined to the wrong one.
      var tail = capsTail(ln);
      if (!tail.text || tail.text.length < 3 || LINE_FOOTER.test(tail.text)) continue;
      if ((tail.text.match(/[A-Za-z]{3,}/g) || []).length < 2) continue;
      if (cur && tail.whole) cur.text = joinWrap(cur.text, tail.text);
      else if (out.length) { cur = { text: tail.text, op: "" }; out.push(cur); }
    }
    return out.map(splitOp).filter(function (l) { return l.text.length >= 3; });
  }
  // The DISPATCH screen: "5) B P110 3R CUSTOMER STAT 5401 1.0 …" — line letter,
  // skill, status, then a truncated description followed by numeric columns.
  function dispatchLines(lines) {
    var out = [];
    lines.forEach(function (ln) {
      var m = ln.match(/^\d{1,2}\)\s*([A-H])\s+(\S+)\s+(\S+)\s+(.+)$/);
      if (!m) return;
      var desc = squash(m[4].split(/\s+(?=\d{3,5}\s+-?\d+\.\d)/)[0].replace(/\s+-?\d+\.\d.*$/, "").replace(/\s+\d{3,5}$/, ""));
      if (desc.length >= 3) out.push({ text: desc, op: "" });
    });
    return out;
  }
  // Nothing recognisable? Anything that reads like a complaint is still worth
  // offering — a handwritten note on the scan usually says it plainly.
  function looseComplaints(lines) {
    return lines.filter(function (s) { return /CUSTOMER\s*STATE|C\/S\b|COMPLAIN|REQUESTS?\b/i.test(s) && s.length >= 8; })
      .slice(0, 8).map(function (s) { return splitOp({ text: squash(s.replace(/^[#*+]?\s*[A-H][\s.):\-]+/, "")), op: "" }); });
  }
  // Loose text under the dispatch table — where a stuck-on note usually is.
  function trailingNote(lines) {
    var at = -1;
    for (var i = 0; i < lines.length; i++) if (/END\s*OF\s*DISPLAY|^COMMAND\s*[:#]/i.test(lines[i])) at = i;
    if (at < 0) return "";
    return squash(lines.slice(at + 1).filter(function (s) {
      return s.length > 3 && /[A-Za-z]{3}/.test(s) && !/^COMMAND/i.test(s);
    }).join(" ")).slice(0, 400);
  }

  // Read one scan into the fields and lines of a repair order. `pages` is the
  // optional per-page layout (rows with their position on the page), which is
  // what makes a two-column form's line table readable.
  function parseScan(raw, pages, hints) {
    var text = String(raw || "");
    var lines = text.split(/\r?\n/).map(squash).filter(Boolean);
    var dispatch = /\bD\s?I\s?S\s?P\s?A\s?T\s?C\s?H\b/.test(text.toUpperCase()) ||
      (/\bTAG\s*[:#]/i.test(text) && /\bSA\s*[:#]/i.test(text));
    var out = {
      ro: "", tag: "", vehicle: "", vin: "", color: "", mileage: "", opened: "",
      advisor: "", customer: "", phone: "", email: "", lines: [], note: "",
      // Which fields the whole-page read missed and a second, closer look
      // recovered — the review flags them, because they are the readings with
      // the least behind them.
      refined: [],
      source: dispatch ? "dispatch" : "ro", text: text
    };

    out.ro = digitsOnly(labelValue(lines, /\bR\.?\s?O\.?\s*(?:No|Number|#)\s*/i));
    if (!/^\d{4,9}$/.test(out.ro)) {
      var rm = text.match(/\bR\.?\s?O\.?\s*(?:No|Number)?\s*[:#]\s*(\d{4,9})\b/i);
      out.ro = rm ? rm[1] : "";
    }

    // A tag is printed twice on an RO (header and body). OCR mangles one of them
    // as often as not — "Tag #T7910" comes back "Tag #17910" — so take the one
    // that actually looks like a tag rather than the one that came first.
    var tagAll = labelValues(lines, /\bTag\s*(?:No|#)?\s*/i)
      .map(function (v) { return v.toUpperCase().replace(/[^A-Z0-9-]/g, ""); })
      .filter(function (v) { return /^[A-Z]{0,2}\d{2,6}[A-Z]?$/.test(v); });
    out.tag = tagAll.filter(function (v) { return /^[A-Z]{1,2}\d{3,6}$/.test(v); })[0] || tagAll[0] || "";

    var hasMileage = function (v) { return !!mileageOf(v); };
    out.mileage = mileageOf(labelValue(lines, /\bMileage\s*(?:In)?\s*/i, hasMileage));
    if (!out.mileage) { var mi = text.match(/\bMI\s*[:#]\s*([\d,]+)/i); out.mileage = mi ? digitsOnly(mi[1]).slice(0, 7) : ""; }
    // Read a second time out of its own cell (see refineCells), for the scans
    // where the whole-page read came back with the label and nothing beside it.
    if (!out.mileage && hints && hints.mileage) { out.mileage = mileageOf(hints.mileage); if (out.mileage) out.refined.push("mileage"); }

    var hasDate = function (v) { return !!dateOf(v); };
    out.opened = dateOf(labelValue(lines, /\b(?:R\.?\s?O\.?\s*)?Open\s*Date\s*/i, hasDate));
    if (!out.opened && hints && hints.opened) { out.opened = dateOf(hints.opened); if (out.opened) out.refined.push("opened"); }
    var isName = function (v) { return !!cleanName(cutAtColumn(v)); };
    out.advisor = cleanName(cutAtColumn(labelValue(lines, /\bService\s*Advisor\s*/i, isName)));
    if (!out.advisor) { var sa = text.match(/\bSA\s*[:#]\s*(\d{2,6})\b/i); out.advisor = sa ? sa[1] : ""; }
    out.customer = cleanName(cutAtColumn(labelValue(lines, /\bName\s*/i, isName)));
    if (!out.customer) out.customer = customerNearAddress(lines);
    // A phone cell is short enough that OCR often clips a digit off the front;
    // show what there is rather than nothing — it is quicker to correct than to
    // look up. Only the labelled cells are read loosely.
    out.phone = firstPhone(labelValue(lines, /\bCell\s*Ph\.?\s*/i)) || firstPhone(labelValue(lines, /\bHome\s*Ph\.?\s*/i)) ||
      firstPhone(labelValue(lines, /\bBus\s*Ph\.?\s*/i)) || firstPhone(text, true);
    var em = text.match(/[A-Za-z0-9._%+-]+\s?@\s?[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    out.email = em ? em[0].replace(/\s/g, "").toLowerCase() : "";

    var color = squash(cutAtColumn(labelValue(lines, /\bColou?r\s*/i)).replace(/[^A-Za-z \-]/g, ""));
    if (!color || color.length > 24) color = colorInHeader(lines);
    out.color = color ? titleCase(color) : "";

    // A VIN read on its own (see refineVin) beats one picked out of the whole
    // page: it was read larger and spelled with a VIN's own alphabet.
    var pageVin = findVinIn(text), hintVin = (hints && hints.vin) || "";
    out.vin = hintVin && (vinCheckOk(hintVin) || !vinCheckOk(pageVin)) ? hintVin : (pageVin || hintVin);
    if (!out.vin) { var vm = text.match(/\bVIN\s*[:#]?\s*([A-HJ-NPR-Z0-9]{17})\b/i); out.vin = vm ? vm[1].toUpperCase() : ""; }

    var year = fullYear(digitsOnly(labelValue(lines, /\bYear\s*/i, function (v) { return /^\D*\d{2,4}\D*$/.test(v); })).slice(0, 4));
    var model = stripMake(labelValue(lines, /\bModel\s*/i));
    if (!year || !model) {
      var veh = text.match(/\bVEH\s*[:#]\s*(\d{2,4})\s+([A-Z0-9][A-Z0-9\-]{1,9})/i);
      if (veh) { year = year || fullYear(veh[1]); model = model || veh[2].toUpperCase(); }
    }
    // "Year:" and "Model:" are small cells and OCR drops them outright often
    // enough to need a way round: the make and model are printed in full
    // somewhere on the page, and the VIN carries its own model year.
    if (!model) {
      var mm = text.match(/\bMERCEDES[\s-]*BENZ\s+([A-Z]{1,4}\s?\d{2,4}\s?[A-Z]{0,3})\b/i);
      if (mm) model = squash(mm[1]).toUpperCase();
    }
    if (!year) year = yearFromVin(out.vin);
    out.vehicle = squash([year, model.slice(0, 40)].filter(Boolean).join(" "));

    // Where the page's own layout separated the table's rows, it beats reading
    // the flat text, which cannot tell one column from another. One group means
    // the row gaps told us nothing (a PDF's text layer has no table rules to
    // find), so the text is the better guide.
    var laid = [];
    (pages || []).forEach(function (rows) { laid = laid.concat(layoutLines(rows)); });
    out.lines = laid.length >= 2 ? laid : [];
    if (!out.lines.length) out.lines = dispatch ? dispatchLines(lines) : formLines(lines);
    if (!out.lines.length) out.lines = dispatch ? formLines(lines) : dispatchLines(lines);
    if (!out.lines.length) out.lines = looseComplaints(lines);
    out.note = trailingNote(lines);
    return out;
  }

  // ---------- recognition engines (loaded only when a scan runs) ----------

  // Rebuild visual rows from a PDF's text layer — a form only parses if the
  // label and the value it belongs to stay on the same line, and the line table
  // only parses if we know which column each row sat in.
  function itemsToRows(items) {
    var rows = {};
    (items || []).forEach(function (it) {
      if (!it.str || !it.str.trim()) return;
      var tr = it.transform || [];
      var x = tr[4] || 0, y = tr[5] || 0, h = Math.abs(tr[3] || 10), w = it.width || 0;
      var key = Math.round(y / 3);
      if (!rows[key]) rows[key] = { parts: [], y: y, h: h, x0: x, x1: x + w };
      rows[key].parts.push({ x: x, w: w, s: it.str });
      if (x < rows[key].x0) rows[key].x0 = x;
      if (x + w > rows[key].x1) rows[key].x1 = x + w;
      if (h > rows[key].h) rows[key].h = h;
    });
    return Object.keys(rows).map(function (k) { return rows[k]; })
      .sort(function (a, b) { return b.y - a.y; })          // PDF y counts up from the foot
      .map(function (r) {
        var parts = r.parts.sort(function (a, b) { return a.x - b.x; });
        return {
          text: squash(parts.map(function (p) { return p.s; }).join(" ")),
          x0: r.x0, x1: r.x1, y0: -r.y, y1: -r.y + r.h,     // flip so y counts down the page
          // Each word keeps its width: columnEdge() finds the descriptions
          // column from where the heading before INSTRUCTIONS ENDS, so a
          // zero-width word would put the cut at that heading's start and hand
          // the op-code cells to the description.
          words: parts.map(function (p) { return { text: squash(p.s), x0: p.x, x1: p.x + (p.w || 0), conf: 100 }; }).filter(function (w) { return w.text; })
        };
      }).filter(function (r) { return r.text; });
  }
  function rowsToText(rows) { return rows.map(function (r) { return r.text; }).join("\n"); }
  // The same shape out of a recognized page.
  function rowsFromData(data) {
    return (((data && data.lines) || [])).map(function (ln) {
      var b = ln.bbox || {};
      return {
        text: squash(ln.text || ""), x0: b.x0 || 0, y0: b.y0 || 0, x1: b.x1 || 0, y1: b.y1 || 0,
        // Each word's own position — the engine reads a two-column form as one
        // row per line about as often as it reads it as two, so a row has to be
        // cuttable at the column boundary rather than trusted as a whole.
        words: (ln.words || []).map(function (w) {
          var wb = w.bbox || {};
          return { text: squash(w.text || ""), x0: wb.x0 || 0, x1: wb.x1 || 0, conf: w.confidence == null ? 100 : w.confidence };
        }).filter(function (w) { return w.text; })
      };
    }).filter(function (r) { return r.text; });
  }

  // Where a VIN might be when nothing on the page said so: the header half of
  // the form, on rows long enough to hold seventeen characters.
  var VIN_SWEEP_MAX = 6;
  function sweepRows(page, rows) {
    var cut = page.height * 0.65, wide = page.width * 0.2, out = [], i;
    for (i = 0; i < rows.length && out.length < VIN_SWEEP_MAX; i++) {
      var r = rows[i];
      if (r.y1 > cut) continue;
      if ((r.x1 - r.x0) < wide) continue;
      if (r.text.replace(/\s/g, "").length < 8) continue;
      out.push(r);
    }
    return out;
  }

  // Where a labelled cell's value sits on its row: after the label's own words,
  // and before the words that start the next label. A label is recognised by
  // its colon, and the short words leading up to that colon ("Bus Ph:", "Home
  // Ph:") belong to it rather than to the cell in front.
  function cellSpan(row, labelRe) {
    var w = row.words || [], i, txt = "", hit = -1;
    for (i = 0; i < w.length; i++) {
      txt = txt ? txt + " " + w[i].text : w[i].text;
      if (labelRe.test(txt)) { hit = i; break; }
    }
    if (hit < 0) return null;
    // "Mileage" matches on its own, but the cell starts after "In:".
    if (!/:$/.test(w[hit].text) && w[hit + 1] && /:$/.test(w[hit + 1].text) && w[hit + 1].text.length <= 4) hit++;

    var end = row.x1, j;
    for (j = hit + 1; j < w.length; j++) {
      if (!/:$/.test(w[j].text)) continue;
      while (j - 1 > hit && /^[A-Za-z]{1,5}$/.test(w[j - 1].text)) j--;
      end = w[j].x0;
      break;
    }
    var start = w[hit].x1;
    if (end - start < (row.y1 - row.y0)) return null;          // nothing there to read
    return { x0: start, x1: end };
  }

  global.FDCore.ro = {
    VIN_SWEEP_MAX: VIN_SWEEP_MAX,
    squash: squash,
    digitsOnly: digitsOnly,
    capsRatio: capsRatio,
    titleCase: titleCase,
    nameLike: nameLike,
    customerNearAddress: customerNearAddress,
    cleanName: cleanName,
    firstPhone: firstPhone,
    fullYear: fullYear,
    findVinIn: findVinIn,
    cutAtLabel: cutAtLabel,
    cutAtColumn: cutAtColumn,
    stripLead: stripLead,
    labelValues: labelValues,
    labelValue: labelValue,
    mileageOf: mileageOf,
    dateOf: dateOf,
    stripMake: stripMake,
    colorInHeader: colorInHeader,
    joinWrap: joinWrap,
    splitOp: splitOp,
    capsTail: capsTail,
    opCodeFrom: opCodeFrom,
    columnEdge: columnEdge,
    layoutLines: layoutLines,
    formLines: formLines,
    dispatchLines: dispatchLines,
    looseComplaints: looseComplaints,
    trailingNote: trailingNote,
    parseScan: parseScan,
    itemsToRows: itemsToRows,
    rowsToText: rowsToText,
    rowsFromData: rowsFromData,
    sweepRows: sweepRows,
    cellSpan: cellSpan,
    LABEL_WORDS: LABEL_WORDS,
    LABEL_STOP: LABEL_STOP,
    COLUMN_SEP: COLUMN_SEP,
    COLOR_WORD: COLOR_WORD,
    LETTERS: LETTERS,
    PAY_TYPE: PAY_TYPE,
    OP_CODE: OP_CODE,
    LINE_FOOTER: LINE_FOOTER,
  };
})(typeof self !== "undefined" ? self : globalThis);
