/* Extract — the panel markup (what used to be the page's <body>; REWRITE-PLAN.md Phase 4). */
export default `
<div class="wrap">
  <h1>🔓 Database File Viewer</h1>
  <p class="sub">Open a File Database backup and get your files back out as <b>normal files</b> —
  no app needed, works offline. Supports <b>.fvault</b> (Files), <b>.lidb</b> (LI Documents)
  and <b>.tidb</b> (Tool Inventory). Nothing is uploaded; everything happens on this computer.</p>

  <div class="drop" id="drop">
    <div class="big">Drop a .fvault / .lidb / .tidb file here</div>
    <div class="hint">or click to choose one</div>
  </div>
  <input type="file" id="pick" accept=".fdb,.fvault,.lidb,.tidb,.json,.zip" hidden />
  <div class="progress" id="status" hidden></div>

  <div id="result" hidden>
    <div class="summary">
      <span class="kind" id="kindLabel"></span>
      <span class="muted" id="countLabel"></span>
      <span class="spacer"></span>
      <button class="btn" id="folderBtn" hidden title="Writes every file straight into a folder you pick — no ZIP, no big download">📂 Save all to a folder…</button>
      <button class="btn btn-ghost" id="zipBtn">⬇ Download all as ZIP</button>
      <button class="btn btn-ghost" id="resetBtn">Open another file</button>
    </div>
    <div class="progress" id="progress"></div>
    <div id="tablewrap"><table>
      <thead><tr><th>File</th><th>Type</th><th class="num">Size</th><th></th></tr></thead>
      <tbody id="rows"></tbody>
    </table></div>
  </div>

  <p class="foot">This page is part of <b>File Database</b> but depends on nothing else — keep a copy
  of <code>viewer.html</code> next to your backups and your data is always recoverable.
  Large backups: the ZIP is assembled from the source file on disk, so even multi-GB
  vaults extract without filling memory (4 GB per ZIP is the format's limit — beyond
  that, use the per-file download links).</p>
</div>
`;
