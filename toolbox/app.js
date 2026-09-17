/* ===== Toolbox page: tab switching and File Database platform integration (moved out of toolbox/index.html, REWRITE-PLAN.md Phase 3) ===== */

/* ===== Tab switching ===== */
(function(){
  var tabs=document.querySelectorAll('.tab');
  var tools=document.querySelectorAll('.tool');
  tabs.forEach(function(t){
    t.addEventListener('click',function(){
      var id=t.getAttribute('data-tab');
      tabs.forEach(function(x){ x.classList.toggle('active', x===t); });
      tools.forEach(function(s){ s.classList.toggle('active', s.id==='tool-'+id); });
    });
  });

  // Programmatic tab activation — clicks the real button so every .active side effect runs.
  window.__openTab = function(key){
    if (typeof key !== 'string' || !/^[a-z0-9-]+$/.test(key)) return;
    var btn = document.querySelector('.tab[data-tab="'+key+'"]');
    if (btn) btn.click();
  };

  // Deep link: "#<key>" or "#tab=<key>".
  var h = (location.hash || '').replace(/^#/, '');
  if (h.indexOf('tab=') === 0) h = h.slice(4);
  if (h) window.__openTab(h);
})();

/* ===== File Database platform integration ===== */
(function () {
  "use strict";

  // Messages from the shell: open a tool tab / apply the platform theme.
  window.addEventListener("message", function (e) {
    var d = e && e.data;
    if (!d || typeof d !== "object") return;
    if (d.type === "toolbox-open" && d.tab) {
      if (window.__openTab) window.__openTab(d.tab);
    } else if (d.type === "platform-theme") {
      if (d.mode === "light" || d.mode === "dark") document.documentElement.setAttribute("data-theme", d.mode);
      else document.documentElement.removeAttribute("data-theme");
    }
  });

  /* ---- Save to File Vault (snackbar offer after each produced download) ---- */
  var snack = null, snackTimer = null;
  function hideSnack() {
    if (snackTimer) { clearTimeout(snackTimer); snackTimer = null; }
    if (snack && snack.parentNode) snack.parentNode.removeChild(snack);
    snack = null;
  }
  // `blob` may be a function returning the Blob, read when the offer is
  // taken — so a tool whose output is still editable (OCR text) saves what
  // the user corrected, not the first result.
  window.__vaultOffer = function (blob, name) {
    try {
      if (!window.FDData || !blob) return;
      hideSnack();
      snack = document.createElement("div");
      snack.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;align-items:center;gap:12px;max-width:min(92vw,440px);background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);box-shadow:0 10px 30px rgba(0,0,0,.28);padding:12px 14px;font-size:13.5px;color:var(--text);";
      var label = document.createElement("span");
      label.style.cssText = "min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      label.textContent = name;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-ghost";
      btn.style.cssText = "flex:none;white-space:nowrap;";
      btn.textContent = "💾 Save to File Vault";
      btn.addEventListener("click", function () {
        btn.disabled = true;
        FDData.boot().then(function () {
          var b = typeof blob === "function" ? blob() : blob;
          return FDData.intake.ingest("vault", [new File([b], name, { type: b.type || "application/octet-stream" })], { collection: "Toolbox", source: "toolbox" });
        }).then(function (out) {
          if (!out.ids.length) throw new Error((out.results[0] && out.results[0].error) || "not stored");
          label.textContent = "Saved to File Vault ✓";
          if (btn.parentNode) btn.parentNode.removeChild(btn);
          if (snackTimer) clearTimeout(snackTimer);
          snackTimer = setTimeout(hideSnack, 2500);
        }).catch(function () {
          btn.disabled = false;
          label.textContent = "Could not save — " + name;
        });
      });
      snack.appendChild(label);
      snack.appendChild(btn);
      document.body.appendChild(snack);
      snackTimer = setTimeout(hideSnack, 8000);
    } catch (err) { /* an offer must never break the download itself */ }
  };

  /* ---- Receive files sent from the File Vault ---- */
  // A "toolbox-intake" job names stored records (a Files-app selection, or
  // transient copies the platform intake made); their bytes are read from
  // the shared store and injected into the tool's file input as ONE batch,
  // so multi-file tools (PDF merge, media queue) see the whole selection.
  // Transient copies are removed once handed over.
  if (window.FDData) {
    var INPUTS = { media: "m-fileInput", pdf: "pdf-org-file", csv: "v-fileInput", zip: "z-fileInput", img: "g-cv-file", ocr: "o-fileInput" };
    var pickTab = function (f) {
      var t = f.type || "", n = (f.name || "").toLowerCase();
      if (t.indexOf("image/") === 0 || t.indexOf("video/") === 0) return "media";
      if (t === "application/pdf" || /\.pdf$/.test(n)) return "pdf";
      if (/\.csv$/.test(n)) return "csv";
      if (/\.zip$/.test(n) || t === "application/zip") return "zip";
      return "media";
    };
    function injectBatch(items) {
      var groups = {};
      items.forEach(function (x) { (groups[x.tab] = groups[x.tab] || []).push(x.f); });
      Object.keys(groups).forEach(function (tab, i) {
        if (i === 0 && window.__openTab) window.__openTab(tab);
        var files = groups[tab];
        try {
          // The media tool queues extra files itself — append through its hook
          // so a straggler batch can't replace an already-loaded file.
          if (tab === "media" && window.__mediaAddFiles) { window.__mediaAddFiles(files); }
          else {
            var input = document.getElementById(INPUTS[tab]);
            if (!input) throw new Error("no input for tab " + tab);
            var dt = new DataTransfer();
            files.forEach(function (f) { dt.items.add(f); });
            input.files = dt.files;
            input.dispatchEvent(new Event("change", { bubbles: true }));
          }
        } catch (err) { /* a controlled "no tool for this file" still counts as handed over */ }
      });
    }
    function intakeJob(job) {
      var R = FDData.repos;
      return R.files.getMany(job.inputIds).then(function (recs) {
        var have = recs.filter(Boolean);
        return Promise.all(have.map(function (r) { return R.files.getBlob(r.id); })).then(function (blobs) {
          var items = [], transient = [];
          have.forEach(function (r, i) {
            if (!blobs[i]) return;
            var f = new File([blobs[i]], r.name || "file", { type: r.type || blobs[i].type || "" });
            var tab = (job.meta && job.meta.tab) || pickTab(f);
            if (!INPUTS[tab]) tab = pickTab(f);
            items.push({ f: f, tab: tab });
            if (r.transient && !(job.meta && job.meta.keep)) transient.push(r.id);
          });
          if (items.length) injectBatch(items);
          return transient.length ? R.files.removeManyFull(transient) : null;
        });
      });
    }
    FDData.boot().then(function () { FDData.jobs.register("toolbox-intake", intakeJob); });
  }
})();

// Platform keyboard parity: Alt+1–4 app switching and Ctrl/Cmd+K quick-open
// forwarded up to the shell, same as the other embedded apps.
(function () {
  "use strict";
  var embedded = false;
  try { embedded = window.parent && window.parent !== window; } catch (e) { embedded = true; }
  if (!embedded) return;
  document.addEventListener("keydown", function (e) {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key >= "1" && e.key <= "9") {
      e.preventDefault();
      try { window.parent.postMessage({ type: "shell-switch", n: +e.key }, "*"); } catch (x) {}
    } else if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      try { window.parent.postMessage({ type: "shell-quickopen" }, "*"); } catch (x) {}
    }
  });
})();

// Spell-check every text field, including ones created after load — flipping
// the flag at focus time covers them all without touching each creation site.
document.addEventListener("focusin", function (e) {
  var t = e.target;
  if (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && (t.type === "text" || t.type === "search"))) t.spellcheck = true;
});
