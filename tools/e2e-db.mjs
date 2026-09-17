// Shared helpers for the browser suites: read and seed the unified database
// (file-database-<n>, REWRITE-PLAN.md §4) from a Playwright page.
//
// Every helper runs inside the page, against the live generation named by
// localStorage "fdb.generation" (generation 1 when the page has not opened
// a database yet). Seeding creates that generation with the real schema
// (src/data/schema.js evaluated in the page), so an app that opens it
// afterwards sees the records exactly as if it had written them.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_SRC = fs.readFileSync(path.join(ROOT, "src", "data", "schema.js"), "utf8");

export const GEN_KEY = "fdb.generation";

// Open the live generation, creating it with the schema when it does not
// exist yet. Resolves the IDBDatabase (inside the page).
const openFn = (schemaSrc) => {
  if (!window.FDSchema) new Function("self", schemaSrc)(window);
  let name = null;
  try { name = localStorage.getItem("fdb.generation"); } catch (e) {}
  if (!name) { name = "file-database-1"; try { localStorage.setItem("fdb.generation", name); } catch (e) {} }
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, window.FDSchema.VERSION);
    r.onupgradeneeded = (e) => window.FDSchema.upgrade(r.result, r.transaction, e.oldVersion);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error("blocked"));
  });
};
// Passed into the page as source and rebuilt there (a page function cannot
// close over a Node-side function).
const OPEN_SRC = openFn.toString();

/** All records of a store (Blobs come back as {size, type} descriptors). */
export function fdbAll(page, store) {
  return page.evaluate(async ({ schemaSrc, openSrc, store }) => {
    const open = new Function("return (" + openSrc + ")")();
    const db = await open(schemaSrc);
    try {
      const rows = await new Promise((res, rej) => { const g = db.transaction(store, "readonly").objectStore(store).getAll(); g.onsuccess = () => res(g.result); g.onerror = () => rej(g.error); });
      return rows.map((r) => { const o = {}; for (const k of Object.keys(r)) { const v = r[k]; o[k] = (v instanceof Blob) ? { __blob: true, size: v.size, type: v.type } : v; } return o; });
    } finally { db.close(); }
  }, { schemaSrc: SCHEMA_SRC, openSrc: OPEN_SRC, store });
}

/** Count of a store, optionally of an index value. */
export function fdbCount(page, store, index, value) {
  return page.evaluate(async ({ schemaSrc, openSrc, store, index, value }) => {
    const open = new Function("return (" + openSrc + ")")();
    const db = await open(schemaSrc);
    try {
      const os = db.transaction(store, "readonly").objectStore(store);
      const req = index ? os.index(index).count(value) : os.count();
      return await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
    } finally { db.close(); }
  }, { schemaSrc: SCHEMA_SRC, openSrc: OPEN_SRC, store, index, value: value === undefined ? null : value });
}

/** The Files-app records (inFiles 1), metadata only. */
export function vaultFiles(page) { return fdbAll(page, "files").then((l) => l.filter((f) => f.inFiles === 1)); }
export function vaultCount(page) { return fdbCount(page, "files", "inFiles", 1); }

/** The stored bytes of a file as text. */
export function fdbBlobText(page, id) {
  return page.evaluate(async ({ schemaSrc, openSrc, id }) => {
    const open = new Function("return (" + openSrc + ")")();
    const db = await open(schemaSrc);
    try {
      const rec = await new Promise((res, rej) => { const g = db.transaction("blobs", "readonly").objectStore("blobs").get(id); g.onsuccess = () => res(g.result); g.onerror = () => rej(g.error); });
      return rec && rec.blob ? await rec.blob.text() : null;
    } finally { db.close(); }
  }, { schemaSrc: SCHEMA_SRC, openSrc: OPEN_SRC, id });
}

/**
 * Seed records: { files: [...], blobs: [{id, text|bytes, type}], thumbs, documents, tools, photos, ros, links, settings }.
 * A `blobs`/`thumbs`/`photos` entry with `text` (string) or `bytes` (number[]) becomes a Blob.
 * File records get inFiles 1 and rev 1 unless set.
 */
export function fdbSeed(page, data) {
  return page.evaluate(async ({ schemaSrc, openSrc, data }) => {
    const open = new Function("return (" + openSrc + ")")();
    const db = await open(schemaSrc);
    try {
      const stores = Object.keys(data).filter((s) => (data[s] || []).length);
      if (!stores.length) return 0;
      const tx = db.transaction(stores, "readwrite");
      let n = 0;
      for (const s of stores) {
        for (const rec of data[s]) {
          const r = Object.assign({}, rec);
          if (s === "files") { if (r.inFiles == null) r.inFiles = 1; if (r.rev == null) r.rev = 1; if (r.tags == null) r.tags = []; if (r.vins == null) r.vins = []; if (r.fins == null) r.fins = []; if (r.collection == null) r.collection = ""; if (r.note == null) r.note = ""; if (r.createdAt == null) r.createdAt = Date.now(); if (r.updatedAt == null) r.updatedAt = Date.now(); if (r.searchText == null) r.searchText = [r.name, r.collection, r.note, r.tags.join(" "), r.vins.join(" "), r.fins.join(" ")].join(" ").toLowerCase(); }
          if (s === "blobs" || s === "thumbs" || s === "photos") {
            if (!(r.blob instanceof Blob)) { const parts = r.bytes ? [new Uint8Array(r.bytes)] : [r.text || ""]; r.blob = new Blob(parts, { type: r.type || "application/octet-stream" }); }
            delete r.text; delete r.bytes; delete r.type;
            if (s === "blobs") { r.size = r.blob.size; if (r.sha256 == null) r.sha256 = null; }
          }
          if (s !== "blobs" && s !== "thumbs" && s !== "photos" && r.rev == null) r.rev = 1;
          tx.objectStore(s).put(r); n++;
        }
      }
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
      return n;
    } finally { db.close(); }
  }, { schemaSrc: SCHEMA_SRC, openSrc: OPEN_SRC, data });
}

/** Delete one record (e.g. a thumbnail) from a store. */
export function fdbDelete(page, store, id) {
  return page.evaluate(async ({ schemaSrc, openSrc, store, id }) => {
    const open = new Function("return (" + openSrc + ")")();
    const db = await open(schemaSrc);
    try {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(id);
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    } finally { db.close(); }
  }, { schemaSrc: SCHEMA_SRC, openSrc: OPEN_SRC, store, id });
}

/** Wipe every generation and the pointer (a fresh profile). */
export function fdbReset(page) {
  return page.evaluate(async () => {
    let name = null;
    try { name = localStorage.getItem("fdb.generation"); localStorage.removeItem("fdb.generation"); } catch (e) {}
    const names = new Set([name, "file-database-1", "file-database-2", "file-database-3"].filter(Boolean));
    for (const n of names) await new Promise((res) => { const r = indexedDB.deleteDatabase(n); r.onsuccess = r.onerror = r.onblocked = () => res(); });
  });
}
