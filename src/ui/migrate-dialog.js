/*
 * migrate-dialog.js — the first-launch dialog that brings the legacy
 * databases into the unified one (REWRITE-PLAN.md §4.1, D2, D8).
 *
 * FDData.ui.migrateDialog(status) runs FDData.migrate.run() with a progress
 * bar and, once the copy has verified, offers a .fdb backup of the migrated
 * data before the old databases are deleted. It resolves when the user
 * dismisses the result, so boot() continues onto the live generation. On a
 * failure the old databases and pointer are untouched: the dialog says why
 * and offers a retry or "skip for now" (the app opens an empty database and
 * asks again next launch).
 *
 * Plain DOM with inline styles keyed to the shared theme tokens, so every
 * page can show it without extra CSS. Classic <script> (window.FDData.ui).
 */
(function (global) {
  "use strict";
  var data = global.FDData;
  var doc = global.document;
  if (!doc) return;

  var CSS = [
    ".fdb-migrate{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--text,#111)}",
    ".fdb-migrate__box{width:min(92vw,520px);background:var(--panel,#fff);border:1px solid var(--border,#d7dbe0);border-radius:var(--radius,12px);box-shadow:0 20px 60px rgba(0,0,0,.35);padding:20px 22px}",
    ".fdb-migrate h2{margin:0 0 8px;font-size:18px}",
    ".fdb-migrate p{margin:0 0 10px}",
    ".fdb-migrate .muted{opacity:.75;font-size:13px}",
    ".fdb-migrate ul{margin:6px 0 12px 18px;padding:0}",
    ".fdb-migrate__bar{height:8px;border-radius:999px;background:var(--border,#e2e6ea);overflow:hidden;margin:12px 0 6px}",
    ".fdb-migrate__fill{height:100%;width:0;background:var(--accent,#2563eb);transition:width .15s}",
    ".fdb-migrate__label{font-size:12.5px;opacity:.8;min-height:1.2em}",
    ".fdb-migrate__row{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px}",
    ".fdb-migrate button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid var(--border,#c9cfd6);background:var(--panel,#fff);color:inherit;cursor:pointer}",
    ".fdb-migrate button.primary{background:var(--accent,#2563eb);border-color:var(--accent,#2563eb);color:#fff}",
    ".fdb-migrate button:disabled{opacity:.55;cursor:default}",
    ".fdb-migrate .error{color:#b91c1c;white-space:pre-wrap}",
  ].join("\n");

  function ensureStyle() {
    if (doc.getElementById("fdb-migrate-style")) return;
    var s = doc.createElement("style"); s.id = "fdb-migrate-style"; s.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(s);
  }
  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function n(x) { return (x || 0).toLocaleString(); }
  function plural(k, s, p) { return n(k) + " " + (k === 1 ? s : p); }
  function download(blob, name) {
    var a = doc.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    doc.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { try { URL.revokeObjectURL(a.href); } catch (e) {} }, 60000);
  }

  function migrateDialog(status) {
    ensureStyle();
    var p = (status && status.probe) || {};
    var counts = {
      files: (p.vault && p.vault.counts.files) || 0,
      docs: (p.li && p.li.counts.docs) || 0,
      tools: (p.inventory && p.inventory.counts.tools) || 0,
      ros: (p.ros && p.ros.counts.ros) || 0,
    };
    var wrap = el("div", "fdb-migrate"); wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-modal", "true"); wrap.id = "fdb-migrate";
    var box = el("div", "fdb-migrate__box");
    var title = el("h2", null, "Bringing your data together");
    var intro = el("p", null, "File Database now keeps everything in one database. Your existing data will be copied into it and verified — counts and every file's checksum — before the old databases are removed.");
    var list = el("ul");
    [[counts.files, "file", "files"], [counts.docs, "LI document", "LI documents"], [counts.tools, "tool", "tools"], [counts.ros, "repair order", "repair orders"]].forEach(function (x) {
      if (x[0]) list.appendChild(el("li", null, plural(x[0], x[1], x[2])));
    });
    var bar = el("div", "fdb-migrate__bar"); var fill = el("div", "fdb-migrate__fill"); bar.appendChild(fill);
    var label = el("div", "fdb-migrate__label", "");
    var note = el("p", "muted", "This runs once and takes a moment per file. Keep this tab open.");
    var err = el("p", "error"); err.hidden = true;
    var row = el("div", "fdb-migrate__row");
    box.append(title, intro, list, bar, label, note, err, row);
    wrap.appendChild(box);
    doc.body.appendChild(wrap);

    function setProgress(pr) {
      var pct = pr.total ? Math.round(pr.done / pr.total * 100) : 0;
      fill.style.width = (pr.phase === "verify" ? 90 + pct / 10 : pct * 0.9) + "%";
      var names = { files: "Copying files", documents: "Copying LI documents", tools: "Copying tools", ros: "Copying repair orders", verify: "Verifying" };
      label.textContent = (names[pr.phase] || pr.phase) + (pr.total ? " · " + n(pr.done) + " / " + n(pr.total) : "");
    }
    function buttons(list) {
      row.innerHTML = "";
      list.forEach(function (b) {
        var btn = el("button", b.primary ? "primary" : "", b.label);
        btn.id = b.id || "";
        btn.onclick = b.onClick;
        row.appendChild(btn);
      });
    }

    return new Promise(function (resolve) {
      function finish() { try { wrap.remove(); } catch (e) {} resolve(); }
      function start() {
        err.hidden = true; err.textContent = "";
        buttons([{ label: "Migrating…", id: "fdb-migrate-busy", onClick: null }]);
        row.firstChild.disabled = true;
        data.migrate.run({
          onProgress: setProgress,
          beforeDelete: function (report) {
            // Verified. Offer a backup of the migrated data before the old
            // databases go — the only rollback afterwards is from a file.
            fill.style.width = "100%";
            label.textContent = "Verified ✓ — " + n(report.counts.files) + " files, " + n(report.counts.documents) + " LI documents, " + n(report.counts.tools) + " tools, " + n(report.counts.ros) + " repair orders" + (report.hashes ? " · " + n(report.hashes) + " checksums match" : "") + ".";
            note.textContent = "Save a backup now? It contains everything that was just migrated. Afterwards the old databases are removed.";
            return new Promise(function (go) {
              buttons([
                { label: "Save a backup (.fdb) first", id: "fdb-migrate-export", onClick: function () {
                  var btn = this; btn.disabled = true; btn.textContent = "Preparing backup…";
                  data.backup.collect({ generation: report.generation }).then(function (r) {
                    download(r.blob, data.backup.fileName("file-database-migrated"));
                    btn.textContent = "Backup saved ✓";
                  }).catch(function (e) { btn.disabled = false; btn.textContent = "Backup failed — try again"; err.hidden = false; err.textContent = (e && e.message) || String(e); });
                } },
                { label: "Continue", id: "fdb-migrate-continue", primary: true, onClick: function () { buttons([]); label.textContent = "Removing the old databases…"; go(); } },
              ]);
            });
          },
        }).then(function (report) {
          label.textContent = "Done — everything is in one place now.";
          note.textContent = report.warnings.length ? "Notes: " + report.warnings.join(" ") : "";
          buttons([{ label: "Open File Database", id: "fdb-migrate-done", primary: true, onClick: finish }]);
        }, function (e) {
          fill.style.width = "0";
          label.textContent = "";
          err.hidden = false;
          err.textContent = "The migration did not complete: " + ((e && e.message) || e) + "\nNothing was changed — your existing data is still where it was.";
          note.textContent = "";
          buttons([
            { label: "Skip for now", id: "fdb-migrate-skip", onClick: finish },
            { label: "Try again", id: "fdb-migrate-retry", primary: true, onClick: start },
          ]);
        });
      }
      buttons([{ label: "Start", id: "fdb-migrate-start", primary: true, onClick: start }]);
    });
  }

  data.ui = data.ui || {};
  data.ui.migrateDialog = migrateDialog;
})(typeof self !== "undefined" ? self : globalThis);
