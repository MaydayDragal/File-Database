import test from "node:test";
import assert from "node:assert/strict";
import { FDData, FDCore, fresh, blobOf } from "./harness/data.mjs";

const { files, documents, ros, links, settings, tools, RevConflict, RoConflict } = FDData.repos;
const sha = FDCore.hash.sha256;

test("put bumps rev, expectedRev guards against lost updates", async () => {
  await fresh();
  const t = await tools.put({ id: "t1", toolNo: "000 589 01 23 00", desc: "wrench" });
  assert.equal(t.rev, 1);
  const t2 = await tools.put({ id: "t1", toolNo: "000 589 01 23 00", desc: "wrench!" }, { expectedRev: 1 });
  assert.equal(t2.rev, 2);
  await assert.rejects(tools.put({ id: "t1", desc: "stale" }, { expectedRev: 1 }), (e) => e instanceof RevConflict && e.current.rev === 2);
  assert.equal((await tools.get("t1")).desc, "wrench!");
});

test("files: putFull splits blob/thumb, getFull joins them, listMeta never carries bytes", async () => {
  await fresh();
  const blob = blobOf("hello world"), thumb = blobOf("th", "image/jpeg");
  const w = await files.putFull({ id: "f1", name: "a.txt", type: "text/plain", blob, thumb }, { verify: true });
  assert.equal(w.size, 11);
  assert.equal(w.sha256, await sha(blob));
  const full = await files.getFull("f1");
  assert.equal(await full.blob.text(), "hello world");
  assert.equal(await full.thumb.text(), "th");
  assert.equal(full.sha256, await sha(blob));
  const meta = await files.listMeta({ inFiles: 1 });
  assert.equal(meta.length, 1);
  assert.equal(meta[0].blob, undefined);
  assert.equal(await meta[0].thumb.text(), "th");
  assert.equal(meta[0].searchText, files.buildSearchText(meta[0]));
  // A metadata put never touches the blob.
  await files.put({ id: "f1", name: "renamed.txt", type: "text/plain", size: 11 });
  assert.equal(await (await files.getFull("f1")).blob.text(), "hello world");
  assert.equal((await files.get("f1")).rev, 2);
  assert.equal(await files.count("inFiles", 1), 1);
});

test("files: ingest reports per file and links/removes cleanly", async () => {
  await fresh();
  const res = await files.ingest([
    { blob: blobOf("one"), name: "one.txt", type: "text/plain", meta: { collection: "RO 1" } },
    { blob: null, name: "broken.txt", type: "text/plain" },
  ]);
  assert.equal(res.length, 2);
  assert.equal(res[0].ok, true); assert.equal(res[1].ok, false);
  const id = res[0].id;
  await links.link("ro", "r1", "file", id, "attachment");
  assert.equal((await links.to("file", id)).length, 1);
  assert.equal((await files.byCollection("RO 1")).length, 1);
  await files.renameCollection("RO 1", "RO 2");
  assert.equal((await files.byCollection("RO 2"))[0].id, id);
  await files.removeFull(id);
  assert.equal(await files.get(id), undefined);
  assert.equal(await files.getBlob(id), null);
  assert.equal((await links.to("file", id)).length, 0);
});

test("documents: putWithFile owns a hidden PDF file, re-keying and delete keep it consistent", async () => {
  await fresh();
  const pdf = blobOf("%PDF-1.4 fake", "application/pdf");
  const d = await documents.putWithFile({ id: "LI54.10-P-070001_3", li: "LI54.10-P-070001", ver: "3", title: "T", filename: "x.pdf", size: pdf.size }, pdf);
  assert.ok(d.fileId);
  const f = await files.get(d.fileId);
  assert.equal(f.inFiles, 0); assert.equal(f.docId, d.id); assert.equal(f.collection, "LI Documents"); assert.equal(f.kind, "pdf");
  assert.equal(await (await documents.getBlob(d.id)).text(), "%PDF-1.4 fake");
  assert.equal((await files.listMeta({ inFiles: 1 })).length, 0, "hidden from the Files app");
  // Corrected version → new id, same file, old record gone.
  const d2 = await documents.putWithFile({ id: "LI54.10-P-070001_4", li: "LI54.10-P-070001", ver: "4", title: "T", fileId: d.fileId }, null, { oldId: d.id });
  assert.equal(await documents.get(d.id), undefined);
  assert.equal((await files.get(d.fileId)).docId, d2.id);
  // Copy to Files, then delete the document: the file stays.
  await files.update(d.fileId, { inFiles: 1, tags: ["LI54.10-P-070001"] });
  await documents.removeWithFile(d2.id);
  assert.equal((await files.get(d.fileId)).docId, undefined);
  assert.equal(await (await files.getBlob(d.fileId)).text(), "%PDF-1.4 fake");
  // A hidden document's delete removes the file and its bytes.
  const d3 = await documents.putWithFile({ id: "GF00.00-P-000001_1", li: "GF00.00-P-000001", ver: "1" }, pdf);
  await documents.removeWithFile(d3.id);
  assert.equal(await files.get(d3.fileId), undefined);
  assert.equal(await files.getBlob(d3.fileId), null);
});

test("ros: RO numbers are unique (D7) but blank drafts are not", async () => {
  await fresh();
  await ros.put({ id: "r1", ro: "123456" });
  await ros.put({ id: "r2", ro: "" });
  await ros.put({ id: "r3", ro: "" });
  await assert.rejects(ros.put({ id: "r4", ro: " 123 456 " }), (e) => e instanceof RoConflict && e.other.id === "r1");
  assert.equal((await ros.byNumber("123456")).id, "r1");
  await ros.put({ id: "r1", ro: "123456", vehicle: "GLC" }); // same record may keep its number
  assert.equal((await ros.get("r1")).rev, 2);
  assert.equal(await ros.count(), 3);
});

test("links and settings verbs", async () => {
  await fresh();
  await links.linkMany([
    { fromType: "ro", fromId: "r1", toType: "file", toId: "f1", kind: "attachment" },
    { fromType: "ro", fromId: "r1", toType: "file", toId: "f2", kind: "attachment" },
    { fromType: "ro", fromId: "r1", toType: "document", toId: "d1", kind: "reference" },
  ]);
  assert.equal((await links.from("ro", "r1")).length, 3);
  assert.equal((await links.from("ro", "r1", "attachment")).length, 2);
  await links.unlink("ro", "r1", "file", "f1", "attachment");
  assert.equal((await links.from("ro", "r1", "attachment")).length, 1);
  assert.equal(await links.removeFor("ro", "r1"), 2);
  await settings.setValue("vault.view", "list");
  assert.equal(await settings.getValue("vault.view", "grid"), "list");
  assert.equal(await settings.getValue("vault.nope", "grid"), "grid");
  assert.equal((await settings.listPrefix("vault.")).length, 1);
});

test("bus announces commits with ids", async () => {
  await fresh();
  const seen = [];
  const off = FDData.bus.on("tools:changed", (d) => seen.push(d));
  await tools.put({ id: "t9" });
  await tools.remove("t9");
  off();
  assert.deepEqual(seen.map((d) => d.op), ["put", "remove"]);
  assert.deepEqual(seen[0].ids, ["t9"]);
});
