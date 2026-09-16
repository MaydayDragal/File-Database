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
Old scopes (`vault/`, `li/`, `inventory/`) each keep a **self-unregistering**
`sw.js` and a redirecting `index.html` for one release, so an installed
standalone PWA lands in the new app and its stale cache is cleared (see §5, Phase 4).

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
| `ros` | `id` | ro, vehicle, vin, tag, mileage, color, opened, customer, advisor, phone, email, lines[], scanText, createdAt, updatedAt, rev, deletedAt? | ro, vin, updatedAt |
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
  renaming an RO touches one record. RO numbers no longer need to be unique.
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
3. Verify counts store-by-store (and blob `sha256` against the source bytes) and
   record `settings.migration = { from, counts, at }`.
4. **Leave the legacy databases in place** for one release. Add a "Remove old
   databases" action in the ☰ menu; delete automatically in the release after
   (decision D2 in §7).

Migration and restore write into a **new generation** — a fresh IndexedDB
database named `file-database-<n>` — and only when it verifies does a pointer in
`localStorage` switch reads to it. The previous generation stays until the user
removes it, so a bad restore or an interrupted migration can never leave the live
data half-written, and rollback is flipping the pointer back (decision D8).
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

### Phase 1 — Extract the pure core · M

Goal: one copy of every parser and format, importable and tested — with **no UI
change**.

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

### Phase 2 — Unify the data layer · L (the risky one)

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
- Migration dialog on first launch; legacy DBs retained.
- Delete `bridge.js`, the `vault-bridge` database, `e2e-bridge.mjs`.

Acceptance: migration unit tests pass; a profile with data in all four legacy DBs
opens with identical counts; RO attach completes without polling; E2E suites that
opened legacy DB names are updated to `file-database` (16 suites, search/replace).

### Phase 3 — De-inline the single-file apps · M

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

### Phase 4 — Collapse the shell · L

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
- Ship redirect stubs at `vault/index.html`, `li/index.html`, `inventory/index.html`
  (`location.replace("../#vault")`) and a self-unregistering `sw.js` at each of
  those scopes that clears its caches on activate. Remove the stubs one release later.
- One `styles/tokens.css`; per-feature CSS files; remove the three inline
  `<style>` blocks.
- Port the E2E suites: `page.frameLocator("#frame-x").locator(…)` → `page.locator(…)`
  (8 suites); drop the shell-frame-specific assertions in `e2e-shell.mjs`.
- Update `tools/test-static.mjs`: it currently asserts **at least four** web
  manifests exist; with one manifest that check must become "exactly one".

Acceptance: Lighthouse PWA installable; offline works after one visit with no
"open each tab" caveat; all ported E2E suites pass; `README.md` "Apps" table no
longer lists per-app entry points.

### Phase 5 — Use the unified model · M

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

### Phase 6 — Tests, docs, tooling · S

- Rewrite `FEATURES.md` from the new layout (much of §9 becomes a repo API list).
- `README.md`: one app, one install, one backup; keep hosting and portable sections.
- `tools/build-portable.mjs` bundles `src/` with esbuild (already a dependency) to
  `dist-portable/app/` for the most robust `file://` behaviour; nothing else builds.
- CI: unit tests on every push (seconds), E2E on PR (minutes), portable build on the
  live branch. Add the precache-manifest check.
- Delete `tools/e2e-bridge.mjs`, `e2e-shell.mjs` frame assertions and any suite
  whose subject moved to a unit test.

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

## 7. Decisions to make

Each has a recommended default; the plan assumes the default unless told otherwise.

| # | Decision | Recommended | Why |
| --- | --- | --- | --- |
| D1 | Standalone per-app PWAs (`vault/`, `li/`, `inventory/`) | **Redirect stubs for one release, then delete** | Installed PWAs and bookmarks land in the new app; data is same-origin so nothing is lost |
| D2 | Legacy databases after migration | **Keep one release + manual "Remove old databases"; auto-delete next release** | Rollback stays possible for a while at the cost of double disk usage |
| D3 | Combined backup container | **Binary container (`.fdb`, same layout as `.fvault` v2)** over ZIP | No 4 GiB ZIP limit; streams via `Blob.slice`; validator already exists and is tested |
| D4 | UI framework | **None — vanilla ES modules** | Keeps no-build hosting; the gain is in modules and one data layer, not a view library; revisit only if a feature needs it |
| D5 | Toolbox scope | **Keep all ten tools**, each as its own module | `convert`, `elec`, `text`, `calc`, `csv` are self-contained and cost nothing to carry |
| D6 | Branching | **Phase PRs into the live branch, not a long-lived rewrite branch** | Each phase is shippable; a diverging branch is the LI-Database problem again |
| D7 | Repair Orders numbering | **Allow duplicate RO numbers** (id is the key) | The current uniqueness requirement exists only because attachment lookup is by string |
| D8 | Restore/migration target | **New IndexedDB generation + pointer flip** over in-place writes | Atomic activation and one-step rollback; costs disk for one extra copy until the old generation is removed |
| D9 | RO ↔ file relationship | **Typed `links` store** over a `roId` foreign key | Same cost to build; unlocks multi-RO attachments, pinned LI versions and required tools without a later schema change |
| D10 | GPT recreation guides | **Reference them from this plan; do not commit the 10 MB of PDFs** | The flowchart JSON/DOT/SVG (small) could be tracked under `docs/` if the acceptance narratives are wanted in-repo |

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
