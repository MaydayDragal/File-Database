# File Database

File Database is a local-first web application for workshop files, Mercedes-Benz
LI documents, special tools, and repair orders. A single platform page hosts six
apps. Files and records are stored in the browser; there is no application
backend, account, or server database.

See [FEATURES.md](FEATURES.md) for the feature map, storage formats, cross-app
contracts, service workers, and test coverage.

## Apps

| App | What it does | Direct entry point |
| --- | --- | --- |
| File Vault | Store, preview, search, tag, star, and group files by collection or VIN | [vault/index.html](vault/index.html) |
| LI Documents | Parse Mercedes-Benz LI PDFs, organize versions, compare changes, and export renamed documents | [li/index.html](li/index.html) |
| Tool Inventory | Open a portable special-tool catalog, search/filter it, and edit locations, quantities, notes, and comments | [inventory/index.html](inventory/index.html) |
| Toolbox | Ten file and workshop utilities, including PDF tools, compression, OCR, and calculators | [toolbox/index.html](toolbox/index.html) |
| Repair Orders | Keep an RO number, vehicle, VIN, and multiple story lines; associate files stored in the Vault | [ros/index.html](ros/index.html) |
| Extract | Open `.fvault`, `.lidb`, or `.tidb` backups and download ordinary files | [viewer.html](viewer.html) |

The shell loads each app on first use and keeps it open when you switch tabs.
Vault, LI Documents, and Tool Inventory have their own PWA manifests and service
workers. Toolbox, Repair Orders, and Extract use the platform's service worker.
Repair Order notes work standalone; its file workflows require the platform shell.

## Getting started

### Serve the repository

Use Edge or Chrome for the folder-picker and portable workflows. To run locally
with Python 3 already installed, run this from the repository root:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`. `npm start` runs the same command. No dependency
installation or application build is required to serve the checked-in files.

For deployment, publish the static files to an HTTPS host, keeping the directory
structure intact. For a branch-based GitHub Pages deployment, select the branch
containing this application and its root folder. This checkout's default branch
is `claude/pwa-file-database-hqbppy`; do not assume a `main` branch exists.

Install and service-worker caching require HTTPS or a supported loopback address
such as `localhost`. Ordinary HTTP on a remote host does not enable these features.
The Install button appears when the browser offers installation.

Keep using the same origin (scheme, hostname, and port) and browser profile.
Switching between a hosted site, localhost, another port, or another profile
opens a separate set of databases. App paths on the same origin share storage.

### Opening local HTML files

You can try opening `index.html` directly. `file://` has no PWA installation or
service-worker caching, and storage, local resource loading, and cross-app
behavior depend on the browser. Use the portable launcher for the repository's
intended local-file configuration, or serve the site for normal daily use.

## Adding and finding files

The platform's **Add files** button accepts mixed batches. Filename-based routing
sends a PDF with a Mercedes document number such as `LI54.10-P-070001` to LI
Documents; other ordinary files go to the Vault. The router does not inspect PDF
contents to choose an app. A PDF without that name pattern can be sent to LI from
its Vault detail panel.

Dropping `.fvault`, `.lidb`, or `.tidb` files on the platform opens the corresponding
app's import/restore flow. To extract files without restoring a database, open
**Extract** first and choose the backup there.

File Vault supports:

- Drag and drop, clipboard paste, file selection, and folder imports.
- Type filters for images, videos, audio, PDFs, documents, spreadsheets,
  presentations, text/code, archives, and other files.
- Image, video, and PDF thumbnails; image/video/audio/PDF previews; inline text
  previews up to 512 KiB. Other formats can be stored and downloaded even when
  an inline preview is unavailable.
- Collections, tags, notes, stars, grid/list views, and search across metadata,
  including VINs and FINs. Vault search is not a full-content document search.
- Multi-select with checkboxes, Ctrl/Cmd-click, Shift-click ranges, and select-all;
  bulk collection, tag, VIN, star, delete, download, and cross-app actions.
- Bulk downloads to a chosen folder with read-back verification, or individual
  browser downloads when the folder API is unavailable.
- PDF handoffs to LI Documents and supported file handoffs to Toolbox. LI can
  copy renamed PDFs back to the Vault; Toolbox outputs offer **Save to File Vault**.

### VINs and the active vehicle

Files added directly or through the shell receive a background VIN read from
filenames, supported text, and PDF text layers. Folder-sync imports use a separate
path; run the manual scan for those files. Use **Scan files for VINs** for the fuller scan, including
image/scanned-PDF OCR when its engine is available. Videos are skipped. Detection
uses Mercedes-specific manufacturer prefixes and heuristics; it is not a general
VIN decoder. VIN and FIN fields can be edited in the file detail panel.

The **By VIN** view groups files by vehicle. Pin a VIN from a vehicle header,
related-file chips, or Ctrl/Cmd+K to make it the active vehicle. New files routed
to the Vault can then receive that VIN. LI and Inventory model filters are applied
only when characters 4–6 of the pinned identifier form a three-digit model series;
many VINs, including North American formats, do not provide this value.

### Repair Orders

Create an RO, enter its vehicle/VIN, and write separate **Line A**, **Line B**, and
subsequent stories. Edits save automatically after a short delay.

- **Add files** uploads through the shell while keeping the RO tab open. The
  shell's normal filename routing still applies: LI-named PDFs go to LI Documents,
  rather than becoming RO attachments directly. To associate one, copy it to the
  Vault and use the import workflow below.
- **Import from Vault** opens the normal Vault screen in selection mode. Select
  files and press **Add to RO**. This changes their collection to `RO <number>`;
  it does not create a second copy or preserve their former collection membership.
- Files without a VIN receive the RO's VIN when provided. Files with a different
  VIN prompt for add-anyway or skip; their existing VIN is retained.
- Changing an RO number in the shell moves its collection's files to the new
  collection name. Deleting the RO leaves its Vault files in place.

RO association is based on a collection name, so use distinct RO numbers.
**RO records and story lines currently have no export/restore feature and are not
included in the platform's backup button.** Attached Vault files are included in
Vault backups, but restoring those files does not recreate the RO records.

### Tool Inventory catalog

A fresh inventory starts empty. Choose **Open database…** to load a `.tidb` file
containing tool records and photos. Opening a database replaces the current
inventory after confirmation; save your current `.tidb` first if you need it.

Build a catalog from the checked-in source data with Node.js:

```bash
node tools/build-inventory-db.mjs
```

This writes `dist-db/FileInventory.tidb`. Open that file in the Inventory app.
The app also checks `data/FileInventory.tidb` relative to the platform root and
shows **Load the built-in tool catalog** if it finds one and the inventory is
empty. The portable builder supplies that file; serving the repository as-is
does not. Catalog descriptions, offered status, and prices are source-data
snapshots, not live supplier information.

### Toolbox

The ten tabs are ZIP Splitter, Media Compressor, Image to Text (OCR), Unit
Converter, Electrical, Text, Calculators, CSV Viewer, Image Tools, and PDF Toolkit.
They cover ZIP partitioning, image re-encoding, browser-based video-to-WebM
recording, workshop calculations, text comparison, CSV browsing/export, image
crop/rotate/resize and EXIF tools, PDF organization/merge, images-to-PDF, page-image
extraction, and LI PDF renaming. Media support depends on the browser's codecs.

### Folder sync

Vault and LI Documents can link folders using the browser's File System Access
API. Vault imports files into a folder-named collection; LI imports PDFs. Auto-sync
checks every five minutes while the page is running, and on focus/visibility
changes. Permissions may need to be granted again after restarting the browser.

This is one-way import, not a filesystem mirror. New/changed files are identified
using filename, size, and modification time; deleting a source file does not
remove its stored copy. LI also offers auto-save of its database to a chosen file.

## Backups and extraction

The top-bar **Back up everything** button asks three apps to export separately.
It is not a single combined backup, and empty LI/Inventory databases may produce
no download. Check that the browser allowed the expected downloads.

| Data | Backup | Restore behavior |
| --- | --- | --- |
| Vault files, thumbnails, and per-file metadata | `.fvault` binary v2; legacy JSON imports remain supported | Adds records; conflicting IDs receive new IDs, so repeated restores can duplicate files |
| LI PDFs and document metadata | `.lidb` ZIP with a manifest and PDFs | Overwrites matching document IDs after confirmation; other documents remain |
| Inventory records, edits, stars, and photos | `.tidb` binary container | Replaces the current inventory after confirmation |
| RO records and story lines | No export implemented | No restore implemented |

Vault backups do not include browser preferences, linked-folder handles, or empty
collections stored only in settings. Backups are not encrypted by the app.

Use Vault's **Request persistent storage** command to request protection from
automatic eviction, and keep regular exports on another drive. Clearing site data,
losing the browser profile, or losing the drive can erase local records; persistence
permission does not replace backups.

**Extract** reads backups without importing them into the application databases.
It offers individual files or a ZIP: Vault files under collection folders, renamed
LI PDFs, or Inventory CSV/JSON and photos. Its standalone `viewer.html` contains
its own parsers and ZIP implementation. Deflated LI ZIP entries require browser
`DecompressionStream` support; ZIP output is not ZIP64 and is limited to roughly
4 GiB. Extraction recovers ordinary files, not all database organization/settings.

## Offline operation and privacy

Files are processed locally; the application has no file-upload backend, analytics,
or account system. It does make requests for hosted application assets and the
optional same-origin inventory catalog. It includes third-party libraries:
PDF.js is vendored, with JSZip and pdf-lib inlined where used.

OCR in **Vault, LI Documents, and Toolbox** loads Tesseract.js, its worker/WASM
runtime, and language data from `cdn.jsdelivr.net` and
`tessdata.projectnaptha.com` when needed. This can happen automatically for scanned
LI imports. Document/image recognition runs locally, but first use normally needs
network access. LI's service worker caches OCR resources; offline OCR across all
apps is not guaranteed. Toolbox's EXIF GPS link opens OpenStreetMap with the
selected coordinates if you click it.

For hosted offline use, first open each app you need while online and exercise
features that lazy-load resources, such as Vault PDF previews. Loading just the
platform does not precache every app or all OCR assets. Verify your intended
workflow with the network disconnected before depending on it.

## Portable USB edition

With Node.js installed on the build machine:

```bash
npm run build:portable
```

The output is `dist-portable/FileDatabase-Portable/`. Copy that whole folder to a
USB drive and use **Start File Database.bat** (Windows) or
**Start File Database (Mac).command** (macOS). The launchers look for an installed
Edge or Chrome and use a separate profile in the package's `data/` folder, with
`--allow-file-access-from-files` for the local app pages. No local server is started.

**Current packaging limitation:** the builder includes the shell, Vault, LI,
Inventory, Toolbox, and Extract, but omits `ros/`. The Repair Orders tab is still
visible and cannot load in an unmodified portable build.

Keep `app/` and `data/` together, close the app before ejecting the drive, and keep
exports separate from the browser profile. Moving the profile between machines,
browsers, operating systems, or file paths is not verified by the portable test;
use export/import for transfers where compatibility matters. The launcher redirects
the profile, but cannot guarantee that the browser/OS leaves no traces on the host
or that separately downloaded files land on the USB drive.

The Windows launcher expands its profile argument without quoting the whole
argument, so use a package path without spaces. The macOS launcher expects Edge
or Chrome in `/Applications`. If the launcher falls back to opening HTML directly,
the USB profile is not selected.

Use a filesystem that supports your backup sizes; FAT32 cannot hold a single file
over 4 GiB. The builder **deletes and recreates `dist-portable/`**, and the portable
E2E test also clears its generated profile. Never keep live data or your only
backup in the build output directory. See [portable/START-HERE.txt](portable/START-HERE.txt).

## Navigation and debugging

- Tabs: `#vault` (alias `#files`), `#li`, `#inventory`, `#toolbox`, `#ros`, `#viewer`.
- Toolbox deep links: `#toolbox/pdf`, or keys `zip`, `media`, `ocr`, `convert`,
  `elec`, `text`, `calc`, `csv`, and `img`.
- Record/filter links include `#li/LI54.10-P-070001`, `#inventory/group/54`, and
  `#vault/vin/<VIN>`. They resolve against the recipient browser's local data.
- Alt+1–6 switches apps; Ctrl/Cmd+K opens the platform's ID/search navigator.
  `/` focuses search in Vault, LI, and Inventory. Vault also supports `a` to add
  and `g`/`l` for grid/list.
- The shell's theme toggle cycles System → Light → Dark for all six apps.
- Ctrl+Shift+D opens the debug log in the shell, Vault, LI, Inventory, and Toolbox.
  RO and Extract pages do not load the logger. Files, LI, and Inventory also have
  debug-log menu entries. Logs stay local until copied or downloaded.

## Development and QA

Use Node.js 20 (the CI version), npm, Git, and Python 3. The application has no
required runtime build; npm dependencies are for development, tests, and PDF.js
vendoring.

```bash
npm ci --omit=optional
npx playwright install chromium
npm start
```

`npm ci --omit=optional` follows the lockfile and skips the unused optional native
canvas dependency. Linux systems may need `npx playwright install --with-deps chromium`
to install browser system dependencies; CI uses this form.

```bash
npm run test:static     # script syntax, manifests, PDF.js policy
npm run test:backup     # malformed binary Vault backups
npm run test:integrity  # full-byte Blob comparison
npm run test:e2e        # tracked tools/e2e*.mjs suites, sequentially
npm test               # static + backup + integrity + E2E
npm run build:portable
```

The E2E runner discovers Git-tracked suites and excludes the shared
`e2e-browser.mjs` helper. New suites must be tracked to participate; a source ZIP
without Git metadata cannot run the discovery-based checks unchanged. Browser
suites use Playwright-managed Chromium and create their own local fixture servers.
Some suites write fixture/build directories, including the destructive portable
build described above. These commands describe the configured checks, not a claim
that the current revision passes them.

Individual scripts include `test:vault`, `test:merge`, `test:inventory`,
`test:shell`, `test:sync`, `test:pdfthumb`, `test:vin`, `test:debug`,
`test:portable`, and `test:pdf-security`; see [package.json](package.json) for all
aliases. Suites without aliases run directly, for example:

```bash
node tools/e2e-ros.mjs
node tools/e2e-bridge.mjs
```

`npm run icons` regenerates icons using Python. `npm run vendor:pdfjs` regenerates
Vault's PDF.js files and LI/Toolbox's inline bundles from pinned `pdfjs-dist@4.2.67`;
`node tools/vendor-pdfjs.mjs --check` verifies the generated artifacts.

[qa.yml](.github/workflows/qa.yml) runs on pushes to
`claude/pwa-file-database-hqbppy` and on pull requests. It installs dependencies,
audits with `--omit=optional --audit-level=high`, installs Chromium, runs the checks
above, and builds the portable package. [zip-test.yml](.github/workflows/zip-test.yml)
validates viewer ZIP output using Windows extraction tools; it is manually runnable
and path-filtered on pushes to that branch.

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html`, `shell.js`, `shell.css` | Platform UI, intake, navigation, theme, and badges |
| `sw.js`, `manifest.webmanifest`, `icons/` | Platform PWA assets |
| `bridge.js`, `debug.js` | File-transfer mailbox and shared local logger |
| `vault/` | File Vault, IndexedDB helpers, backup validation, Blob verification, PDF.js vendor files |
| `li/`, `inventory/`, `toolbox/`, `ros/` | Other application pages and assets |
| `viewer.html` | Standalone backup extractor |
| `inventory-data/` | Source catalog JSON and photos; build input, not automatically imported |
| `portable/` | Portable launchers and user guide |
| `tools/` | Build helpers, vendoring, static/unit checks, and browser suites |
| `.github/workflows/` | QA and Windows ZIP workflows |

## License

`package.json` declares MIT. The repository currently has no standalone LICENSE
file. Bundled third-party libraries retain their own license notices.
