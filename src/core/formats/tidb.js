/*
 * tidb.js — the Tool Inventory database file: "TIDB" + u32 version + u32
 * metaLen + JSON (format "tool-inventory-db", tools and a photo table) +
 * the photos' PNG bytes back to back.
 *
 * The reader and the readable-CSV shaping moved verbatim out of viewer.html
 * (REWRITE-PLAN.md Phase 1). Requires container.js. Classic <script>
 * (window.FDCore.formats.tidb) and side-effect import from Node.
 */
(function (global) {
  "use strict";
  var formats = global.FDCore.formats;

  var MAGIC = "TIDB";

  // Returns { meta, photos:[{ id, blob }] }; each photo blob is a slice of the file.
  function read(file) {
    return formats.readHeader(file).then(function (h) {
      var meta = h.meta;
      if (!meta || meta.format !== "tool-inventory-db" || !Array.isArray(meta.tools)) throw new Error("Not a Tool Inventory database.");
      var off = h.payloadOffset, photos = [];
      (meta.photos || []).forEach(function (p) {
        photos.push({ id: p.id, blob: file.slice(off, off + p.len, "image/png") });
        off += p.len;
      });
      return { meta: meta, photos: photos };
    });
  }

  // The tool data as a normal spreadsheet — the columns the Extract page has
  // always written.
  var CSV_HEAD = ["ID", "No.", "Qty", "Tool Number", "Svc Grp", "Ct", "Description", "Location", "Year", "Dlr Net($)", "Note", "Comment", "Photo"];
  function toolsCsv(tools) {
    var q = function (s) { s = String(s == null ? "" : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var lines = [CSV_HEAD.join(",")];
    tools.forEach(function (t) {
      lines.push([t.id, t.no, t.qty, t.toolNo, t.svcGrp, t.ct, t.desc, t.location, t.year, (t.price == null ? "" : t.price), t.note, t.comment, t.photo].map(q).join(","));
    });
    return lines.join("\n");
  }

  formats.tidb = { MAGIC: MAGIC, read: read, toolsCsv: toolsCsv, CSV_HEAD: CSV_HEAD };
})(typeof self !== "undefined" ? self : globalThis);
