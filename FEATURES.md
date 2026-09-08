# File Database — Features and Application Topology

This map describes the checked-in application. See [README.md](README.md) for
setup, workflows, backups, and portable use. Source links identify the implementation
behind each area; test coverage describes assertions in the repository, not a
passing-test certification.

## 1. Platform topology

The [shell](shell.js) hosts six lazy-loaded, same-origin iframes. A visited frame
stays loaded while another tab is visible. Cross-app work uses three mechanisms:

| Mechanism | Purpose | Participants |
| --- | --- | --- |
| [VaultBridge](bridge.js) | Queue file Blobs in IndexedDB; notify receivers through BroadcastChannel | Shell sends; Vault, LI, and Toolbox send/receive |
| `postMessage` through the shell | Navigation, theme, keyboard commands, intake, restores, and RO updates | Shell and app frames |
| Read-only IndexedDB peeks | Counts and RO attachment listings | Shell reads Vault/LI/Inventory; RO reads Vault |

Navigation messages usually contain metadata, but file-bearing messages also
exist: `shell-add-files` carries Files to the shell, and restore/import messages
carry backup Files into their app. It is incorrect to describe all postMessage
traffic as having no file bytes. IndexedDB peeks abort upgrades to avoid creating
another app's database accidentally. Same-origin deployment is required for the
shared databases, theme, and bridge; it is not an isolation boundary between apps.

| App key | Entry point | Standalone support | Own SW/manifest |
| --- | --- | --- | --- |
| `vault` (`files` alias) | [vault/index.html](vault/index.html) | Files and organization | Yes |
| `li` | [li/index.html](li/index.html) | LI library and PDF processing | Yes |
| `inventory` | [inventory/index.html](inventory/index.html) | Catalog and local edits | Yes |
| `toolbox` | [toolbox/index.html](toolbox/index.html) | Utility tabs | No; platform cache |
| `ros` | [ros/index.html](ros/index.html) | RO records/stories; attachment actions need the shell | No; platform cache |
| `viewer` | [viewer.html](viewer.html) | Backup extraction, without database restore | No; platform cache |

## 2. Shell behavior

[shell.js](shell.js) and [index.html](index.html) implement:

- Six ARIA tabs with one visible panel, arrow/Home/End navigation, and remembered
  last-used app (`fd-app`).
- Live row-count badges for Vault, LI, and Inventory; refresh on navigation,
  focus/visibility changes, app notifications, and intake timers. Background count
  changes pulse, and background app toasts are relayed to the shell.
- A shared System/Light/Dark theme, applied before paint and broadcast to frames.
- A unified file picker and drop router. PDF filenames matching
  `/\b[A-Z]{2}\d{2}\.\d{2}-[A-Z]-\d{5,7}\b/i` route to LI. Other ordinary files
  route to Vault. This is filename recognition, not PDF-content classification.
- `.fvault`, `.lidb`, and `.tidb` inputs invoke app restore/import messages instead
  of being stored as ordinary files. Ordinary inputs up to 256 MiB are eagerly
  materialized before bridge delivery; larger files retain their original handle.
- Single-target batches normally surface their destination; mixed batches stay
  on the current tab. `stay:true` keeps an RO upload on its existing tab.
- Optional collection/VIN metadata for Vault intake. An explicit intake VIN wins
  over the pinned vehicle; LI routing does not use those Vault collection fields.
- A pinned active vehicle (`fd-vehicle`). Vault filters by VIN. LI/Inventory scope
  by the three characters at positions 4–6 only if they are all digits. There is
  no external VIN decoder. Unpinning clears these scopes.
- Ctrl/Cmd+K recognition of LI numbers, special-tool numbers, and 17-character
  VINs; arbitrary text offers searches in Vault, LI, and Inventory.
- Alt+1–6 app switching, forwarded by embedded pages. `/` search belongs to the
  Vault, LI, and Inventory handlers, not every app.
- **Back up everything** sends `platform-backup` to Vault, LI, and Inventory at
  1.2-second offsets. RO records, preferences, and bridge/log databases are excluded.
- Install prompting when offered by the browser, platform service-worker
  registration on HTTPS/loopback, and refresh handling for worker updates.

### Navigation routes

| Route | Result |
| --- | --- |
| `#vault`, `#files`, `#li`, `#inventory`, `#toolbox`, `#ros`, `#viewer` | Select app |
| `#toolbox/<key>` | Open utility; keys: `zip media ocr convert elec text calc csv img pdf` |
| `#li/<LI number>` | Open matching LI document |
| `#li/group/54` | Search `LI54.` |
| `#li/model/214`, `#li/search/<query>` | Model filter or text search |
| `#inventory/group/54`, `#inventory/model/214` | Group-membership or model filter |
| `#inventory/<tool number>`, `#inventory/tool/<tool number>` | Open tool |
| `#inventory/search/<query>` | Catalog search |
| `#vault/vin/<VIN>`, `#vault/search/<query>` | Vehicle filter or metadata search |
| `?view=li`, `?view=inventory` | Legacy app selection |
| `?view=starred`, `?action=add` | Legacy Vault shortcut forwarded into its frame |

Consumed queries are removed. Hash changes route in place. Links resolve against
local browser data; sharing a link does not share its document. RO has a tab route
but no implemented record-ID hash router.

## 3. File Vault

Implementation: [app.js](vault/app.js), [db.js](vault/db.js),
[backup-format.js](vault/backup-format.js), [blob-integrity.js](vault/blob-integrity.js).

| Area | Implemented behavior |
| --- | --- |
| Intake | Picker, drag/drop, paste, linked-folder import, and bridge deliveries; embedded intake forwards through the shell |
| Stored-file checks | Materializes ordinary additions up to 256 MiB, then compares the stored Blob with the source in chunks; failed normal-intake verification removes the bad record |
| Classification | Images, videos, audio, PDFs, documents, spreadsheets, presentations, text/code, archives, other |
| Thumbnails | Canvas images, video frame grabs, first-page PDF.js renders; existing PDF thumbnails backfill in the background |
| Preview | Image/video/audio, native PDF iframe, text up to 512 KiB, fallback icon for unsupported types |
| Organization | One collection per file, tags, note, star, editable filename, VINs and FINs |
| Search/filter | Metadata search; type/collection/tag/VIN filters; All, Starred, Recent, By VIN; active-filter chips |
| Sort/view | Date, name, size; grid/list saved in DB metadata |
| Selection | Checkboxes, Ctrl/Cmd-click, Shift-click ranges, select-all, Escape; collection/tag/VIN/star/delete bulk actions |
| Bulk outputs | Folder downloads with read-back comparison or individual-download fallback; PDFs to LI; compatible same-kind batches to Toolbox |
| Local storage | Usage/quota display and `navigator.storage.persist()` request |
| Keyboard | `/` search, `a` add, `g` grid, `l` list, Escape overlays/selection |

PDF.js is pinned to **4.2.67**, generated from the npm package by
[tools/vendor-pdfjs.mjs](tools/vendor-pdfjs.mjs). Vault lazy-loads its vendored
runtime; loading the shell alone does not cache it. Preview support is distinct
from accepting and storing a file.

### VIN scan and grouping

Direct additions and shell deliveries perform a no-OCR read; folder-sync imports
do not invoke that automatic scan. The manual scan supports filenames,
supported text/CSV/RTF content (first 1 MiB), PDF text (first ten pages), and image
or sparse-page OCR fallback. Videos are skipped, including filename detection.
A rich PDF text layer without a VIN is not indiscriminately OCR'd.

Matching accepts space-split candidates and applies Mercedes-specific WMI and
plausibility rules. It separates labelled ISO VINs from Baumuster/FIN datacard
identifiers; VINs drive grouping, while FINs remain searchable and editable.
Detection is heuristic, not a guarantee of recall or validity for every vehicle.

The scan is cancellable and incremental (`vinScan`); Shift-click requests a full
rescan. OCR uses up to four worker lanes by default, based on available cores,
with load/recognition timeouts. Files needing unavailable OCR remain eligible for
retry. `__VIN_OCR_WORKERS` and `__VIN_OCR_*` globals support controlled overrides.

### Folder sync

A chosen directory handle is stored in `meta.syncDir`; auto mode in `syncAuto`.
Scans recurse with depth/file-count limits and match filename, size, and source
modification time. Imports go into a collection named after the folder. A fresh
DB read helps deduplication but does not constitute a transactional cross-window
uniqueness guarantee. Changed files can create new records; removals are not mirrored.
Auto checks run every five minutes and on focus/visibility while the page runs,
without requesting permission in the background.

### Cross-app files

Vault sends PDFs to LI and supported images/videos/PDFs/CSVs/ZIPs to Toolbox.
LI deliveries become renamed PDFs in an `LI Documents` collection with LI/group/model
tags and a note. Toolbox outputs default to a `Toolbox` collection. Explicit
`meta.collection` overrides defaults. Bulk Toolbox sends are buffered; PDF merge
receives a batch, while Media can queue later files behind **Next file**.

## 4. LI Documents

[li/index.html](li/index.html) contains the app plus inlined JSZip and generated
PDF.js main/worker bundles.

- Imports individual PDFs, folders, drops, and bridge deliveries; extracts document
  number, version, title, reason for change, function group, date, and validity.
- Falls back to Tesseract OCR for scanned documents. First OCR use normally needs
  network access; this can occur during import without a separate OCR button.
- Keeps versions under document identities; repeated LI/version imports update
  their record. Re-read all reparses stored PDFs while preserving edited fields.
- Searches metadata and extracted full text. Filters include function group,
  model series, stars, and records needing review.
- Offers PDF preview, editable metadata, version selection, visual page comparison,
  text comparison, LI/filename/permalink copying, original or renamed downloads,
  and bulk deletion/renamed ZIP export.
- Copies renamed PDFs to Vault with LI/group/model metadata; links to Inventory
  by service group/model and referenced special-tool numbers.
- Supports folder import and five-minute auto-sync while open. Folder identity
  uses name/size/mtime; Shift-click allows relinking.
- Exports `.lidb` backups and restores by document ID; optional auto-save writes a
  backup to a selected file after changes, debounced and deferred during import.
  File System Access permissions are required and may need renewal.

## 5. Tool Inventory

Implementation: [inventory/app.js](inventory/app.js).

The app starts with an empty database. It imports a portable `.tidb` containing
records and photos; it does not automatically seed from `inventory-data/tools.json`.
An empty app probes `../data/FileInventory.tidb` and offers a load button when found.
[build-inventory-db.mjs](tools/build-inventory-db.mjs) creates
`dist-db/FileInventory.tidb` from the source JSON and referenced photos. The portable
builder copies it to `app/data/`; there is no `bundle-app` script in this repository.

| Area | Behavior |
| --- | --- |
| Record data | Tool number, description, service group, category, location, quantity, year, price, notes, offered flag, catalog details, WIS reference, model validities, photo |
| Search/filter | Tool/catalog text, location, WIS, comments; group/category/note, offered, starred; cross-app group/model filters |
| Browsing | Sortable columns, photo thumbnails from IndexedDB Blob URLs, record/photo/offered counts |
| Editing | Location, quantity, note, comment; star toggle; saved locally |
| Import/export | `.tidb` replacement after confirmation; legacy JSON input; CSV refresh/extension and filtered CSV export |
| Cross-links | Tool's first non-00 group links to precise `LINN.` search; tool number links to LI full-text search |

Source catalog prices/offered status are snapshots. Importing a new `.tidb`
replaces the current database. CSV imports match ID first, then tool number, and
overwrite matching fields with nonempty incoming values, including locally edited
fields; unmatched rows are added. Stars and fields absent from that update remain
on existing records. Inventory uses shell messages and direct database storage,
not VaultBridge.

## 6. Toolbox

Implementation: [toolbox/index.html](toolbox/index.html), with inlined JSZip,
pdf-lib, and generated PDF.js main/worker bundles.

| Key | Tool | Capabilities |
| --- | --- | --- |
| `zip` | ZIP Splitter | Partition by count/size, preserve folder structure, ZIP parts or folder-oriented extraction |
| `media` | Media Compressor | Canvas photo re-encoding; browser MediaRecorder/captureStream video output to WebM |
| `ocr` | Image to Text | Tesseract recognition, including pasted images |
| `convert` | Unit Converter | Length, mass, temperature, data, and other unit categories |
| `elec` | Electrical | Ohm/power, resistors, divider, LED resistor, color/SMD codes, reactance, energy cost, dBm/W, AWG, battery life |
| `text` | Text | Editor/counters, find/replace, comparison |
| `calc` | Calculators | Percentage, discount, date/age, mileage/trip cost |
| `csv` | CSV Viewer | Search/sort table; CSV/JSON export |
| `img` | Image Tools | Format conversion, batch ZIP, crop/rotate/resize, EXIF view/strip, GPS map link |
| `pdf` | PDF Toolkit | Merge/organize/reorder/rotate/delete, images-to-PDF, page-image extraction, LI renaming with OCR fallback |

Standalone tool hashes use `#<key>`; the shell uses `#toolbox/<key>`. Bridge inputs
select a tab and inject files into its input. Output download helpers offer
**Save to File Vault**. Browser codecs and API support constrain available media
and filesystem operations. A ZIP target cannot make an indivisible oversized
source file arbitrarily small.

## 7. Repair Orders

[ros/index.html](ros/index.html) stores records in `repair-orders/ros` separately
from Vault. Fields are RO number, vehicle text, VIN, collection association, story
lines, and timestamps. Stories use independently removable textareas labelled
Line A/B/etc.; editing is debounced by 400 ms. Older single-note records migrate
into the first line. The list is ordered by last update.

Files live in Vault, associated by a single collection string: `RO <number>`, or
an ID-derived fallback when there is no number. RO numbers are not unique database
keys, so repeated numbers can share the same attachment collection.

| Action | Implementation and effect |
| --- | --- |
| Upload | `shell-add-files` with collection and `stay:true`; normal shell routing still sends LI-named PDFs to LI |
| Import existing files | `vault-ro-import` opens normal Vault selection UI; **Add to RO** changes selected records' collection, then returns to the RO |
| VIN reconciliation | Fill a missing VIN from the RO; keep matching VINs; prompt on mismatch and preserve original VINs when accepted |
| Upload reconciliation | Poll new collection records, allow a short settle for no-OCR VIN detection, then send `vault-ro-apply`; ignored uploads become uncategorized |
| Existing-file mismatch | Vault uses `confirm()`; cancel skips the mismatched files |
| Attachment listing | Read-only Vault peek, refreshed after actions and on focus; VIN badges and Vault navigation |
| Rename | `vault-rename-collection` relayed by the shell moves the old collection's files |
| Delete RO | Deletes the RO record, leaving Vault files |

File workflows require the shell. There is **no RO export/import or
`platform-backup` handler**. Vault backups contain attached files and collection
names, but not the separate RO stories/vehicle records. The current portable
builder omits `ros/` even though the shell still shows its tab.

## 8. Backup formats and Extract

| Format | Structure | App restore semantics |
| --- | --- | --- |
| `.fvault` v2 | `FVLT`, little-endian uint32 version 2 and metadata length; UTF-8 JSON; alternating raw file/thumbnail bytes described by metadata | Validates the binary structure before writes, then adds records; ID collisions receive new IDs |
| Legacy `.fvault` | JSON `format: "file-vault"`, file/thumbnail base64 fields | Adds records; legacy path has separate validation |
| `.lidb` | ZIP containing `manifest.json` and `files/` PDFs; current writer uses STORE | Restores by document ID, overwriting matching entries after confirmation |
| `.tidb` | `TIDB`, little-endian uint32 version 1 and metadata length; UTF-8 JSON with tools/photo lengths; concatenated photos | Replaces inventory after confirmation |

Vault exports metadata such as tags, note, collection, stars, VINs/FINs, and
timestamps. They do not export the `meta` store (preferences, folder handles,
empty collections), source sync timestamps, RO records, or logs. A structurally
validated import is not a single atomic transaction for every restored record;
write failures can still interrupt restoration. The app does not encrypt backups.

[viewer.html](viewer.html) reads all three formats plus legacy Vault JSON without
restoring app databases. It lists entries and downloads them individually or in a
STORE ZIP with CRC32 and UTF-8 names. Vault output uses collection folders; LI uses
readable document filenames; Inventory outputs `tools.csv`, `tools.json`, and
`photos/`. Thumbnails and application settings are not extracted as user files.
The standalone page embeds its own readers/writer. Deflated LI entries use
`DecompressionStream("deflate-raw")`; ZIP output has a roughly 4 GiB limit and no
ZIP64 support. Viewer parsers are separate from Vault's strict restore validator.

## 9. Shared contracts and storage

### VaultBridge delivery

[bridge.js](bridge.js) uses IndexedDB `vault-bridge` version 2, store `outbox`, with
an auto-incrementing ID and target index. `send(target, {name, type, blob, meta})`
resolves after queue persistence, not after destination import.
`receive(target, handler)` registers a receiver, drains pending items, and returns
an unsubscribe function. `drain(target)` is also exposed.

A receiver atomically claims a row with a token and a time-limited lease (default
five minutes), renewing while the handler runs. A fulfilled handler leads to
acknowledgement/deletion; rejection releases it for retry. A crashed receiver
leaves a recoverable row once the lease expires and another drain occurs.
This supports retries and competing receivers, but is not a transactional
exactly-once guarantee across the receiver's database write and mailbox deletion.
Handlers must return their completion promise and reject failed delivery.

Wakeups occur on send/registration, BroadcastChannel messages, and window focus.
A 2.5-second polling fallback runs only when BroadcastChannel is unavailable.
Failed handlers schedule bounded delayed retries; expiry alone is not a universal
background timer guaranteeing immediate crash recovery.

### Shell message families

| Message | Direction | Effect |
| --- | --- | --- |
| `shell-nav {app, tab?, payload?}` | App → shell | Activate app and forward optional payload |
| `shell-relay {app, payload}` | App → shell | Load target and forward without switching |
| `vault-nav {to:"files"}` | LI → shell | Legacy Vault navigation |
| `shell-add-files {files, collection?, vin?, stay?}` | App → shell | Unified file intake |
| `shell-open-picker` | App → shell | Open top-bar picker |
| `shell-toast {app, msg}`, `li-changed` | App → shell | Notifications/badge refresh |
| `shell-switch {n}`, `shell-quickopen`, `shell-pin-vehicle {vin}` | App → shell | Keyboard/navigation/vehicle context |
| `platform-theme {mode}` | Shell → frames | System/light/dark |
| `platform-backup` | Shell → Vault/LI/Inventory | Per-app exports |
| `toolbox-open {tab}` | Shell → Toolbox | Select utility |
| `li-open`, `li-search`, `li-filter`, `li-restore` | Shell → LI | Document navigation, filters, backup restore |
| `inventory-open`, `inventory-search`, `inventory-filter`, `inventory-import` | Shell → Inventory | Catalog navigation/import |
| `vault-filter`, `vault-search`, `vault-restore` | Shell → Vault | Navigation/import |
| `vault-ro-import`, `vault-ro-apply`, `vault-rename-collection` | Shell → Vault | RO selection, VIN/attachment updates, collection rename |
| `shell-nav {id}` | Shell → RO | Open RO after Vault selection workflow |

The shell queues messages until iframe load; Vault/LI/Inventory also queue their
navigation messages until app boot. Message names alone are not authentication;
current listeners must not be described as enforcing sender-origin validation.

### Storage map

| Store/key | Owner | Contents |
| --- | --- | --- |
| IndexedDB `file-vault`: `files`, `meta` | Vault | File records/Blobs/thumbnails; preferences, collections, folder settings |
| IndexedDB `LIDocsDB`: `docs`, `files`, `settings` | LI | Parsed records, PDFs, autosave/folder handles and flags |
| IndexedDB `tool-inventory`: `tools`, `photos`, `meta` | Inventory | Catalog, edits/stars, photo Blobs, source metadata |
| IndexedDB `repair-orders`: `ros` | RO | RO fields, collection string, story lines, timestamps |
| IndexedDB `vault-bridge`: `outbox` | Bridge | Pending files, claims/leases, attempt state |
| IndexedDB `fv-debug`: `entries` | Logger | Local error/warning/app entries |
| localStorage `fv-theme` | Shell / standalone Vault | Light/dark; absent means system |
| localStorage `fd-app`, `fd-vehicle` | Shell | Last tab and pinned VIN/series |

These are origin/profile scoped for hosted use. `file://` behavior depends on the
browser and launcher configuration. App paths do not isolate databases on one origin.

### Theme and debug log

All seven HTML entry pages (shell plus six apps) read the shared theme before
paint and support embedded theme updates. The shell and standalone Vault expose
the theme cycle; other apps do not all have their own theme-toggle control.

[debug.js](debug.js) is loaded by the shell, Vault, LI, Inventory, and Toolbox,
not RO or Extract. It records uncaught errors, rejected promises, resource errors,
console warnings/errors, and explicit `FVDebug` calls. It labels the five supported
pages by app, with entry fields `{t, level, app, src, msg, stack}`.
Periodic trimming reduces over-600-entry logs to 400; an in-memory fallback is
available when IndexedDB fails. Ctrl+Shift+D or `FVDebug.open()` opens the viewer,
with filtering, copying, downloading, and clearing. Vault/LI/Inventory also have
menu entries. It cannot capture errors that occur before it is loaded.

## 10. Offline assets and network dependencies

| Scope | Worker | Current cache | Strategy |
| --- | --- | --- | --- |
| Platform root | [sw.js](sw.js) | `platform-shell-v16` | Required shell core; tolerant extras including Toolbox, RO, Extract; network-first navigation and cache-first assets; skips Vault/LI/Inventory paths |
| Vault | [vault/sw.js](vault/sw.js) | `vault-app-v29` | Required app core, tolerant shared scripts/icons; network-first navigation; same-origin assets cached on use, including lazy PDF.js |
| LI | [li/sw.js](li/sw.js) | `li-db-shell-v2`, `li-db-runtime-v1` | Tolerant precache; network-first navigation; same-origin assets and OCR hosts cached with background refresh |
| Inventory | [inventory/sw.js](inventory/sw.js) | `tool-inventory-v9` | App-shell precache; network-first navigation; cache-first assets |

Workers prune their own cache prefixes; the root also removes old pre-platform
`file-vault-*` caches. User databases are not stored in service-worker caches.
Tolerant precaching means an install can succeed with an optional asset missing.
Open required apps/features online and verify offline before relying on them.
Toolbox/RO/Extract have no independent worker registration for a first standalone visit.

OCR is the optional external runtime dependency in Vault, LI, and Toolbox:
Tesseract.js 5.1.1, core 5.1.0, and language data from jsDelivr/Project Naptha.
`__TESS_LIB`, `__TESS_WORK`, `__TESS_CORE`, and `__TESS_LANG` override resource paths;
they do not themselves package the resources for offline use. LI's worker caches
OCR hosts, but full offline OCR is not guaranteed across apps. The Inventory
catalog probe is a same-origin fetch. Clicking Toolbox's EXIF GPS link sends the
coordinates to OpenStreetMap. There is no application file-upload backend.

## 11. Build and test map

[package.json](package.json) declares dev dependencies `playwright@1.56.1`,
`pdfjs-dist@4.2.67`, and `esbuild@0.25.5`. The checked-in site needs no application
build. [build-portable.mjs](tools/build-portable.mjs) copies runtime assets and
builds the catalog; it omits RO and deletes/recreates `dist-portable/`.
See the README and [portable guide](portable/START-HERE.txt) for launcher limits.

`npm test` runs static, binary-backup, and Blob-integrity checks, then
[run-e2e.mjs](tools/run-e2e.mjs). E2E discovery uses Git-tracked `tools/e2e*.mjs`,
excluding the browser helper, sorts the list, and stops at the first failure.
There are currently **21 browser suites**. Git metadata, Node/npm, Python 3, and
Playwright-managed Chromium are required for the full workflow.

| Suite under `tools/` | Coverage focus |
| --- | --- |
| `e2e.mjs` | Vault standalone CRUD, search/organization, export/import, theme, PWA behavior |
| `e2e-bridge.mjs` | Lease/ack persistence, in-flight arrivals, retries, receiver crashes, competing receivers |
| `e2e-bulk.mjs` | Multi-selection, bulk metadata/actions, batched Toolbox delivery |
| `e2e-debug.mjs` | Logger capture, persistence, viewer, clearing, shared shell log |
| `e2e-integration.mjs` | Record links, cross-app filters, auto VIN, quick-open, backups, toasts, catalog offer |
| `e2e-inventory.mjs` | Empty start, fixture `.tidb`, photos, filters, edits, import/export, embedding |
| `e2e-merge.mjs` | Vault → LI, LI → Vault, Vault → Toolbox handoffs |
| `e2e-pdf-security.mjs` | PDF.js runtime/parser configuration and malformed-PDF handling |
| `e2e-pdfthumb.mjs` | PDF preview generation, persistence, background backfill |
| `e2e-portable.mjs` | Build, local-file shell/Vault/Inventory, catalog offer, same-path profile restart; clears generated data |
| `e2e-ros.mjs` | RO stories, persistence, attachments, Vault selection, VIN reconciliation, collection rename |
| `e2e-shell.mjs` | Tabs, embedding, theme, hashes/legacy navigation, badges, Toolbox save |
| `e2e-sync.mjs` | Vault folder sync with a mocked picker/directory, dedup, changed-file import, auto mode |
| `e2e-unified-add.mjs` | Mixed-file shell intake and filename-based LI routing |
| `e2e-viewer.mjs` | Backup extraction and ZIP validation using Python's independent ZIP reader |
| `e2e-vin.mjs` | VIN search/grouping/persistence, incremental scan, unavailable OCR |
| `e2e-vin-datacard.mjs` | VIN/FIN separation and false-positive rejection |
| `e2e-vin-parallel.mjs` | Worker concurrency using a fake OCR engine |
| `e2e-vin-recall.mjs` | Space-split VINs, PDF text and mocked OCR fallback |
| `e2e-vin-skip-video.mjs` | Video exclusion from scanning/detection UI |
| `e2e-vin-wmi.mjs` | Mercedes-prefix validation and engine/non-Mercedes rejection |

The portable suite does not validate RO packaging, real Windows/macOS launcher
execution, moving a profile across machines/paths, or zero host traces. Mocked OCR
and directory-picker tests do not prove live CDN availability or OS permission
behavior. The PDF regression is not a comprehensive audit of every malformed PDF.

[qa.yml](.github/workflows/qa.yml) configures the Node 20 release checks and
portable build. [zip-test.yml](.github/workflows/zip-test.yml) independently checks
ZIP extraction with Windows .NET and Explorer. Run the relevant commands to
establish current pass/fail status; the coverage map is not test-run evidence.
