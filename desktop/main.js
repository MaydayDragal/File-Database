// File Database — Electron desktop wrapper.
// Runs the bundled web platform as its own windowed application (no browser
// visible) and keeps ALL data next to the executable, so the whole thing is
// portable on a USB drive. The bundled app is served over a private, secure
// "app://" origin so fetch() and IndexedDB behave exactly like a hosted PWA.
const { app, BrowserWindow, protocol, net, Menu, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

// ---- Portable data: profile + vault live in a "data" folder by the app ----
function portableDataDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return path.join(process.env.PORTABLE_EXECUTABLE_DIR, "data");
  if (app.isPackaged) return path.join(path.dirname(process.execPath), "data");
  return path.join(__dirname, "data-dev");
}
const DATA_DIR = portableDataDir();
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
app.setPath("userData", DATA_DIR);

const APP_ROOT = path.join(__dirname, "app");
const SELFTEST = process.argv.includes("--selftest");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

function resolveFile(pathname) {
  let p = decodeURIComponent(pathname || "/");
  if (!p || p === "/") p = "/index.html";
  const filePath = path.normalize(path.join(APP_ROOT, p));
  if (filePath !== APP_ROOT && !filePath.startsWith(APP_ROOT + path.sep)) return null; // no traversal
  try { if (fs.statSync(filePath).isDirectory()) return path.join(filePath, "index.html"); } catch (e) {}
  return filePath;
}

function createWindow(opts) {
  const win = new BrowserWindow(Object.assign({
    width: 1300, height: 880, minWidth: 900, minHeight: 600,
    backgroundColor: "#0f172a", autoHideMenuBar: true, title: "File Database",
    icon: path.join(__dirname, "icon.png"),
    // plugins:true enables Chromium's built-in PDF viewer — without it every
    // PDF preview (vault drawer, LI document view) shows "Failed to load PDF
    // document." The viewer is implemented as a plugin in Electron.
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false, plugins: true },
  }, opts || {}));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) { shell.openExternal(url); return { action: "deny" }; }
    return { action: "allow" };
  });
  return win;
}

app.whenReady().then(async () => {
  protocol.handle("app", (request) => {
    const u = new URL(request.url);
    const filePath = resolveFile(u.pathname);
    if (!filePath) return new Response("Forbidden", { status: 403 });
    if (!fs.existsSync(filePath)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
  Menu.setApplicationMenu(null);

  if (SELFTEST) return runSelfTest();

  createWindow().loadURL("app://bundle/index.html");
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow().loadURL("app://bundle/index.html"); });
});
app.on("window-all-closed", () => app.quit());

// Headless self-check used by the build/test step: proves the app serves over
// app://, that fetch() of a bundled data file works, and that IndexedDB writes
// persist into the portable DATA_DIR across restarts.
async function runSelfTest() {
  const win = createWindow({ show: false });
  const wc = win.webContents;
  try {
    await wc.loadURL("app://bundle/inventory/index.html");
    await new Promise((r) => setTimeout(r, 3000));
    const rows = await wc.executeJavaScript("document.querySelectorAll('#tbody tr').length");
    // The inventory ships empty; what matters is that the bundled catalog is
    // fetchable (its one-click load depends on it) and that the PDF viewer
    // plugin is enabled (vault + LI previews depend on it).
    const catalog = await wc.executeJavaScript(
      "fetch('../data/FileInventory.tidb').then((r)=>r.ok? r.blob().then((b)=>b.size):-r.status).catch(()=>-1)");
    const pdfViewer = await wc.executeJavaScript("navigator.pdfViewerEnabled === true");
    const before = await wc.executeJavaScript(`new Promise((res)=>{
      const q=indexedDB.open('persist-check',1);
      q.onupgradeneeded=()=>{ if(!q.result.objectStoreNames.contains('s')) q.result.createObjectStore('s'); };
      q.onsuccess=()=>{ const db=q.result; const g=db.transaction('s').objectStore('s').get('k');
        g.onsuccess=()=>{ const had=g.result||null; if(!had){ const t=db.transaction('s','readwrite'); t.objectStore('s').put('v1','k'); t.oncomplete=()=>res(null);} else res(had); };
        g.onerror=()=>res('ERR'); };
      q.onerror=()=>res('OPEN-ERR');
    })`);
    const filesOnDisk = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR).length : 0;
    console.log("SELFTEST " + JSON.stringify({ rows, catalog, pdfViewer, before, dataDir: DATA_DIR, filesOnDisk }));
  } catch (e) {
    console.log("SELFTEST " + JSON.stringify({ error: String(e && e.message || e) }));
  }
  setTimeout(() => app.quit(), 200);
}
