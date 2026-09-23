// Phase 5 — the unified model in use: trash and reference-checked purge,
// shared bytes after a duplicate review, repair orders that attach, pin and
// rename through links, the vehicles store, and one backup that carries all
// of it.
import test from "node:test";
import assert from "node:assert/strict";
import { FDData, FDCore, FDSchema, fresh, blobOf, dbExists } from "./harness/data.mjs";

const { repos, db, backup } = FDData;
const { files, ros, links, documents, tools, vehicles } = repos;

const VIN = "W1K2140471A068698"; // passes its check digit, model series 214
const VIN_BAD = "W1K2140471A068690";

async function blobRows() { return db.run(["blobs"], "readonly", (api) => api.req(api.store("blobs").getAll())); }

test("trash hides a file everywhere a list looks, keeps its bytes, and restore brings it back", async () => {
  await fresh(); await db.open();
  await files.putFull({ id: "f1", name: "a.txt", blob: blobOf("A") });
  await files.putFull({ id: "f2", name: "b.txt", blob: blobOf("B") });
  assert.equal(await files.countInFiles(), 2);
  assert.deepEqual(await files.trash(["f1"]), ["f1"]);
  assert.deepEqual((await files.listMeta({ inFiles: 1 })).map((f) => f.id), ["f2"]);
  assert.deepEqual((await files.listTrash()).map((f) => f.id), ["f1"]);
  assert.equal((await files.listMeta({ trash: "with" })).length, 2);
  assert.equal(await files.countInFiles(), 1);
  assert.equal(await (await files.getBlob("f1")).text(), "A", "bytes stay while in the trash");
  await files.restore(["f1"]);
  assert.equal((await files.get("f1")).deletedAt, undefined);
  assert.equal(await files.countInFiles(), 2);
});

test("purge refuses a file a repair order or an LI document still references", async () => {
  await fresh(); await db.open();
  await files.putFull({ id: "f1", name: "attached.jpg", blob: blobOf("1") });
  await files.putFull({ id: "f2", name: "loose.jpg", blob: blobOf("2") });
  await documents.putWithFile({ id: "LI1_1", li: "LI1", ver: "1" }, blobOf("%PDF", "application/pdf"));
  const docFile = (await documents.get("LI1_1")).fileId;
  await ros.put({ id: "r1", ro: "100" });
  await ros.attach("r1", ["f1"]);
  await files.trash(["f1", "f2", docFile]);
  const res = await files.purge(["f1", "f2", docFile]);
  assert.deepEqual(res.purged, ["f2"]);
  assert.deepEqual(res.blocked.map((b) => b.id).sort(), [docFile, "f1"].sort());
  assert.equal(res.blocked.find((b) => b.id === "f1").refs[0].type, "ro");
  assert.equal(res.blocked.find((b) => b.id === docFile).refs[0].type, "document");
  assert.equal(await files.get("f2"), undefined);
  assert.ok(await files.get("f1"), "a referenced file stays in the trash");
  assert.deepEqual((await blobRows()).map((b) => b.id).sort(), [docFile, "f1"].sort());
  // Unlinked, it can go.
  await ros.detach("r1", ["f1"]);
  assert.deepEqual((await files.purge(["f1"])).purged, ["f1"]);
});

test("a duplicate can reuse the stored bytes: one blobs row, and it outlives either record alone", async () => {
  await fresh(); await db.open();
  const [first] = await files.ingest([{ blob: blobOf("SAME BYTES"), name: "one.txt" }]);
  const dups = await files.findDuplicates([blobOf("SAME BYTES"), blobOf("other")]);
  assert.equal(dups.length, 1);
  assert.equal(dups[0].index, 0);
  assert.deepEqual(dups[0].matches.map((f) => f.id), [first.id]);
  const [second] = await files.ingest([{ blob: blobOf("SAME BYTES"), name: "two.txt", reuse: first.id }]);
  assert.equal(second.ok, true);
  assert.equal(second.reused, true);
  const rec = await files.get(second.id);
  assert.equal(rec.blobId, first.id);
  assert.equal(rec.size, 10);
  assert.equal((await blobRows()).length, 1, "no second copy of the bytes");
  assert.equal(await (await files.getBlob(second.id)).text(), "SAME BYTES");
  assert.equal((await files.getFull(second.id)).sha256, await FDCore.hash.sha256(blobOf("SAME BYTES")));
  assert.deepEqual((await files.bySha256(dups[0].sha256)).map((f) => f.id).sort(), [first.id, second.id].sort());
  // Removing the record that stored them keeps the bytes for the other.
  await files.removeFull(first.id);
  assert.equal((await blobRows()).length, 1);
  assert.equal(await (await files.getBlob(second.id)).text(), "SAME BYTES");
  await files.removeFull(second.id);
  assert.equal((await blobRows()).length, 0, "the last user takes the bytes with it");
});

test("a file sits on two repair orders; renumbering one touches the RO record alone", async () => {
  await fresh(); await db.open();
  await files.putFull({ id: "f1", name: "photo.jpg", collection: "", blob: blobOf("x") });
  await ros.put({ id: "r1", ro: "100" });
  await ros.put({ id: "r2", ro: "200" });
  await ros.attach("r1", ["f1"]);
  await ros.attach("r2", ["f1"]);
  const before = await files.get("f1");
  const r1 = await ros.get("r1");
  r1.ro = "101";
  await ros.put(r1);
  assert.equal((await ros.byNumber("101")).id, "r1");
  assert.deepEqual(await files.get("f1"), before, "the file record is untouched (same rev, same collection)");
  assert.deepEqual((await ros.attachments("r1")).map((f) => f.id), ["f1"]);
  assert.deepEqual((await ros.attachments("r2")).map((f) => f.id), ["f1"]);
  assert.deepEqual((await ros.ofFile("f1")).map((r) => r.id).sort(), ["r1", "r2"]);
  await assert.rejects(ros.put({ id: "r3", ro: "200" }), (e) => e.name === "RoConflict" && e.other.id === "r2");
});

test("deleting a repair order trashes it and keeps, unlinks or trashes its files", async () => {
  await fresh(); await db.open();
  for (const id of ["a", "b", "c", "shared"]) await files.putFull({ id, name: id, blob: blobOf(id) });
  await ros.put({ id: "keep", ro: "1" }); await ros.attach("keep", ["a"]);
  await ros.put({ id: "unl", ro: "2" }); await ros.attach("unl", ["b"]);
  await ros.put({ id: "tr", ro: "3" }); await ros.attach("tr", ["c", "shared"]);
  await ros.put({ id: "other", ro: "4" }); await ros.attach("other", ["shared"]);

  assert.deepEqual(await ros.trash("keep"), { trashed: [], unlinked: 0, kept: [] });
  assert.ok((await ros.get("keep")).deletedAt);
  assert.equal((await links.from("ro", "keep")).length, 1, "keep: the link stays for a restore");
  assert.deepEqual((await ros.live()).map((r) => r.id).sort(), ["other", "tr", "unl"]);
  assert.deepEqual((await ros.listTrash()).map((r) => r.id), ["keep"]);

  assert.equal((await ros.trash("unl", { attachments: "unlink" })).unlinked, 1);
  assert.equal((await links.from("ro", "unl")).length, 0);
  assert.equal((await files.get("b")).deletedAt, undefined, "unlink: the file stays in Files");

  const t = await ros.trash("tr", { attachments: "trash" });
  assert.deepEqual(t.trashed, ["c"]);
  assert.deepEqual(t.kept, ["shared"], "a file another live RO uses is not trashed");
  assert.ok((await files.get("c")).deletedAt);

  await ros.restore("tr", { files: true });
  assert.equal((await ros.get("tr")).deletedAt, undefined);
  assert.equal((await files.get("c")).deletedAt, undefined);

  // A trashed RO keeps its number.
  await assert.rejects(ros.put({ id: "new", ro: "1" }), (e) => e.name === "RoConflict" && !!e.other.deletedAt);
  const p = await ros.purge("keep");
  assert.equal(p.purged, true);
  assert.equal(await ros.get("keep"), undefined);
  assert.equal((await links.from("ro", "keep")).length, 0);
  assert.ok(await files.get("a"), "purging an RO never deletes its files");
  await ros.put({ id: "new", ro: "1" });
});

test("a repair order pins an exact LI version and its tools; a newer import is reported, not applied", async () => {
  await fresh(); await db.open();
  await documents.put({ id: "LI54.10-P-070001_3", li: "LI54.10-P-070001", ver: "3", title: "Wiring" });
  await tools.put({ id: "t1", toolNo: "000 589 01 23 00", name: "Puller" });
  await ros.put({ id: "r1", ro: "500" });
  await ros.pinDocument("r1", await documents.get("LI54.10-P-070001_3"));
  await ros.pinTool("r1", "t1");
  let refs = await ros.references("r1");
  assert.equal(refs.documents.length, 1);
  assert.equal(refs.documents[0].doc.ver, "3");
  assert.equal(refs.documents[0].newer, false);
  assert.equal(refs.tools[0].tool.name, "Puller");
  await documents.put({ id: "LI54.10-P-070001_4", li: "LI54.10-P-070001", ver: "4", title: "Wiring (rev)" });
  refs = await ros.references("r1");
  assert.equal(refs.documents[0].doc.id, "LI54.10-P-070001_3", "the RO still points at what was used");
  assert.equal(refs.documents[0].newer, true);
  assert.equal(refs.documents[0].latest.ver, "4");
  assert.equal((await documents.latestOf("LI54.10-P-070001")).ver, "4");
  // The pinned version is deleted: the link's snapshot still names it.
  await documents.remove("LI54.10-P-070001_3");
  refs = await ros.references("r1");
  assert.equal(refs.documents[0].doc, null);
  assert.equal(refs.documents[0].link.ver, "3");
  assert.equal(refs.documents[0].newer, true);
  await ros.unpinTool("r1", "t1");
  assert.equal((await ros.references("r1")).tools.length, 0);
});

test("vehicles: one record per VIN, check digit recorded, confirmed only by a person, never downgraded", async () => {
  await fresh(); await db.open();
  const v = await vehicles.note(VIN.toLowerCase(), { source: "ro-scan" });
  assert.equal(v.vin, VIN);
  assert.equal(v.series, "214");
  assert.equal(v.checkDigit, true);
  assert.equal(v.status, "check-digit-ok");
  assert.deepEqual(v.sources, ["ro-scan"]);
  await vehicles.confirm(VIN);
  await vehicles.note(VIN, { source: "ro", fin: "WDD2140471A000001" });
  const again = await vehicles.get(VIN);
  assert.equal(again.status, "confirmed");
  assert.deepEqual(again.sources, ["ro-scan", "ro"]);
  assert.equal(again.fin, "WDD2140471A000001");
  await vehicles.confirm(VIN, false);
  assert.equal((await vehicles.get(VIN)).status, "check-digit-ok");
  assert.equal((await vehicles.note(VIN_BAD, { source: "ro-scan" })).status, "extracted");
  await assert.rejects(vehicles.note("NOTAVIN", {}), /Not a VIN/);
});

test("vehicles.summary answers files, repair orders, LI documents and tools for one car in one read", async () => {
  await fresh(); await db.open();
  await files.putFull({ id: "f1", name: "a.jpg", vins: [VIN], blob: blobOf("a") });
  await files.putFull({ id: "f2", name: "b.jpg", vins: [VIN], blob: blobOf("b") });
  await files.putFull({ id: "f3", name: "hidden.pdf", vins: [VIN], inFiles: 0, blob: blobOf("c") });
  await files.trash(["f2"]);
  await ros.put({ id: "r1", ro: "1", vin: VIN });
  await ros.put({ id: "r2", ro: "2", vin: VIN });
  await ros.trash("r2");
  await documents.put({ id: "d1", li: "LI1", ver: "1", validity: "Model 214" });
  await documents.put({ id: "d2", li: "LI2", ver: "1", validity: "205, 213" });
  await tools.put({ id: "t1", toolNo: "1", validities: ["213, 214"] });
  await tools.put({ id: "t2", toolNo: "2", validities: ["2140"] });
  await vehicles.note(VIN, { source: "ro" });
  const s = await vehicles.summary(VIN);
  assert.equal(s.series, "214");
  assert.equal(s.vehicle.status, "check-digit-ok");
  assert.deepEqual([s.files.count, s.ros.count, s.documents.count, s.tools.count], [1, 1, 1, 1]);
  assert.equal(s.files.items[0].id, "f1");
  assert.equal(s.documents.items[0].id, "d1");
  assert.equal(s.tools.items[0].id, "t1");
  const none = await vehicles.summary("1HGCM82633A004352");
  assert.equal(none.vehicle, null);
  assert.equal(none.series, "");
  assert.equal(none.documents.count, 0);
});

test("one backup round-trips repair orders, their links, vehicles, the trash and shared bytes", async () => {
  await fresh(); await db.open();
  await files.putFull({ id: "f1", name: "a.jpg", vins: [VIN], blob: blobOf("AAA") });
  const [dup] = await files.ingest([{ blob: blobOf("AAA"), name: "a-copy.jpg", reuse: "f1" }]);
  await files.putFull({ id: "f3", name: "old.txt", blob: blobOf("old") });
  await files.trash(["f3"]);
  await documents.putWithFile({ id: "LI1_1", li: "LI1", ver: "1" }, blobOf("%PDF", "application/pdf"));
  await tools.put({ id: "t1", toolNo: "000 589 01 23 00" });
  await ros.put({ id: "r1", ro: "42", vin: VIN, lines: [{ op: "A", text: "Replace pump" }] });
  await ros.put({ id: "r2", ro: "43" });
  await ros.trash("r2");
  await ros.attach("r1", ["f1", dup.id]);
  await ros.pinDocument("r1", await documents.get("LI1_1"));
  await ros.pinTool("r1", "t1");
  await vehicles.note(VIN, { source: "ro" });
  await vehicles.confirm(VIN);

  const { blob, meta } = await backup.collect();
  assert.equal(meta.records.ros.length, 2);
  assert.equal(meta.records.links.length, 4);
  assert.equal(meta.records.vehicles.length, 1);
  assert.equal(meta.payloads.filter((p) => p.store === "blobs").length, 3, "shared bytes are in the file once");
  assert.ok(meta.payloads.filter((p) => p.store === "blobs").every((p) => /^[0-9a-f]{64}$/.test(p.sha256)));

  const report = await backup.restore(blob, {});
  assert.equal(report.ok, true);
  assert.equal(await dbExists("file-database-1"), false);
  assert.equal((await ros.get("r1")).lines[0].text, "Replace pump");
  assert.ok((await ros.get("r2")).deletedAt, "the trash survives a restore");
  assert.deepEqual((await ros.attachments("r1")).map((f) => f.id).sort(), ["f1", dup.id].sort());
  const refs = await ros.references("r1");
  assert.equal(refs.documents[0].doc.id, "LI1_1");
  assert.equal(refs.tools[0].tool.id, "t1");
  assert.equal((await vehicles.get(VIN)).status, "confirmed");
  assert.equal(await (await files.getBlob(dup.id)).text(), "AAA");
  assert.ok((await files.get("f3")).deletedAt);
  assert.equal(await (await documents.getBlob("LI1_1")).text(), "%PDF");
});

test("a backup from before Phase 5 (no vehicles list) still restores", async () => {
  await fresh(); await db.open();
  await ros.put({ id: "r1", ro: "7" });
  const { meta } = await backup.collect();
  delete meta.records.vehicles;
  const legacy = FDCore.formats.fdb.build(meta, []);
  const report = await backup.restore(legacy, {});
  assert.equal(report.ok, true);
  assert.equal((await ros.get("r1")).ro, "7");
  assert.deepEqual(await vehicles.list(), []);
});

test("a generation created at schema version 1 is upgraded in place, data kept", async () => {
  await fresh();
  // Build file-database-1 exactly as version 1 had it: every store but
  // vehicles, and none of the new indexes.
  await new Promise((resolve, reject) => {
    const r = indexedDB.open("file-database-1", 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const [name, def] of Object.entries(FDSchema.STORES)) {
        if (name === "vehicles") continue;
        const os = d.createObjectStore(name, { keyPath: def.keyPath, autoIncrement: !!def.autoIncrement });
        for (const [ix, x] of Object.entries(def.indexes || {})) {
          if ((name === "files" && ix === "blobId") || (name === "ros" && ix === "deletedAt")) continue;
          os.createIndex(ix, x.keyPath || ix, { unique: !!x.unique, multiEntry: !!x.multiEntry });
        }
      }
      r.transaction.objectStore("ros").put({ id: "r1", ro: "9", roKey: "9", lines: [], rev: 1 });
    };
    r.onsuccess = () => { r.result.close(); resolve(); };
    r.onerror = () => reject(r.error);
  });
  db.setCurrentName("file-database-1");
  const conn = await db.open();
  assert.equal(conn.version, FDSchema.VERSION);
  assert.ok(conn.objectStoreNames.contains("vehicles"));
  assert.equal((await ros.get("r1")).ro, "9");
  await ros.trash("r1");
  assert.deepEqual((await ros.listTrash()).map((r) => r.id), ["r1"]);
  await vehicles.note(VIN, {});
  assert.equal((await vehicles.list()).length, 1);
});

test("settings are stored by key alone (no stray id field)", async () => {
  await fresh(); await db.open();
  await repos.settings.setValue("x.y", 3);
  const row = await repos.settings.get("x.y");
  assert.equal(row.value, 3);
  assert.equal(row.id, undefined);
});

test("intake puts exact duplicates to the reviewer before writing: reuse, keep or skip", async () => {
  await fresh(); await db.open();
  const { intake, jobs } = FDData;
  const first = await intake.ingest("vault", [new File(["ONE"], "one.txt", { type: "text/plain" }), new File(["TWO"], "two.txt"), new File(["THREE"], "three.txt")], { vinDetect: false });
  const [idOne, idTwo, idThree] = first.ids;
  await ros.put({ id: "r1", ro: "1" });
  let asked = null;
  const out = await intake.ingest("vault", [
    new File(["ONE"], "one again.txt"), new File(["TWO"], "two again.txt"), new File(["THREE"], "three again.txt"), new File(["NEW"], "new.txt"),
  ], {
    vinDetect: false, roId: "r1",
    reviewDuplicates: (list) => {
      asked = list;
      return [{ index: 0, action: "reuse" }, { index: 1, action: "keep" }, { index: 2, action: "skip" }];
    },
  });
  assert.deepEqual(asked.map((a) => [a.index, a.name, a.matches[0].id]), [[0, "one again.txt", idOne], [1, "two again.txt", idTwo], [2, "three again.txt", idThree]]);
  const byName = Object.fromEntries(out.results.map((r) => [r.name, r]));
  assert.equal(byName["one again.txt"].reused, true);
  assert.equal((await files.get(byName["one again.txt"].id)).blobId, idOne);
  assert.equal(byName["two again.txt"].ok, true);
  assert.equal((await files.get(byName["two again.txt"].id)).blobId, undefined, "keep = a second copy");
  assert.equal(byName["three again.txt"].skipped, true);
  assert.equal(byName["three again.txt"].duplicateOf, idThree);
  assert.equal(out.ids.length, 3);
  const onRo = (await ros.attachments("r1")).map((f) => f.id).sort();
  assert.deepEqual(onRo, out.ids.concat([idThree]).sort(), "a skipped duplicate is attached as the stored file");
  // No reviewer: both kept, nothing dropped.
  const plain = await intake.ingest("vault", [new File(["ONE"], "one thrice.txt")], { vinDetect: false });
  assert.equal(plain.results[0].ok, true);
  assert.equal((await files.get(plain.ids[0])).blobId, undefined);
  await jobs.stop?.();
});

test("LI's Add to File Vault is the same record and the same bytes, not a copy", async () => {
  await fresh(); await db.open();
  await documents.putWithFile({ id: "LI9_1", li: "LI9", ver: "1" }, blobOf("%PDF-li", "application/pdf"));
  const fileId = (await documents.get("LI9_1")).fileId;
  assert.equal((await files.listMeta({ inFiles: 1 })).length, 0, "hidden until added");
  await files.update(fileId, { inFiles: 1, collection: repos.LI_COLLECTION });
  const shown = await files.listMeta({ inFiles: 1 });
  assert.deepEqual(shown.map((f) => f.id), [fileId]);
  assert.equal((await files.list()).length, 1, "one record");
  assert.equal((await blobRows()).length, 1, "one blob");
  assert.equal(await (await documents.getBlob("LI9_1")).text(), "%PDF-li");
});
