import test from "node:test";
import assert from "node:assert/strict";
import { FDData, FDCore, fresh, blobOf, seedLegacy, dbExists } from "./harness/data.mjs";

const { migrate, repos, db } = FDData;
const sha = FDCore.hash.sha256;

// The four legacy databases as the current apps write them.
async function seedAll() {
  await seedLegacy("file-vault", {
    files: { keyPath: "id", records: [
      { id: "v1", name: "invoice.txt", type: "text/plain", kind: "text", size: 6, blob: blobOf("INV001"), thumb: null, tags: ["tax"], collection: "RO 42", note: "", starred: true, createdAt: 1, updatedAt: 2, vins: ["WDD2130461A123456"], fins: [], vinScan: 5, searchText: "x" },
      { id: "v2", name: "photo.png", type: "image/png", kind: "image", size: 4, blob: blobOf("PNG!", "image/png"), thumb: blobOf("th", "image/jpeg"), tags: [], collection: "", note: "n", starred: false, createdAt: 3, updatedAt: 4 },
    ] },
    meta: { keyPath: "key", records: [{ key: "view", value: "list" }, { key: "collections", value: ["RO 42"] }] },
  });
  await seedLegacy("LIDocsDB", {
    docs: { keyPath: "id", records: [{ id: "LI54.10-P-070001_3", li: "LI54.10-P-070001", ver: "3", title: "Brakes", filename: "LI54.pdf", size: 8, added: 9, star: true }] },
    files: { keyPath: "id", records: [{ id: "LI54.10-P-070001_3", blob: blobOf("%PDF-1.4", "application/pdf") }, { id: "orphan", blob: blobOf("x") }] },
    settings: { keyPath: "k", records: [{ k: "autoSyncOn", v: true }] },
  }, 2);
  await seedLegacy("tool-inventory", {
    tools: { keyPath: "id", records: [{ id: "t1", toolNo: "000 589 01 23 00", desc: "wrench" }, { id: "t2", toolNo: "000 589 99 99 00", desc: "socket" }] },
    photos: { keyPath: "id", records: [{ id: "t1", blob: blobOf("PNG", "image/png") }] },
    meta: { keyPath: "k", records: [{ k: "source", v: { source: "catalog" } }] },
  }, 2);
  await seedLegacy("repair-orders", {
    ros: { keyPath: "id", records: [
      { id: "r1", ro: "42", vehicle: "GLC", collection: "RO 42", lines: [], createdAt: 1, updatedAt: 1 },
      { id: "r2", ro: "42", vehicle: "dup", collection: "RO 42", lines: [], createdAt: 2, updatedAt: 2 },
      { id: "r3", ro: "", vehicle: "draft", collection: "RO-r3", lines: [], createdAt: 3, updatedAt: 3 },
    ] },
  });
  await seedLegacy("vault-bridge", { outbox: { keyPath: "id", records: [{ id: 1, target: "li" }] } }, 2);
}

test("status(): none → needed → cleanup", async () => {
  await fresh();
  assert.equal((await migrate.status()).state, "none");
  await seedAll();
  assert.equal((await migrate.status()).state, "needed");
});

test("run(): copies, verifies by count and hash, flips the pointer, deletes the legacy databases", async () => {
  await fresh();
  await seedAll();
  const phases = [];
  const report = await migrate.run({ onProgress: (p) => phases.push(p.phase) });
  assert.equal(report.ok, true);
  assert.equal(db.currentName(), "file-database-1");
  assert.equal(report.counts.files, 3); assert.equal(report.counts.blobs, 3); assert.equal(report.counts.thumbs, 1);
  assert.equal(report.counts.documents, 1); assert.equal(report.counts.tools, 2); assert.equal(report.counts.photos, 1);
  assert.equal(report.counts.ros, 3); assert.equal(report.counts.links, 2, "two files in 'RO 42' → r1 gets them (r2 too: same collection)");
  assert.equal(report.hashes, 3);
  assert.ok(phases.includes("verify"));
  for (const n of migrate.LEGACY_NAMES) assert.equal(await dbExists(n), false, n + " deleted");
  // Shapes.
  const v1 = await repos.files.getFull("v1");
  assert.equal(v1.inFiles, 1); assert.equal(v1.rev, 1); assert.equal(await v1.blob.text(), "INV001"); assert.equal(v1.sha256, await sha(blobOf("INV001")));
  assert.equal(await (await repos.files.getThumb("v2")).text(), "th");
  const doc = await repos.documents.get("LI54.10-P-070001_3");
  assert.equal(doc.fileId, "li:LI54.10-P-070001_3"); assert.equal(doc.star, true);
  const lf = await repos.files.get(doc.fileId);
  assert.equal(lf.inFiles, 0); assert.equal(lf.docId, doc.id); assert.equal(lf.name, "LI54.pdf");
  assert.equal((await repos.files.listMeta({ inFiles: 1 })).length, 2);
  assert.equal(await repos.settings.getValue("vault.view"), "list");
  assert.equal(await repos.settings.getValue("li.autoSyncOn"), true);
  assert.deepEqual(await repos.settings.getValue("inventory.source"), { source: "catalog" });
  const mig = await repos.settings.getValue("migration");
  assert.equal(mig.counts.files, 3);
  assert.ok(mig.warnings.some((w) => /share number 42/.test(w)));
  assert.ok(mig.warnings.some((w) => /without a document record/.test(w)));
  // D7 on legacy duplicates: the older keeps the number indexed, the newer is flagged.
  assert.equal((await repos.ros.byNumber("42")).id, "r1");
  assert.equal((await repos.ros.get("r2")).roConflict, "r1");
  assert.equal((await repos.links.from("ro", "r1", "attachment")).length, 1);
  assert.equal((await repos.links.from("ro", "r1", "attachment"))[0].toId, "v1");
  assert.equal((await migrate.status()).state, "none");
});

test("a migration whose verification fails leaves the legacy databases and the pointer untouched", async () => {
  await fresh();
  await seedAll();
  globalThis.__FDB_MIGRATION_FAIL = true;
  await assert.rejects(migrate.run({}), /Verification failed/);
  delete globalThis.__FDB_MIGRATION_FAIL;
  assert.equal(db.currentName(), null);
  assert.equal(await dbExists("file-database-1"), false);
  for (const n of ["file-vault", "LIDocsDB", "tool-inventory", "repair-orders"]) assert.equal(await dbExists(n), true, n + " kept");
  assert.equal((await migrate.status()).state, "needed");
  // And it can be retried.
  const report = await migrate.run({});
  assert.equal(report.ok, true);
});

test("boot(): runs the migration once, then opens; a leftover legacy database is cleaned up", async () => {
  await fresh();
  await seedAll();
  await FDData.boot({ ui: false });
  assert.equal(db.currentName(), "file-database-1");
  assert.equal(await repos.tools.count(), 2);
  // A legacy database recreated later (empty) is removed quietly on the next boot.
  await seedLegacy("repair-orders", { ros: { keyPath: "id", records: [] } });
  FDData.bootReset();
  await FDData.boot({ ui: false });
  assert.equal(await dbExists("repair-orders"), false);
  assert.equal(await repos.tools.count(), 2);
});

test("a fresh profile with nothing to migrate just opens generation 1", async () => {
  await fresh();
  await FDData.boot({ ui: false });
  assert.equal(db.currentName(), "file-database-1");
  assert.equal(await repos.files.count(), 0);
});

test("a legacy database holding only secondary-store data is migrated, not deleted", async () => {
  await fresh();
  await seedLegacy("file-vault", { files: { keyPath: "id", records: [] }, meta: { keyPath: "key", records: [{ key: "collections", value: ["Toolbox"] }] } });
  await seedLegacy("tool-inventory", { tools: { keyPath: "id", records: [] }, photos: { keyPath: "id", records: [{ id: "p1", blob: blobOf("PNG", "image/png") }] }, meta: { keyPath: "k", records: [] } }, 2);
  assert.equal((await migrate.status()).state, "needed");
  await FDData.boot({ ui: false });
  assert.deepEqual(await repos.settings.getValue("vault.collections"), ["Toolbox"]);
  assert.equal(await repos.photos.count(), 1);
  assert.equal(await dbExists("file-vault"), false);
});

test("data created after a skipped migration is carried into the merged generation", async () => {
  await fresh();
  await seedAll();
  // "Skip for now": the app opens an empty generation 1 and the user works in it.
  await db.open();
  await repos.tools.put({ id: "new1", toolNo: "111 111 11 11 11", desc: "added later" });
  await repos.files.putFull({ id: "nf1", name: "later.txt", type: "text/plain", blob: blobOf("LATER") });
  await repos.tools.put({ id: "t1", toolNo: "000 589 01 23 00", desc: "edited copy of a legacy id" }); // an id clash: the live record wins
  assert.equal((await migrate.status()).state, "needed");
  const report = await migrate.run({});
  assert.equal(report.ok, true);
  assert.equal(report.generation, "file-database-2");
  assert.equal(db.currentName(), "file-database-2");
  assert.equal(await dbExists("file-database-1"), false, "the interim generation is superseded");
  assert.equal(report.carried.tools, 2);
  assert.equal(await repos.tools.count(), 3, "legacy t2 + live new1 + the clashing t1");
  assert.equal((await repos.tools.get("t1")).desc, "edited copy of a legacy id");
  assert.equal(report.skipped, 1);
  assert.equal(await (await repos.files.getBlob("nf1")).text(), "LATER");
  assert.equal(await repos.files.count(), 4, "3 legacy files + 1 created later");
  assert.equal(report.hashes, 4);
  assert.equal(await repos.ros.count(), 3);
  for (const n of migrate.LEGACY_NAMES) assert.equal(await dbExists(n), false, n + " deleted");
  assert.equal((await migrate.status()).state, "none");
});
