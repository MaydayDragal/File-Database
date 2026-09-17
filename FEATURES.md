# File Database — Features and Application Topology

This map describes the checked-in application. See [README.md](README.md) for
setup, workflows, backups, and portable use. Source links identify the implementation
behind each area; test coverage describes assertions in the repository, not a
passing-test certification.

## 1. Platform topology

One page ([index.html](index.html)), one service worker, one manifest. The
shell ([src/shell/index.js](src/shell/index.js)) owns the top bar and mounts
each feature ([src/features/](src/features/)) into its panel's **shadow root**
the first time its tab is shown or work is routed to it; a mounted feature
stays mounted while another tab is visible. There are no iframes: a feature's
markup, styles and element IDs live inside its own shadow root, so two features
can use the same ID and the same class names without touching each other,
while the theme's tokens are inherited into all of them. Cross-feature work
uses two mechanisms:

| Mechanism | Purpose | Participants |
| --- | --- | --- |
| The shared database ([src/data](src/data/), §9) | Every record; files stored once through one intake; follow-up work as jobs; change events on a bus that reaches every feature and every open tab | Shell and every feature read and write it directly |
| Messages as function calls | Navigation, keyboard commands, restores, the RO's "select in Files" mode: a feature calls `shell.send({type, …})`, the shell calls `instance.receive({type, …})` — the same message contract the iframes once spoke over `postMessage` (§9) | Shell and feature instances |

| Feature key | Folder | What it is |
| --- | --- | --- |
| `vault` (`files` alias) | [src/features/files/](src/features/files/) | Files and organization (the File Vault) |
| `li` | [src/features/documents/](src/features/documents/) | LI library and PDF processing |
| `inventory` | [src/features/inventory/](src/features/inventory/) | Catalog and local edits |
| `toolbox` | [src/features/toolbox/](src/features/toolbox/) | Ten utilities, one file each under `tools/` |
| `ros` | [src/features/ros/](src/features/ros/) | RO records/stories and their attachments |
| `viewer` | [src/features/extract/](src/features/extract/) | Backup extraction, without database restore |

Every feature folder is `index.js` (`route` + `mount(host, shell)`), `app.js`
(the app, `start(root, host, shell)` → an instance with `receive(msg)`),
`markup.js` (its former `<body>`) and `styles.css`. [viewer.html](viewer.html)
still exists as a standalone host of the Extract feature, so a copy of it next to
a backup can always get the files back out; the other per-app pages are gone
(D1) — anyone who installed one installs the platform instead.

## 2. Shell behavior

[src/shell/index.js](src/shell/index.js) and [index.html](index.html) implement:

- Six ARIA tabs with one visible panel, arrow/Home/End navigation, and remembered
  last-used app (`fd-app`).
- Live row-count badges for Vault, LI, and Inventory; refresh on navigation,
  focus/visibility changes, app notifications, and intake timers. Background count
  changes pulse, and background app toasts are relayed to the shell.
- A shared System/Light/Dark theme, applied before paint; [src/styles/tokens.css](src/styles/tokens.css) is the one set of colours, inherited into every feature.
- A unified file picker and drop router. PDF filenames matching
  `/\b[A-Z]{2}\d{2}\.\d{2}-[A-Z]-\d{5,7}\b/i` route to LI. Other ordinary files
  route to Vault. This is filename recognition, not PDF-content classification.
- `.fvault`, `.lidb`, and `.tidb` inputs invoke app restore/import messages instead
  of being stored as ordinary files; an `.fdb` restores the whole platform after a
  confirm. Ordinary inputs up to 256 MiB are eagerly materialized by the intake
  before they are stored; larger files retain their original handle.
- Single-target batches normally surface their destination; mixed batches stay
  on the current tab. `stay:true` keeps an RO upload on its existing tab.
- Optional collection/VIN metadata for Vault intake. An explicit intake VIN wins
  over the pinned vehicle; LI routing does not use those Vault collection fields.
- A pinned active vehicle (`fd-vehicle`). Vault filters by VIN. LI/Inventory scope
  by the three characters at positions 4–6 only if they are all digits. There is
  no external VIN decoder. Unpinning clears these scopes.
- Ctrl/Cmd+K recognition of LI numbers, special-tool numbers, and 17-character
  VINs; arbitrary text offers searches in Vault, LI, and Inventory.
- Alt+1–6 app switching from anywhere on the page. `/` search belongs to the
  Vault, LI, and Inventory handlers (each listens on its own shadow root, so a
  shortcut acts only when the focus is inside that feature); the shell focuses
  the feature's panel on activation unless the user is already typing.
- **Back up everything** downloads one `.fdb` with every store (files, LI
  documents, tools, repair orders, links, plain-data settings) and then sends
  `platform-backup` to Vault, LI, and Inventory at 1.2-second offsets for the
  per-app formats. Folder handles, jobs and the log are excluded.
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
| `?view=starred`, `?action=add` | Legacy PWA shortcuts: the starred filter, the platform's file picker |

Consumed queries are removed. Hash changes route in place. Links resolve against
local browser data; sharing a link does not share its document. RO has a tab route
but no implemented record-ID hash router.

## 3. File Vault

Implementation: [src/features/files/](src/features/files/) (`app.js`, the
repos adapter `db.js`, `blob-integrity.js`); the strict backup validator is
[src/core/formats/fvault.js](src/core/formats/fvault.js) and the VIN/FIN
classifier [src/core/vin.js](src/core/vin.js) (see §10).

| Area | Implemented behavior |
| --- | --- |
| Intake | Picker, drag/drop, paste and linked-folder import all go through the shared intake; embedded intake forwards through the shell; files stored by other contexts appear through the change bus |
| Stored-file checks | The intake materializes ordinary additions up to 256 MiB, hashes them (SHA-256), re-reads the stored bytes and compares the hash; a failed verification removes the record and reports the file |
| Classification | Images, videos, audio, PDFs, documents, spreadsheets, presentations, text/code, archives, other |
| Thumbnails | Canvas images, video frame grabs, first-page PDF.js renders ([src/services/thumbs.js](src/services/thumbs.js)), made by `thumb` jobs this app runs (queued by the intake, and on boot for PDFs without one) |
| Preview | Image/video/audio, native PDF iframe, text up to 512 KiB, fallback icon for unsupported types |
| Organization | One collection per file, tags, note, star, editable filename, VINs and FINs |
| Search/filter | Metadata search; type/collection/tag/VIN filters; All, Starred, Recent, By VIN; active-filter chips |
| Sort/view | Date, name, size; grid/list saved in DB metadata |
| Selection | Checkboxes, Ctrl/Cmd-click, Shift-click ranges, select-all, Escape; collection/tag/VIN/star/delete bulk actions |
| Bulk outputs | Folder downloads with read-back comparison or individual-download fallback; PDFs to LI; compatible same-kind batches to Toolbox |
| Local storage | Usage/quota display and `navigator.storage.persist()` request |
| Keyboard | `/` search, `a` add, `g` grid, `l` list, Escape overlays/selection |

PDF.js is pinned to **4.2.67**, generated from the npm package by
[tools/vendor-pdfjs.mjs](tools/vendor-pdfjs.mjs) into `vendor/` — one copy for
every page, loaded on demand by [src/services/pdf.js](src/services/pdf.js) the
first time a page needs it (§10). Preview support is distinct from accepting and
storing a file.

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
with load/recognition timeouts. A page that yields no VIN is checked for which
way up it is and read again ([ocr.js](ocr.js)); a page that yielded one is not. Files needing unavailable OCR remain eligible for
retry. `__VIN_OCR_WORKERS` and `__VIN_OCR_*` globals support controlled overrides.

### Folder sync

One implementation, [src/services/folder-sync.js](src/services/folder-sync.js),
serves this app and LI Documents; each supplies where its handle is kept, what it
already holds and how it imports. Vault stores the handle in `vault.syncDir`
and auto mode in `vault.syncAuto` (LI: `li.syncDir`, `li.autoSyncOn`). Scans
recurse with depth/file-count limits and match filename, size, and source
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

[src/features/documents/](src/features/documents/) is the feature (`markup.js`,
`app.js`, `styles.css`); JSZip is the page script
`vendor/jszip.min.js`, PDF.js the shared on-demand copy, the OCR worker pool
and folder sync the shared services (§10). Text normalization, the document-number matchers and
the text-to-record extraction are the shared [src/core](src/core/) modules
`text.js`, `ids.js` and `li-parse.js` (§10); the Toolbox's LI renamer runs the same code.

- Imports individual PDFs, folders and drops, and runs `li-import` jobs for PDFs
  the intake or the Files app stored (the document is filed against that same
  record); extracts document number, version, title, reason for change, function
  group, date, and validity.
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
on existing records. Inventory uses shell messages and the shared `tools`,
`photos` and `settings` stores.

## 6. Toolbox

Implementation: [src/features/toolbox/](src/features/toolbox/): `markup.js`
holds the tab bar; each tool is one file under `tools/` exporting its panel
markup and `init(root)`; `app.js` is tab switching and the platform integration,
`styles.css` the styles. pdf-lib and JSZip are page scripts from `vendor/`; PDF.js is the
shared on-demand copy (§10).

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

The route is `#toolbox/<key>`. Files sent from Files arrive as a `toolbox-intake`
job that selects a tab and injects them into its input. Output download helpers offer
**Save to File Vault**. Browser codecs and API support constrain available media
and filesystem operations. A ZIP target cannot make an indivisible oversized
source file arbitrarily small.

## 7. Repair Orders

[src/features/ros/](src/features/ros/) stores records in `repair-orders/ros` separately
from Vault. Fields are RO number, vehicle text, VIN, tag, mileage in, colour, open
date, customer, service advisor, phone, e-mail, collection association, story
lines, and timestamps; a record created from a scan also keeps that scan's
recognized text. Stories use independently removable textareas labelled
Line A/B/etc., each with an operation-code box; editing is debounced by 400 ms.
Older records migrate: a single note becomes the first line, and missing fields are
backfilled as empty strings on load. The list is ordered by last update.

Files live in Vault, associated by a single collection string: `RO <number>`, or
an ID-derived fallback when there is no number. RO numbers are not unique database
keys, so repeated numbers can share the same attachment collection.

| Action | Implementation and effect |
| --- | --- |
| Upload | Stored straight through the shared intake into the RO's collection with an `attachment` link (ro → file); the reconciliation waits for the intake's `vin-detect` job (run by the Files app) instead of polling |
| Import existing files | `vault-ro-import` opens normal Vault selection UI; **Add to RO** changes selected records' collection, links them to the RO, then returns to the RO |
| VIN reconciliation | Fill a missing VIN from the RO; keep matching VINs; prompt on mismatch and preserve original VINs when accepted |
| Upload reconciliation | Written directly: links and collection for kept files, the RO VIN stamped on files without one; ignored uploads are unlinked and become uncategorized |
| Existing-file mismatch | Vault uses `confirm()`; cancel skips the mismatched files |
| Attachment listing | The RO's `attachment` links joined with the file records; refreshed by change events; VIN badges and Vault navigation |
| Rename | The RO renames the collection on its files itself (`files.renameCollection`) |
| Unique numbers | `ros.roKey` is a unique index (D7): a number another RO holds is refused and the field shows "Not saved" |
| Delete RO | Deletes the RO record and its links, leaving the files |

### Scanning a paper RO

**📷** in the sidebar reads a printed RO into a new record. Sources are images and
PDFs, up to four pages, all parsed as one document.

| Stage | Implementation |
| --- | --- |
| Read | PDF text layer first (the shared PDF.js, `isEvalSupported: false`), rebuilt into positioned rows from each text item's transform (x, y flipped to count down the page); under 200 letters it is treated as a scan and pages render at scale 2.2 for OCR. Recognized pages contribute the same rows from `data.lines` bounding boxes |
| Recognize | Tesseract.js 5.1.1 through the shared loader ([src/services/ocr.js](src/services/ocr.js): from `cdn.jsdelivr.net`, overridable with `window.__TESS_LIB/_WORK/_CORE/_LANG`); one worker per scan, terminated on success and on failure. Reads go through [ocr.js](ocr.js) in page-segmentation mode 3 at a 2200–3300 px long edge |
| Orientation | [ocr.js](ocr.js) `readUpright`: page 1 of each scan is probed, later pages follow its answer. A scan is a deliberate action, so it always pays for the probe rather than settling for a first read |
| Parse | `parseScan(text, pages)` — labelled values run until the next known label on the row, and every occurrence of a label is a candidate so a field can be taken from the row beneath its own empty cell; a value is cut at a column rule (`\|`, `*`, `¢`, a stray `:`). VIN uses the Vault's MB-WMI rules plus the same I→1 / O→0 OCR repair |
| VIN | Read twice. The whole-page read is joined by a second, closer read of the row the VIN sits on: cropped out, enlarged, page-segmentation mode 7, and the engine restricted to a VIN's own alphabet (no I, O or Q). ISO 3779's check digit at character 9 picks the winner — of the readings one marginal scan gave for a real VIN, only the correct one passes it. The digit only ever PREFERS a reading, never rejects the only one there is, and the review flags a VIN that fails it. Which magnification works is not predictable (the same strip read correctly at 2x and 4x and wrongly at 3x on one scan), so it is read at each until one checks out. When a scan loses the number AND its own `VIN` label, there is no row to go back to: the header rows wide enough to hold seventeen characters are swept instead, one magnification each, and only a reading that passes the check digit is taken — a guess that cannot check itself is worse than nothing there |
| Faint header cells | `Mileage In` and `RO Open Date` sit in inch-wide boxes in the same dot-matrix as the VIN, and a worn copy loses the value while keeping the label: a whole page reads `Mileage In: Bus Ph: 13` — the label, then the NEXT label. `cellSpan` takes the box from the end of the label's own words to the start of the words that open the next label (a label is known by its colon, and the short words leading up to it — `Bus`, `Home` — belong to it). `refineCells` crops that box, thresholds it where the paper's own histogram peak ends rather than against the whole page (which is what puts a 74% grey number on the paper side of one threshold when the labels are 43% grey and the paper 94%), wipes columns and rows that are almost entirely ink (the printed rules), drops ink blobs too small to be a character or too long and thin to be anything but what is left of a rule, crops to the ink that survived, and reads it in mode 7 over that cell's own characters. Reading twice and demanding agreement was tried and measured as no help — on one scan two magnifications agreed on a wrong number, on another they disagreed over a right one — so the first reading of the right shape is taken and the review says it came off the second pass |
| Column bleed | When a worn copy loses a small printed label there is nothing to cut the value at, and it runs into its neighbour's: `RO Open Date:` reads back `08-31-26 678.979.7260`, `Mileage In:` reads back `15258 jilblues28@amail com`. Both are taken as the first run in the cell shaped like what belongs there — a number, or a date — rather than as everything after the label |
| Fields OCR loses | A tag is taken from whichever occurrence looks like a tag (`T7910` over `17910`); the model year falls back to VIN position 10 (position 7 picks the 30-year cycle) when the `Year` cell is lost; the model falls back to the printed `MERCEDES BENZ <model>`; the colour falls back to a capitalised colour word in the header, so "Jill Blue" is not one; a phone cell missing a digit is shown rather than dropped |
| Lines (layout) | `layoutLines(rows)` reads the table from where each WORD sat, because the engine returns a two-column row as one line about as often as two. The descriptions column begins at the right edge of the last heading before `INSTRUCTIONS` — not at that heading's own left edge, which is centred over a wide column and would clip every description. When nothing was read to the left of that heading there is no edge to measure, and the descriptions are taken instead by the other thing that separates the columns: the table is printed in capitals and the small print beside it is not. Every row is cut at that edge, rows with nothing in the column are dropped, and what remains is cut into lines on vertical gaps over 0.75 × the median row height. The op code is read from the cells beside the description, and only when the LINE cell beside it was read too: the line letter vouches for having found the right cells, so `ph pn Ya` / `i sat tbc I HE` off the neighbouring column cannot become an op code. Case and confidence are deliberately not used — the engine reads a printed `CV` as `cv` about as often as not, and rated a correct `cw` at 18% — so once the cell is vouched for its token is shown as read. `CW` and `CV` are op codes on these ROs, not pay types; only `CC` is treated as one |
| Lines (text) | Used when the layout separated nothing — a PDF text layer has no table rules to find. Rows opening `# A`, `# B`… in letter order (the marker may sit mid-row on a flattened form), wrapped continuations joined (a word-final hyphen closes the word, a standalone dash does not), then `<op code> <pay type>` split off the front. A row carrying the other column's prose contributes only its trailing run of capitals, and is offered as its own line rather than joined to a line it may not belong to. DISPATCH: `\d\) <letter> <skill> <status> <description>` with the numeric columns trimmed. Neither matching falls back to any line reading like a complaint |
| Review | Nothing is written until **Create**; fields, op codes, and line text are editable, lines can be dropped or unticked, and the whole recognized text is shown. A note found under a dispatch print-out is offered unticked |
| Existing RO | Same RO number switches to update: blank fields are filled, lines not already present (compared case- and space-insensitively) are appended, empty placeholder lines are dropped |
| The scan itself | Inside the shell, the source files are added to the RO's Vault collection through the normal upload path |

The platform service worker caches `cdn.jsdelivr.net` and
`tessdata.projectnaptha.com` responses cache-first with background revalidation, so
recognition keeps working offline after one successful download.

File workflows require the shell. There is **no RO export/import or
`platform-backup` handler**. Vault backups contain attached files and collection
names, but not the separate RO stories/vehicle records.

### Reading a scan (shared by every app)

[ocr.js](ocr.js) is loaded by Vault, LI, Toolbox and Repair Orders so all four
read scans the same way; the engine itself comes from one loader,
[src/services/ocr.js](src/services/ocr.js). It exists
because the engine is wrong twice by default on workshop paperwork, and neither
failure is reported — both come back as a thin, plausible-looking read.

| Problem | What ocr.js does |
| --- | --- |
| Tesseract.js defaults to page-segmentation mode 6, "one uniform block of text", which drops most of a form | `prepare()` sets mode 3 (automatic) once per worker before any read. On a 300 dpi repair order this moves 4 of 16 expected fields to 14 of 16, and the whole vehicle/customer table reappears |
| A page fed through the scanner sideways is not an error to the engine — it returns a handful of low-confidence words | `bestAngle()` recognizes a band of the page at 0°/90°/270°/180° and counts the words the engine rated ≥ 60% confident. On the same order the right way up scores 47–73 such words and every other rotation 0–14 |

Mechanics that matter:

- The probe runs at a **2200 px long edge**. At 1100 px nothing is legible at any
  rotation (every angle scored 0–5), so a cheap small probe decides nothing and
  silently picks 0° — which is how a sideways scan used to read as almost
  nothing.
- The probe measures in **mode 6**, not mode 3. Mode 3 partly reads a sideways
  page, which is what you want when reading and useless for telling which way up
  it is.
- It reads a **band** of the inked area, not the page: ~3× cheaper and just as
  decisive. `inkBox()` finds the marked region on a 240 px thumbnail first,
  because a band across the middle of a half-empty page is blank paper. A bad
  ink box only mis-aims the probe — the read itself is never cropped.
- A rotation that reads well stops the probe, so an upright page costs one band.
  If no rotation reads at all, 0° is kept rather than turning an unreadable page.

| Caller | Strategy |
| --- | --- |
| Repair Orders scan | `readUpright` — always probe (user-initiated, once per job) |
| Vault VIN scan | `readSmart` with `accept` = a VIN was found; a page that yielded one never pays for the probe |
| LI import, Toolbox LI rename | `readSmart` with `accept` = a document number was found; later pages reuse page 1's angle |
| Toolbox Image to Text | `readUpright` — one image at a time, so accuracy over speed |

Every feature degrades to a plain read if `ocr.js` is missing from the cache.

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

The Extract feature ([src/features/extract/](src/features/extract/) — the
platform's Extract tab, and [viewer.html](viewer.html) standalone) reads all
three formats plus `.fdb` and legacy Vault JSON without restoring app databases. It lists entries and downloads them individually or in a
STORE ZIP with CRC32 and UTF-8 names. Vault output uses collection folders; LI uses
readable document filenames; Inventory outputs `tools.csv`, `tools.json`, and
`photos/`. Thumbnails and application settings are not extracted as user files.
The readers and the ZIP writer are the shared [src/core/formats](src/core/formats/)
modules (`container.js`, `zip.js`, `fvault.js`, `tidb.js`, `lidb.js`), which the
standalone page loads by relative path. Deflated LI entries use
`DecompressionStream("deflate-raw")`; ZIP output has a roughly 4 GiB limit and no
ZIP64 support. The Extract reader (`fvault.readLoose`) trusts the metadata and
slices what it describes; the Vault's restore uses `fvault.parseBinary`, which
validates the whole file first. Both live in the same module.

## 9. Shared contracts and storage

### The data layer (`src/data/`)

One IndexedDB database per **generation** (`file-database-<n>`, named by
`localStorage` `fdb.generation`), one schema ([schema.js](src/data/schema.js)),
opened only by [db.js](src/data/db.js). `FDData.boot()` is the first call every
page makes: it migrates the pre-Phase-2 databases on a profile that still has
them (dialog in [src/ui/migrate-dialog.js](src/ui/migrate-dialog.js); verified
by counts and every blob's SHA-256, a `.fdb` export offered, then the old
databases deleted — D2, D8), cleans up leftovers, opens the live generation and
requeues jobs a dead page left running.

| Module | Owns |
| --- | --- |
| `repos.js` | `files` / `blobs` / `thumbs`, `documents`, `tools`, `photos`, `ros`, `links`, `jobs`, `settings`, `log`: the same verbs everywhere, `rev` on every write and `expectedRev` checks (`RevConflict`), commit = transaction complete, `<store>:changed` on the bus after each commit; blobs immutable with their `sha256`; an LI document's PDF is a `files` record (`inFiles 0`, `docId`); `ros.roKey` unique (`RoConflict`) |
| `bus.js` | `emit`/`on` on an `EventTarget` mirrored over `BroadcastChannel("file-database")`; `detail.remote` marks events from another context |
| `jobs.js` | `enqueue`, `register` (runs a type's queue in this page under `navigator.locks`), heartbeat, cancel, retry up to 5, stale requeue, `whenDone` |
| `intake.js` | `ingest(target, files, opts)`: eager read, store with verification, per-file results, then the follow-up job (`thumb` + `vin-detect` for Files, `li-import`, `toolbox-intake`) and an RO `attachment` link when `roId` is given |
| `backup.js` | `collect()` → one `.fdb` ([src/core/formats/fdb.js](src/core/formats/fdb.js), magic `FDBK`) read in a single transaction so every store is from the same instant; `restore()` into a new generation, verified (counts, a payload behind every file record, every blob's hash), then the pointer flips and the old generation is deleted |
| `migrate.js` | `status()` / `run()`: `file-vault`, `LIDocsDB`, `tool-inventory`, `repair-orders` → one generation; a legacy database counts as holding data when any of its stores does; anything already in the live generation (a skipped migration, a restore) is carried into the merged one first and legacy records whose ids it already holds are skipped; files in an RO's collection become links; colliding RO numbers keep the older record's key |

Jobs today: `thumb`, `vin-detect` (the quick, OCR-free read on arrival) and
`vin-scan` (the manual scan) run in the Files feature; `li-import` in LI
Documents; `toolbox-intake` in the Toolbox. The shell mounts the feature that
runs a queued job.

### Cross-feature messages

The contract the iframes spoke over `postMessage`, kept verbatim as function
calls: a feature's `shell.send(msg)` is the shell's inbound handler, the shell's
`deliver(app, msg)` is the feature instance's `receive(msg)` (queued until the
feature has mounted). Phase 5 turns these into direct repo/feature calls
(REWRITE-PLAN.md Appendix A).

| Message | Direction | Effect |
| --- | --- | --- |
| `shell-nav {app, tab?, payload?}` | App → shell | Activate app and forward optional payload |
| `shell-relay {app, payload}` | App → shell | Load target and forward without switching |
| `vault-nav {to:"files"}` | LI → shell | Legacy Vault navigation |
| `shell-add-files {files, collection?, vin?, roId?, stay?}` | App → shell | Unified file intake |
| `shell-open-picker` | App → shell | Open top-bar picker |
| `shell-toast {app, msg}`, `li-changed` | App → shell | Notifications/badge refresh |
| `shell-switch {n}`, `shell-quickopen`, `shell-pin-vehicle {vin}` | App → shell | Keyboard/navigation/vehicle context |
| `platform-backup` | Shell → Vault/LI/Inventory | Per-app exports |
| `toolbox-open {tab}` | Shell → Toolbox | Select utility |
| `li-open`, `li-search`, `li-filter`, `li-restore` | Shell → LI | Document navigation, filters, backup restore |
| `inventory-open`, `inventory-search`, `inventory-filter`, `inventory-import` | Shell → Inventory | Catalog navigation/import |
| `vault-filter`, `vault-search`, `vault-restore` | Shell → Vault | Navigation/import |
| `vault-ro-import` | Shell → Vault | RO "select in Files" mode |
| `shell-nav {id}` | Shell → RO | Open RO after Vault selection workflow |

The shell queues messages until iframe load; Vault/LI/Inventory also queue their
navigation messages until app boot. Message names alone are not authentication;
current listeners must not be described as enforcing sender-origin validation.

### Storage map

| Store/key | Owner | Contents |
| --- | --- | --- |
| IndexedDB `file-database-<n>`: `files`, `blobs`, `thumbs` | Files (and LI for its PDFs) | Metadata (`inFiles`, `collection`, `tags`, `vins`, `docId`, `rev`…), immutable bytes with `sha256`, previews |
| `documents` | LI | Parsed records with `fileId` |
| `tools`, `photos` | Inventory | Catalog, edits/stars, photo Blobs |
| `ros`, `links` | RO | RO fields and story lines; typed relations (`ro → file attachment`) |
| `jobs` | every app | Queued/running/done work with progress and attempts |
| `settings` | every app | `vault.*`, `li.*`, `inventory.*`, `migration`, `backup.restored` (folder handles included; not exported) |
| `log` | (reserved) | The logger still writes `fv-debug`; it moves here when the pages collapse into one (Phase 4), so one boot gates its writes |
| IndexedDB `fv-debug`: `entries` | Logger | Local error/warning/app entries |
| localStorage `fdb.generation` | Data layer | The live generation's name |
| localStorage `fv-theme` | Shell / standalone Vault | Light/dark; absent means system |
| localStorage `fd-app`, `fd-vehicle` | Shell | Last tab and pinned VIN/series |

These are origin/profile scoped for hosted use. `file://` behavior depends on the
browser and launcher configuration. The page and the standalone `viewer.html`
share the origin's storage.

### Theme and debug log

The page reads the shared theme before paint; the shell's toggle cycles it and
[src/styles/tokens.css](src/styles/tokens.css) restyles every feature at once
(the Vault's own toggle is hidden).

[debug.js](debug.js) is loaded once by the page, before everything else. It
records uncaught errors, rejected promises, resource errors, console
warnings/errors, and explicit `FVDebug` calls, labelling each entry with the
feature on screen at the time (`app`), with entry fields
`{t, level, app, src, msg, stack}`.
Periodic trimming reduces over-600-entry logs to 400; an in-memory fallback is
available when IndexedDB fails. Ctrl+Shift+D or `FVDebug.open()` opens the viewer,
with filtering, copying, downloading, and clearing. Vault/LI/Inventory also have
menu entries. It cannot capture errors that occur before it is loaded.

## 10. Shared core (`src/core/`)

Pure code every page loads as a classic `<script>` (it attaches to
`window.FDCore`) and the unit tests import from Node. Moved out of the apps in
[REWRITE-PLAN.md](REWRITE-PLAN.md) Phase 1 without behaviour change; the golden
checks in `tests/` prove it.

| Module | Owns | Loaded by |
| --- | --- | --- |
| `text.js` | `normChars`/`normText`/`normLI`, Windows-safe `sanitize`/`cleanTitle` | every page |
| `ids.js` | the LI document-number matcher (`detectLI`, fuzzy OCR form, versions, canonical key), tool numbers, VIN shape, model series | every page |
| `li-parse.js` | lines from PDF.js items, title and field extraction, renamed filename, `buildRecord()` | LI, Toolbox |
| `vin.js` | the VIN/FIN classifier (`findVinsDetailed`), the ISO 3779 check digit, model year from a VIN | Vault, Repair Orders |
| `ro-parse.js` | the RO scan parser: `parseScan`, `layoutLines`, DISPATCH screens, cell spans, the VIN sweep, rows from a text layer or a recognized page | Repair Orders |
| `hash.js` | SHA-256 of a Blob/bytes/string: WebCrypto up to 256 MiB, a streaming JS implementation above | every page |
| `formats/` | `container.js` (magic + version + JSON + payloads), `zip.js`, `fvault.js` (strict and loose readers, legacy JSON), `tidb.js`, `lidb.js`, `fdb.js` (the whole-platform backup, strict) | every page (`fdb`), Vault, Extract |

### Shared services (`src/services/`)

Browser-side machinery the apps used to carry in copies, moved out in Phase 3
(classic scripts on `window.FDServices`; they touch the DOM and the network, so
the browser suites cover them).

| Module | Owns | Loaded by |
| --- | --- | --- |
| `vendor.js` | where `vendor/` is (from its own script URL) and a cached one-shot script loader | every page that loads a service |
| `pdf.js` | the one PDF.js: `load()` injects `vendor/pdf.min.js` on first use, points it at `vendor/pdf.worker.min.js`, resolves with the library; `window.__PDFJS_SRC/_WORKER` override | Vault, LI, Toolbox, Repair Orders |
| `ocr.js` | `tess.load()` / `tess.createWorker(lang, opts)` for Tesseract.js (`window.__TESS_*` override the resource paths) and `ocrPool.create()` — LI's capped, reusable worker pool | Vault, LI, Toolbox, Repair Orders |
| `thumbs.js` | `make(file, kind)`: image re-encode, video frame grab, first PDF page | Vault |
| `folder-sync.js` | link a folder, scan it with depth/count limits, dedupe by name + size + mtime, auto-sync on a timer/focus/visibility; the feature supplies persistence, its index and its import | Vault, LI |

The vendored runtimes are real files under `vendor/` — PDF.js main + worker
(generated by [tools/vendor-pdfjs.mjs](tools/vendor-pdfjs.mjs)), JSZip 3.10.1,
pdf-lib 1.17.1 — never inlined into a page; `vendor-pdfjs --check` and the
static policy's 300 KB rule ([tools/test-static.mjs](tools/test-static.mjs))
keep it that way.

## 11. Offline assets and network dependencies

| Scope | Worker | Current cache | Strategy |
| --- | --- | --- | --- |
| The page | [sw.js](sw.js) | `file-database-v1`, `platform-runtime-v1` | Required core (the page, the shell, the theme); every feature, service, vendor runtime and icon precached tolerantly on install (generated list, verified against the tree); network-first navigation; cache-first assets |

One visit precaches the whole platform, every feature included. The worker
prunes its own old caches and everything the pre-Phase-4 workers left behind
(`platform-shell-*`, `file-vault-*`, `vault-app-*`, `li-db-*`,
`tool-inventory-*`). User databases are not stored in service-worker caches.
Tolerant precaching means an install can succeed with an optional asset missing.

OCR is the optional external runtime dependency in Vault, LI, Toolbox and
Repair Orders:
Tesseract.js 5.1.1, core 5.1.0, and language data from jsDelivr/Project Naptha.
`__TESS_LIB`, `__TESS_WORK`, `__TESS_CORE`, and `__TESS_LANG` override resource paths;
they do not themselves package the resources for offline use. The worker caches
the OCR hosts once fetched, but full offline OCR is not guaranteed. The Inventory
catalog probe is a same-origin fetch. Clicking Toolbox's EXIF GPS link sends the
coordinates to OpenStreetMap. There is no application file-upload backend.

## 11. Build and test map

[package.json](package.json) declares dev dependencies `playwright@1.56.1`,
`pdfjs-dist@4.2.67`, `esbuild@0.25.5` and `fake-indexeddb@6.2.5` (the data layer's
Node tests). The checked-in site needs no application
build. [build-portable.mjs](tools/build-portable.mjs) copies runtime assets and
builds the catalog; it omits RO and deletes/recreates `dist-portable/`.
See the README and [portable guide](portable/START-HERE.txt) for launcher limits.

`npm test` runs the static, unit (`tests/unit/`, incl. the data layer), LI-number,
binary-backup and Blob-integrity checks, then [run-e2e.mjs](tools/run-e2e.mjs).
E2E discovery uses Git-tracked `tools/e2e*.mjs`, excluding the browser and
database helpers, sorts the list, and stops at the first failure. There are
currently **25 browser suites**; they drive the one page (a feature's elements
are addressed through its panel, `page.locator("#view-li").locator(…)`, which
pierces the shadow root) and read and seed the shared database through
[tools/e2e-db.mjs](tools/e2e-db.mjs). Git metadata, Node/npm, Python 3, and
Playwright-managed Chromium are required for the full workflow.

| Suite under `tools/` | Coverage focus |
| --- | --- |
| `e2e.mjs` | Vault standalone CRUD, search/organization, export/import, theme, PWA behavior |
| `e2e-bulk.mjs` | Multi-selection, bulk metadata/actions, batched Toolbox delivery |
| `e2e-debug.mjs` | Logger capture, persistence, viewer, clearing, shared shell log |
| `e2e-integration.mjs` | Record links, cross-app filters, auto VIN, quick-open, backups, toasts, catalog offer |
| `e2e-inventory.mjs` | Empty start, fixture `.tidb`, photos, filters, edits, import/export, embedding |
| `e2e-merge.mjs` | Vault → LI, LI → Vault, Vault → Toolbox handoffs over the shared database |
| `e2e-migrate.mjs` | First-launch migration of a profile seeded with all four legacy databases: dialog, verify, `.fdb` offer, deletion, every app reading the result; a forced verification failure leaving everything untouched |
| `e2e-pdf-security.mjs` | PDF.js runtime/parser configuration and malformed-PDF handling |
| `e2e-pdfthumb.mjs` | PDF preview generation, persistence, background backfill |
| `e2e-portable.mjs` | Build, local-file shell/Vault/Inventory, catalog offer, same-path profile restart; clears generated data |
| `e2e-ocr-orient.mjs` | ocr.js itself: render geometry, ink box, which rotation is chosen and when probing stops, document mode for reads and block mode for probes, and probing only when the caller's test fails |
| `e2e-ro-scan.mjs` | Scan parsing of both dealer layouts and of a verbatim 300 dpi OCR read of the printed form (flattened columns, mangled tag, lost Year/Model/Color labels, clipped phone), the line table read from page layout, text-layer PDF intake, the review step, updating an existing RO, and the orientation probe with a fake OCR engine |
| `e2e-ros.mjs` | RO stories, persistence, attachments, Vault selection, VIN reconciliation, collection rename |
| `e2e-shell.mjs` | Tabs, embedding, theme, hashes/legacy navigation, badges, Toolbox save |
| `e2e-sync.mjs` | Vault folder sync with a mocked picker/directory, dedup, changed-file import, auto mode |
| `e2e-unified-add.mjs` | Mixed-file shell intake and filename-based LI routing |
| `e2e-viewer.mjs` | Backup extraction and ZIP validation using Python's independent ZIP reader |
| `e2e-vin.mjs` | VIN search/grouping/persistence, incremental scan, unavailable OCR |
| `e2e-vin-datacard.mjs` | VIN/FIN separation and false-positive rejection |
| `e2e-vin-orient.mjs` | A sideways photo whose VIN only appears once the page is turned, using a scripted engine |
| `e2e-vin-parallel.mjs` | Worker concurrency using a fake OCR engine |
| `e2e-vin-recall.mjs` | Space-split VINs, PDF text and mocked OCR fallback |
| `e2e-vin-skip-video.mjs` | Video exclusion from scanning/detection UI |
| `e2e-vin-wmi.mjs` | Mercedes-prefix validation and engine/non-Mercedes rejection |

The portable suite does not validate real Windows/macOS launcher execution, moving
a profile across machines/paths, or zero host traces. Mocked OCR and
directory-picker tests do not prove live CDN availability or OS permission
behavior, and the scan suite proves the parser and the plumbing around it rather
than how well a real photograph is recognized. The PDF regression is not a comprehensive audit of every malformed PDF.

[qa.yml](.github/workflows/qa.yml) configures the Node 20 release checks and
portable build. [zip-test.yml](.github/workflows/zip-test.yml) independently checks
ZIP extraction with Windows .NET and Explorer. Run the relevant commands to
establish current pass/fail status; the coverage map is not test-run evidence.
