# 🗂️ File Database — one page, four apps, all in your browser

**File Database** is a Progressive Web App (PWA) platform that bundles four
local‑first apps behind a single page:

- **📁 File Vault** — a private, searchable database for **documents, videos,
  photos, PDFs, spreadsheets and text files**.
- **🗄️ LI Documents** — a database for Mercedes‑Benz LI PDFs.
- **🔧 Tool Inventory** — a searchable catalog of dealer special tools.
- **🧰 Toolbox** — ten file & workshop utilities (compress, split, convert, OCR…).

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

## One platform, four apps

The repo root is a slim **platform shell**: one top bar with an app tab for
each of the four apps, which run side by side in lazy‑loaded, same‑origin
iframes. The shell owns everything the apps share:

- **Tabs & badges** — Files / LI Documents / Tool Inventory / Toolbox, with
  live counts of your files, documents and tools on the tabs.
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

## Features

The Files app (File Vault) is the heart of the platform:

- **Add anything** — drag & drop onto the window, paste from the clipboard, or use **Add files**. Bulk‑add supported.
- **Automatic sorting by type** — Images, Videos, Audio, PDFs, Documents, Spreadsheets, Presentations, Text & code, Archives, Other.
- **Thumbnails** generated on device for images and videos.
- **Instant preview** in a side panel: images, video, audio, PDFs (native browser viewer), and inline text/code.
- **Organize like a database** — put files into **Collections**, add any number of **Tags**, write **Notes**, and **★ Star** favorites.
- **Fast find** — live search across names, tags, notes and collections; filter by type, collection, tag; sort by date / name / size; grid or list view.
- **Backup & restore** — export the whole vault to one `.fvault` file and import it on another computer or browser profile.
- **Installable** — click **Install app** to add it to your Start menu / dock and launch it in its own window.
- **Offline‑first** and **keyboard‑friendly** (`/` search, `a` add, `g`/`l` grid/list, `Esc` close).
- **Light & dark themes** — the ◐ toggle in the platform top bar cycles System → Light → Dark across all four apps (your choice is remembered and applied before the page paints, so no flash).

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
index.html            Platform shell (app tabs, one page for all four apps)
shell.js              Shell logic (tabs, lazy iframes, theme, badges, deep links)
shell.css             Shell styling (light + dark)
sw.js                 Platform service worker (shell cache)
manifest.webmanifest  Platform PWA manifest (install metadata + icons)
bridge.js             Shared cross-app file transfer bus (IndexedDB + BroadcastChannel)
icons/                Generated platform icons
vault/                📁 File Vault app (markup, app.js, db.js, styles, own SW + manifest)
li/                   🗄️ LI Document Database (its own app + SW)
inventory/            🔧 Tool Inventory app (data in tools.json, own SW)
toolbox/              🧰 Toolbox — ten file & workshop tools in a single page
tools/gen_icons.py    Regenerates the root icons (no dependencies)
tools/e2e.mjs         End-to-end test — File Vault, standalone at /vault/
tools/e2e-merge.mjs   Integration test — cross-app handoffs through the shell
tools/e2e-inventory.mjs  Tool Inventory test — standalone + embedded
tools/e2e-shell.mjs   Platform shell test — tabs, theme, deep links, badges
```

### Development

```bash
npm start          # serve the platform locally at http://localhost:8080
npm run icons      # regenerate icons/ from tools/gen_icons.py
npm test           # run all four end-to-end browser tests (needs a Chromium)
npm run test:shell # just the shell test (also: test:vault, test:merge, test:inventory)
```

The platform has **no build step and no runtime dependencies** — the files in
the repo are exactly what ships. `npm`/Python are only used for the optional
dev helpers above.

---

## Storage notes & limits

- Browsers allocate storage per site; modern Chromium typically allows a large
  share of free disk (often several GB or more). The Files app's sidebar shows
  current usage and the available quota.
- Very large media libraries are better kept on a drive; File Vault shines for
  the documents, clips, images and PDFs you need to **find and open quickly**.

## License

MIT
