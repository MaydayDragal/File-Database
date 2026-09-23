/* Repair Orders — the app, as a feature module (REWRITE-PLAN.md Phase 4). */
/* ===== Repair Orders app (moved out of ros/index.html, REWRITE-PLAN.md Phase 3) ===== */
import { reviewDuplicates } from "../../ui/duplicates.js";

export function start(root, host, shell) {
  "use strict";
  var $ = function (s) { return root.querySelector(s); };
  var embedded = true;

  var toastT;
  function toast(m) { var t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("show"); }, 2600); }

  // ---------- RO storage (shared: ../src/data) ----------
  // Repair orders live in the platform database; a file attached to an RO is
  // a typed link (ro → file, "attachment"), so a file can sit on two ROs and
  // renumbering an RO touches one record — never its files. RO numbers are
  // unique (D7). The exact LI version and the tools a job used are links too
  // ("reference", "required-tool"). Delete is trash first (Phase 5).
  var R = function () { return FDData.repos; };
  function open() { return FDData.boot(); }
  function roAll() { return R().ros.live(); }
  function roPut(rec) { return R().ros.put(rec); }
  function uid() { return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function isRoConflict(e) { return !!(e && e.name === "RoConflict"); }
  function mini(x) { return { id: x.id, name: x.name, type: x.type, kind: x.kind, size: x.size, vins: x.vins || [], collection: x.collection || "" }; }
  // The files attached to a repair order, by its links (the trash left out).
  function attachedFiles(roId) {
    return R().ros.attachments(roId).then(function (recs) {
      return recs.map(mini).sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
    });
  }

  // ---------- state ----------
  var ros = [], current = null, saveT = null;
  var showTrash = false, trashed = [];

  // Every plain text field on the screen, paired with the record key it holds.
  // A scan fills these in; typing in any of them saves the same way.
  var FIELDS = [
    ["#ro-no", "ro"], ["#ro-vehicle", "vehicle"], ["#ro-vin", "vin"],
    ["#ro-tag", "tag"], ["#ro-mileage", "mileage"], ["#ro-color", "color"],
    ["#ro-opened", "opened"], ["#ro-customer", "customer"],
    ["#ro-advisor", "advisor"], ["#ro-phone", "phone"], ["#ro-email", "email"]
  ];

  function blankRO() {
    var rec = { id: uid(), lines: [], createdAt: Date.now(), updatedAt: Date.now() };
    FIELDS.forEach(function (f) { rec[f[1]] = ""; });
    return rec;
  }
  function fmtBytes(b) { if (!b) return "0 B"; var u = ["B", "KB", "MB", "GB"], i = Math.floor(Math.log(b) / Math.log(1024)); i = Math.min(i, u.length - 1); return (b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + " " + u[i]; }
  var GLYPH = { image: "🖼️", video: "🎬", audio: "🎵", pdf: "📕", document: "📄", spreadsheet: "📊", presentation: "📈", text: "📝", archive: "🗜️", other: "📎" };
  function letter(i) { return i < 26 ? String.fromCharCode(65 + i) : "L" + (i + 1); }

  // ---------- rendering ----------
  function renderList() {
    var box = $("#list"); box.innerHTML = "";
    $("#trash-count").textContent = trashed.length ? "(" + trashed.length + ")" : "";
    $("#trash-toggle").classList.toggle("on", showTrash);
    if (showTrash) { renderTrash(box); return; }
    if (!ros.length) { box.innerHTML = '<div class="side__empty">No repair orders yet.<br>Click ＋ to start one.</div>'; return; }
    ros.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    ros.forEach(function (r) {
      var d = document.createElement("div");
      d.className = "ro-item" + (current && r.id === current.id ? " active" : "");
      var no = document.createElement("div"); no.className = "ro-item__no"; no.textContent = (r.ro || "").trim() ? "RO " + r.ro.trim() : "Untitled RO";
      var m = document.createElement("div"); m.className = "ro-item__meta"; m.textContent = r.vehicle || "—";
      d.append(no, m);
      d.onclick = function () { openRO(r.id); if (window.innerWidth <= 760) $("#side").classList.remove("show"); };
      box.append(d);
    });
  }
  // The trash: each deleted RO with Restore / Delete forever.
  function renderTrash(box) {
    if (!trashed.length) { box.innerHTML = '<div class="side__empty">The trash is empty.</div>'; return; }
    trashed.slice().sort(function (a, b) { return (b.deletedAt || 0) - (a.deletedAt || 0); }).forEach(function (r) {
      var d = document.createElement("div"); d.className = "ro-item trashed";
      var no = document.createElement("div"); no.className = "ro-item__no"; no.textContent = (r.ro || "").trim() ? "RO " + r.ro.trim() : "Untitled RO";
      var m = document.createElement("div"); m.className = "ro-item__meta"; m.textContent = r.vehicle || "—";
      var acts = document.createElement("div"); acts.className = "ro-item__actions";
      var rs = document.createElement("button"); rs.className = "btn btn--sm btn--primary"; rs.textContent = "♻️ Restore"; rs.dataset.restore = r.id;
      rs.onclick = function () { restoreRO(r.id); };
      var del = document.createElement("button"); del.className = "btn btn--sm btn--danger"; del.textContent = "Delete forever"; del.dataset.purge = r.id;
      del.onclick = function () { purgeRO(r); };
      acts.append(rs, del);
      d.append(no, m, acts);
      box.append(d);
    });
  }
  function loadTrash() { return R().ros.listTrash().then(function (l) { trashed = l || []; }, function () { trashed = []; }); }
  function restoreRO(id) {
    R().ros.restore(id, { files: true }).then(function () {
      return Promise.all([roAll(), loadTrash()]);
    }).then(function (r) {
      ros = r[0] || [];
      showTrash = false;
      openRO(id);
      toast("Repair order restored.");
    }, function (e) { toast("Couldn't restore — " + ((e && e.message) || e)); });
  }
  function purgeRO(r) {
    var label = (r.ro || "").trim() ? "RO " + r.ro.trim() : "this repair order";
    if (!confirm("Delete " + label + " for good? Its notes and links go; its files stay in Files.")) return;
    R().ros.purge(r.id).then(function (res) {
      if (!res.purged) { toast(label + " is still referenced elsewhere and was kept."); return null; }
      return loadTrash().then(function () { renderList(); toast(label + " deleted for good."); });
    });
  }

  // ---------- VIN: check digit, confirmation, the vehicle record ----------
  function paintVin() {
    var v = current ? (current.vin || "").trim().toUpperCase().replace(/\s+/g, "") : "";
    var box = $("#vin-status");
    box.hidden = v.length !== 17;
    if (box.hidden) return;
    var id = current.id;
    R().vehicles.get(v).then(function (rec) {
      if (!current || current.id !== id) return;
      var ok = vinCheckOk(v);
      var t = $("#vin-status-text"); t.textContent = "";
      var a = document.createElement("span"); a.className = ok ? "ok" : "warn";
      a.textContent = ok ? "✓ Check digit OK" : "⚠ Check digit fails — probably a misread";
      t.append(a);
      var confirmed = !!(rec && rec.confirmedAt);
      t.append(document.createTextNode(confirmed ? " · confirmed by a technician" : " · not confirmed"));
      $("#vin-confirm").textContent = confirmed ? "Withdraw confirmation" : "✓ Confirm VIN";
      $("#vin-confirm").dataset.confirmed = confirmed ? "1" : "";
    }).catch(function () {});
  }
  // A VIN saved on an RO becomes (or tops up) its vehicle record.
  function noteVehicle(vin, source) {
    vin = String(vin || "").trim().toUpperCase().replace(/\s+/g, "");
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return Promise.resolve(null);
    return R().vehicles.note(vin, { source: source }).catch(function () { return null; });
  }

  // ---------- pinned LI versions and tools ----------
  function renderRefs() {
    if (!current) return;
    var id = current.id;
    R().ros.references(id).then(function (refs) {
      if (!current || current.id !== id) return;
      var box = $("#refs"); box.innerHTML = "";
      if (!refs.documents.length && !refs.tools.length) { box.innerHTML = '<div class="refs-empty">Nothing pinned yet.</div>'; return; }
      refs.documents.forEach(function (r) {
        var row = document.createElement("div"); row.className = "ref"; row.dataset.kind = "document";
        var li = (r.doc && r.doc.li) || r.link.li || "", ver = (r.doc && r.doc.ver) || r.link.ver || "";
        var main = document.createElement("span"); main.className = "ref__main";
        main.textContent = "🗄️ " + li + (ver ? " v" + ver : "") + (r.doc && r.doc.title ? " · " + r.doc.title : "");
        main.title = "Open in LI Documents";
        main.onclick = function () { navLi(li); };
        row.append(main);
        if (!r.doc) { var g = document.createElement("span"); g.className = "ref__gone"; g.textContent = "(this version is no longer stored)"; row.append(g); }
        if (r.newer && r.latest) {
          var nb = document.createElement("button"); nb.type = "button"; nb.className = "ref__newer";
          nb.textContent = "newer version exists (v" + r.latest.ver + ")"; nb.title = "Open the newest version — this RO keeps the one it used";
          nb.onclick = function () { navLi(li); };
          row.append(nb);
        }
        var x = document.createElement("button"); x.className = "btn btn--sm"; x.textContent = "✕"; x.title = "Unpin";
        x.onclick = function () { R().links.remove(r.link.id).then(renderRefs); };
        row.append(x);
        box.append(row);
      });
      refs.tools.forEach(function (r) {
        var row = document.createElement("div"); row.className = "ref"; row.dataset.kind = "tool";
        var t = r.tool || {};
        var main = document.createElement("span"); main.className = "ref__main";
        main.textContent = "🔧 " + (t.toolNo || r.link.toId) + (t.desc ? " · " + t.desc : "");
        main.title = "Open in the Tool Inventory";
        main.onclick = function () { try { shell.send({ type: "shell-nav", app: "inventory", payload: { type: "inventory-open", toolNo: t.toolNo || "" } }); } catch (e) {} };
        row.append(main);
        if (!r.tool) { var g = document.createElement("span"); g.className = "ref__gone"; g.textContent = "(no longer in the inventory)"; row.append(g); }
        var x = document.createElement("button"); x.className = "btn btn--sm"; x.textContent = "✕"; x.title = "Unpin";
        x.onclick = function () { R().links.remove(r.link.id).then(renderRefs); };
        row.append(x);
        box.append(row);
      });
    }).catch(function () {});
  }
  function navLi(li) { try { shell.send({ type: "shell-nav", app: "li", payload: { type: "li-open", li: li } }); } catch (e) {} }
  // Pin what was typed: an LI number (its newest stored version — the one
  // in use today) or a special-tool number.
  function addRef() {
    if (!current) return;
    var raw = $("#ref-input").value.trim();
    if (!raw) return;
    var id = current.id;
    var ids = FDCore.ids;
    var li = ids.isLiNumber(raw) ? ids.canonLI(raw).toUpperCase() : "";
    var toolNo = ids.canonToolNo(raw);
    var p;
    if (li) {
      p = R().documents.latestOf(li).then(function (doc) {
        if (!doc) { toast(li + " isn't in LI Documents yet — import it there first."); return false; }
        return R().ros.pinDocument(id, doc).then(function () { toast("Pinned " + li + " v" + doc.ver + "."); return true; });
      });
    } else if (toolNo) {
      p = R().tools.list().then(function (list) {
        var key = toolNo.replace(/\s+/g, "");
        var t = list.filter(function (x) { return String(x.toolNo || "").replace(/\s+/g, "") === key; })[0];
        if (!t) { toast("Tool " + toolNo + " isn't in the Tool Inventory."); return false; }
        return R().ros.pinTool(id, t.id).then(function () { toast("Pinned tool " + toolNo + "."); return true; });
      });
    } else { toast("Type an LI number (LI54.10-P-070001) or a tool number (000 589 01 23 00)."); return; }
    p.then(function (ok) { if (ok) { $("#ref-input").value = ""; renderRefs(); } }).catch(function (e) { toast("Couldn't pin — " + ((e && e.message) || e)); });
  }

  function paint() {
    var has = !!current;
    $("#inner").hidden = !has; $("#empty-main").hidden = has;
    if (!has) return;
    FIELDS.forEach(function (f) { $(f[0]).value = current[f[1]] || ""; });
    $("#save-note").textContent = "";
    $("#add-banner").hidden = embedded;
    renderLines();
    refreshFiles();
    renderRefs();
    paintVin();
  }
  function renderLines() {
    var box = $("#lines"); box.innerHTML = "";
    var lines = current.lines || [];
    if (!lines.length) { box.innerHTML = '<div class="lines-empty">No lines yet. Click ＋ Add line to start the story (e.g. “Customer states car makes a noise”).</div>'; return; }
    lines.forEach(function (ln, i) {
      var row = document.createElement("div"); row.className = "line";
      var lab = document.createElement("div"); lab.className = "line__label"; lab.textContent = "Line " + letter(i);
      var op = document.createElement("input"); op.className = "line__op"; op.value = ln.op || "";
      op.placeholder = "OP"; op.title = "Operation code"; op.spellcheck = false; op.maxLength = 10;
      op.addEventListener("input", function () { ln.op = op.value.toUpperCase(); scheduleSave(); });
      var ta = document.createElement("textarea"); ta.value = ln.text || ""; ta.spellcheck = true;
      ta.placeholder = "What happened on line " + letter(i) + "… (complaint / cause / correction)";
      ta.addEventListener("input", function () { ln.text = ta.value; scheduleSave(); });
      var del = document.createElement("button"); del.className = "btn btn--sm btn--danger line__del"; del.textContent = "✕"; del.title = "Remove this line";
      del.onclick = function () { current.lines.splice(i, 1); renderLines(); scheduleSave(); };
      row.append(lab, op, ta, del);
      box.append(row);
    });
  }
  function refreshFiles() {
    if (!current) return;
    var id = current.id, roVin = current.vin;
    attachedFiles(id).then(function (list) {
      if (!current || current.id !== id) return;
      var box = $("#files"); box.innerHTML = "";
      if (!list.length) { box.innerHTML = '<div class="files-empty">No files yet. Add the RO paperwork, photos, scans… or import files already in the Vault.</div>'; return; }
      list.forEach(function (f) {
        var row = document.createElement("div"); row.className = "file";
        var g = document.createElement("span"); g.className = "file__glyph"; g.textContent = GLYPH[f.kind] || GLYPH.other;
        var n = document.createElement("span"); n.className = "file__name"; n.textContent = f.name; n.title = f.name;
        var meta = document.createElement("span"); meta.className = "file__meta";
        if (f.vins && f.vins.length) { var vb = document.createElement("span"); vb.className = "vin-badge" + (roVin && f.vins.indexOf(roVin) !== -1 ? " match" : ""); vb.textContent = "🚗 " + f.vins[0].slice(-6); vb.title = f.vins.join(", "); meta.append(vb); }
        var sz = document.createElement("span"); sz.textContent = fmtBytes(f.size); meta.append(sz);
        row.append(g, n, meta);
        row.onclick = function () { try { shell.send({ type: "shell-nav", app: "vault", payload: { type: "vault-open", id: f.id } }); } catch (e) {} };
        box.append(row);
      });
    });
  }

  // ---------- CRUD ----------
  // A field edit is saved 400 ms after the last keystroke. Anything that
  // changes `current` first commits that pending save for the record it
  // belongs to — otherwise the timer fired against the newly opened RO.
  function flushSave() { if (saveT) { clearTimeout(saveT); saveT = null; commitSave(); } }
  function newRO() {
    flushSave();
    var rec = blankRO();
    rec.lines = [{ id: uid(), text: "", op: "" }];
    current = rec; ros.push(rec); roPut(rec);
    renderList(); paint(); $("#ro-no").focus();
  }
  function openRO(id) { var r = ros.find(function (x) { return x.id === id; }); if (!r) return; flushSave(); current = r; showTrash = false; renderList(); paint(); }
  function scheduleSave() { if (!current) return; $("#save-note").textContent = "Saving…"; clearTimeout(saveT); saveT = setTimeout(commitSave, 400); }
  function commitSave() {
    saveT = null;
    if (!current) return;
    FIELDS.forEach(function (f) { current[f[1]] = $(f[0]).value; });
    current.vin = (current.vin || "").trim().toUpperCase().replace(/\s+/g, "");
    current.updatedAt = Date.now();
    var rec = current;
    // Renumbering is this one record: the attached files are links, so
    // nothing in Files changes (no collection rename, no file writes).
    roPut(rec).then(function () {
      noteVehicle(rec.vin, "ro").then(function () { if (current === rec) paintVin(); });
      $("#save-note").textContent = "Saved"; setTimeout(function () { if ($("#save-note").textContent === "Saved") $("#save-note").textContent = ""; }, 1400); renderList();
    }, function (e) {
      // D7: the number belongs to another repair order — nothing is saved
      // until it is changed.
      if (isRoConflict(e)) { $("#save-note").textContent = "Not saved — RO " + (rec.ro || "").trim() + " already exists"; toast("RO " + (rec.ro || "").trim() + " is already used by another repair order."); }
      else { $("#save-note").textContent = "Not saved"; toast("Couldn't save — " + ((e && e.message) || e)); }
    });
  }
  // Delete = move to the trash, after asking what happens to the files:
  // keep them attached (a restore brings them back), unlink them, or trash
  // them too (a file another repair order uses is kept).
  function deleteRO() {
    if (!current) return;
    flushSave();
    var rec = current;
    var label = (rec.ro || "").trim() ? "RO " + rec.ro.trim() : "this repair order";
    attachedFiles(rec.id).then(function (files) {
      $("#del-title").textContent = "🗑 Delete " + label;
      $("#del-note").textContent = label.charAt(0).toUpperCase() + label.slice(1) + " goes to the trash (restore it any time from 🗑️ Trash). " +
        (files.length ? "It has " + files.length + " file" + (files.length === 1 ? "" : "s") + " attached:" : "It has no files attached.");
      root.querySelectorAll('input[name="del-files"]').forEach(function (r) { r.checked = r.value === "keep"; r.disabled = !files.length; });
      $("#del-scrim").classList.add("show"); $("#del-modal").classList.add("show");
      function close() { $("#del-scrim").classList.remove("show"); $("#del-modal").classList.remove("show"); $("#del-ok").onclick = null; $("#del-cancel").onclick = null; }
      $("#del-cancel").onclick = close;
      $("#del-ok").onclick = function () {
        var picked = root.querySelector('input[name="del-files"]:checked');
        var mode = picked ? picked.value : "keep";
        close();
        R().ros.trash(rec.id, { attachments: mode }).then(function (res) {
          ros = ros.filter(function (x) { return x.id !== rec.id; });
          current = ros.length ? ros.slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); })[0] : null;
          return loadTrash().then(function () {
            renderList(); paint();
            var msg = "Moved " + label + " to the trash.";
            if (mode === "unlink" && res.unlinked) msg += " " + res.unlinked + " file(s) unlinked.";
            if (mode === "trash") msg += " " + res.trashed.length + " file(s) trashed" + (res.kept.length ? ", " + res.kept.length + " kept (on another RO)" : "") + ".";
            toast(msg);
          });
        }, function (e) { toast("Couldn't delete — " + ((e && e.message) || e)); });
      };
    });
  }

  // ---------- VIN reconcile shared by upload + import ----------
  function classify(files, roVin) {
    var noVin = [], match = [], mismatch = [];
    files.forEach(function (f) {
      var v = f.vins || [];
      if (!v.length) noVin.push(f);
      else if (roVin && v.indexOf(roVin) !== -1) match.push(f);
      else if (roVin) mismatch.push(f);
      else match.push(f); // no RO VIN set → nothing to reconcile
    });
    return { noVin: noVin, match: match, mismatch: mismatch };
  }
  // uploaded=true → files are already attached (detach to remove);
  // uploaded=false (import) → files aren't attached yet (skip to omit).
  function reconcile(files, uploaded) {
    if (!files.length) { refreshFiles(); return Promise.resolve(); }
    var roVin = current.vin;
    var c = classify(files, roVin);
    var keep = c.noVin.concat(c.match);
    var stampVin = roVin ? c.noVin.map(function (f) { return f.id; }) : [];
    var rec = current;
    var doApply = function (extraKeep, eject) {
      var add = keep.concat(extraKeep || []).map(function (f) { return f.id; });
      var remove = (eject || []).map(function (f) { return f.id; });
      var ops = [];
      if (add.length) ops.push(R().ros.attach(rec.id, add, { source: "ro" }));
      stampVin.forEach(function (fid) {
        ops.push(R().files.get(fid).then(function (f) { if (!f) return null; return R().files.update(fid, { vins: Array.from(new Set([roVin].concat(f.vins || []))), vinScan: Date.now() }); }));
      });
      if (remove.length) ops.push(R().ros.detach(rec.id, remove));
      var msgs = [];
      if (c.noVin.length && roVin) msgs.push("stamped VIN on " + c.noVin.length);
      if (add.length) msgs.push(add.length + " added");
      if (remove.length) msgs.push(remove.length + " ignored");
      return Promise.all(ops).catch(function () {}).then(function () {
        if (msgs.length) toast("Files updated — " + msgs.join(" · ") + ".");
        refreshFiles();
      });
    };
    if (c.mismatch.length && roVin) {
      return askMismatch(c.mismatch, roVin).then(function (decision) {
        if (decision === "add") return doApply(c.mismatch, []);
        return doApply([], uploaded ? c.mismatch : []); // ignore: eject uploads, omit imports
      });
    }
    return doApply(c.mismatch, []); // no RO VIN, or nothing mismatched
  }

  // ---------- files: attach ----------
  function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []).filter(Boolean);
    if (!files.length || !current) return;
    var rec = current;
    toast("Saving " + files.length + " file" + (files.length === 1 ? "" : "s") + " to this RO…");
    // Stored straight into the shared database and linked to this RO. No
    // polling: the intake reports each file, and the quick VIN read it
    // queues (a job the Files app runs) is awaited before the VINs are
    // reconciled. A file whose bytes are already stored is put to the
    // duplicate review; a skipped one is attached as the stored file.
    FDData.intake.ingest("vault", files, { roId: rec.id, source: "ro", reviewDuplicates: reviewFor(rec.id) }).then(function (out) {
      out.results.filter(function (r) { return !r.ok && !r.skipped; }).forEach(function (r) { toast("Couldn't save “" + r.name + "” — " + r.error); });
      refreshFiles();
      if (!out.ids.length) return;
      var vj = (out.jobs || []).filter(function (j) { return j.type === "vin-detect"; })[0];
      var settled = vj ? FDData.jobs.whenDone(vj.id, 20000).catch(function () {}) : Promise.resolve();
      return settled.then(function () { return R().files.getMany(out.ids); }).then(function (got) {
        if (!current || current.id !== rec.id) return;
        return reconcile(got.filter(Boolean).map(mini), true);
      });
    }).catch(function (e) { toast("Couldn't save the files — " + ((e && e.message) || e)); });
  }
  // Duplicate review for files added to an RO: bytes already attached to
  // THIS repair order (a rescan filing the same PDF again) are skipped
  // without asking; any other match is put to the person.
  function reviewFor(roId) {
    return function (list) {
      return R().ros.attachments(roId, { trash: "with" }).then(function (att) {
        var on = {}; att.forEach(function (f) { on[f.id] = true; });
        var auto = [], ask = [];
        list.forEach(function (d) {
          var hit = d.matches.filter(function (m) { return on[m.id]; })[0];
          if (hit) auto.push({ index: d.index, action: "skip", reuse: hit.id }); else ask.push(d);
        });
        return (ask.length ? reviewDuplicates(ask) : Promise.resolve([])).then(function (r) { return auto.concat(r); });
      });
    };
  }
  function openInVault() {
    if (!current) return;
    if (!embedded) { toast("Open in the File Database app to view files in the Vault."); return; }
    try { shell.send({ type: "shell-nav", app: "vault", payload: { type: "vault-filter", filter: "ro:" + current.id } }); } catch (e) {}
  }

  // ---------- import from Vault: hand off to the normal Vault screen ----------
  // The Vault opens in "select for RO" mode: pick files with its own
  // multi-select, then its ➕ Add to RO button transfers them here.
  function selectInVault() {
    if (!current) return;
    if (!embedded) { toast("Open in the File Database app to import Vault files."); return; }
    try {
      shell.send({ type: "shell-nav", app: "vault", payload: { type: "vault-ro-import", vin: current.vin || "", roNo: (current.ro || "").trim(), roId: current.id } });
    } catch (e) {}
  }

  // ---------- VIN mismatch modal ----------
  function askMismatch(files, roVin) {
    return new Promise(function (resolve) {
      var note = $("#mm-note"); note.textContent = "";
      var vinEl = document.createElement("b"); vinEl.textContent = roVin;
      note.append("This RO's VIN is ", vinEl, ", but " + files.length + " file" + (files.length === 1 ? " has a" : "s have a") + " different VIN. Add them to this RO anyway, or ignore them?");
      var box = $("#mm-list"); box.innerHTML = "";
      files.forEach(function (f) {
        var row = document.createElement("div"); row.className = "mm-file";
        var n = document.createElement("span"); n.textContent = f.name; n.style.overflow = "hidden"; n.style.textOverflow = "ellipsis"; n.style.whiteSpace = "nowrap";
        var v = document.createElement("b"); v.textContent = (f.vins || [])[0] || "?";
        row.append(n, v); box.append(row);
      });
      $("#mm-scrim").classList.add("show"); $("#mm-modal").classList.add("show");
      function done(dec) { $("#mm-scrim").classList.remove("show"); $("#mm-modal").classList.remove("show"); $("#mm-add").onclick = null; $("#mm-ignore").onclick = null; resolve(dec); }
      $("#mm-add").onclick = function () { done("add"); };
      $("#mm-ignore").onclick = function () { done("ignore"); };
    });
  }

  // ================= Scan a paper RO =================
  // A photographed or scanned repair order is read entirely on this device —
  // a PDF's own text layer when it has one, Tesseract OCR otherwise — then
  // parsed into fields and lines, shown for review, and turned into an RO.

  var MAX_SCAN_PAGES = 4;   // one RO's paperwork, not a whole day's stack
  var QUICK_EDGE = 1100;    // long edge used for the which-way-up probe
  var GOOD_SCORE = 30;      // an upright page scoring this well skips the probe

  // ---------- parsing (shared: ../src/core/ro-parse.js) ----------
  // The scan parser — header fields, the line table, DISPATCH screens, the
  // VIN and cell helpers — moved to src/core/ro-parse.js (REWRITE-PLAN.md
  // Phase 1). These aliases keep the rest of this file reading as before.
  var squash = FDCore.ro.squash, findVinIn = FDCore.ro.findVinIn, mileageOf = FDCore.ro.mileageOf, dateOf = FDCore.ro.dateOf;
  var layoutLines = FDCore.ro.layoutLines, parseScan = FDCore.ro.parseScan, vinCheckOk = FDCore.vin.vinCheckOk;

  // The text-recognition engine and PDF.js are the shared, on-demand
  // services (src/services/ocr.js, src/services/pdf.js); window.__TESS_* and
  // window.__PDFJS_* still override where they come from.
  var loadTess = function () { return FDServices.tess.load(); };
  var loadPdfjs = function () { return FDServices.pdf.load(); };

  function isPdf(f) { return /pdf/i.test(f.type || "") || /\.pdf$/i.test(f.name || ""); }
  function bitmapOf(file) {
    var viaImg = function () {
      return new Promise(function (res, rej) {
        var url = URL.createObjectURL(file), im = new Image();
        im.onload = function () { URL.revokeObjectURL(url); res(im); };
        im.onerror = function () { URL.revokeObjectURL(url); rej(new Error("Couldn't open “" + file.name + "”.")); };
        im.src = url;
      });
    };
    if (!window.createImageBitmap) return viaImg();
    return createImageBitmap(file).catch(viaImg);
  }
  function srcSize(src) { return { w: src.width || src.naturalWidth || 1, h: src.height || src.naturalHeight || 1 }; }
  // A letter page needs ~200 DPI before small print is legible, so nothing is
  // ever read below a 2200px long edge; past 3300 it is only cost.
  function fullEdge(src) { var sz = srcSize(src); return Math.max(2200, Math.min(3300, Math.max(sz.w, sz.h))); }

  // Rows from a PDF text layer or a recognized page: ../src/core/ro-parse.js.
  var itemsToRows = FDCore.ro.itemsToRows, rowsToText = FDCore.ro.rowsToText, rowsFromData = FDCore.ro.rowsFromData;

  function pdfDoc(file) {
    return loadPdfjs().then(function (lib) {
      return file.arrayBuffer().then(function (buf) {
        return lib.getDocument({ data: buf, isEvalSupported: false, disableAutoFetch: true, disableStream: true }).promise;
      });
    });
  }
  // A born-digital RO carries its own text; a scanned one carries almost none,
  // and its pages come back as canvases for OCR instead.
  function readPdf(file, status) {
    return pdfDoc(file).then(function (doc) {
      var n = Math.min(doc.numPages, MAX_SCAN_PAGES), texts = [], pageRows = [], i = 1;
      function textStep() {
        if (i > n) return Promise.resolve();
        return doc.getPage(i).then(function (page) {
          return page.getTextContent().then(function (tc) { var r = itemsToRows(tc.items); pageRows.push(r); texts.push(rowsToText(r)); i++; return textStep(); });
        });
      }
      return textStep().then(function () {
        var text = texts.join("\n");
        if ((text.match(/[A-Za-z]/g) || []).length >= 200) { try { doc.destroy(); } catch (e) {} return { text: text, rows: pageRows, sources: [] }; }
        var sources = [], k = 1;
        function renderStep() {
          if (k > n) return Promise.resolve();
          status("Rendering page " + k + " of " + n + "…");
          return doc.getPage(k).then(function (page) {
            var vp = page.getViewport({ scale: 2.2 });
            var c = document.createElement("canvas");
            c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
            var ctx = c.getContext("2d");
            ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
            return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () { sources.push(c); k++; return renderStep(); });
          });
        }
        return renderStep().then(function () { try { doc.destroy(); } catch (e) {} return { text: text, rows: [], sources: sources }; });
      });
    });
  }

  /*
   * A VIN read again, on its own terms.
   *
   * It is the densest thing on the page — 17 characters, no word shape for the
   * engine to lean on, in the smallest print on the form — so it is the first
   * thing a tired scan loses. Reading the whole page at once, a washed-out copy
   * gives "W1NKMAGB1SF382775" for "W1NKM4GB9SF382775" (4 read as A, 9 as 1), and
   * a worse one gives nothing at all.
   *
   * So once the page has been read, the row the VIN sits on is read a second
   * time by itself: cropped out, enlarged, and with the engine told two things
   * it cannot work out for itself — that this is a single line, and that a VIN
   * is spelled without I, O or Q. The result only wins if it actually looks
   * like a VIN.
   */
  var VIN_ALPHABET = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";

  // Crop a box out of the upright page, enlarge it, and read it as one line.
  // Enlarging adds no detail that was not already there, but the engine reads
  // small type better at a comfortable size, and at which size is not
  // predictable — on one marginal scan the same strip read correctly at 2x and
  // 4x and wrongly at 3x — so a caller reads at several and judges the results.
  function readBand(worker, page, box, zoom, stretch) {
    var band = document.createElement("canvas");
    band.width = Math.max(1, Math.round(box.w * zoom));
    band.height = Math.max(1, Math.round(box.h * zoom));
    var ctx = band.getContext("2d", { willReadFrequently: !!stretch });
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, band.width, band.height);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(page, box.x, box.y, box.w, box.h, 0, 0, band.width, band.height);
    var read = band;
    if (stretch) {
      stretchInk(ctx, band.width, band.height, zoom);
      read = tightenInk(band, ctx, zoom) || band;
    }
    return worker.recognize(read).then(function (r) {
      band.width = band.height = 0; if (read !== band) { read.width = read.height = 0; }
      return (r && r.data && r.data.text) || "";
    }, function () { band.width = band.height = 0; if (read !== band) { read.width = read.height = 0; } return ""; });
  }

  /*
   * Separate a faint cell's own ink from its paper, and take the form's rules out.
   *
   * A dot-matrix value printed into a form box is already the lightest thing on
   * the page, and a worn copier lifts it further: on one scan the printed
   * labels come off the glass at 43% grey and the number beside them at 74%,
   * against 94% paper. Read as part of the whole page that is hopeless — the
   * engine picks one threshold for everything and the faint cell falls on the
   * paper side of it.
   *
   * Read on its own it is recoverable, because a cell is mostly paper and the
   * paper is all one tone. Its tones pile up into a peak near white, and the
   * width of that peak is the scan's own speckle: where the peak ends, paper
   * ends and ink begins. Cutting there tells a 74% grey number from a 94% grey
   * background even though both are pale — and does not turn JPEG mottle into
   * letters, which a fixed threshold does.
   *
   * What the cut also picks up is the box the value is printed in. A rule is a
   * line of ink running the whole way across, so it is found by exactly that —
   * a column or row that is almost entirely ink — and wiped, before it can be
   * read as a 1 or a row of dashes.
   */
  var PEAK_TAIL = 0.06, RULE_FILL = 0.8, MAX_INK_DEPTH = 130;
  function stretchInk(ctx, w, h, zoom) {
    var img, i, x, y, n = w * h;
    try { img = ctx.getImageData(0, 0, w, h); } catch (e) { return; }
    var d = img.data, grey = new Uint8Array(n), hist = new Uint32Array(256);
    for (i = 0; i < n; i++) {
      grey[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000 | 0;
      hist[grey[i]]++;
    }
    var cut = paperEdge(hist);
    if (cut < 0) return;                          // no paper peak to work from: leave it alone
    for (i = 0; i < n; i++) grey[i] = grey[i] < cut ? 0 : 255;

    // Wipe the box's own rules: a column (or row) of ink almost all the way down
    // (or across) is a printed line, not a character.
    var col = new Uint32Array(w), rowc = new Uint32Array(h);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) if (!grey[y * w + x]) { col[x]++; rowc[y]++; }
    for (x = 0; x < w; x++) if (col[x] >= h * RULE_FILL) for (y = 0; y < h; y++) grey[y * w + x] = 255;
    for (y = 0; y < h; y++) if (rowc[y] >= w * RULE_FILL) for (x = 0; x < w; x++) grey[y * w + x] = 255;

    despeckle(grey, w, h, zoom || 1);
    for (i = 0; i < n; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = grey[i]; d[i * 4 + 3] = 255; }
    ctx.putImageData(img, 0, 0);
  }

  /*
   * What is left after the rules go is the value, the dashes where a rule was
   * not quite straight enough to be wiped in one piece, and the dirt every
   * photocopy carries. A character is a blob of ink of roughly a character's
   * size; the rest is neither big enough nor the right shape, and goes.
   */
  function despeckle(grey, w, h, zoom) {
    var minArea = Math.max(6, Math.round(zoom * zoom * 2)), n = w * h;
    var seen = new Uint8Array(n), stack = new Int32Array(n), i, p, x, y;
    for (i = 0; i < n; i++) {
      if (grey[i] || seen[i]) continue;
      var top = 0, count = 0, x0 = w, x1 = -1, y0 = h, y1 = -1, px = [];
      stack[top++] = i; seen[i] = 1;
      while (top > 0) {
        p = stack[--top]; px.push(p); count++;
        x = p % w; y = (p / w) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && !grey[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[top++] = p - 1; }
        if (x < w - 1 && !grey[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[top++] = p + 1; }
        if (y > 0 && !grey[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[top++] = p - w; }
        if (y < h - 1 && !grey[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[top++] = p + w; }
      }
      var bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      // Too small to be a character, or a long thin streak — what is left of a
      // printed rule after the straight part of it was wiped.
      if (count >= minArea && bw < bh * 10) continue;
      for (var k = 0; k < px.length; k++) grey[px[k]] = 255;
    }
  }

  // Crop the cleaned band down to the ink that survived, so the engine is given
  // a line of text rather than a line of text adrift in half an inch of paper.
  function tightenInk(band, ctx, zoom) {
    var w = band.width, h = band.height, img, x, y;
    try { img = ctx.getImageData(0, 0, w, h); } catch (e) { return null; }
    var d = img.data, x0 = w, x1 = -1, y0 = h, y1 = -1;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      if (d[(y * w + x) * 4] >= 128) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < x0 || y1 < y0) return null;
    var pad = Math.max(6, Math.round(4 * zoom));
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    var cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    if (cw === w && ch === h) return null;
    var out = document.createElement("canvas");
    out.width = cw; out.height = ch;
    var octx = out.getContext("2d");
    octx.fillStyle = "#fff"; octx.fillRect(0, 0, cw, ch);
    octx.drawImage(band, x0, y0, cw, ch, 0, 0, cw, ch);
    return out;
  }
  // Where the paper's own peak ends, going down from it — smoothed first, so a
  // one-level dip in the histogram is not mistaken for the end of the peak.
  function paperEdge(hist) {
    var i, sm = new Float64Array(256);
    for (i = 0; i < 256; i++) sm[i] = (hist[Math.max(0, i - 1)] + hist[i] + hist[Math.min(255, i + 1)]) / 3;
    var peak = -1, peakAt = -1;
    for (i = 128; i < 256; i++) if (sm[i] > peak) { peak = sm[i]; peakAt = i; }
    if (peakAt < 0 || peak <= 0) return -1;
    var floor = peak * PEAK_TAIL, edge = peakAt;
    while (edge > 0 && sm[edge] > floor) edge--;
    if (peakAt - edge > MAX_INK_DEPTH) return -1; // no distinct peak — the cell is not mostly paper
    return edge;
  }

  // The strip a row occupies, with a little air above and below so the crop does
  // not clip the tops of the letters.
  function rowBox(page, row, x0, x1, padFrac) {
    var pad = Math.round((row.y1 - row.y0) * (padFrac == null ? 0.4 : padFrac));
    var y = Math.max(0, row.y0 - pad);
    var h = Math.min(page.height - y, (row.y1 - row.y0) + pad * 2);
    var left = Math.max(0, x0 == null ? 0 : x0);
    var right = Math.min(page.width, x1 == null ? page.width : x1);
    return { x: left, y: y, w: right - left, h: h };
  }

  // Put the engine in single-line mode over a given alphabet, and put it back
  // afterwards whatever happened.
  function withAlphabet(worker, alphabet, run) {
    function restore() {
      return Promise.resolve(worker.setParameters({ tessedit_char_whitelist: "" }))
        .then(function () { return OcrOrient.prepare(worker, OcrOrient.PSM_AUTO); })
        .catch(function () {});
    }
    return OcrOrient.prepare(worker, "7")                       // one line of text
      .then(function () { return worker.setParameters({ tessedit_char_whitelist: alphabet }); })
      .then(run)
      .then(function (v) { return restore().then(function () { return v; }); },
            function () { return restore().then(function () { return null; }); });
  }

  /*
   * A VIN read again, on its own terms.
   *
   * It is the densest thing on the page — 17 characters, no word shape for the
   * engine to lean on, in the smallest print on the form — so it is the first
   * thing a tired scan loses. Reading the whole page at once, a washed-out copy
   * gives "W1NKMAGB1SF382775" for "W1NKM4GB9SF382775" (4 read as A, 9 as 1), and
   * a worse one gives nothing at all.
   *
   * So once the page has been read, the row the VIN sits on is read a second
   * time by itself: cropped out, enlarged, and with the engine told two things
   * it cannot work out for itself — that this is a single line, and that a VIN
   * is spelled without I, O or Q. The result only wins if it actually looks
   * like a VIN.
   *
   * When the first read lost the VIN so completely that neither the number nor
   * its own "VIN" label survived, there is no row to go back to. Then the likely
   * rows are tried in turn, and only a reading that passes its own check digit
   * is believed — a guess that cannot check itself is worse than nothing here.
   */
  function refineVin(worker, src, angle, rows) {
    var row = null, i;
    for (i = 0; i < rows.length; i++) if (/\bV\s?I\s?N\b/.test(rows[i].text.toUpperCase())) { row = rows[i]; break; }
    if (!row) for (i = 0; i < rows.length; i++) if (findVinIn(rows[i].text)) { row = rows[i]; break; }

    var page = OcrOrient.render(src, angle, fullEdge(src), 0);
    var targets = row ? [row] : sweepRows(page, rows);
    if (!targets.length) { page.width = page.height = 0; return Promise.resolve(""); }

    var found = [], ti = 0, zi = 0, zooms = [2, 3, 4];
    // A known row is worth three sizes; a sweep is a guess, so each candidate
    // gets one middling size and has to prove itself on the check digit.
    var sweeping = !row;
    function step() {
      if (ti >= targets.length) return Promise.resolve();
      var t = targets[ti], sizes = sweeping ? [3] : zooms;
      if (zi >= sizes.length) { ti++; zi = 0; return step(); }
      var box = rowBox(page, t, null, null);
      if (box.h < 4 || box.w < 4) { ti++; zi = 0; return step(); }
      return readBand(worker, page, box, sizes[zi++]).then(function (text) {
        var v = findVinIn(text);
        if (v && (!sweeping || vinCheckOk(v))) {
          found.push(v);
          if (vinCheckOk(v)) return;                            // a reading that checks out ends it
        }
        return step();
      });
    }
    return withAlphabet(worker, VIN_ALPHABET, step).then(function () {
      page.width = page.height = 0;
      return pickVin(found);
    });
  }
  var sweepRows = FDCore.ro.sweepRows;
  // One that checks out, else the reading the most attempts agreed on.
  function pickVin(found) {
    var i, counts = {}, best = "", n = 0;
    for (i = 0; i < found.length; i++) if (vinCheckOk(found[i])) return found[i];
    for (i = 0; i < found.length; i++) {
      counts[found[i]] = (counts[found[i]] || 0) + 1;
      if (counts[found[i]] > n) { n = counts[found[i]]; best = found[i]; }
    }
    return best;
  }


  /*
   * The small header cells, read again.
   *
   * Mileage and the open date are printed in the same tired dot-matrix as the
   * VIN, into boxes an inch wide, and a scan loses them the same way: the
   * printed label beside them survives ("Mileage In:", "RO Open Date:") while
   * the value next to it comes back empty. On RO 934230 the whole page read
   * "Mileage In: Bus Ph: 13" — the label, then the *next* label, with nothing
   * where the number should be.
   *
   * The label is the handle. Its own word boxes say where it ends, the next
   * label on the row says where the cell stops, and what sits between them is
   * read on its own, enlarged, over just the characters the value can contain.
   */
  var CELLS = {
    mileage: {
      label: /\bMileage\s*(?:In)?\s*/i,
      alphabet: "0123456789,",
      pick: mileageOf,
      ok: function (v) { return /^\d{2,7}$/.test(v); }
    },
    opened: {
      label: /\b(?:R\.?\s?O\.?\s*)?Open\s*Date\s*/i,
      alphabet: "0123456789/-.",
      pick: dateOf,
      ok: function (v) { return /^\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4}$/.test(v); }
    }
  };
  var cellSpan = FDCore.ro.cellSpan;
  // Only the cells the page read left empty, and only when the page's own
  // layout says where they are.
  function refineCells(worker, src, angle, rows, want) {
    var jobs = [], i, k;
    for (i = 0; i < want.length; i++) {
      var spec = CELLS[want[i]];
      if (!spec) continue;
      for (k = 0; k < rows.length; k++) {
        var span = cellSpan(rows[k], spec.label);
        if (span) { jobs.push({ key: want[i], spec: spec, row: rows[k], span: span }); break; }
      }
    }
    if (!jobs.length) return Promise.resolve({});

    var page = OcrOrient.render(src, angle, fullEdge(src), 0);
    var out = {}, ji = 0;
    function step() {
      if (ji >= jobs.length) return Promise.resolve();
      var job = jobs[ji++], spec = job.spec;
      // Tight to the row: the box's own rules sit just above and below it, and
      // in single-line mode a rule read as a row of dashes is what comes back
      // instead of the number.
      var box = rowBox(page, job.row, job.span.x0, job.span.x1, 0.12);
      if (box.w < 4 || box.h < 4) return step();
      // Unlike a VIN, a mileage carries no way of checking itself. Reading it
      // twice and demanding the two agree was tried and does not tell the
      // difference: on one scan two sizes agreed on a wrong number, and on
      // another they disagreed over a right one. So the first reading that is
      // the right shape is taken, and the review says where it came from — the
      // person approving the scan has the paper in front of them.
      var zooms = [3, 5], zi = 0;
      function tryZoom() {
        if (zi >= zooms.length) return Promise.resolve();
        return readBand(worker, page, box, zooms[zi++], true).then(function (text) {
          var v = spec.pick(text);
          if (v && spec.ok(v)) { out[job.key] = v; return; }
          return tryZoom();
        });
      }
      // Each cell holds one kind of character, so each is read over its own
      // alphabet rather than all of them over a shared one.
      return withAlphabet(worker, spec.alphabet, tryZoom).then(step);
    }
    return step().then(function () {
      page.width = page.height = 0;
      return out;
    }, function () {
      page.width = page.height = 0;
      return out;
    });
  }
  // Read every page. The first page decides which way up the batch is (pages of
  // one RO go through the scanner the same way), and the rest follow it — the
  // probe is the expensive part, so it is paid once.
  function ocrSources(sources, status, progress, cancelled) {
    if (!sources.length) return Promise.resolve({ text: "", rows: [] });
    return FDServices.tess.createWorker("eng", {
      logger: function (m) { if (m && m.status === "recognizing text" && progress) progress(m.progress || 0); }
    }).then(function (worker) {
      var texts = [], rows = [], angle = 0, i = 0;
      function readOne() {
        if (i >= sources.length || (cancelled && cancelled())) return Promise.resolve();
        var src = sources[i], n = i + 1;
        var label = sources.length > 1 ? " (page " + n + " of " + sources.length + ")" : "";
        var opts = {
          readEdge: fullEdge,
          onStatus: function (m) { status(m.replace(/…$/, "") + label + "…"); },
          cancelled: cancelled,
          onDone: function (d) { lastScan = d; }
        };
        // Page 1 works out which way up the batch is; the rest follow it.
        // Scanning an RO is a deliberate, once-per-job action, so it always
        // pays for the probe rather than settling for whatever a first read
        // gives: an upright page costs one extra band read (the probe stops as
        // soon as a rotation reads well), a sideways one two or three.
        var orient = window.OcrOrient;
        var p = !orient
          ? (status("Reading the page" + label + "…"),
             worker.recognize(src).then(function (r) { return { text: (r && r.data && r.data.text) || "", angle: 0 }; }))
          : i === 0 ? orient.readUpright(worker, src, opts)
            : orient.readAt(worker, src, angle, opts);
        return p.then(function (res) {
          if (i === 0) angle = res.angle;
          texts.push(res.text);
          rows.push(rowsFromData(res.data));   // where each row sat — the line table needs it
          i++;
          return readOne();
        });
      }
      return readOne().then(function () {
        if (cancelled && cancelled()) return { vin: "", cells: {} };
        status("Taking a closer look at the VIN…");
        return refineVin(worker, sources[0], angle, rows[0] || []).catch(function () { return ""; })
          .then(function (vin) {
            // What the page gave up decides what is worth going back for: a
            // second look at a cell costs a read apiece, so only the cells that
            // came back empty are paid for.
            var draft = parseScan(texts.join("\n"), rows, { vin: vin });
            var want = [];
            if (!draft.mileage) want.push("mileage");
            if (!draft.opened) want.push("opened");
            if (!want.length || (cancelled && cancelled())) return { vin: vin, cells: {} };
            status("Taking a closer look at the header…");
            return refineCells(worker, sources[0], angle, rows[0] || [], want)
              .then(function (cells) { return { vin: vin, cells: cells }; },
                    function () { return { vin: vin, cells: {} }; });
          });
      }).then(function (extra) {
        try { worker.terminate(); } catch (e) {}
        return { text: texts.join("\n"), rows: rows, vin: extra.vin, cells: extra.cells || {} };
      }, function (e) { try { worker.terminate(); } catch (x) {} throw e; });
    });
  }

  // ---------- the scan flow ----------
  var scanFiles = [], review = null, scanning = false, scanDropped = false, lastScan = null;
  var RV = [["#rv-ro", "ro"], ["#rv-tag", "tag"], ["#rv-vehicle", "vehicle"], ["#rv-vin", "vin"], ["#rv-color", "color"],
    ["#rv-mileage", "mileage"], ["#rv-opened", "opened"], ["#rv-advisor", "advisor"], ["#rv-customer", "customer"],
    ["#rv-phone", "phone"], ["#rv-email", "email"]];

  function scanStep(step) {
    $("#scan-pick").hidden = step !== "pick";
    $("#scan-work").hidden = step !== "work";
    $("#scan-review").hidden = step !== "review";
    $("#scan-foot").hidden = step !== "review";
    $("#scan-title").textContent = step === "review" ? "📷 Check what the scan says" : "📷 Scan a repair order";
  }
  function openScan() {
    scanFiles = []; review = null; scanDropped = false;
    $("#scan-err").hidden = true; $("#scan-input").value = "";
    scanStep("pick");
    $("#scan-scrim").classList.add("show"); $("#scan-modal").classList.add("show");
  }
  function closeScan() {
    // Closing mid-read walks away from it: the pages still being recognized are
    // dropped as they finish, and the worker is shut down at the end either way.
    if (scanning) scanDropped = true;
    $("#scan-scrim").classList.remove("show"); $("#scan-modal").classList.remove("show");
    scanFiles = []; review = null;
  }
  function closeModals() { closeScan(); }
  function scanError(msg) {
    scanStep("pick");
    var el = $("#scan-err"); el.textContent = msg; el.hidden = false;
  }
  function scanProgress(frac, label) {
    $("#scan-bar").style.width = Math.max(0, Math.min(1, frac)) * 100 + "%";
    if (label != null) $("#scan-label").textContent = label;
  }

  function startScan(fileList) {
    var files = Array.prototype.slice.call(fileList || []).filter(Boolean)
      .filter(function (f) { return isPdf(f) || /^image\//.test(f.type || "") || /\.(jpe?g|png|webp|bmp|gif|tiff?)$/i.test(f.name || ""); });
    if (!files.length) { scanError("Pick a photo, a scan (JPG / PNG) or a PDF of the repair order."); return; }
    scanFiles = files.slice(0, MAX_SCAN_PAGES);
    scanning = true; scanDropped = false;
    scanStep("work");
    scanProgress(0.04, "Opening the scan…");

    var texts = [], pages = [], sources = [], hints = {}, i = 0;
    var status = function (m) { $("#scan-label").textContent = m; };

    function gather() {
      if (scanDropped || i >= scanFiles.length) return Promise.resolve();
      var f = scanFiles[i++];
      scanProgress(0.05 + 0.15 * (i / scanFiles.length), "Opening " + f.name + "…");
      if (isPdf(f)) {
        return readPdf(f, status).then(function (r) {
          if (r.text) texts.push(r.text);
          (r.rows || []).forEach(function (rows) { pages.push(rows); });
          r.sources.forEach(function (c) { sources.push(c); });
          return gather();
        });
      }
      return bitmapOf(f).then(function (b) { sources.push(b); return gather(); });
    }

    gather().then(function () {
      if (!sources.length) { scanProgress(0.9, "Reading the text…"); return texts.join("\n"); }
      scanProgress(0.25, "Starting the text recognizer…");
      return ocrSources(sources, status, function (p) { scanProgress(0.45 + 0.5 * p); }, function () { return scanDropped; })
        .then(function (ocr) {
          (ocr.rows || []).forEach(function (rows) { pages.push(rows); });
          if (ocr.vin) hints.vin = ocr.vin;
          if (ocr.cells) { if (ocr.cells.mileage) hints.mileage = ocr.cells.mileage; if (ocr.cells.opened) hints.opened = ocr.cells.opened; }
          return texts.concat([ocr.text]).join("\n");
        });
    }).then(function (text) {
      scanProgress(1, "Done.");
      scanning = false;
      if (scanDropped) return;
      var parsed = parseScan(text, pages, hints);
      if (!parsed.ro && !parsed.vin && !parsed.lines.length) {
        scanError("Nothing on that scan reads like a repair order. Try a sharper, straighter photo of the whole page.");
        return;
      }
      showReview(parsed);
    }).catch(function (e) {
      scanning = false;
      if (scanDropped) return;
      console.error(e);
      scanError((e && e.message) || "Couldn't read that scan.");
    });
  }

  function showReview(parsed) {
    review = parsed;
    review.lines = (parsed.lines || []).map(function (l) { return { text: l.text, op: l.op || "", pick: true }; });
    if (parsed.note) review.lines.push({ text: parsed.note, op: "", pick: false, note: true });
    RV.forEach(function (f) {
      var el = $(f[0]);
      el.value = parsed[f[1]] || "";
      el.classList.toggle("found", !!parsed[f[1]]);
    });
    $("#rv-raw").value = parsed.text || "";
    refreshVinWarn();
    showRefined(parsed.refined || []);
    $("#rv-file-wrap").hidden = !embedded;
    renderReviewLines();
    refreshDupe();
    scanStep("review");
  }
  // A cell the page read straight off is one reading; a cell only the close-up
  // pass found is a weaker one, and says so — the person approving the scan has
  // the paper in front of them and can settle it in a glance.
  var REFINED_NAME = { mileage: "mileage", opened: "open date" };
  function showRefined(keys) {
    var names = keys.map(function (k) { return REFINED_NAME[k] || k; });
    var box = $("#rv-cell-warn");
    box.hidden = !names.length;
    if (!names.length) return;
    var list = names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0];
    box.textContent = "The " + list + " " + (names.length > 1 ? "were" : "was") +
      " too faint to read with the rest of the page and had to be read close up — worth a glance against the paper.";
  }
  // A VIN carries its own checksum, so a misread can be pointed out rather than
  // handed over as if it were certain.
  function refreshVinWarn() {
    var v = $("#rv-vin").value.trim().toUpperCase().replace(/\s+/g, "");
    $("#rv-vin-warn").hidden = !(v.length === 17 && !vinCheckOk(v));
  }
  function refreshDupe() {
    var no = $("#rv-ro").value.trim();
    var hit = no ? ros.filter(function (r) { return (r.ro || "").trim() === no; })[0] : null;
    var box = $("#rv-dupe");
    box.hidden = !hit;
    if (hit) box.textContent = "RO " + no + " is already on the list — creating it again would fill in anything it's missing and add any new lines.";
    $("#rv-create").textContent = hit ? "Update RO " + no : "Create repair order";
  }
  function renderReviewLines() {
    var box = $("#rv-lines"); box.innerHTML = "";
    if (!review.lines.length) { box.innerHTML = '<div class="rv-empty">No lines were read off this scan — add them by hand once the RO exists.</div>'; return; }
    var seen = 0;
    review.lines.forEach(function (ln, i) {
      var row = document.createElement("div"); row.className = "rv-line";
      var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!ln.pick;
      cb.title = "Put this on the repair order";
      cb.onchange = function () { ln.pick = cb.checked; renderReviewLines(); };
      var lab = document.createElement("div"); lab.className = "rv-line__label";
      lab.textContent = ln.pick ? "Line " + letter(seen++) : (ln.note ? "note" : "—");
      var op = document.createElement("input"); op.type = "text"; op.value = ln.op || ""; op.placeholder = "OP";
      op.spellcheck = false; op.maxLength = 10;
      op.addEventListener("input", function () { ln.op = op.value.toUpperCase(); });
      var ta = document.createElement("textarea"); ta.value = ln.text || ""; ta.spellcheck = true;
      ta.addEventListener("input", function () { ln.text = ta.value; });
      var del = document.createElement("button"); del.className = "btn btn--sm btn--danger"; del.textContent = "✕"; del.title = "Drop this line";
      del.onclick = function () { review.lines.splice(i, 1); renderReviewLines(); };
      row.append(cb, lab, op, ta, del);
      box.append(row);
    });
  }

  function createFromReview() {
    if (!review) return;
    var vals = {};
    RV.forEach(function (f) { vals[f[1]] = squash($(f[0]).value); });
    vals.vin = vals.vin.toUpperCase().replace(/\s+/g, "");
    var picked = review.lines.filter(function (l) { return l.pick; })
      .map(function (l) { return { id: uid(), text: squash(l.text), op: squash(l.op).toUpperCase() }; })
      .filter(function (l) { return l.text || l.op; });
    var norm = function (s) { return squash(s).toUpperCase(); };
    flushSave(); // a pending field edit commits before the scan tops the record up
    var existing = vals.ro ? ros.filter(function (r) { return (r.ro || "").trim() === vals.ro; })[0] : null;
    var rec, added = 0;

    if (existing) {
      // Filling a gap is safe; overwriting what someone typed is not.
      FIELDS.forEach(function (f) { if (!squash(existing[f[1]]) && vals[f[1]]) existing[f[1]] = vals[f[1]]; });
      existing.lines = existing.lines || [];
      var have = existing.lines.map(function (l) { return norm(l.text); });
      picked.forEach(function (l) { if (have.indexOf(norm(l.text)) === -1) { existing.lines.push(l); have.push(norm(l.text)); added++; } });
      // A blank starter line just gets in the way once real ones arrive.
      existing.lines = existing.lines.filter(function (l) { return squash(l.text) || squash(l.op); });
      existing.scanText = review.text || existing.scanText || "";
      existing.updatedAt = Date.now();
      rec = existing;
    } else {
      rec = blankRO();
      FIELDS.forEach(function (f) { rec[f[1]] = vals[f[1]] || ""; });
      rec.lines = picked.length ? picked : [{ id: uid(), text: "", op: "" }];
      rec.scanText = review.text || "";
      ros.push(rec);
      added = picked.length;
    }

    var attach = $("#rv-file").checked ? scanFiles.slice() : [];
    roPut(rec).then(function () {
      current = rec;
      // The scanner's reading of the VIN is recorded with its check-digit
      // verdict; only a technician's ✓ Confirm VIN marks it confirmed.
      noteVehicle(rec.vin, "ro-scan").then(function () { if (current === rec) paintVin(); });
      renderList(); paint();
      toast(existing
        ? "RO " + (rec.ro || "") + " updated from the scan — " + added + " new line" + (added === 1 ? "" : "s") + "."
        : "Repair order created from the scan — " + added + " line" + (added === 1 ? "" : "s") + ".");
      closeScan();
      if (attach.length) addFiles(attach);
    }, function (e) {
      if (!existing) ros = ros.filter(function (x) { return x !== rec; });
      if (isRoConflict(e)) toast("RO " + (rec.ro || "").trim() + " is already used" + (e.other && e.other.deletedAt ? " by a repair order in the trash — restore it from 🗑️ Trash." : " by another repair order."));
      else toast("Couldn't save — " + ((e && e.message) || e));
    });
  }

  // ---------- wire ----------
  function wire() {
    $("#new-btn").onclick = newRO;
    $("#scan-btn").onclick = openScan;
    $("#scan-btn-empty").onclick = openScan;
    $("#side-toggle").onclick = function () { $("#side").classList.toggle("show"); };
    FIELDS.forEach(function (f) { $(f[0]).addEventListener("input", scheduleSave); });
    $("#add-line-btn").onclick = function () { if (!current) return; (current.lines = current.lines || []).push({ id: uid(), text: "", op: "" }); renderLines(); scheduleSave(); var tas = root.querySelectorAll("#lines textarea"); if (tas.length) tas[tas.length - 1].focus(); };
    $("#delete-btn").onclick = deleteRO;
    $("#add-btn").onclick = function () { $("#file-input").click(); };
    $("#file-input").addEventListener("change", function (e) { addFiles(e.target.files); e.target.value = ""; });
    $("#open-vault-btn").onclick = openInVault;
    $("#import-btn").onclick = selectInVault;
    $("#trash-toggle").onclick = function () { flushSave(); showTrash = !showTrash; loadTrash().then(renderList); };
    $("#ref-add").onclick = addRef;
    $("#ref-input").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addRef(); } });
    $("#vin-confirm").onclick = function () {
      if (!current) return;
      var v = (current.vin || "").trim().toUpperCase();
      var yes = !$("#vin-confirm").dataset.confirmed;
      R().vehicles.confirm(v, yes).then(paintVin, function (e) { toast("Couldn't record that — " + ((e && e.message) || e)); });
    };
    $("#vin-open").onclick = function () {
      if (!current || !current.vin) return;
      try { shell.send({ type: "shell-vehicle", vin: current.vin.trim().toUpperCase() }); } catch (e) {}
    };
    // The VIN line is repainted once the edit is saved.
    $("#ro-vin").addEventListener("input", function () { $("#vin-status").hidden = true; });
    var dz = $("#dropz");
    dz.onclick = function () { $("#file-input").click(); };
    ["dragenter", "dragover"].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); dz.classList.add("drag"); }); });
    ["dragleave", "drop"].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); dz.classList.remove("drag"); }); });
    dz.addEventListener("drop", function (e) { if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
    // Scan modal
    $("#scan-close").onclick = closeScan;
    $("#scan-scrim").onclick = closeScan;
    $("#rv-cancel").onclick = closeScan;
    $("#rv-create").onclick = createFromReview;
    $("#rv-ro").addEventListener("input", refreshDupe);
    $("#rv-vin").addEventListener("input", refreshVinWarn);
    $("#rv-add-line").onclick = function () { if (!review) return; review.lines.push({ text: "", op: "", pick: true }); renderReviewLines(); };
    var sd = $("#scan-drop");
    sd.onclick = function () { $("#scan-input").click(); };
    $("#scan-input").addEventListener("change", function (e) { startScan(e.target.files); e.target.value = ""; });
    ["dragenter", "dragover"].forEach(function (ev) { sd.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); sd.classList.add("drag"); }); });
    ["dragleave", "drop"].forEach(function (ev) { sd.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); sd.classList.remove("drag"); }); });
    sd.addEventListener("drop", function (e) { if (e.dataTransfer && e.dataTransfer.files.length) startScan(e.dataTransfer.files); });
        window.addEventListener("focus", refreshFiles);
    root.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeModals(); $("#del-scrim").classList.remove("show"); $("#del-modal").classList.remove("show"); } });
  }

  // ---------- platform embedding ----------
  function receive(d) {
    d = d || {};
    if (d.type === "shell-nav" && d.id) openRO(d.id);
  }

  function boot() {
    wire();
    open().then(function () {
      // Changes from elsewhere refresh what is on screen. Files and links are
      // written by the Files feature on the same page too (moving a file to an
      // RO, renaming, deleting), so every such event refreshes the attachment
      // list; RO records are only ever written here, so for those only another
      // tab's edits count (a reload mid-typing would clobber the field).
      var filesT = null, rosT = null, refsT = null;
      function onFiles(d) { clearTimeout(filesT); filesT = setTimeout(refreshFiles, 200); }
      FDData.bus.on("files:changed", onFiles);
      FDData.bus.on("links:changed", function () { onFiles(); clearTimeout(refsT); refsT = setTimeout(renderRefs, 200); });
      FDData.bus.on("documents:changed", function () { clearTimeout(refsT); refsT = setTimeout(renderRefs, 200); });
      FDData.bus.on("vehicles:changed", function () { paintVin(); });
      FDData.bus.on("ros:changed", function (d) {
        if (!d.remote) return;
        clearTimeout(rosT);
        rosT = setTimeout(function () {
          Promise.all([roAll(), loadTrash()]).then(function (r) {
            var recs = r[0];
            ros = recs || [];
            if (current) { var c = ros.filter(function (x) { return x.id === current.id; })[0]; current = c || null; }
            renderList(); paint();
          });
        }, 200);
      });
      return loadTrash().then(roAll);
    }).then(function (recs) {
      ros = recs || [];
      ros.forEach(function (r) {
        var changed = false;
        // migrate the old single notes field into the first story line
        if (!r.lines) { r.lines = (r.notes && r.notes.trim()) ? [{ id: uid(), text: r.notes }] : []; changed = true; }
        FIELDS.forEach(function (f) { if (typeof r[f[1]] !== "string") { r[f[1]] = ""; changed = true; } });
        if (changed) roPut(r).catch(function () {});
      });
      renderList();
      if (ros.length) openRO(ros.slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); })[0].id);
      else { current = null; paint(); }
    }).catch(function () { current = null; paint(); });
  }
  boot();

  window.__ros = {
    count: function () { return ros.length; },
    get current() { return current; },
    refreshFiles: refreshFiles,
    // Exposed so the scan parser can be exercised on raw text (E2E suite).
    parseScan: parseScan,
    layoutLines: layoutLines,
    itemsToRows: itemsToRows,
    vinCheckOk: vinCheckOk,
    cellSpan: cellSpan,
    sweepRows: sweepRows,
    reviewText: function (t) { openScan(); showReview(parseScan(t)); },
    // What the which-way-up probe decided on the last scan {angle, tried}.
    get lastScan() { return lastScan; }
  };

  return { receive };
}

