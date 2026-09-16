/*
 * ocr.js — shared text-recognition helpers for every app that reads a scan.
 *
 * THE PROBLEM THIS SOLVES
 * Tesseract only reads horizontal text, but a page fed through the scanner
 * sideways does not fail loudly: it returns a thin dribble of low-confidence
 * words, which looks to the caller exactly like a successful read of a sparse
 * page. So a sideways RO, datacard or LI print-out came back with almost
 * nothing on it and nothing explained why.
 *
 * HOW THE ANGLE IS DECIDED
 * By measurement, not by guesswork: a band of the page is recognized at each of
 * the four rotations, and the one the engine is actually confident about wins.
 * The probe deliberately runs in single-block mode (6), because that is the
 * mode that CANNOT cope with rotated text and therefore says something about
 * orientation; automatic mode (3) partly reads a sideways page, which is what
 * you want for the read itself and useless for telling which way up it is.
 * Measured on a 300 DPI repair order, as words the engine rated >= 60%
 * confident (rotations are tried 0, 90, 270, 180 and stop at a clear winner):
 *
 *     the same page, scanned sideways    0 -> 0    90 -> 11    270 -> 47
 *     the same page, scanned upright     0 -> 45   (settled by the first probe)
 *
 * The right way up is never close, so one cheap probe settles it. Three details
 * are load-bearing:
 *   - The probe runs at FULL resolution. At half resolution (a 1100px long
 *     edge) nothing is legible at ANY rotation — every angle scored 0-5 — so a
 *     cheap-looking small probe decides nothing and silently picks 0.
 *   - It reads a BAND, not the whole page: ~3x cheaper, and just as decisive.
 *   - The band is aimed at the ink, not at the middle of the paper (inkBox).
 *
 * THE OTHER HALF OF THE PROBLEM
 * tesseract.js defaults to page-segmentation mode 6, "one uniform block of
 * text". A repair order is not one block — it is a header, two tables and a
 * column of small print — and in mode 6 the engine simply drops most of it. The
 * same 300 DPI scan, same rotation, read at mode 3 (automatic segmentation)
 * instead: 4 of 16 expected fields found becomes 14 of 16, and the entire
 * vehicle/customer table reappears. So every caller here gets mode 3 before it
 * reads anything (prepare()).
 */
(function (global) {
  "use strict";

  var ANGLES = [0, 90, 270, 180];   // 90/270 before 180: sideways is far commoner than upside-down
  var PROBE_EDGE = 2200;            // long edge of the probe render — see the note above
  var PROBE_BAND = 0.45;            // fraction of the inked area the probe reads
  var MIN_GOOD = 20;                // confident words that make a rotation a clear winner
  var MIN_CONF = 70;                // ...together with the page confidence
  var READ_CONF = 60;               // ...and the softer bar for "this page was read at all"
  var MIN_TURN = 10;                // ...and the bar for turning the page at all (see finish())
  var PSM_AUTO = "3";               // automatic page segmentation — for reading
  var PSM_BLOCK = "6";              // one uniform block — for the orientation probe only

  function sizeOf(src) {
    return { w: (src && (src.width || src.naturalWidth)) || 1, h: (src && (src.height || src.naturalHeight)) || 1 };
  }

  /*
   * Where the ink is, in source pixels. A band across the geometric middle of
   * the page is worthless on a document whose text stops half way down — it
   * reads blank paper and every rotation scores zero. So the probe is aimed at
   * the marked area instead, found on a thumbnail (cheap, no OCR).
   * Returns null when that can't be worked out, and the caller uses the whole
   * page; this only ever aims the PROBE, never the read, so a bad box costs a
   * little accuracy and can never crop the document.
   */
  function inkBox(src) {
    var sz = sizeOf(src), SMALL = 240;
    var scale = Math.min(1, SMALL / Math.max(sz.w, sz.h));
    var w = Math.max(1, Math.round(sz.w * scale)), h = Math.max(1, Math.round(sz.h * scale));
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    var ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    try { ctx.drawImage(src, 0, 0, w, h); } catch (e) { return null; }
    var d;
    try { d = ctx.getImageData(0, 0, w, h).data; } catch (e) { return null; }   // tainted canvas
    var minX = w, minY = h, maxX = -1, maxY = -1, x, y, i, lum;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = (y * w + x) * 4;
        lum = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
        if (lum < 200) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    c.width = c.height = 0;
    if (maxX < 0) return null;                       // a blank page
    var pad = Math.round(Math.max(w, h) * 0.02);
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
    var box = {
      x: Math.floor(minX / scale), y: Math.floor(minY / scale),
      w: Math.ceil((maxX - minX + 1) / scale), h: Math.ceil((maxY - minY + 1) / scale)
    };
    if (box.w < sz.w * 0.15 || box.h < sz.h * 0.15) return null;   // implausibly small — don't trust it
    return box;
  }

  /*
   * Draw `src` turned by `angle` onto a canvas whose long edge is `longEdge`.
   * `box` (source pixels) limits it to part of the source; with `band` (0-1),
   * only that fraction of the result's height is kept, centred.
   */
  function render(src, angle, longEdge, band, box) {
    var sz = sizeOf(src);
    box = box || { x: 0, y: 0, w: sz.w, h: sz.h };
    var scale = longEdge / Math.max(box.w, box.h);
    var w = Math.max(1, Math.round(box.w * scale)), h = Math.max(1, Math.round(box.h * scale));
    var swap = angle === 90 || angle === 270;
    var pw = swap ? h : w, ph = swap ? w : h;
    var c = document.createElement("canvas");
    c.width = pw;
    c.height = band && band > 0 && band < 1 ? Math.max(1, Math.round(ph * band)) : ph;
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);   // paper, not transparency
    ctx.translate(pw / 2, c.height / 2);
    ctx.rotate(angle * Math.PI / 180);
    ctx.drawImage(src, box.x, box.y, box.w, box.h, -w / 2, -h / 2, w, h);
    return c;
  }

  /*
   * How well a rotation read: how many words the engine was confident about,
   * plus its own confidence for the page. Scraps of misread sideways text score
   * near zero on both.
   */
  function score(data) {
    var conf = Math.round((data && data.confidence) || 0);
    var words = (data && data.words) || [];
    var good = 0, i;
    if (words.length) {
      for (i = 0; i < words.length; i++) {
        if (words[i].confidence >= 60 && /[A-Za-z0-9]{3,}/.test(words[i].text || "")) good++;
      }
    } else {
      // A build that doesn't hand back per-word data — fall back to the page
      // confidence over the words visible in the text.
      var toks = String((data && data.text) || "").match(/[A-Za-z0-9]{3,}/g) || [];
      good = conf >= 60 ? toks.length : 0;
    }
    return { good: good, conf: conf };
  }

  /*
   * Put a worker into document mode. Cheap, idempotent, and safe to call before
   * every read: the parameter is only actually sent to the worker once.
   */
  var prepared = typeof WeakMap === "function" ? new WeakMap() : null;
  function prepare(worker, psm) {
    psm = psm || PSM_AUTO;
    if (!worker || typeof worker.setParameters !== "function") return Promise.resolve();
    var seen = prepared && prepared.get(worker);
    if (seen && seen.psm === psm) return seen.p;
    var p = Promise.resolve().then(function () { return worker.setParameters({ tessedit_pageseg_mode: psm }); })
      .catch(function () {});   // an engine that won't take it still reads
    if (prepared) prepared.set(worker, { psm: psm, p: p });
    return p;
  }

  /* Was this page read at all, or is it the dribble a misfed page produces? */
  function looksRead(data, opts) {
    var s = score(data);
    return s.good >= ((opts && opts.minGood) || MIN_GOOD) && s.conf >= ((opts && opts.minReadConf) || READ_CONF);
  }

  function edgeFor(src, opts) {
    if (typeof (opts && opts.readEdge) === "function") return opts.readEdge(src);
    if (opts && opts.readEdge) return opts.readEdge;
    var sz = sizeOf(src);
    return Math.max(2200, Math.min(3300, Math.max(sz.w, sz.h)));
  }

  /*
   * Work out which way up `src` is, using `worker` (an existing Tesseract
   * worker). Returns the rotation in degrees to apply before reading it.
   * Options: onStatus(message), cancelled() -> bool, angles, probeEdge, band.
   * Nothing legible at any rotation -> 0, and so is anything the winner cannot
   * clearly justify: rotating a page on the strength of one stray word is worse
   * than leaving it alone (see finish()).
   */
  function bestAngle(worker, src, opts) {
    opts = opts || {};
    var ready = prepare(worker, opts.probePsm || PSM_BLOCK);
    var angles = opts.angles || ANGLES;
    var edge = opts.probeEdge || PROBE_EDGE;
    var band = opts.band == null ? PROBE_BAND : opts.band;
    var status = opts.onStatus || function () {};
    var cancelled = opts.cancelled || function () { return false; };
    var best = { good: -1, conf: -1, angle: 0 }, i = 0, tried = [];
    var box = opts.box === undefined ? inkBox(src) : opts.box;

    function step() {
      if (i >= angles.length || cancelled()) return finish();
      var angle = angles[i++];
      status(i === 1 ? "Checking which way up the scan is…" : "Reading it at " + angle + "°…");
      var canvas = render(src, angle, edge, band, box);
      return ready.then(function () { return worker.recognize(canvas); }).then(function (r) {
        var s = score(r && r.data);
        tried.push({ angle: angle, good: s.good, conf: s.conf });
        canvas.width = canvas.height = 0;                     // release it now, they are large
        if (s.good > best.good || (s.good === best.good && s.conf > best.conf)) {
          best = { good: s.good, conf: s.conf, angle: angle };
        }
        // A clear winner is not worth second-guessing with three more passes.
        if (s.good >= (opts.minGood || MIN_GOOD) && s.conf >= (opts.minConf || MIN_CONF)) return finish();
        return step();
      }, function (e) {
        canvas.width = canvas.height = 0;
        if (i >= angles.length) return finish();
        return step();                                        // one bad pass must not sink the read
      });
    }
    function finish() {
      // Turning the page has to be EARNED, not merely preferred. On a sparse or
      // poor scan every rotation can score near zero while one of them picks up
      // a stray word, and "best" would then be noise — enough, under a bare
      // `good > 0`, to throw away a usable upright read and re-read the page
      // sideways. Measured, the two cases do not overlap: a rotation the engine
      // can really read scores 47-126 confident words at 75-90% page
      // confidence, while a wrong one scores 0-14 at 30-46%. So a rotation is
      // only taken when it clears both bars; anything less keeps the page as it
      // came in.
      var out = 0;
      if (best.angle !== 0 && best.good >= (opts.minTurn || MIN_TURN) && best.conf >= (opts.minReadConf || READ_CONF)) {
        out = best.angle;
      }
      if (opts.onDone) { try { opts.onDone({ angle: out, tried: tried }); } catch (e) {} }
      return Promise.resolve(out);
    }
    return step();
  }

  /*
   * Probe, then read the whole page the right way up. `readEdge` may be a
   * number or a function of the source; it defaults to the source's own size,
   * bounded so tiny scans are enlarged and huge ones don't cost a fortune.
   */
  function readUpright(worker, src, opts) {
    opts = opts || {};
    return bestAngle(worker, src, opts).then(function (angle) {
      // The probe stops when the caller cancels, but the full read is the
      // expensive part — never start it for a job that has been abandoned.
      if (opts.cancelled && opts.cancelled()) return { text: "", angle: angle, data: null, probed: true, cancelled: true };
      return readAt(worker, src, angle, opts).then(function (res) { res.probed = true; return res; });
    });
  }

  /* Read the whole of `src` turned by `angle`. */
  function readAt(worker, src, angle, opts) {
    opts = opts || {};
    if (opts.onStatus) opts.onStatus(angle ? "Reading the page, turned " + angle + "°…" : "Reading the page…");
    var canvas = render(src, angle, edgeFor(src, opts), 0);
    return prepare(worker, opts.psm).then(function () { return worker.recognize(canvas); }).then(function (r) {
      canvas.width = canvas.height = 0;
      return { text: (r && r.data && r.data.text) || "", angle: angle, data: (r && r.data) || null };
    }, function (e) { canvas.width = canvas.height = 0; throw e; });
  }

  /*
   * The one a background job should reach for: read the page as it came in, and
   * only work out which way up it is if that read didn't produce what the
   * caller needed. A page that arrived the right way up — nearly all of them —
   * pays for exactly one read.
   *
   * `opts.accept(text, data)` is that test. A caller with a definite answer in
   * mind should pass one (a VIN, a document number); the default just asks
   * whether the page looks read at all.
   */
  function readSmart(worker, src, opts) {
    opts = opts || {};
    var accept = opts.accept || function (text, data) { return looksRead(data, opts); };
    return readAt(worker, src, 0, opts).then(function (first) {
      var ok;
      try { ok = accept(first.text, first.data); } catch (e) { ok = true; }
      if (ok || (opts.cancelled && opts.cancelled())) {
        first.probed = false;
        return first;
      }
      return bestAngle(worker, src, opts).then(function (angle) {
        if (!angle || (opts.cancelled && opts.cancelled())) { first.probed = true; return first; }
        return readAt(worker, src, angle, opts).then(function (res) { res.probed = true; return res; });
      });
    });
  }

  global.OcrOrient = {
    ANGLES: ANGLES,
    inkBox: inkBox,
    PROBE_EDGE: PROBE_EDGE,
    PROBE_BAND: PROBE_BAND,
    PSM_AUTO: PSM_AUTO,
    PSM_BLOCK: PSM_BLOCK,
    render: render,
    score: score,
    looksRead: looksRead,
    prepare: prepare,
    bestAngle: bestAngle,
    readAt: readAt,
    readUpright: readUpright,
    readSmart: readSmart,
  };
})(window);
