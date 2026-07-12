# 🗂️ File Vault — a personal file database that runs in your browser

**File Vault** is a Progressive Web App (PWA) that turns your browser into a
private, searchable database for **documents, videos, photos, PDFs,
spreadsheets, and text files**. Add files, tag and group them, and find and
open anything in seconds.

It was built specifically for a **locked‑down work computer where you don't
have admin rights**: there is nothing to install, no server to run, and no
account to create. It's just a web page — and everything you add stays on
that one computer.

---

## Why it fits a no‑admin work computer

| Constraint | How File Vault handles it |
| --- | --- |
| ❌ Can't install software | It's a **web page**. Open it in the browser that's already there (Edge/Chrome). |
| ❌ Can't run a local server / database | All data is stored in the browser's built‑in **IndexedDB**. No backend. |
| 🔒 Data must stay private | Files **never leave the machine** — nothing is uploaded anywhere. |
| 📴 Flaky or blocked network | Works **fully offline** once loaded (a service worker caches the app). |
| 🔎 Hard to find files across folders | **Search, type filters, collections, and tags** — like a mini database. |
| 💾 Need to move data between machines | **Export** a single backup file and **Import** it elsewhere. |

---

## Two databases, one app

File Vault also hosts the **LI Document Database** — a specialist tool for
Mercedes‑Benz LI PDFs (reads each PDF's LI number, version, title, function
group, date and validity; OCRs scans; compares versions; exports renamed
copies). They share one site and hand files to each other:

- Open **🗄️ LI Documents** in the sidebar to use the LI database right inside
  File Vault. A **← Files** link takes you back.
- In File Vault, open any **PDF** and click **🗄️ Send to LI** to push it into
  the LI database, where it's parsed and filed automatically.
- In the LI database's document view, click **＋ File Vault** to copy the
  renamed PDF into File Vault — filed under an **“LI Documents”** collection
  and auto‑tagged with its LI number, function group and model series.

Both databases stay on your machine; the handoff happens locally through a
small shared bridge (`bridge.js`) — nothing is uploaded.

## Features

- **Add anything** — drag & drop onto the window, paste from the clipboard, or use **Add files**. Bulk‑add supported.
- **Automatic sorting by type** — Images, Videos, Audio, PDFs, Documents, Spreadsheets, Presentations, Text & code, Archives, Other.
- **Thumbnails** generated on device for images and videos.
- **Instant preview** in a side panel: images, video, audio, PDFs (native browser viewer), and inline text/code.
- **Organize like a database** — put files into **Collections**, add any number of **Tags**, write **Notes**, and **★ Star** favorites.
- **Fast find** — live search across names, tags, notes and collections; filter by type, collection, tag; sort by date / name / size; grid or list view.
- **Backup & restore** — export the whole vault to one `.fvault` file and import it on another computer or browser profile.
- **Installable** — click **Install app** to add it to your Start menu / dock and launch it in its own window.
- **Offline‑first** and **keyboard‑friendly** (`/` search, `a` add, `g`/`l` grid/list, `Esc` close).
- **Light & dark themes** — click the ◐ toggle in the top bar to cycle System → Light → Dark (your choice is remembered and applied before the page paints, so no flash).

---

## How to use it

### Option A — Host it (recommended, enables install & offline)

A PWA needs to be served over `http(s)` (or `localhost`) for install and
offline features. You don't need admin rights for any of these:

- **GitHub Pages (free, zero setup):** in this repo's GitHub settings →
  *Pages* → deploy from the `main` branch. Your vault will live at
  `https://<user>.github.io/File-Database/`. Open that URL on the work
  computer and click **Install app**.
- **Any static host** you can reach (Netlify, Cloudflare Pages, an internal
  web share, etc.) — just upload the files.
- **A quick local server** (if a runtime is already on the machine):
  ```bash
  python3 -m http.server 8080     # then open http://localhost:8080
  # or:  npx serve
  ```

> Because the data lives per‑origin, always open it from the **same URL** so
> you're looking at the same vault.

### Option B — Just open the file

Double‑click `index.html`. The database still works (IndexedDB works from
`file://`), but the browser won't offer **Install** or offline caching from a
`file://` URL. Good for a quick try; host it (Option A) for daily use.

---

## ⚠️ Keep a backup

Your vault lives inside this browser profile on this computer. It is **not**
in the cloud. That means:

- **Clearing the browser's site data / cookies will erase the vault.**
- A reimaged or replaced computer takes the vault with it.

So:

1. Click **⋮ → Request persistent storage** once (asks the browser not to
   auto‑evict your data).
2. Use **⋮ → Export / back up vault…** regularly. It saves a single
   `file-vault-backup-YYYY-MM-DD.fvault` file you can keep on a network drive
   or USB stick and **Import** later or on another machine.

---

## Privacy

Everything is local. There are **no network calls** for your data, no
analytics, no accounts, no third‑party scripts or CDNs. The app is a handful
of static files (HTML/CSS/JS) plus your data in IndexedDB.

---

## Project layout

```
index.html            App shell / markup
styles.css            Styling (light + dark, responsive)
db.js                 IndexedDB storage layer
app.js                Application logic (import, search, preview, backup)
bridge.js             Shared File Vault ⇄ LI Database transfer bus
sw.js                 Service worker (offline app‑shell cache)
manifest.webmanifest  PWA manifest (install metadata + icons)
icons/                Generated PNG app icons
li/                   The embedded LI Document Database (its own app + SW)
tools/gen_icons.py    Regenerates the icons (no dependencies)
tools/e2e.mjs         End‑to‑end test for File Vault
tools/e2e-merge.mjs   Integration test for the File Vault ⇄ LI merge
```

### Development

```bash
npm start          # serve locally at http://localhost:8080
npm run icons      # regenerate icons/ from tools/gen_icons.py
npm test           # run the end-to-end browser smoke test (needs a Chromium)
```

The app itself has **no build step and no runtime dependencies** — the files
in the repo root are exactly what ships. `npm`/Python are only used for the
optional dev helpers above.

---

## Storage notes & limits

- Browsers allocate storage per site; modern Chromium typically allows a large
  share of free disk (often several GB or more). The sidebar shows current
  usage and the available quota.
- Very large media libraries are better kept on a drive; File Vault shines for
  the documents, clips, images and PDFs you need to **find and open quickly**.

## License

MIT
