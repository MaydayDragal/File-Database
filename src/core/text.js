/*
 * text.js — text normalization and Windows-safe names, shared by every app.
 *
 * Moved out of li/index.html unchanged (REWRITE-PLAN.md, Phase 1). The Toolbox
 * carried an older copy of the same functions; it now uses these.
 *
 * Loads as a classic <script> (defines window.FDCore.text) and, because it
 * neither imports nor exports, also as a side-effect import from Node for the
 * unit tests: `import "../src/core/text.js"` then `globalThis.FDCore.text`.
 */
(function (global) {
  "use strict";

  // XENTRY's newer LI PDFs typeset the document number with NON-BREAKING
  // punctuation - a U+2011 non-breaking hyphen between the groups, U+00A0
  // no-break spaces around the field labels - so "LI83.70‑P‑080411"
  // never matched the ASCII-hyphen pattern and the LI number came back
  // empty. Fold the no-break/typographic variants back to ASCII before any
  // matching. En/em dashes are deliberately left alone so prose keeps its
  // typography; only hyphen-shaped characters fold.
  // normChars() is 1:1 so it is safe where character offsets matter (the
  // viewer's word index); normText() also drops invisibles and is what the
  // extractors use.
  var NORM_SPACE = /[   -   　]/g;
  var NORM_HYPHEN = /[‐‑‒−﹘﹣－]/g;
  var NORM_DROP = /[­​‌‍﻿]/g;
  function normChars(s) { return String(s == null ? "" : s).replace(NORM_SPACE, " ").replace(NORM_HYPHEN, "-"); }
  function normText(s) { return normChars(s).replace(NORM_DROP, ""); }
  // Detection only (never the stored text): also accept en/em dashes, which
  // some exports substitute for the hyphen inside the number itself.
  var NORM_DASH = /[–—―]/g;
  function normLI(s) { return normText(s).replace(NORM_DASH, "-"); }

  function reEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // ---------- filename rules (Windows-safe) ----------
  var WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  // Strip control chars, Unicode bidi/format controls (RLO U+202E etc. — used to
  // spoof extensions in filenames), and Windows-illegal path characters.
  function sanitize(s) { return String(s || "").replace(/[\x00-\x1f\x7f​-‏‪-‮⁦-⁩﻿]/g, "").replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim(); }
  function cleanTitle(s) { return sanitize(String(s || "").replace(/[‘’ʼ′]/g, "'").replace(/[“”″]/g, '"')).replace(/[.\s]+$/, "").trim(); }

  var core = global.FDCore = global.FDCore || {};
  core.text = {
    NORM_SPACE: NORM_SPACE, NORM_HYPHEN: NORM_HYPHEN, NORM_DROP: NORM_DROP, NORM_DASH: NORM_DASH,
    normChars: normChars, normText: normText, normLI: normLI, reEsc: reEsc,
    WIN_RESERVED: WIN_RESERVED, sanitize: sanitize, cleanTitle: cleanTitle,
  };
})(typeof self !== "undefined" ? self : globalThis);
