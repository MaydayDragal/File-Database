import test from "node:test";
import assert from "node:assert/strict";
import { FDData, FDCore, fresh, blobOf, dbExists } from "./harness/data.mjs";

const { backup, repos, db } = FDData;

async function seed() {
  await repos.files.putFull({ id: "f1", name: "a.txt", type: "text/plain", blob: blobOf("AAAA"), thumb: blobOf("t", "image/jpeg") });
  await repos.documents.putWithFile({ id: "LI1_1", li: "LI1", ver: "1", title: "doc" }, blobOf("%PDF", "application/pdf"));
  await repos.tools.put({ id: "t1", toolNo: "000 589 01 23 00" });
  await repos.photos.put({ id: "t1", blob: blobOf("PNG", "image/png") });
  await repos.ros.put({ id: "r1", ro: "42", vehicle: "GLC" });
  await repos.links.link("ro", "r1", "file", "f1", "attachment");
  await repos.settings.setValue("vault.view", "list");
  await repos.settings.setValue("li.syncDir", new Map([["handle", 1]])); // cloneable, not plain data (a folder handle)
}

test("collect() → restore() moves everything into a new generation and drops the old one", async () => {
  await fresh();
  await db.open();
  await seed();
  const { blob, meta } = await backup.collect();
  assert.equal(meta.records.files.length, 2);
  assert.equal(meta.payloads.length, 4, "2 blobs + 1 thumb + 1 photo");
  assert.deepEqual(meta.skippedSettings, ["li.syncDir"]);
  const report = await backup.restore(blob, {});
  assert.equal(report.ok, true);
  assert.equal(report.generation, "file-database-2");
  assert.equal(db.currentName(), "file-database-2");
  assert.equal(await dbExists("file-database-1"), false, "old generation removed");
  assert.equal(await (await repos.files.getBlob("f1")).text(), "AAAA");
  assert.equal(await (await repos.files.getThumb("f1")).text(), "t");
  assert.equal(await (await repos.documents.getBlob("LI1_1")).text(), "%PDF");
  assert.equal((await repos.ros.get("r1")).vehicle, "GLC");
  assert.equal((await repos.links.from("ro", "r1")).length, 1);
  assert.equal(await repos.settings.getValue("vault.view"), "list");
  assert.ok(await repos.settings.getValue("backup.restored"));
  assert.equal((await repos.files.getBlobRecord("f1")).sha256, await FDCore.hash.sha256(blobOf("AAAA")));
});

test("a restore whose verification fails leaves the live generation untouched", async () => {
  await fresh();
  await db.open();
  await seed();
  const { blob } = await backup.collect();
  globalThis.__FDB_RESTORE_FAIL = true;
  await assert.rejects(backup.restore(blob, {}), /Verification failed/);
  delete globalThis.__FDB_RESTORE_FAIL;
  assert.equal(db.currentName(), "file-database-1");
  assert.equal(await dbExists("file-database-2"), false);
  assert.equal(await (await repos.files.getBlob("f1")).text(), "AAAA");
});

test("a tampered blob is caught by the sha256 check", async () => {
  await fresh();
  await db.open();
  await seed();
  const { blob } = await backup.collect();
  const buf = new Uint8Array(await blob.arrayBuffer());
  // Flip a byte inside the first payload (right after the JSON block).
  const metaLen = new DataView(buf.buffer).getUint32(8, true);
  buf[12 + metaLen] ^= 0xff;
  await assert.rejects(backup.restore(new Blob([buf]), {}), /does not match its hash/);
  assert.equal(db.currentName(), "file-database-1");
});
