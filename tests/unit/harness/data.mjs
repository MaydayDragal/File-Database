// Loads the data layer into Node on top of fake-indexeddb. The modules are
// classic scripts attaching to globalThis (FDCore, FDSchema, FDData), so
// side-effect imports are enough. fresh() gives every test its own
// IndexedDB world and clears the generation pointer.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import "../../../src/core/text.js";
import "../../../src/core/ids.js";
import "../../../src/core/hash.js";
import "../../../src/core/formats/container.js";
import "../../../src/core/formats/fdb.js";
import "../../../src/data/schema.js";
import "../../../src/data/bus.js";
import "../../../src/data/db.js";
import "../../../src/data/repos.js";
import "../../../src/data/jobs.js";
import "../../../src/data/intake.js";
import "../../../src/data/backup.js";
import "../../../src/data/migrate.js";
import "../../../src/data/boot.js";

export const FDData = globalThis.FDData;
export const FDCore = globalThis.FDCore;
export const FDSchema = globalThis.FDSchema;

export async function fresh() {
  await FDData.db.closeAll();
  globalThis.indexedDB = new IDBFactory();
  FDData.db.setCurrentName(null);
  FDData.bootReset();
  delete globalThis.__FDB_MIGRATION_FAIL;
  delete globalThis.__FDB_RESTORE_FAIL;
}

export function blobOf(text, type = "text/plain") { return new Blob([text], { type }); }
export function bytesOf(n, seed = 1) { const u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = (i * 31 + seed) & 255; return u; }

// Open (creating) a legacy-shaped database and fill it: stores is
// { storeName: { keyPath, records: [...] } }.
export function seedLegacy(name, stores, version = 1) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, version);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const s of Object.keys(stores)) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: stores[s].keyPath });
    };
    r.onsuccess = () => {
      const db = r.result;
      const names = Object.keys(stores);
      const tx = db.transaction(names, "readwrite");
      for (const s of names) for (const rec of stores[s].records || []) tx.objectStore(s).put(rec);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    r.onerror = () => reject(r.error);
  });
}
export function dbExists(name) { return FDData.db.probe(name).then((i) => i.exists); }
