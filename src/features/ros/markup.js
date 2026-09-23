/* Repair Orders — the panel markup (what used to be the page's <body>; REWRITE-PLAN.md Phase 4). */
export default `
<div class="app">
  <aside class="side" id="side">
    <div class="side__head">
      <h1>🧾 Repair Orders</h1>
      <button class="icon-btn" id="scan-btn" title="Scan a paper RO and fill one in automatically">📷</button>
      <button class="icon-btn" id="new-btn" title="New repair order">＋</button>
    </div>
    <div class="side__list" id="list"></div>
    <button class="side__trash" id="trash-toggle" type="button" title="Deleted repair orders — restore them, or delete them for good">🗑️ Trash <span id="trash-count"></span></button>
  </aside>

  <main class="main">
    <div class="main__inner" id="inner" hidden>
      <button class="btn btn--sm side-toggle" id="side-toggle" style="margin-bottom:12px">☰ Repair orders</button>

      <div class="fields">
        <div class="field">
          <label for="ro-no">RO number</label>
          <input id="ro-no" placeholder="e.g. 1234567" autocomplete="off" spellcheck="false" />
        </div>
        <div class="field">
          <label for="ro-vehicle">Vehicle</label>
          <input id="ro-vehicle" placeholder="e.g. 2021 GLC 300" autocomplete="off" />
        </div>
        <div class="field wide">
          <label for="ro-vin">VIN (files added here auto-fill this VIN when they don't have one)</label>
          <input id="ro-vin" placeholder="e.g. W1N0G8DB0MV000000" autocomplete="off" spellcheck="false" autocapitalize="characters" />
          <div class="vin-status" id="vin-status" hidden>
            <span id="vin-status-text"></span>
            <button class="btn btn--sm" id="vin-confirm" type="button" title="You checked this VIN against the car">✓ Confirm VIN</button>
            <button class="btn btn--sm" id="vin-open" type="button" title="Everything about this vehicle — its files, repair orders, LI documents and tools">🚗 Vehicle</button>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>🚗 Vehicle &amp; customer</h3>
        <div class="fields" style="margin-bottom:0">
          <div class="field">
            <label for="ro-tag">Tag</label>
            <input id="ro-tag" placeholder="e.g. T7910" autocomplete="off" spellcheck="false" />
          </div>
          <div class="field">
            <label for="ro-mileage">Mileage in</label>
            <input id="ro-mileage" placeholder="e.g. 15258" autocomplete="off" spellcheck="false" inputmode="numeric" />
          </div>
          <div class="field">
            <label for="ro-color">Color</label>
            <input id="ro-color" placeholder="e.g. Silver" autocomplete="off" />
          </div>
          <div class="field">
            <label for="ro-opened">Opened</label>
            <input id="ro-opened" placeholder="e.g. 08-31-26" autocomplete="off" spellcheck="false" />
          </div>
          <div class="field">
            <label for="ro-customer">Customer</label>
            <input id="ro-customer" placeholder="e.g. Jill Blue" autocomplete="off" />
          </div>
          <div class="field">
            <label for="ro-advisor">Service advisor</label>
            <input id="ro-advisor" placeholder="e.g. Johnson, Brandon" autocomplete="off" />
          </div>
          <div class="field">
            <label for="ro-phone">Phone</label>
            <input id="ro-phone" placeholder="e.g. 678-979-7260" autocomplete="off" spellcheck="false" />
          </div>
          <div class="field">
            <label for="ro-email">E-mail</label>
            <input id="ro-email" placeholder="e.g. name@example.com" autocomplete="off" spellcheck="false" />
          </div>
        </div>
      </div>

      <div class="card">
        <h3>📝 Stories / repairs <span class="grow"></span><span class="save-note" id="save-note"></span>
          <button class="btn btn--sm" id="add-line-btn">＋ Add line</button>
        </h3>
        <div id="lines"></div>
      </div>

      <div class="card">
        <h3>📚 LI documents &amp; tools used <span class="grow"></span></h3>
        <p class="refs-hint">Pin the exact LI version and the special tools this job used. A later import of a newer version shows up here without changing what was used.</p>
        <div class="refs-add">
          <input id="ref-input" placeholder="LI number (e.g. LI54.10-P-070001) or tool number (e.g. 000 589 01 23 00)" autocomplete="off" spellcheck="false" />
          <button class="btn btn--sm btn--primary" id="ref-add" type="button">Pin</button>
        </div>
        <div class="refs" id="refs"></div>
      </div>

      <div class="card">
        <h3>📎 Files <span class="grow"></span>
          <button class="btn btn--sm" id="import-btn" title="Import files that are already in the Vault">⬇ Import from Vault</button>
          <button class="btn btn--sm" id="open-vault-btn" title="Open these files in the File Vault">Open in Vault ↗</button>
          <button class="btn btn--sm btn--primary" id="add-btn">＋ Add files</button>
        </h3>
        <div id="add-banner" class="banner" hidden>Open Repair Orders inside the <b>File Database</b> app to attach files (they're saved in Files and attached to this RO).</div>
        <div class="dropz" id="dropz">Drop files here, or click to browse — they're saved in Files and attached to this RO.</div>
        <input type="file" id="file-input" multiple hidden />
        <div class="files" id="files"></div>
      </div>

      <button class="btn btn--sm btn--danger" id="delete-btn">🗑 Delete this repair order</button>
    </div>

    <div class="empty-main" id="empty-main">
      <div>
        <h2>No repair order open</h2>
        <p>Pick one on the left, or click ＋ to start a new repair order.</p>
        <p><button class="btn btn--primary" id="scan-btn-empty">📷 Scan a paper RO</button></p>
        <p style="font-size:12.5px;max-width:420px;margin:0 auto">Photograph or scan the printed repair order — the number, vehicle, VIN, customer and every line are read off it and filled in for you.</p>
      </div>
    </div>
  </main>
</div>

<!-- VIN mismatch prompt (uploads) -->
<div class="scrim" id="mm-scrim"></div>
<div class="modal" id="mm-modal" role="dialog" aria-label="VIN mismatch">
  <div class="modal__head"><h2>⚠ VIN doesn't match this RO</h2></div>
  <div class="modal__body">
    <div class="mm-note" id="mm-note"></div>
    <div id="mm-list"></div>
  </div>
  <div class="modal__foot">
    <button class="btn btn--sm" id="mm-ignore">Ignore these</button>
    <button class="btn btn--sm btn--primary" id="mm-add">Add anyway</button>
  </div>
</div>

<!-- Delete a repair order: what happens to its files -->
<div class="scrim" id="del-scrim"></div>
<div class="modal" id="del-modal" role="dialog" aria-label="Delete repair order">
  <div class="modal__head"><h2 id="del-title">🗑 Delete repair order</h2></div>
  <div class="modal__body">
    <p class="del-note" id="del-note"></p>
    <label class="del-opt"><input type="radio" name="del-files" value="keep" checked /> <span><b>Keep the files attached</b> — restoring the RO brings them back with it</span></label>
    <label class="del-opt"><input type="radio" name="del-files" value="unlink" /> <span><b>Unlink the files</b> — they stay in Files, attached to nothing</span></label>
    <label class="del-opt"><input type="radio" name="del-files" value="trash" /> <span><b>Move the files to the trash too</b> — except any another repair order still uses</span></label>
  </div>
  <div class="modal__foot">
    <button class="btn btn--sm" id="del-cancel">Cancel</button>
    <button class="btn btn--sm btn--danger" id="del-ok">Move to trash</button>
  </div>
</div>

<!-- Scan a paper RO -->
<div class="scrim" id="scan-scrim"></div>
<div class="modal modal--wide" id="scan-modal" role="dialog" aria-label="Scan a repair order">
  <div class="modal__head"><h2 id="scan-title">📷 Scan a repair order</h2><button class="icon-btn" id="scan-close" title="Close">✕</button></div>
  <div class="modal__body">
    <!-- step 1: pick the scan -->
    <div id="scan-pick">
      <div class="scan-drop" id="scan-drop">
        <b>Drop the scanned RO here, or click to browse</b>
        A photo or scan (JPG / PNG) or a PDF. Pick every page of the same repair order at once — they're read together.
      </div>
      <input type="file" id="scan-input" accept="image/*,application/pdf,.pdf" multiple hidden />
      <p class="scan-hint">Everything is read on this device. Sideways and upside-down scans are straightened automatically. The first scan downloads the text-recognition engine (needs internet once), then it works offline.</p>
      <div class="scan-err" id="scan-err" hidden></div>
    </div>
    <!-- step 2: working -->
    <div id="scan-work" hidden>
      <div class="scan-prog">
        <div class="scan-prog__track"><div class="scan-prog__bar" id="scan-bar"></div></div>
        <div class="scan-prog__label" id="scan-label">Reading…</div>
      </div>
    </div>
    <!-- step 3: review what was read -->
    <div id="scan-review" hidden>
      <div class="rv-dupe" id="rv-dupe" hidden></div>
      <div class="rv-sec">Repair order</div>
      <div class="rv-grid">
        <div class="rv-field"><label for="rv-ro">RO number</label><input id="rv-ro" autocomplete="off" spellcheck="false" /></div>
        <div class="rv-field"><label for="rv-tag">Tag</label><input id="rv-tag" autocomplete="off" spellcheck="false" /></div>
        <div class="rv-field wide"><label for="rv-vehicle">Vehicle</label><input id="rv-vehicle" autocomplete="off" /></div>
        <div class="rv-field wide"><label for="rv-vin">VIN</label><input id="rv-vin" autocomplete="off" spellcheck="false" autocapitalize="characters" /><div class="rv-warn" id="rv-vin-warn" hidden>This VIN doesn't pass its own check digit — the scan probably misread a character. Worth checking against the car.</div></div>
        <div class="rv-field"><label for="rv-color">Color</label><input id="rv-color" autocomplete="off" /></div>
        <div class="rv-field"><label for="rv-mileage">Mileage in</label><input id="rv-mileage" autocomplete="off" spellcheck="false" /></div>
        <div class="rv-field"><label for="rv-opened">Opened</label><input id="rv-opened" autocomplete="off" spellcheck="false" /></div>
        <div class="rv-warn rv-field wide" id="rv-cell-warn" hidden></div>
        <div class="rv-field"><label for="rv-advisor">Service advisor</label><input id="rv-advisor" autocomplete="off" /></div>
        <div class="rv-field"><label for="rv-customer">Customer</label><input id="rv-customer" autocomplete="off" /></div>
        <div class="rv-field"><label for="rv-phone">Phone</label><input id="rv-phone" autocomplete="off" spellcheck="false" /></div>
        <div class="rv-field wide"><label for="rv-email">E-mail</label><input id="rv-email" autocomplete="off" spellcheck="false" /></div>
      </div>
      <div class="rv-sec">Lines <span class="grow"></span><button class="btn btn--sm" id="rv-add-line">＋ Add line</button></div>
      <div id="rv-lines"></div>
      <details class="rv-raw">
        <summary id="rv-raw-sum">Everything the scan read</summary>
        <textarea id="rv-raw" spellcheck="false" readonly></textarea>
      </details>
    </div>
  </div>
  <div class="modal__foot" id="scan-foot" hidden>
    <label class="rv-check" id="rv-file-wrap"><input type="checkbox" id="rv-file" checked /> Also file the scan under this RO</label>
    <button class="btn btn--sm" id="rv-cancel">Cancel</button>
    <button class="btn btn--sm btn--primary" id="rv-create">Create repair order</button>
  </div>
</div>

<div id="toast"></div>
`;
