# 🗂️ File Database — one page, six apps, all in your browser

> 📖 Looking for the full technical map? **[FEATURES.md](FEATURES.md)** is the
> complete feature tree and application topology — every feature, every
> cross‑app tie‑in, storage, service workers, message contracts and test coverage.

**File Database** is a Progressive Web App (PWA) platform that bundles six
local‑first apps behind a single page:

- **📁 File Vault** — a private, searchable database for **documents, videos,
  photos, PDFs, spreadsheets and text files**.
- **🗄️ LI Documents** — a database for Mercedes‑Benz LI PDFs.
- **🔧 Tool Inventory** — a searchable catalog of dealer special tools.
- **🧰 Toolbox** — ten file & workshop utilities (compress, split, convert, OCR…).
- **🧾 Repair Orders** — one place per RO: attach files (upload, or pick them on
  the normal Vault screen and hit **➕ Add to RO**), write the job's story as
  multiple lines (Line A, B, …), and auto‑stamp the RO's VIN onto files that
  lack one.
- **🔓 Extract** — open a `.fvault` / `.lidb` / `.tidb` backup and save its
  contents back out as ordinary files.

It was built specifically for a **locked‑down work computer where you don't
have admin rights**: there is nothing to install, no server to run, and no
account to create. It's just a web page — and everything you add stays on
that one computer.

---

## Why it fits a no‑admin work computer

| Constraint | How File Database handles it |
| --- | --- |
| ❌ Can't install software | It's a **web page**. Open it in the browser that's already there (Edge/Chrome). |
| ❌ Can't run a local server / database | All data is stored in the browser's built‑in **IndexedDB**. No backend. |
| 🔒 Data must stay private | Files **never leave the machine** — nothing is uploaded anywhere. |
| 📴 Flaky or blocked network | Works **fully offline** once loaded (service workers cache the apps). |
| 🔎 Hard to find files across folders | **Search, type filters, collections, and tags** — like a mini database. |
| 💾 Need to move data between machines | **Export** a single backup file and **Import** it elsewhere. |

---

## One platform, six apps

The repo root is a slim **platform shell**: one top bar with an app tab for
each of the six apps, which run side by side in lazy‑loaded, same‑origin
iframes. The shell owns everything the apps share:

- **One "Add files" button** — a single uploader in the top bar (and a
  full‑window drop zone) files everything for you: drop or pick any mix, and
  each item lands where it belongs — Mercedes **LI PDFs** go to LI Documents,
  everything else to Files. No more hunting for the right app's upload spot
  first; it works the same on every tab, so the platform behaves as one app.
- **Tabs & badges** — Files / LI Documents / Tool Inventory / Toolbox, with
  live counts of your files, documents and tools on the tabs (they pulse when
  a background app's count changes, and background apps' messages surface in
  the platform's own toast bar).
- **Everything is connected** — the apps share the Mercedes vocabulary and
  link into each other:
  - Add a file with a **VIN** and it's read automatically (no clicks) and
    grouped under its vehicle; the vehicle header offers **LI docs / Special
    tools for that model series** in one click.
  - An LI document links to the **special tools for its function group and
    model series** (bin locations, photos, prices); a tool links back to
    **every LI document that mentions it** (full-text) and its group's docs.
  - **Pin the car you're working on** — 📌 a VIN (from a vehicle header, a
    file's Related chips, or Ctrl+K) and a 🚗 chip appears in the top bar:
    Files shows that vehicle's paperwork, LI Documents and the Tool
    Inventory scope to its model series, and files you add are tagged with
    the VIN automatically. ✕ unpins.
  - **Ctrl+K** anywhere: paste a VIN, LI number or tool number and land on
    the record — or search any app with the query carried over.
  - **Deep links for records**: `#li/LI54.10-P-070001`, `#inventory/group/54`,
    `#vault/vin/…` — bookmarkable, shareable on the same machine.
  - **⬇ Back up everything** — one button saves all three databases
    (`.fvault`, `.lidb`, `.tidb`); drop any of those files back on the window
    to restore/open it in the right app.
  - **Alt+1–6** switches apps from anywhere; `/` focuses search in every app.
- **One theme** — the ◐ toggle cycles System → Light → Dark and applies to the
  shell **and every app at once** (remembered, applied before first paint).
- **Deep links** — `#vault`, `#li`, `#inventory`, `#toolbox` and even
  `#toolbox/pdf` open the platform on a specific app (or Toolbox tool).
- **Cross‑app handoffs** — files move between apps over a small local bridge
  (`bridge.js`, IndexedDB + BroadcastChannel). Nothing is uploaded:
  - **File Vault → LI**: open any PDF and click **🗄️ Send to LI** — the LI app
    reads, renames and files it automatically.
  - **LI → File Vault**: click **＋ File Vault** on a document to copy the
    renamed PDF into the vault, filed under an **“LI Documents”** collection
    and auto‑tagged with its LI number, function group and model series.
  - **File Vault → Toolbox**: for images, videos, PDFs, CSVs and ZIPs, click
    **🧰 Send to Toolbox** — the right tool opens with the file already loaded.
  - **Toolbox → File Vault**: every file the Toolbox produces offers a
    **💾 Save to File Vault** button; saved files land in a **“Toolbox”**
    collection.

Each app also works **standalone** at its own subpath (`vault/`, `li/`,
`inventory/`, `toolbox/`) with its own service worker, manifest and theme
toggle — the platform is a convenience, not a cage.

**📁 File Vault** — add files, tag and group them, and find and open anything
in seconds (see [Features](#features) below).

**🗄️ LI Documents** — a tool for Mercedes‑Benz LI PDFs: reads each PDF's LI
number, version, title, function group, date and validity; OCRs scans;
compares versions; exports renamed copies.

**🔧 Tool Inventory** — a searchable database of Mercedes‑Benz dealer special
tools (tool number, description, service group, bin location, category and
dealer‑net price). It ships with the current list built in, and lets you
search, filter, sort and star; edit a tool's location, quantity, note and
comment (saved locally); import/export CSV and back up the whole database.

**🧰 Toolbox** — ten utilities imported from the File‑Compressor project:
Zip Splitter, Media Compressor, Image to Text (OCR), Unit Converter,
Electrical helpers, Text tools, Calculators, CSV Viewer, Image Tools and a
PDF Toolkit. Everything runs in the browser; the **only online feature** is
OCR, which lazy‑loads the Tesseract.js engine from a CDN the first time you
use it.

**🐞 Debug log** — every page quietly records errors and warnings (uncaught
exceptions, promise rejections, failed loads, `console.error`/`warn`) into one
local, on‑device log. Press **Ctrl+Shift+D** anywhere — or use “Debug log” in
the Files ⋮ / LI ☰ / Inventory ☰ menus — to view, filter, copy, download or
clear it. Handy when something misbehaves and you want to see why.

## Features

The Files app (File Vault) is the heart of the platform:

- **Add anything** — drag & drop onto the window, paste from the clipboard, or use **Add files**. Bulk‑add supported.
- **Automatic sorting by type** — Images, Videos, Audio, PDFs, Documents, Spreadsheets, Presentations, Text & code, Archives, Other.
- **Thumbnails** generated on device for images, videos **and PDFs** (the PDF's first page is rendered as its preview; previews for PDFs already in your vault are filled in automatically in the background).
- **Instant preview** in a side panel: images, video, audio, PDFs (native browser viewer), and inline text/code.
- **Organize like a database** — put files into **Collections**, add any number of **Tags**, write **Notes**, and **★ Star** favorites.
- **Select many at once** — checkboxes, Shift+click ranges, or Ctrl+A, then set the collection, tags or VIN for the whole batch, star or delete them, download them all into a folder you pick (each file verified on disk), or send them together to LI Documents / a Toolbox tool (PDF merge receives them all at once; the Media tool queues pictures with a "Next file ▸" bar).
- **Group by VIN** — **⋮ → Scan files for VINs** reads every file for a 17‑character vehicle identification number: filenames and text files directly, PDFs through their text layer, and images or scanned PDFs via OCR (used only when the text doesn't already contain the VIN; loaded online once, like the LI app's OCR). It recovers VINs even when the PDF splits them with spaces, throws out look‑alike junk, and keeps a Mercedes **FIN**/datacard number separate from the real VIN. Detected VINs appear in the sidebar and in the **🚗 By VIN** view, which groups files under one header per vehicle; VIN and FIN are editable in each file's detail panel (with a per‑file **Detect** button). Videos are skipped.
- **Fast find** — live search across names, tags, notes, collections and VINs; filter by type, collection, tag or VIN; sort by date / name / size; grid or list view.
- **Backup & restore** — export the whole vault to one `.fvault` file and import it on another computer or browser profile.
- **Folder sync (auto‑import)** — link a folder once (⋮ → **Sync a folder**, Edge/Chrome) and File Vault imports any new or changed files from it, filed under a collection named after the folder. Turn on **Auto‑sync** to re‑scan every 5 minutes while the app is open (and whenever you switch back to it) — drop a file in the folder and it appears in the vault on its own. Files are matched by name + size + modified‑time so nothing imports twice. The **LI Documents** app has the same thing for PDFs (⋮ → **Sync folder** / **Auto‑sync**). *Tip: point it at a dedicated folder such as `Downloads\LI‑inbox` rather than all of Downloads.* Background scanning only runs while the app is open — browsers don't allow a web app to watch a folder while it's fully closed.
- **Installable** — click **Install app** to add it to your Start menu / dock and launch it in its own window.
- **Offline‑first** and **keyboard‑friendly** (`/` search, `a` add, `g`/`l` grid/list, `Esc` close).
- **Light & dark themes** — the ◐ toggle in the platform top bar cycles System → Light → Dark across all six apps (your choice is remembered and applied before the page paints, so no flash).

---

## How to use it

### Option A — Host it (recommended, enables install & offline)

A PWA needs to be served over `http(s)` (or `localhost`) for install and
offline features. You don't need admin rights for any of these:

- **GitHub Pages (free, zero setup):** in this repo's GitHub settings →
  *Pages* → deploy from the `main` branch. The platform will live at
  `https://<user>.github.io/File-Database/`. Open that URL on the work
  computer and click **⤓ Install**. Each app is also reachable directly at
  `…/File-Database/vault/`, `…/li/`, `…/inventory/` and `…/toolbox/`.
- **Any static host** you can reach (Netlify, Cloudflare Pages, an internal
  web share, etc.) — just upload the files.
- **A quick local server** (if a runtime is already on the machine):
  ```bash
  python3 -m http.server 8080     # then open http://localhost:8080
  # or:  npx serve
  ```

> Because the data lives per‑origin, always open it from the **same URL** so
> you're looking at the same data.

### Option B — Just open the file

Double‑click `index.html` to open the platform (or an app's own
`index.html`, e.g. `vault/index.html`, to open just that app). The databases
still work from `file://`, but the browser won't offer **Install** or offline
caching, and some browsers isolate `file://` pages from each other, which can
break the cross‑app handoffs. Good for a quick try; host it (Option A) for
daily use.

### Option C — Portable, from a USB drive (no install, no admin, data on the stick)

Build a self‑contained package that runs from a USB drive using the browser
already on the PC, with **all data kept on the stick** — nothing is left on the
computer and no admin rights are needed:

```bash
npm run build:portable      # creates dist-portable/FileDatabase-Portable/
```

Copy the `FileDatabase-Portable` folder to a USB drive and run
**`Start File Database.bat`** (Windows) or **`Start File Database (Mac).command`**
(macOS). The launcher opens Edge/Chrome in an app window with its data profile
pointed at the `data/` folder next to it, so your vault lives on the USB drive
and travels between machines. See `portable/START-HERE.txt` for the full guide.

How it works: the launcher runs the installed browser with
`--app=file://…/app/index.html --user-data-dir=…/data --allow-file-access-from-files`.
That keeps the IndexedDB profile (and therefore your files) on the stick and
lets the apps read their local data files. Use an **exFAT/NTFS** stick (FAT32
caps files at 4 GB). If your workplace blocks running `.bat` files, you can
still open `app/index.html` directly and use **Export/Import** to carry data.

---

## ⚠️ Keep a backup

Your data lives inside this browser profile on this computer. It is **not**
in the cloud. That means:

- **Clearing the browser's site data / cookies will erase it.**
- A reimaged or replaced computer takes the data with it.

So, in the **Files** app:

1. Click **⋮ → Request persistent storage** once (asks the browser not to
   auto‑evict your data).
2. Use **⋮ → Export / back up vault…** regularly. It saves a single
   `file-vault-backup-YYYY-MM-DD.fvault` file you can keep on a network drive
   or USB stick and **Import** later or on another machine.

The LI Documents and Tool Inventory apps have their own backup/export menus.

**Your data is never locked in.** The platform's **🔓 Extract** tab is a
built-in **Database File Viewer**: drop any `.fvault`, `.lidb` or `.tidb`
backup on it and download the contents as **normal files** — one ZIP or
file-by-file. It's also a standalone page (`viewer.html`) that works with no
app and no internet — keep a copy next to your backups and they're always
readable anywhere.
Tool Inventory ships empty and loads its catalog from a portable database file:
**☰ Menu → Open database…** to load a `.tidb` (every tool plus its part photos in
one file), and **Save database (.tidb)** to back it up or move it to another
machine — just like the Vault's `.fvault` and LI's documents.

---

## Privacy

Everything is local. There are **no network calls** for your data, no
analytics, no accounts and no third‑party scripts — with one opt‑in
exception: the Toolbox's OCR tool downloads the Tesseract.js engine from a
CDN the first time you run it (your images are still processed on device).
The platform is a set of static files (HTML/CSS/JS) plus your data in
IndexedDB.

---

## Project layout

```
index.html            Platform shell (app tabs, one page for all six apps)
shell.js              Shell logic (tabs, lazy iframes, theme, badges, deep links)
shell.css             Shell styling (light + dark)
sw.js                 Platform service worker (shell cache)
manifest.webmanifest  Platform PWA manifest (install metadata + icons)
bridge.js             Shared cross-app file transfer bus (IndexedDB + BroadcastChannel)
icons/                Generated platform icons
vault/                📁 File Vault app (markup, app.js, db.js, styles, own SW + manifest)
li/                   🗄️ LI Document Database (its own app + SW)
inventory/            🔧 Tool Inventory app (empty; loads a portable .tidb file, own SW)
inventory-data/       Source data (tools.json + img/) used to build the .tidb — not shipped in the app
tools/build-inventory-db.mjs  Builds FileInventory.tidb (tools + photos) from inventory-data/
toolbox/              🧰 Toolbox — ten file & workshop tools in a single page
ros/                  🧾 Repair Orders — per-RO notes + files (files saved in the Vault)
viewer.html           🔓 Extract — open a .fvault/.lidb/.tidb backup and save its files out
tools/gen_icons.py    Regenerates the root icons (no dependencies)
tools/e2e.mjs         End-to-end test — File Vault, standalone at /vault/
tools/e2e-merge.mjs   Integration test — cross-app handoffs through the shell
tools/e2e-inventory.mjs  Tool Inventory test — standalone + embedded
tools/e2e-shell.mjs   Platform shell test — tabs, theme, deep links, badges
tools/e2e-sync.mjs    Folder-sync test — scan, import, dedup, auto-sync
tools/e2e-pdfthumb.mjs   PDF-thumbnail test — render, persist, backfill
vault/vendor/         Vendored pdf.js (renders PDF first-page previews, offline)
```

### Development

```bash
npm start          # serve the platform locally at http://localhost:8080
npm run icons      # regenerate icons/ from tools/gen_icons.py
npm test           # static + backup + integrity checks, then the full E2E suite
npm run test:shell # just the shell test (also: test:vault, test:merge, test:inventory)
```

The platform has **no build step and no runtime dependencies** — the files in
the repo are exactly what ships. `npm`/Python are only used for the optional
dev helpers above and the tests.

### Local QA (release verification)

On a clean machine, this is the exact sequence the CI release gate runs:

```bash
npm ci --omit=optional              # lockfile-driven install (skip pdfjs-dist's
                                    #   unused optional `canvas` native dep)
npm audit --omit=optional --audit-level=high   # no high/critical advisories
npx playwright install chromium     # Playwright-managed browser (no fixed path)
npm run test:static                 # syntax, manifests, PDF.js + browser-path policy
npm run test:backup                 # malformed .fvault backups are rejected
npm run test:integrity              # full-byte stored-blob comparison
npm test                            # the above three + every tools/e2e*.mjs suite
npm run build:portable              # the USB package builds
```

The E2E suites launch **Playwright-managed Chromium** — there is no fixed
`/opt` executable path. If the browser is missing, the runner prints the exact
`npx playwright install chromium` command. To regenerate the vendored,
version-pinned PDF.js runtime: `npm run vendor:pdfjs` (verify with
`node tools/vendor-pdfjs.mjs --check`).

Continuous integration runs `.github/workflows/qa.yml` on pushes and pull
requests (`npm ci` → `npm audit --audit-level=high` → install Chromium →
static/backup/integrity → `npm test` → portable build), and
`.github/workflows/zip-test.yml` covers Windows ZIP validation.

---

## Storage notes & limits

- Browsers allocate storage per site; modern Chromium typically allows a large
  share of free disk (often several GB or more). The Files app's sidebar shows
  current usage and the available quota.
- Very large media libraries are better kept on a drive; File Vault shines for
  the documents, clips, images and PDFs you need to **find and open quickly**.

## License

MIT
