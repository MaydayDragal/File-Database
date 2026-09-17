/*
 * lidb.js — the LI Documents backup: a ZIP (stored or deflated) holding
 * manifest.json and the PDFs under files/.
 *
 * Moved verbatim out of viewer.html (REWRITE-PLAN.md Phase 1). Requires
 * zip.js. Classic <script> (window.FDCore.formats.lidb) and side-effect
 * import from Node.
 */
(function (global) {
  "use strict";
  var zip = global.FDCore.formats.zip;

  // Returns { manifest, pdfs:[{ name, blob, doc }] } — `doc` is the manifest
  // record for that archive entry, or {} when the manifest does not name it.
  function read(file) {
    return zip.readEntries(file).then(function (list) {
      var manifest = null;
      for (var i = 0; i < list.length; i++) if (list[i].name === "manifest.json") manifest = list[i];
      if (!manifest) throw new Error("This ZIP isn't an LI Documents backup (no manifest.json).");
      return zip.inflateEntry(manifest, "application/json").then(function (b) { return b.text(); }).then(function (txt) {
        var man = JSON.parse(txt);
        var byFname = {};
        (man.docs || []).forEach(function (d) { if (d.fname) byFname["files/" + d.fname] = d; });
        var pdfs = list.filter(function (en) { return en.name.indexOf("files/") === 0; });
        return Promise.all(pdfs.map(function (en) { return zip.inflateEntry(en, "application/pdf"); })).then(function (blobs) {
          return { manifest: man, pdfs: pdfs.map(function (en, i) { return { name: en.name, blob: blobs[i], doc: byFname[en.name] || {} }; }) };
        });
      });
    });
  }

  // A readable name for a document: "LI54.10-P-070001_3 - Title.pdf", falling
  // back to the document's original filename, then the archive name.
  function readableName(doc, archiveName) {
    return doc.li ? (doc.li + (doc.ver ? "_" + doc.ver : "") + (doc.title ? " - " + doc.title : "") + ".pdf") : (doc.filename || archiveName.slice(6));
  }

  global.FDCore.formats.lidb = { read: read, readableName: readableName };
})(typeof self !== "undefined" ? self : globalThis);
