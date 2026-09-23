# File Database — Rewrite Action Plan

One application, one data layer, one place to change things.

This plan was written against commit `8bee4fc` on `claude/pwa-file-database-hqbppy`
after reading every source file, the four service workers, the test suite and CI.
Numbers below are measured from that tree, not estimated.

**The recommendation in five lines.** Do not rewrite from scratch. The value in
this codebase is in hard-won heuristics (OCR orientation thresholds, RO table
layout parsing, Mercedes VIN rules, the XENTRY non-breaking-hyphen fold) that were
measured against real paperwork and would be lost. Instead: transplant that logic
verbatim into a single-page application with one IndexedDB database, one event bus,
one service worker and one theme — in six phases, each of which leaves the app
working and shippable.

---

## 1. What is there today (measured)

Six apps run as six same-origin **iframes** under a shell. Each is a separate
page with its own boot, storage, service worker and copy of the platform plumbing.

| App | Entry | App code | Own DB | Own SW | Own manifest |
| --- | --- | ---: | --- | --- | --- |
| Shell | `index.html` + `shell.js` | 604 lines | — (localStorage) | `sw.js` | yes |
| Files (Vault) | `vault/app.js` + `db.js` + 2 helpers | 2,591 + 340 | `file-vault` | `vault/sw.js` | yes |
| LI Documents | `li/index.html` (single file, **2.0 MB**) | ~2,320 | `LIDocsDB` | `li/sw.js` | yes |
| Tool Inventory | `inventory/app.js` | 616 | `tool-inventory` | `inventory/sw.js` | yes |
| Toolbox | `toolbox/index.html` (single file, **2.6 MB**) | ~4,615 | — | (platform) | — |
| Repair Orders | `ros/index.html` (single file) | 1,685 | `repair-orders` | (platform) | — |
| Extract | `viewer.html` (single file) | 517 | — | (platform) | — |

Plus two more databases nobody sees: `vault-bridge` (the file mailbox) and
`fv-debug` (the log). **Six IndexedDB databases, four service workers, four manifests.**

### 1.1 The same plumbing is written six or seven times

| Boilerplate | Copies | Where |
| --- | ---: | --- |
| Theme-before-paint `<script>` snippet | 7 | every HTML page |
| `platform-theme` message handler | 6 | every app |
| `window.parent !== window` "am I embedded" probe | 6 (LI does it 5× internally) | every app |
| Alt+1–9 / Ctrl+K forwarding to the shell | 6 | every app |
| `toast()` | 5 | shell, vault, li, inventory, ros |
| LI document-number regex | 5 literals in 4 files | `shell.js` ×2, `li` , `toolbox`, `vault` |
| `detectLI` / `normLI` / `cleanTitle` parser | 2 full copies | `li/index.html`, `toolbox/index.html` |
| Backup-format readers (`.fvault` `.tidb` `.lidb`) | 2 | apps + `viewer.html` re-implements all three |
| PDF.js main + worker | **3** (≈5 MB) | `vault/vendor/`, inlined in `li`, inlined in `toolbox` |
| JSZip | 2 | inlined in `li` and `toolbox` |

`tools/test-li-number.mjs` has to `lift()` source regions out of the single-file
apps by string markers and `eval` them with stubbed helpers, because the parser
cannot be imported. That is the clearest symptom: the logic has no seams.

### 1.2 Cross-app work goes over three transports and ~30 message types

1. **VaultBridge** (`bridge.js`, 275 lines): an IndexedDB mailbox + BroadcastChannel
   with leases, claims, renewals and retry backoff — engineered carefully, and only
   needed because a file cannot be handed across an iframe boundary as a function call.
2. **`postMessage` through the shell**: 11 inbound types the shell understands,
   ~17 outbound types the apps understand (`FEATURES.md` §9 lists them all).
3. **Read-only IndexedDB peeks**: the shell opens sibling databases with an
   abort-on-upgrade trick to count rows for the tab badges; Repair Orders does
   the same to list a RO's attachments.

The cost shows up as **timing-based coupling**. `ros/index.html` `addFiles()` posts
`shell-add-files`, then polls the Vault's database every 500 ms for up to 8 s to
see whether the files landed, then waits a further 900 ms "to let the no-OCR VIN
detect finish" before reconciling. In one page that is `await vault.ingest(files)`.

### 1.3 Storage is split along app lines, not data lines

- A repair order is linked to its files by the **string** `collection === "RO <number>"`.
  RO numbers are not unique; renaming an RO relays a `vault-rename-collection`
  message to move files by string match.
- **RO records have no backup at all.** "Back up everything" fires three separate
  exports 1.2 s apart and produces three files.
- LI PDFs live in `LIDocsDB.files`; a copy sent to the Vault becomes a second,
  unrelated blob in `file-vault.files`.
- The active vehicle is a `localStorage` key whose scope is broadcast as three
  different filter messages; nothing stores a vehicle.
- `VaultDB.listMeta()` cursors over full records including the Blob to build the
  list — every grid render reads every file's bytes through the IDB cursor.

### 1.4 Offline/PWA is four parallel implementations

Four workers with four cache-name schemes (`platform-shell-v18`, `vault-app-v30`,
`li-db-shell-v3`, `tool-inventory-v9`) and four precache lists maintained by hand.
`sw.js` has been edited in 17 commits — nearly every feature commit has to touch a
precache list and bump a cache name, and three commits exist only to do that. Opening the platform does not
precache the apps; the README has to tell users to open each tab while online.

### 1.5 The safety net is real but bound to the current shape

25 Playwright suites (`tools/e2e*.mjs`) + 4 Node checks. 8 suites drive the app
through `frameLocator("#frame-…")`; 16 open IndexedDB by its current database
names. Selectors are element IDs (`#results`, `#tbody`, `#search-input`, `#detail`…).
A rewrite that keeps those IDs and moves from frames to one page ports mechanically;
one that renames everything throws the suite away.

**Baseline on `8bee4fc`:** `test:static`, `test:li-number`, `test:backup`,
`test:integrity` and `vendor-pdfjs --check` all pass. The E2E suite was not run
for this plan.

---

## 2. What must not change

These are the project's own commitments (README, FEATURES.md, portable launcher).
Every phase below is checked against them.

1. **Local-first, no backend.** Everything stays in the browser's IndexedDB on the
   same origin. "Backend" in this plan means the storage/data layer, not a server.
2. **Serve the checked-in files with no build step** (`python3 -m http.server`,
   GitHub Pages from a branch root). A build is acceptable only where one already
   exists: the portable USB edition (`npm run build:portable`) and vendoring.
3. **Existing user data opens unchanged.** Databases `file-vault`, `LIDocsDB`,
   `tool-inventory`, `repair-orders` must migrate automatically; `.fvault`, `.lidb`,
   `.tidb` backups must keep importing; Extract must keep reading them.
4. **Existing URLs keep working**: `#vault`, `#li/LI54.10-P-070001`,
   `#inventory/group/54`, `#vault/vin/<VIN>`, `#toolbox/pdf`, the manifest
   shortcuts (`?action=add`, `?view=starred`) and the standalone app paths
   `vault/`, `li/`, `inventory/` that people may have installed as PWAs.
5. **Offline after first visit**, including OCR assets once downloaded.
6. **Pinned PDF.js 4.2.67 with `isEvalSupported:false`** on every call site
   (`test-static.mjs` policy), and no CDN for anything but Tesseract.
7. **Behaviour of the parsers and scanners is preserved bit-for-bit** — LI metadata
   extraction, RO scan parsing, VIN/FIN classification, orientation probing.

---

## 3. Target architecture

### 3.1 Shape

One page, no iframes. Features are ES modules mounted into one DOM by a small shell.
Vanilla JS stays (see §8 on frameworks). The directory layout is the map of the app:

```
index.html                  the only page
sw.js                       the only service worker
manifest.webmanifest        the only manifest
src/
  main.js                   boot: open db → migrate → theme → router → mount shell
  shell/                    chrome: tabs, top bar, Add files, Ctrl+K, vehicle chip,
                            toasts, theme toggle, install prompt, badges
  core/                     PURE — no DOM, no IndexedDB, unit-tested in Node
    ids.js                  LI number, VIN, FIN, tool number, model series (ONE copy)
    li-parse.js             LI PDF metadata extraction   ← from li/index.html
    ro-parse.js             RO scan → fields + lines      ← from ros/index.html
    vin.js                  MB_WMI, looksLikeVin, findVinsDetailed ← from vault/app.js
    text.js                 sanitize, cleanTitle, joinWrap, esc, fmtBytes…
    formats/
      container.js          "magic + u32 version + u32 metaLen + JSON + payloads"
                            reader/writer (generalised from vault/backup-format.js)
      fvault.js  lidb.js  tidb.js  fdb.js  zip.js
  data/                     THE BACKEND — the only code that touches IndexedDB
    db.js                   one database, one version, all stores, one upgrade path
    migrate.js              legacy databases → unified schema (runs once)
    repos/                  files.js documents.js tools.js ros.js settings.js log.js
    bus.js                  in-page events + BroadcastChannel mirror for other tabs
    backup.js               one combined backup/restore; legacy importers
  services/                 async machinery shared by features
    pdf.js                  lazy-load vendored PDF.js once; text layer; render page
    ocr.js                  (existing ocr.js, unchanged) + worker pool from LI
    thumbs.js               image/video/PDF thumbnails       ← from vault/app.js
    intake.js               the unified "Add files" router  ← from shell.js routeFiles
    folder-sync.js          linked-folder import             ← Vault + LI copies merged
    downloads.js            save-as / folder download with read-back verify
  features/                 one folder per tab; each exports {route, mount, intake?, backup?}
    files/      documents/      inventory/      ros/      extract/
    toolbox/    zip/ media/ ocr/ convert/ elec/ text/ calc/ csv/ img/ pdf/
  ui/                       shared components: toast, menu, dialog, table, chips,
                            drop-zone, empty-state, progress
  styles/
    tokens.css              ONE theme (light/dark), the 13 tokens shell+vault already share
    base.css  shell.css  per-feature .css
vendor/                     pdf.min.js pdf.worker.min.js jszip.min.js pdf-lib.min.js
                            — real files, loaded on demand, never inlined again
tools/                      build-portable (esbuild), vendor-pdfjs, sw-manifest check
tests/
  unit/                     node:test — core/, data/ (with fake-indexeddb)
  e2e/                      Playwright suites (ported from tools/e2e*.mjs)
  fixtures/
```

Every feature module has the same six optional exports, and the shell only ever
calls those:

```js
export const route   = { key: "li", title: "LI Documents", icon: "🗄️", badge: () => documents.count() };
export function mount(el)            // render into the panel once; return { show(), hide(), navigate(sub) }
export const schema  = { stores: {…}, migrations: […] }                              // the stores this feature owns
export const intake  = { accepts(file) → boolean, ingest(files, opts) → Promise }   // optional
export const search  = { query(q, ctx) → results[] }                                  // optional; feeds Ctrl+K
export const backup  = { collect() → entries, restore(entries) }                     // optional
```

`features/index.js` is a static list; a unit test validates it (unique keys, every
`schema` store declared once, no feature importing another's private module).

Adding a seventh tab is one folder plus one line in `features/index.js`.

### 3.2 Cross-feature calls replace the three transports

| Today | Target |
| --- | --- |
| `VaultBridge.send("li", {blob})` + lease/claim/retry | `await documents.ingest([file], {source:"files"})` |
| `postMessage({type:"shell-nav", app, payload})` | `nav.go("documents", { open: "LI54.10-P-070001" })` |
| `postMessage({type:"shell-add-files", files, collection, stay})` | `intake.route(files, { collection, stay:true })` |
| `postMessage({type:"vault-filter", filter:"vin:…"})` on pin | `bus.on("vehicle:pinned", …)` in each feature |
| `peekCount("LIDocsDB","docs")` for badges | `bus.on("documents:changed", updateBadge)` |
| RO polls Vault DB for 8 s | `const ids = await files.ingest(files, { roId })` |
| `shell-toast` relay from background frames | one `toast()` |

`bus.js` is an `EventTarget` plus a `BroadcastChannel("file-database")` that
re-emits change events to other open tabs, so two tabs stay consistent — which is
all the bridge's cross-tab machinery was really for once handoffs are function calls.

### 3.3 Routing

Same hash grammar, one table (`src/shell/router.js`), built from the route list in
`FEATURES.md` §2. `#files` stays an alias of `#vault`; legacy `?view=` / `?action=`
keep being honoured once and stripped.

### 3.4 Vendor libraries

One copy each in `vendor/`, loaded on first use with a cached `import()`-style
promise in `services/pdf.js` etc. `tools/vendor-pdfjs.mjs` shrinks to "copy the two
files and verify the pin"; the HTML-splicing half goes away. Repo size drops by
roughly 3.5 MB of inlined minified code.

### 3.5 PWA

One `sw.js`, one cache name, one precache list that a Node check verifies is
complete (like `vendor-pdfjs --check` today) so nothing is bumped by hand in four
places. Runtime cache for `vendor/` and the two OCR hosts, as `sw.js` does now.
The old scopes (`vault/`, `li/`, `inventory/`) are deleted outright (D1): a
worker still registered there serves the 404 it fetches, and a standalone
install is replaced by installing the platform once.

---

## 4. The data model ("backend")

One IndexedDB database `file-database`, version 1, opened in exactly one module.

Every record carries `rev` (incremented on write) and, where deletion is
reversible, `deletedAt`.

| Store | Key | Record | Indexes |
| --- | --- | --- | --- |
| `files` | `id` | name, type, kind, size, tags[], collection, note, starred, createdAt, updatedAt, vins[], fins[], vinScan, srcMtime, **docId?**, searchText, rev, deletedAt? | kind, collection, starred, updatedAt, tags*, vins*, docId, deletedAt |
| `blobs` | `id` (= file id) | blob, **sha256**, size — immutable once written | sha256 |
| `thumbs` | `id` (= file id) | blob | — |
| `documents` | `id` | li, ver, title, reason, fgroup, date, validity, text, pages, **fileId**, filename, size, mtime, noText, err, star, added, rev | li, fgroup, star, added |
| `tools` | `id` | as today (`inventory/app.js normalize()`), rev | toolNo, grp |
| `photos` | `id` | blob | — |
| `ros` | `id` | ro, vehicle, vin, tag, mileage, color, opened, customer, advisor, phone, email, lines[], scanText, createdAt, updatedAt, rev, deletedAt? | ro (unique, D7), vin, updatedAt |
| `links` | `id` | **fromType, fromId, toType, toId, kind**, createdAt, source (user / scan / migration) | [fromType+fromId], [toType+toId], unique [fromType+fromId+toType+toId+kind] |
| `jobs` | `id` | type, inputIds[], state (queued / running / done / failed / cancelled), progress, attempts, error, createdAt | state, type |
| `vehicles` *(Phase 5)* | `vin` | fin?, series, model text, status (extracted / check-digit-ok / confirmed), notes | series |
| `settings` | `key` | value — merges Vault `meta`, LI `settings`, Inventory `meta`, `fd-app`, `fd-vehicle` | — |
| `log` | `id` | t, level, app, src, msg, stack (from `debug.js`) | t |

Rules the repos enforce, so no feature has to remember them:

- **Commit = transaction complete**, never request success. `vault/db.js` today
  resolves `put()` on the request's `onsuccess`; a later abort (quota) is lost.
  LI's `txDone()` is the pattern; it moves into `data/db.js`.
- **Writes take `expectedRev`** and check it inside the transaction; a mismatch
  rejects with the current record so the caller can merge. This is what makes two
  tabs editing the same RO story safe.
- **Blobs are immutable and content-addressed.** An edit produces a new blob id; a
  hash match on ingest offers "reuse bytes" instead of storing twice. Because
  blobs never change, a backup is one read-only transaction over the metadata
  stores (consistent by IndexedDB's own snapshot) followed by streaming blobs by
  id — no write pause needed.

What this fixes, concretely:

- **Blobs out of the metadata store.** List renders never read file bytes.
- **RO ↔ files is a typed link**, not a collection string. `links {from: ro, to:
  file, kind: "attachment"}` — a file can sit on two ROs, an RO can pin an exact
  LI version (`kind: "reference"`) or a tool (`kind: "required-tool"`), and
  renaming an RO touches one record. RO numbers stay unique (D7), but as a
  validation rule on a unique index rather than a storage necessity.
- **LI PDFs are files.** A document points at its `fileId`; "copy to Vault" becomes
  a tag/collection change on the same record, not a second blob.
- **Long work survives a reload.** OCR imports, VIN scans and thumbnail backfills
  are `jobs` rows resumed on boot; `navigator.locks` keeps one tab running them.
  This replaces the `vinScan` marker, LI's restart-from-zero and the bridge's
  lease machinery with one small store.
- **A vehicle becomes a record in Phase 5**, once the RO scanner's check-digit
  verdict and a technician's confirmation have somewhere to live; until then
  `files.byVin(v)`, `ros.byVin(v)`, `documents.byModel(series)` answer every
  vehicle question off the indexes.
- **Delete is trash first.** `deletedAt` hides a record; purge is a separate,
  reference-checked action (nothing referenced by a link or a document is purged).
- **One backup.** `backup.collect()` walks every feature's `backup` export into one
  `.fdb` container (same `magic + JSON + payloads` layout as `.fvault` v2, whose
  strict validator in `vault/backup-format.js` and its tests carry over), with each
  blob's `sha256` in the manifest. RO records and links are finally included.
  `.fvault`/`.lidb`/`.tidb` keep importing; Extract reads all four.
- **`theme` stays in `localStorage`** — it must be readable before first paint.

### 4.1 Migration (`data/migrate.js`)

Runs once, on first open of `file-database`, before the shell mounts:

1. Probe each legacy database with the existing abort-on-upgrade trick (last time
   that trick is used). Skip any that do not exist.
2. Copy in one direction, one legacy DB at a time, inside a progress dialog:
   `file-vault.files` → `files` + `blobs` + `thumbs`; `file-vault.meta` → `settings`;
   `LIDocsDB.docs`+`files` → `documents` + `files`/`blobs` (kind `pdf`, collection
   `LI Documents`, `docId` set); `tool-inventory.*` → `tools`/`photos`/`settings`;
   `repair-orders.ros` → `ros`, then `files` whose collection is `RO <n>` get `roId`.
3. Verify counts store-by-store and every blob's `sha256` against the source
   bytes; record `settings.migration = { from, counts, at }`.
4. **Delete the legacy databases** as soon as step 3 passes (D2). If it does not
   pass, keep them, leave the pointer on the old generation and show the report.
   Because there is no rollback afterwards except from a file, the migration
   dialog offers a `.fdb` export of the migrated data before it deletes anything.

Migration and restore write into a **new generation** — a fresh IndexedDB
database named `file-database-<n>` — and only when it verifies does a pointer in
`localStorage` switch reads to it. An interrupted run therefore never leaves the
live data half-written; the superseded generation is removed once the new one
has opened successfully (D8, D2).
Multi-tab safety comes free with IndexedDB: opening a newer schema fires
`versionchange` in every other tab, which closes its connection and reloads.

Migration is unit-tested in Node with `fake-indexeddb` against fixtures captured
from the current apps' exports.

---

## 5. Phases

Each phase ends with the app working, CI green and a merge to the live branch.
Sizes are relative (S < M < L < XL). Nothing in a later phase is needed to ship an
earlier one.

### Phase 0 — Freeze the behaviour · S

Goal: make "identical output" provable before anything moves.

- Tag the current head (`v1-pre-rewrite`).
- Capture **golden fixtures**: for each PDF in `tools/fixtures/` record what the LI
  parser extracts today (li, ver, title, reason, fgroup, date, validity); for each
  RO scan text the RO parser's fields + lines; for the VIN test strings in
  `vault/app.js` comments the vin/fin classification. Store as JSON under
  `tests/fixtures/golden/`.
- Run the full E2E suite once and record which suites pass on this machine
  (`npm test`), so later phases have a known starting point.
- Add `tests/unit/` with `node --test` wired into `npm test`.

Acceptance: golden files exist; `npm test` runs unit tests (zero so far) then the
existing checks.

### Phase 1 — Extract the pure core · M — **done**

Goal: one copy of every parser and format, importable and tested — with **no UI
change**.

Landed as `src/core/{text,ids,li-parse,vin,ro-parse}.js` and
`src/core/formats/{container,zip,fvault,tidb,lidb}.js`. The modules are classic
scripts that attach to `window.FDCore` (and keep `window.FileVaultBackup` for the
Vault) and are imported for their side effect by the unit tests — the plain-script
form, not ESM, because the current pages load classic scripts and hosting has no
build; Phase 4 adds the `export`s when the pages become modules. All 160 goldens
pass through the moved code and re-capturing is byte-identical; the goldens caught
two transcription gaps on the way (a literal U+00A0 in a character class, a
constant defined outside the function that used it).

- Create `src/core/ids.js`, `li-parse.js`, `ro-parse.js`, `vin.js`, `text.js`,
  `formats/*.js` by moving code out of `li/index.html`, `toolbox/index.html`,
  `ros/index.html`, `vault/app.js`, `viewer.html`, `vault/backup-format.js`.
  Move, don't rewrite: the functions keep their names and bodies.
- Each module is an ES module that *also* attaches to `window` under its old
  global (e.g. `window.FileVaultBackup`) so the current apps can `<script>` it
  unchanged until Phase 4. (Same dual-mode trick `backup-format.js` already uses.)
- Delete the duplicates: the second `detectLI` in Toolbox, the four extra LI
  regexes, the viewer's private format readers.
- Unit tests against the Phase 0 golden files. `tools/test-li-number.mjs` becomes a
  normal import instead of `lift()`.

Acceptance: `git grep -c "\\d{2}\\.\\d{2}-\\[A-Z\\]-"` returns one file; golden tests
pass; the existing E2E suite passes unchanged.

### Phase 2 — Unify the data layer · L (the risky one) — **done**

Goal: every app reads and writes `file-database` through `src/data/repos/*`; the
bridge, the peeks and the RO polling are gone. Apps still run in iframes.

- Write `data/db.js`, `repos/`, `bus.js`, `migrate.js` (§4). `bus.js` works across
  the iframes for now because `BroadcastChannel` is same-origin.
- Point `vault/db.js` callers, LI's `openDB()` block, `inventory/app.js` DB
  functions and `ros/index.html` `roAll/roPut/roDel` at the repos. This is
  mechanical: the repos expose the same verbs (`put/get/remove/listMeta/each/…`).
- Replace `VaultBridge.send/receive` with direct `repos.files.ingest()` calls —
  the receiving side's buffering logic (`flushIncoming` in LI and Toolbox) moves
  into `services/intake.js` as a normal batch call.
- Replace `peekCount` badges and RO's `readVault()` with `bus` subscriptions and
  `links.from("ro", id)`.
- Fix the RO save race while its persistence moves: `openRO`/`newRO`/`deleteRO`
  flush the pending 400 ms save for the record it belongs to before switching.
  Delete `wantNames` (computed, never read) with the polling it belonged to.
- Add the `jobs` store and resume-on-boot; LI import, VIN scan and thumbnail
  backfill become jobs. `ingest()` returns per-file results, so a failed file is
  never acknowledged as stored (the bridge acked LI batches that had failures).
- Migration dialog on first launch: offer a `.fdb` export, migrate into a new
  generation, verify, then delete the legacy databases (D2, D8).
- Delete `bridge.js`, the `vault-bridge` database, `e2e-bridge.mjs`.

Acceptance: migration unit tests pass; a profile with data in all four legacy DBs
opens with identical counts and hashes and the legacy DBs are gone afterwards;
a migration whose verification is made to fail leaves the legacy DBs and the
old pointer untouched; RO attach completes without polling; E2E suites that
opened legacy DB names are updated to `file-database` (16 suites, search/replace).

Done as written, with these notes:

- `src/data/` is classic scripts on `window.FDData` (like `src/core/` — the pages
  still load classic `<script>` tags; Phase 4 adds `export`s), in one file per
  concern: `schema.js`, `db.js`, `bus.js`, `repos.js`, `jobs.js`, `intake.js`,
  `backup.js`, `migrate.js`, `boot.js`, plus `src/ui/migrate-dialog.js`. Every
  page calls `FDData.boot()` first; on a profile with legacy data that shows the
  migration dialog before any frame opens the database.
- The apps keep their own verbs as thin adapters over the repos (`vault/db.js`
  is now that adapter; LI, Inventory and RO wrap the repos inline), so the
  Phase 3 de-inlining moves code, not behaviour.
- Blobs are hashed on ingest (`src/core/hash.js`: WebCrypto up to 256 MiB, a
  streaming JS SHA-256 above) and the write is verified by re-reading; `.fdb`
  (`src/core/formats/fdb.js`, magic `FDBK`) is the one backup and restores into
  a new generation. The Extract page reads it.
- An LI document's PDF is a `files` record with `inFiles 0` (hidden from the
  Files app) and `docId`; "Add to File Vault" flips `inFiles` on the same
  record. "Send to LI" from Files enqueues an `li-import` job on the existing
  record — no second copy of the bytes anywhere.
- Jobs: `thumb`, `vin-detect`, `vin-scan` run in the Files app; `li-import` in
  LI; `toolbox-intake` in the Toolbox. The shell loads the app that runs a
  queued job, and jobs left running by a dead page are requeued on boot.
- Legacy RO numbers that collide are both kept: the older keeps the unique key,
  the newer carries `roConflict` and a warning in `settings.migration`.
- Not moved yet: `debug.js` still writes `fv-debug` (the `log` store exists for
  Phase 3), and the standalone app pages remain until Phase 4 (they open the
  shared database too).

### Phase 3 — De-inline the single-file apps · M — **done**

Goal: no HTML file over ~300 lines; vendor code lives in `vendor/`.

- Split `li/index.html` → `li/app.js` + `li/styles.css` + markup; same for
  `toolbox/` (one file per tool: the ten `/* ===== Tool ===== */` IIFEs are
  already separate blocks) and `ros/`, `viewer.html`.
- Move PDF.js, JSZip, pdf-lib to `vendor/`; `services/pdf.js` lazy-loads the one
  copy. Remove the inline `<script id="pdfjs-lib">` blocks and the splicing half of
  `tools/vendor-pdfjs.mjs`; keep `--check`.
- Lift LI's OCR worker pool and Vault's thumbnail code into `services/`.
- Merge the two folder-sync implementations (Vault `syncDir`, LI `resumeSyncDir`)
  into `services/folder-sync.js` with a per-feature `onFiles` callback — and route
  its imports through the same `ingest()` as everything else, so folder-synced
  files get the automatic VIN pass they skip today.
- Small defects to take while each file is open: the RO mismatch note builds
  `innerHTML` from the RO's VIN (use a text node); Toolbox OCR's download and
  "Save to Vault" are built from the first recognition, not the edited text;
  Extract's error text goes into `#progress`, which sits inside the hidden
  `#result`; Inventory's CSV import lacks the re-entrancy guard `.tidb` has.

Acceptance: `test-static` policy still passes (add: no file > 300 KB outside
`vendor/`); `vendor-pdfjs --check` passes; E2E unchanged.

Done as written, with these notes:

- `vendor/` at the root holds the four runtimes — PDF.js main + worker
  (generated by `tools/vendor-pdfjs.mjs`, whose HTML-splicing half is gone),
  `jszip.min.js`, `pdf-lib.min.js` — and `src/services/vendor.js` finds it from
  its own script URL, so every page depth resolves the same files. PDF.js is
  on demand everywhere through `src/services/pdf.js` (LI waits for it at the
  start of an import, a re-read and a version compare; the Toolbox's PDF tab
  at every entry point). JSZip and pdf-lib stay synchronous page scripts
  (`<script src="../vendor/…">`) in LI and the Toolbox: their call sites are
  synchronous and moving them behind a promise would have been a behaviour
  change for no offline gain — they are precached like any other asset.
- `src/services/` is classic scripts on `window.FDServices`, like `src/core/`
  and `src/data/`: `pdf.js`, `ocr.js` (the engine loader every app carried,
  plus LI's worker pool as `ocrPool.create()`), `thumbs.js`, `folder-sync.js`.
  One wording for the engine's two load failures replaces four; LI keeps a
  linked folder when a permission check fails (it used to unlink it) and its
  sync is guarded for the whole scan, not only the import.
- `li/`, `ros/` and `viewer.html` are markup + `app.js`/`viewer.js` +
  `styles.css`/`viewer.css`. The Toolbox is `toolbox/index.html` (the tab bar,
  71 lines) + `toolbox/tools/<key>.js`, one per tool, each mounting its own
  panel markup where its script tag sits and then wiring it — the shape Phase
  4's `mount(el)` needs — + `toolbox/app.js` + `toolbox/styles.css`. Element
  IDs are unchanged; the browser suites did not move.
- The four small defects: RO's mismatch note builds its VIN as a text node;
  the Toolbox OCR download and "Save to File Vault" read the textarea when
  taken (`__vaultOffer` accepts a Blob-returning function); Extract mirrors
  its progress/error text outside the hidden `#result`; Inventory's CSV
  import shares the `.tidb` re-entrancy guard.
- `tools/test-li-number.mjs` still lifts two regions by marker, now out of
  `li/app.js`; Phase 4's `export`s retire the lift. `debug.js` still writes
  `fv-debug`: the `log` store needs one booted database to write into, which
  is Phase 4's one page and one boot, not six pages each with its own
  `FDData.boot()` racing the logger.

### Phase 4 — Collapse the shell · L — **done**

Goal: one page. This is the phase users notice — faster tab switches, one
install, one theme, drops and paste work everywhere.

- Convert each app into a `features/<name>/` module with the four exports (§3.1).
  Their DOM moves into `<section>` panels of `index.html`; **element IDs are kept**
  so E2E selectors survive.
- `src/shell/` absorbs `shell.js`: tabs, Add files (→ `services/intake.js`),
  Ctrl+K (now queries the repos directly instead of offering per-app searches),
  vehicle pin (→ `bus`), theme, badges, install.
- Delete the seven theme snippets, six message handlers, six keyboard forwarders,
  five toasts, six `embedded` probes. Delete `vault/sw.js`, `li/sw.js`,
  `inventory/sw.js` and the three manifests.
- Delete the `vault/`, `li/` and `inventory/` entry pages outright (D1) — no
  redirect stubs. `README.md` gains one line telling anyone with a standalone
  install to install the platform instead.
- One `styles/tokens.css`; per-feature CSS files; remove the three inline
  `<style>` blocks.
- Port the E2E suites: `page.frameLocator("#frame-x").locator(…)` → `page.locator(…)`
  (8 suites); drop the shell-frame-specific assertions in `e2e-shell.mjs`.
- Update `tools/test-static.mjs`: it currently asserts **at least four** web
  manifests exist; with one manifest that check must become "exactly one".

Acceptance: Lighthouse PWA installable; offline works after one visit with no
"open each tab" caveat; all ported E2E suites pass; `README.md` "Apps" table no
longer lists per-app entry points.

Done as written, with these notes:

- Each feature mounts into its panel's **shadow root** (`src/features/index.js`
  `mountInto`): its former `<body>` becomes `.fd-root`, its stylesheet loads
  inside the root, and `document`-wide lookups became root lookups. That is
  what let six apps with seventeen colliding element IDs and six sets of
  `.btn`/`.topbar`/`body` rules share one page without a rename or a CSS
  rewrite, and it keeps every browser-suite selector. The panel has
  `contain: layout paint`, so a feature's fixed-position overlays and toasts
  cover the panel as they covered the iframe and never the top bar.
- `src/styles/tokens.css` is the one theme: the union of every app's tokens
  with the shell's values for the shared names (`--bg`, `--text`, …), the
  LI/Inventory/Toolbox names (`--panel`, `--muted`, `--accent`…) as aliases
  of them, and the per-feature extras (badges, diff colours…). Repair Orders
  moves from its indigo palette to the platform's; nothing else changes.
- The cross-feature contract is **kept as messages**, now function calls:
  `shell.send(msg)` in a feature is the shell's old `message` handler,
  `deliver(app, msg)` is the instance's `receive(msg)`, queued until the
  feature has mounted. Appendix A's direct calls are Phase 5's, on top of a
  working page.
- Shortcuts: a feature's keydown handlers listen on its shadow root; the shell
  focuses the panel on activation and re-dispatches a key pressed with the
  focus outside the feature into it, so `/`, `a`, `g`, `l`, Escape reach the
  feature on screen as they reached the app's document inside its frame.
  Alt+N and Ctrl+K are the shell's alone (the six forwarders are gone).
- Drops and pastes are the shell's window handlers alone; a feature's own
  drop zone marks its drop handled, the feature on screen adds context
  (`dropContext()` → the open Vault collection) or claims the files
  (`intake()` → Extract opens a backup it is shown).
- One gotcha worth recording: after dispatch, an event from inside a shadow
  root reports the host as its `target`, so a debounced handler must read
  the input it was attached to (`e.currentTarget`), not `e.target` later.
- `src/core|data|services/index.js` are ES-module facades over the classic
  scripts (the pages still load those first); the features import through
  them. Turning the classic scripts themselves into modules waits for Phase
  6's bundling step, where the Node tests move to real imports too.
- `viewer.html` stays as a standalone host of the Extract feature (a copy
  next to a backup can always get the files out — and double-clicked from
  disk, so it loads the feature as `viewer.js`, one classic script bundled by
  `tools/build-viewer.mjs` and checked by `npm test`); `vault/`, `li/`,
  `inventory/`, `toolbox/`, `ros/` and their workers, manifests and icons
  are deleted (D1). `sw.js` precaches a generated list; `debug.js` labels
  entries with the feature on screen.
- Two things the first review caught: on one page every feature shares one
  bus, so a write by another feature arrives without `remote` — the Files
  and Repair Orders views now reload on every `files`/`links` event
  (debounced), keeping the `remote` guard only for stores a feature alone
  writes; and the platform's worker proxies the OCR hosts for the page, which
  the VIN suite's hung-CDN route could not hold, so that suite blocks the
  worker in its context.
- `tools/sw-manifest.mjs` (planned for Phase 6, pulled forward after the
  follow-up review found `mount.js` missing from the list) regenerates the
  worker's precache list from the tree and `--check` runs in `npm test`.
- Not done here: a Lighthouse run (not in the toolchain).

### Phase 5 — Use the unified model · M — **done**

Goal: the features the old split made impossible.

- **RO ↔ files by link**: rename an RO without touching files; attach one file to
  two ROs; delete an RO asks whether to keep, unlink or trash attachments.
- **RO pins an exact LI version and its tools** (`links` of kind `reference` /
  `required-tool`); a later LI import shows "newer version exists" on the RO
  without rewriting what was used.
- **One backup file** (`.fdb`) with ROs and links included and every blob's
  `sha256` in the manifest; "Back up everything" is one download and one restore
  into a new generation. Legacy importers stay.
- **`vehicles` store**: pin a VIN and the shell shows files, ROs and model-scoped
  LI/tool counts from one query; `#vehicle/<VIN>` route; a scanned VIN records
  whether it passed its check digit and whether a technician confirmed it.
- **Trash**: deleted files and ROs are recoverable until purged; purge refuses
  anything still linked.
- **Exact-duplicate review** on ingest via `blobs.sha256`: reuse bytes, keep both
  records, or skip — never auto-delete on a name/size match.
- **Quick-open across all stores** through each feature's `search` export (LI
  number, tool number, VIN, RO number, filename, story text) with results, not
  "search app X for…".
- **LI copy-to-Vault becomes a link**, not a second blob.

Acceptance: unit tests for backup round-trip including ROs; E2E for RO rename and
combined backup/restore.

Done as written, with these notes:

- **Schema 2** (`src/data/schema.js`): the `vehicles` store (keyed by VIN,
  indexed by series), `ros.deletedAt` and `files.blobId`. An existing
  generation upgrades in place (new stores and indexes only). Repos now key by
  their store's own keyPath, so `settings` and `vehicles` rows carry no stray
  `id`.
- **Trash** is `deletedAt` on `files` and `ros`; lists leave it out
  (`files.listMeta` takes `trash: "with" | "only"`). Purge is reference-checked
  in the data layer: `files.purge` keeps (and reports) anything a link names or
  an LI document owns; `ros.purge` refuses while anything links *to* the RO and
  takes the RO's own links with it, never its files. Trashing an RO keeps its
  number (a restore must not collide), so a conflict names the trashed record.
- **Duplicate review** is an intake step (`opts.reviewDuplicates`) that runs
  before anything is written. "Reuse bytes" is a new record with `blobId` —
  blobs stay immutable and keyed by the record that stored them, and a blobs
  row is deleted only when no record names it (`dropFiles`). No reviewer means
  keep both. Repair Orders skips, without asking, bytes already attached to
  that RO (a rescan re-filing its PDF); a skipped duplicate on an RO is
  attached as the stored file.
- **RO ↔ files** carry no collection any more: attach/detach are links, "Open
  in Files" is the `ro:<id>` view (by links), and a drop there attaches. The
  old `RO <number>` collections on existing records are left as they are.
  Appendix A's `files.linkToRo` is `ros.attach`; `vault-rename-collection` is
  gone. The navigation messages stay messages (they are routing between
  features, not data hand-offs); `vault-open {id}` and `shell-vehicle {vin}`
  are new.
- **Pins** keep the LI number and version on the `reference` link as a
  snapshot, so an RO still says what it used after that version is deleted;
  `ros.references()` reports the newest stored version beside it.
- **Vehicles**: recorded when an RO is saved with a VIN (`ro`) or created from
  a scan (`ro-scan`), never downgraded; only **✓ Confirm VIN** sets
  `confirmed`. `vehicles.summary` reads vehicles, files, ros, documents and
  tools in one transaction; LI documents and tools match the model series by
  one shared rule (`FDCore.ids.modelsOfValidity` / `toolFitsModel`, which LI
  Documents and the Tool Inventory filter by too). The view is shell-level
  (`src/shell/vehicle.js`) over whichever feature is showing, not a seventh
  tab.
- **Quick-open**: each feature's `search` export is its own small module
  (`src/features/*/search.js`, registered in `features/index.js`), so Ctrl+K
  searches every store without loading a feature's UI.
- **One backup**: `vehicles` joined the `.fdb` record stores (a backup without
  them still restores); "Back up everything" is now the one `.fdb` download —
  the per-app exports stay in each app's menu.
- **LI copy-to-Vault** was already the same record since Phase 2 (a document
  owns its PDF as a `files` row; "Add to File Vault" flips `inFiles`), so
  nothing changed there; the unit tests pin it.
- The worker's required core is now **derived**: `tools/sw-manifest.mjs`
  follows `src/main.js`'s static imports, so a module the shell imports can
  never be missing offline (the shell gained two).

### Phase 6 — Tests, docs, tooling · S — **done**

- Rewrite `FEATURES.md` from the new layout (much of §9 becomes a repo API list).
- `README.md`: one app, one install, one backup; keep hosting and portable sections.
- `tools/build-portable.mjs` bundles `src/` with esbuild (already a dependency) to
  `dist-portable/app/` for the most robust `file://` behaviour; nothing else builds.
- CI: unit tests on every push (seconds), E2E on PR (minutes), portable build on the
  live branch. Add the precache-manifest check.
- Delete `tools/e2e-bridge.mjs`, `e2e-shell.mjs` frame assertions and any suite
  whose subject moved to a unit test.

Done as written, with these notes:

- **Portable bundle.** `tools/build-portable.mjs` bundles `src/main.js` and
  everything it imports (the features and their search modules — esbuild
  inlines the registry's dynamic `import()`s) into `app/app.js`, swaps the
  page's module tag for a plain `<script>`, and adds the bundle to the copy's
  precache list. Features now find their stylesheet beside the page
  (`featureStyle(folder)` in `src/features/mount.js`) instead of through
  `import.meta.url`, which a classic bundle does not have; the build refuses a
  bundle that still references it. `e2e-portable.mjs` opens the built page
  from `file://` with no browser flags and checks all six features mount and
  are styled. The launchers keep `--allow-file-access-from-files` for the
  catalog fetch and the PDF worker.
- **CI.** `qa.yml` is three jobs: `checks` (audit + `npm run test:fast`: the
  static, generated-file and unit checks) on every push and PR; `qa` (the
  whole browser suite) on PRs, under its old name so a required check keeps
  matching; `portable` (build, exercise, upload the package) on pushes to the
  live branch. The precache-manifest check was already in `npm test` (pulled
  forward in Phase 4) and is part of `test:fast`; `vendor-pdfjs --check`
  joined it.
- **Tests.** `e2e-bridge.mjs` had already gone with the bridge (Phase 2), and
  the shell suite's frame assertions with the frames (Phase 4); what remained
  was iframe wording in three suites, now corrected. `e2e-vin-wmi.mjs` is
  deleted: its subject (Mercedes-prefix validation — the engine number and a
  non-Mercedes VIN rejected) is pinned exactly by the VIN golden, and the
  datacard suite already proves only real VINs reach the sidebar.
- **Docs.** FEATURES.md §9 is now the data layer's API: the common repo verbs,
  each repo's own calls, and the module functions. README and tests/README
  describe the fast/browser split and the portable bundle.
- **Not done:** the core, data and services files stay classic scripts on
  `window.FD*` (with ES-module facades), and the Node tests keep loading them
  by side-effect import. Phase 4's notes expected them to become modules
  here, but nothing in this list needs it — the portable bundle works with
  them as they are — so it stays a candidate for later rather than a change
  made without a reason.

---

## 6. Testing strategy

| Layer | Tool | What | When |
| --- | --- | --- | --- |
| Unit | `node --test` (no browser) | `core/` parsers vs golden fixtures; `formats/` round-trips + corrupt inputs (port `test-backup-format.mjs`); `data/migrate.js` with `fake-indexeddb`; `services/intake.js` routing table | every push, < 10 s |
| Integration | Playwright, one page | each feature's smoke path; migration on a seeded profile; offline reload | every PR |
| Acceptance | Playwright | the ported `tools/e2e*.mjs` cross-app flows (RO attach, LI hand-off, VIN pin, backup) | every PR |
| Build | Node | `test-static` policy, precache manifest complete, vendor pin, portable build | live branch |

Rules that keep the safety net alive through the rewrite:

- **Keep element IDs.** The suites are ID-driven; keep `#results`, `#tbody`,
  `#search-input`, `#detail`, `#ro-no` … and the ports are trivial.
- **Golden before move.** No parser moves in Phase 1 without its Phase 0 fixture.
- **One E2E per phase minimum** that exercises the phase's seam end-to-end.

---

## 7. Decisions — made 2026-09-16

All ten are decided. Three went against the recommended default (D1, D2, D7);
the rest of this document has been updated to match.

| # | Decision | Decided | Consequence |
| --- | --- | --- | --- |
| D1 | Standalone per-app PWAs (`vault/`, `li/`, `inventory/`) | **Delete immediately** in Phase 4 | The old paths 404. A service worker still registered at an old scope serves that 404 (its navigation handler returns the response as-is and only falls back to cache on a network error); anyone with a standalone install opens the platform URL and installs once. No stubs to remove later. |
| D2 | Legacy databases after migration | **Delete right after a verified migration** | Verification is counts per store plus every blob's `sha256` against the source; only then are `file-vault`, `LIDocsDB`, `tool-inventory` and `repair-orders` deleted. A failed verification keeps them and reports. Rollback afterwards is from a backup file, so the migration dialog offers a `.fdb` export first. |
| D3 | Combined backup container | **Binary container (`.fdb`, same layout as `.fvault` v2)** | No 4 GiB ZIP limit; streams via `Blob.slice`; `vault/backup-format.js`'s validator and tests carry over. |
| D4 | UI framework | **None — vanilla ES modules** | No-build hosting stays. |
| D5 | Toolbox scope | **Keep all ten tools**, each its own module | Ten folders under `features/toolbox/`. |
| D6 | Branching | **One PR per phase into `claude/pwa-file-database-hqbppy`** | Each phase CI-gated and shippable; no long-lived branch. |
| D7 | Repair Orders numbering | **Enforce unique numbers** | `ros.ro` becomes a unique index; creating or renumbering to an existing number is refused with a link to the other record. Attachment lookup is still by id (D9) — uniqueness is a validation rule now, not a storage necessity. |
| D8 | Restore/migration target | **New IndexedDB generation + pointer flip** | Atomic activation; an interrupted run never touches live data. The superseded generation is removed once the new one opens (D2). |
| D9 | RO ↔ file relationship | **Typed `links` store** | Multi-RO attachments, pinned LI versions and required tools without a later schema change. |
| D10 | GPT recreation guides | **Reference only; commit nothing** | §10 is the record. |

---

## 8. Explicitly not recommended

- **A from-scratch rewrite.** Roughly 14,000 lines of application code encode
  measured behaviour (`ocr.js` thresholds, `layoutLines`, `refineVin`, `MB_WMI`,
  `titleFromStructure`, the XENTRY hyphen fold). Re-deriving them means re-losing
  them. Every phase above moves code; none re-implements it.
- **Adding React/Vue/Svelte.** It forces a build step for hosting, which the
  README promises not to need, and none of the current pain is in the view code.
- **A `vehicles` store before Phase 5.** Indexes answer every vehicle question
  until there is confirmation state to record (§10.2).
- **Keeping the bridge "just in case".** Once handoffs are function calls the
  lease/claim machinery has no job; the cross-tab need is met by a change-event
  broadcast.

---

## 9. Where to start

The first PR is Phase 1's `src/core/ids.js`: move the LI regex + `normLI` +
`detectLI` + `detectLIFuzzy` + `canonLI` out of `li/index.html`, export them, attach
them to `window.FDIds` for the current pages, replace the other four regex copies
with imports/globals, and turn `tools/test-li-number.mjs` into a plain import. It is
a small, self-contained change that proves the dual-mode module pattern every later
phase relies on, and it deletes the first duplication.

## 10. Reconciliation with the GPT Recreation Guides

A separate set of guides — eight application/architecture PDFs, a 104-page
handbook and sixteen action flowcharts (F01–F16, with JSON/DOT/SVG sources) —
was written against commit `b3870af` on September 8. That is **15 commits and
4,283 inserted lines** before this plan's baseline: it predates `ocr.js`, the
Repair Order scanner (`ros/index.html` grew by 1,213 lines), VIN check-digit
validation, `test-li-number.mjs` and the three orientation/scan E2E suites.
This section records what was taken from them, what was declined, and what
they say that is no longer true.

### 10.1 Same diagnosis

The guides' eight integration problems (INT-01…08) are §1.2–1.4 of this plan in
different words: bridge copies, filename routing diverting an RO upload into LI,
collection strings as ownership, three transports with broad handlers,
acknowledgement following the handler rather than the commit, timing-based RO
reconciliation, a three-app backup, and parsers that diverge per app. There is
no disagreement about what is wrong.

### 10.2 Absorbed into this plan (the edits above)

| From the guides | Where it landed here |
| --- | --- |
| `Asset` with a content digest, immutable bytes (07 §4, F02) | `blobs.sha256`, immutable and content-addressed; duplicate review on ingest; checksums in `.fdb` |
| `Link` records with a unique relation key (07 §4, F03, INT-03) | `links` store replaces the `roId` foreign key (D9) |
| Transaction-complete as the commit boundary; expected-revision checks inside the write (07 §7, F04, INT-A04) | Repo rules in §4: `rev`, `expectedRev`, `txDone()` |
| Per-record drafts flushed before navigation (RO-05, F04, F09) | Phase 2: flush the 400 ms RO save on switch |
| Durable jobs resumed after reload (07 §7, F13) | `jobs` store + `navigator.locks`, without leases/fencing |
| `Vehicle` as a shared record with confirmation status (07 §4) | `vehicles` store in Phase 5 — reversing the earlier "YAGNI" |
| Trash, then reference-checked purge (F14) | `deletedAt` + purge in Phase 5 |
| Search providers and schema ownership per module (08 §2) | `search` and `schema` feature exports |
| Staged generation, atomic activation, recoverable prior generation (F11) | New IndexedDB generation per restore/migration + pointer flip (D8) |
| Stale tabs must not write an old schema (F15) | `versionchange` → close and reload |
| Extract reuses the strict readers (06 §5) | Already in §3.1 (`core/formats`); the guide confirms `viewer.html` never calls `backup-format.js` |
| Portable manifest must fail on a missing module (07 §9) | Phase 6 precache/manifest check |

### 10.3 Declined, and why

- **Leased and fenced job workers, an outbox, a code/data generation handshake
  between the service worker and the database, OPFS as a byte store.** These
  are multi-writer, multi-process guarantees. This is one user in one browser;
  `navigator.locks` plus IndexedDB transactions cover the hazards that actually
  occur (two tabs, a reload mid-job). Revisit only if a job ever has to run in a
  tab that did not start it.
- **Module descriptors with `requires`, capability predicates, lifecycle/flags
  and dependency-cycle validation (08 §3).** The six-export contract in §3.1 is
  the same idea at this codebase's size; a static list checked by a unit test
  replaces a registry.
- **"A development build is acceptable"; defer the framework decision until
  USB-first is decided (07 §1, §12).** `README.md` promises hosting with no
  build; §2 keeps that and the portable builder already bundles for `file://`.
  D4 stands.
- **A "Utilities" domain owning editable projects, recipes and calculation
  definitions; the AF-01…08 and TBX-* feature families** (diagnostic timelines,
  story templates, case export packages, known-fix knowledge base, video
  trim/annotate/spectrogram, thermal alignment, saved views and smart
  collections, comparison viewer). These are product expansions, not the
  rewrite. They are listed in 10.5 so the IDs survive.
- **Stage A "canonical model and contracts before any UI"** (07 §10). Phases
  1–2 here build the same model with the application running throughout.

### 10.4 No longer true since `b3870af`

- Guide 05 §1 describes the RO editor as number, vehicle, VIN and story lines.
  It now also has tag, mileage, colour, open date, customer, advisor, phone,
  e-mail, an op code per line and the scan's recognized text.
- "No dedicated LI parser/OCR/version-diff regression suite was found" (02 §9):
  `test-li-number.mjs`, `e2e-ocr-orient.mjs`, `e2e-vin-orient.mjs` and
  `e2e-ro-scan.mjs` exist.
- "The portable INCLUDE list omits ros" (RO-07, INT §9): fixed.
- "Escape invokes undefined `closePicker`" (RO-08): the call is gone.
- "App-specific parser/resource behaviour diverges" (INT-08) for OCR: all four
  readers go through `ocr.js` with measured thresholds.

### 10.5 Defects from the guides that still hold

Verified against the current tree; each is folded into the phase that already
touches the file.

| Defect | Location | Phase |
| --- | --- | --- |
| RO save timer not flushed when switching, creating or deleting an RO — an edit made <400 ms before switching is lost | `ros/index.html` `openRO`/`newRO`/`deleteRO` | 2 |
| Vault writes resolve on request success, not transaction complete | `vault/db.js` `reqAsPromise` | 2 |
| LI `importFiles` counts failures but resolves, so the bridge acknowledges a batch with unstored files | `li/index.html` | 2 |
| Vault bridge receiver has no idempotency key; an integrity failure deletes the record but still acknowledges | `vault/app.js` `addIncomingFile` | 2 |
| `wantNames` computed and never read | `ros/index.html` `addFiles` | 2 |
| RO mismatch note builds `innerHTML` from the RO VIN | `ros/index.html` `askMismatch` | 3 |
| Toolbox OCR download and Vault offer are built from the first recognition, not the edited text | `toolbox/index.html` `showResult` | 3 |
| Extract error text is written to `#progress`, which is inside the hidden `#result` | `viewer.html` | 3 |
| Inventory CSV import has no re-entrancy guard (`.tidb` does) | `inventory/app.js` `importCSV` | 3 |
| Folder-sync imports skip the automatic VIN pass | `vault/app.js` `syncImport` | 3 |

### 10.6 Backlog carried from the guides (after Phase 6)

Kept by ID so nothing is lost; none of it is part of the rewrite.

- **Repair Orders:** AF-01 diagnostic timeline and evidence, AF-02 known-fix and
  unresolved-case knowledge, AF-03 structured stories and templates, AF-04
  saved measurements and calculations, AF-08 case report / handoff package,
  vehicle history and work dashboard.
- **LI Documents:** AF-05 revision-impact review, AF-06 procedure notes and
  bookmarks; extraction coverage and parser provenance (LI-02), explicit blank
  corrections (LI-11), a strict diff mode (LI-19).
- **Tool Inventory:** AF-07 readiness and required-tool checklists, catalog
  update with override preservation (TI-06/07), `ToolInstance` later.
- **Files:** saved views and smart collections, comparison preview, full-text
  index state (FV §3–4).
- **Toolbox:** the TBX-F/V/A/W series — photo markup, video trim/frames/
  bookmarks, CSV graphing, conversion adapters, workshop units, diagnostic
  calculators, recipes.
- **Extract:** salvage mode, human-readable RO export, ZIP64 fallback (EX-05…10).

The flowcharts F01–F16 are the acceptance narratives for these items and for
the shared behaviours absorbed in 10.2.

## Appendix A — Message contract → function map

For Phase 2/4, every `postMessage` type in `FEATURES.md` §9 and its replacement.

| Message | Replacement |
| --- | --- |
| `shell-nav {app, tab?, payload?}` | `nav.go(key, sub)` |
| `shell-relay {app, payload}` | direct repo/feature call |
| `vault-nav {to:"files"}` (legacy) | `nav.go("files")` |
| `shell-add-files {files, collection?, vin?, stay?}` | `intake.route(files, opts)` |
| `shell-open-picker` | `shell.openPicker()` |
| `shell-toast {app, msg}`, `li-changed` | `toast()`, `bus.emit("documents:changed")` |
| `shell-switch {n}`, `shell-quickopen`, `shell-pin-vehicle {vin}` | shell-level key handlers; `vehicle.pin(vin)` |
| `platform-theme {mode}` | `theme.set(mode)` (one DOM) |
| `platform-backup` | `backup.collect()` walks feature `backup` exports |
| `toolbox-open {tab}` | `nav.go("toolbox", tab)` |
| `li-open`, `li-search`, `li-filter`, `li-restore` | `documents.open/search/filter`, `backup.importLegacy(".lidb")` |
| `inventory-open`, `inventory-search`, `inventory-filter`, `inventory-import` | `inventory.open/search/filter`, `backup.importLegacy(".tidb")` |
| `vault-filter`, `vault-search`, `vault-restore` | `files.filter/search`, `backup.importLegacy(".fvault")` |
| `vault-ro-import`, `vault-ro-apply`, `vault-rename-collection` | `files.pickForRo(roId)`, `files.linkToRo(ids, roId)`, *(gone: rename touches one record)* |
| `shell-nav {id}` (RO) | `nav.go("ros", id)` |

## Appendix B — Files that disappear

`bridge.js`, `vault/sw.js`, `li/sw.js`, `inventory/sw.js`, `vault/manifest.webmanifest`,
`li/manifest.webmanifest`, `inventory/manifest.webmanifest`, `vault/db.js` (→ repos),
`vault/backup-format.js` (→ `core/formats/container.js`), the inline PDF.js/JSZip/pdf-lib
blocks in `li/index.html` and `toolbox/index.html`, `viewer.html`'s private readers,
`tools/e2e-bridge.mjs`, the HTML-splicing half of `tools/vendor-pdfjs.mjs`.
(`inventory/gen_icons.py` and `tools/gen_icons.py` differ materially and should be
merged into one parameterised script rather than one deleted.)
