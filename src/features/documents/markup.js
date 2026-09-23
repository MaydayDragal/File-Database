/* LI Documents — the panel markup (what used to be the page's <body>; REWRITE-PLAN.md Phase 4). */
export default `
<header class="topbar">
  <h1>🗄️ LI Document Database</h1>
  <span class="sub" id="storeInfo"></span>
  <span class="spacer"></span>
  <div class="actions">
    <a class="btn btn-ghost btn-sm" id="backToVault" href="../index.html#vault" title="Back to Files">← Files</a>
    <button class="btn btn-primary" id="importBtn">＋ Import PDFs</button>
    <button class="btn btn-ghost btn-sm" id="exportSelBtn">⬇ Export renamed (ZIP)</button>
    <div class="menu-wrap">
      <button class="btn btn-ghost btn-sm menu-btn" id="menuBtn" title="Menu" aria-haspopup="true" aria-expanded="false">☰ Menu</button>
      <div class="menu" id="appMenu" hidden role="menu">
        <div class="menu-label">Files</div>
        <button class="menu-item" id="syncBtn" title="Link a folder — one click imports any new or changed PDFs from it">📂 Sync folder</button>
        <button class="menu-item" id="autoSyncBtn" title="Automatically re-scan the linked folder every few minutes (while the app is open) and import new PDFs">⏱ Auto-sync: off</button>
        <div class="menu-sep"></div>
        <div class="menu-label">Save &amp; backup</div>
        <button class="menu-item" id="autosaveBtn" title="Automatically save the database to a file you choose (e.g. on a flash drive) after every change">🔄 Auto-save: off</button>
        <button class="menu-item" id="backupBtn">💾 Backup</button>
        <button class="menu-item" id="restoreBtn">↥ Restore</button>
        <div class="menu-sep" id="menuSepInstall"></div>
        <button class="menu-item" id="installBtn" title="Put an app icon on your desktop">📌 Install</button>
        <div class="menu-sep"></div>
        <button class="menu-item" id="debugBtn" title="Errors and warnings recorded on this device (Ctrl+Shift+D)">🐞 Debug log</button>
      </div>
    </div>
  </div>
</header>

<div class="toolbar">
  <label class="search">
    <span class="muted">🔍</span>
    <input type="text" id="search" placeholder="Search LI number, title, function group, or full text…" />
  </label>
  <select id="fgFilter"><option value="">All function groups</option></select>
  <select id="modelFilter" title="Filter by model series (from Validity)"><option value="">All models</option></select>
  <button class="btn btn-ghost btn-sm" id="starFilter" title="Show starred only">☆ Starred</button>
  <button class="btn btn-ghost btn-sm" id="needsFilter" title="Show only documents with missing or suspect fields">⚠ Needs review</button>
  <span class="count" id="count"></span>
  <button class="btn btn-ghost btn-sm" id="rereadAllBtn" title="Re-run the parser over every stored PDF (keeps your hand edits)">↻ Re-read all</button>
  <button class="btn btn-ghost btn-sm" id="selAll">Select all</button>
  <button class="btn btn-danger btn-sm" id="delSel">Delete selected</button>
</div>

<div class="main" id="main">
  <div class="empty" id="empty">
    <div style="font-size:40px">🗄️</div>
    <div style="font-size:17px; font-weight:600; margin:10px 0 4px">Your database is empty</div>
    <div>Click <b>＋ Import PDFs</b> to add your LI documents. They're stored locally in this browser — nothing is uploaded.</div>
  </div>
  <table class="lib" id="table" style="display:none">
    <thead><tr id="head"></tr></thead>
    <tbody id="rows"></tbody>
  </table>
</div>

<!-- Import modal -->
<div class="overlay" id="importOverlay">
  <div class="modal" style="width:min(620px,96vw)">
    <div class="modal-head"><h2>Import LI PDFs</h2><button class="x" data-close>×</button></div>
    <div>
      <div class="drop" id="impDrop">
        <div class="big">Drop PDFs or a folder here, or click to browse</div>
        <div class="sub">Reads the LI number, version, title &amp; text from each file · stored locally · scanned PDFs are OCR&#8209;read automatically</div>
      </div>
      <label class="opt"><input type="checkbox" class="chk" id="optFolder" /> Pick a whole folder (instead of individual files)</label>
      <div class="prog" id="impProg" style="display:none">
        <div class="bar"><div id="impBar"></div></div>
        <div class="prog-label" id="impLabel"></div>
      </div>
    </div>
  </div>
</div>

<!-- Detail modal -->
<div class="overlay" id="detailOverlay">
  <div class="modal big">
    <div class="modal-head">
      <button class="dback" id="dBack" title="Back to the document you came from" style="display:none">← Back</button>
      <h2 id="dTitle">Document</h2>
      <button class="dstar" id="dStar" title="Star this document">☆</button>
      <div class="verpick" id="dVerPick" style="display:none"><span class="muted" style="font-size:12px">Viewing</span><select id="dVerSel"></select></div>
      <button class="x" data-close>×</button>
    </div>
    <div class="modal-body">
      <div class="preview-pane">
        <div class="att-bar" id="dAttBar" style="display:none">
          <span class="att-bar__name" id="dAttBarName"></span>
          <button class="btn btn-ghost btn-sm" id="dAttDownload" title="Save this file">⬇ Download</button>
          <button class="btn btn-ghost btn-sm" id="dAttBack" title="Show the LI document again">← Back to the PDF</button>
        </div>
        <div class="att-view" id="dAttView" style="display:none"></div>
        <iframe id="dFrame" title="PDF preview"></iframe>
      </div>
      <div class="meta-pane">
        <div class="field"><label>Document number</label><input id="dLi" /></div>
        <div class="field"><label>Version</label><input id="dVer" /></div>
        <div class="field"><label>Title</label><textarea id="dTitleIn"></textarea></div>
        <div class="field"><label>Reason for change</label><textarea id="dReason"></textarea></div>
        <div class="field"><label>Function group</label><input id="dFg" /></div>
        <div class="field" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div><label>Date</label><input id="dDate" /></div>
          <div><label>Validity</label><input id="dValid" /></div>
        </div>
        <label class="muted" style="font-size:11px">New filename</label>
        <div class="newname" id="dNewName"></div>
        <div class="copyrow">
          <button class="btn btn-ghost btn-sm" id="dCopyLi" title="Copy the LI document number">📋 LI number</button>
          <button class="btn btn-ghost btn-sm" id="dCopyName" title="Copy the renamed filename">📋 Filename</button>
          <button class="btn btn-ghost btn-sm" id="dCopyLink" title="Copy a link that opens straight to this document">🔗 Link</button>
        </div>
        <div class="meta-actions">
          <button class="btn btn-primary btn-sm" id="dSave">Save</button>
          <button class="btn btn-green btn-sm" id="dDownload">⬇ Renamed</button>
          <button class="btn btn-ghost btn-sm" id="dSendVault" title="Add this document to File Vault">＋ File Vault</button>
          <button class="btn btn-ghost btn-sm" id="dDownloadOrig">Original</button>
          <button class="btn btn-ghost btn-sm" id="dReread" title="Re-extract the fields from the stored PDF (keeps fields you edited by hand)">↻ Re-read PDF</button>
          <button class="btn btn-danger btn-sm" id="dDelete">Delete</button>
        </div>
        <div class="refs" id="dRefs" style="display:none">
          <h3>Referenced documents</h3>
          <div class="refchips" id="dRefChips"></div>
        </div>
        <div class="refs" id="dXApps" style="display:none">
          <h3>Special tools</h3>
          <div class="refchips" id="dXAppChips"></div>
        </div>
        <div class="refs" id="dAtt">
          <h3>📎 Files in this PDF <span class="att-count" id="dAttCount"></span></h3>
          <div class="att-list" id="dAttList"></div>
          <div class="att-list att-links" id="dAttLinks" style="display:none"></div>
        </div>
        <div class="cmp" id="dCmp" style="display:none">
          <h3>Compare versions</h3>
          <div class="row2"><select id="dCmpA"></select><span class="muted">→</span><select id="dCmpB"></select></div>
          <button class="btn btn-ghost btn-sm" id="dCmpGo">🔍 Show differences</button>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Install overlay -->
<div class="overlay" id="installOverlay">
  <div class="modal" style="width:min(620px,96vw)">
    <div class="modal-head"><h2>📌 Install as a desktop app</h2><button class="x" data-close>×</button></div>
    <div style="padding:18px; font-size:13.5px; line-height:1.65; overflow:auto">
      <p style="margin-top:0">Get an <b>“LI Document Database”</b> icon on your desktop that opens in its own
      app window — no admin rights needed.</p>
      <h3 class="inst-h">Option 1 — desktop shortcut <span class="muted" style="font-weight:400">(nothing to download; works on locked-down PCs)</span></h3>
      <ol style="padding-left:20px; margin:6px 0 8px">
        <li>Right-click an empty spot on your desktop → <b>New → Shortcut</b>.</li>
        <li>Paste this as the location:
          <div class="cmdrow"><input id="installCmd" readonly /><button class="btn btn-ghost btn-sm" id="installCopy">📋 Copy</button></div></li>
        <li>Click <b>Next</b>, name it <b>LI Document Database</b>, click <b>Finish</b>.</li>
        <li><b>Give it the app icon:</b> <button class="btn btn-ghost btn-sm" id="installIco">⬇ Download icon (.ico)</button>
          — save it <b>next to index.html</b>, then right-click the new shortcut →
          <b>Properties → Change Icon… → Browse</b> and pick <b>LI-Database.ico</b>.</li>
      </ol>
      <div class="muted" style="font-size:12.5px">Tip: to hide the brief black window at launch, right-click the new
      shortcut → <b>Properties</b> → set <b>Run</b> to <b>Minimized</b>.</div>
      <h3 class="inst-h">Option 2 — install with Edge</h3>
      <div>Open this file in <b>Microsoft Edge</b>, then <b>⋯ → Apps → Install this site as an app</b>.<br>
      <span class="muted" style="font-size:12.5px">Edge keeps its own separate copy of the database — use 🔄 Auto-save or
      💾 Backup / ↥ Restore to move your documents across once.</span></div>
      <h3 class="inst-h">Option 3 — automatic installer</h3>
      <div><button class="btn btn-ghost btn-sm" id="installDl">⬇ Download installer (.bat)</button><br>
      <span class="muted" style="font-size:12.5px">Some work PCs block downloaded scripts (“Your Internet security
      settings prevented these files from being opened”) — if you see that, use Option 1.</span></div>
      <p class="muted" style="margin:14px 0 0; font-size:12.5px">If you later move <b>index.html</b> to a
      different folder, redo the install so the icon points at the new location.</p>
    </div>
  </div>
</div>

<!-- Diff overlay -->
<div class="overlay" id="diffOverlay">
  <div class="modal big">
    <div class="modal-head"><h2 id="diffTitle">Differences</h2>
      <div class="seg"><button id="diffModePages" class="on">Pages</button><button id="diffModeText">Text</button></div>
      <button class="x" id="diffClose" style="margin-left:0">×</button></div>
    <div style="padding:16px; overflow:hidden; flex:1; min-height:0; display:flex; flex-direction:column">
      <div class="diff-sum" id="diffSum"></div>
      <div class="vdiff" id="vDiff">
        <div class="vcol"><div class="vhead" id="vHeadA"></div><div class="vscroll" id="vColA"></div></div>
        <div class="vcol"><div class="vhead" id="vHeadB"></div><div class="vscroll" id="vColB"></div></div>
      </div>
      <div class="diff-out" id="diffOut" style="display:none; flex:1; min-height:0"></div>
    </div>
  </div>
</div>

<input type="file" id="fileInput" accept="application/pdf,.pdf" multiple />
<input type="file" id="folderInput" webkitdirectory multiple />
<input type="file" id="restoreInput" accept=".zip,.lidb,application/zip" />

<div class="toast" id="toast"></div>
`;
