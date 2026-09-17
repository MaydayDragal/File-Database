import test from "node:test";
import assert from "node:assert/strict";
import "../../src/core/formats/container.js";
import "../../src/core/formats/fdb.js";

const { fdb, sniff, BackupFormatError } = globalThis.FDCore.formats;
const enc = (s) => new TextEncoder().encode(s);

function sample() {
  const meta = {
    exportedAt: 1, generation: "file-database-1",
    records: { files: [{ id: "f1", name: "a.txt" }], documents: [], tools: [], ros: [], links: [], settings: [{ key: "k", value: 1 }] },
    payloads: [{ store: "blobs", id: "f1", type: "text/plain", sha256: "x" }, { store: "thumbs", id: "f1", type: "image/jpeg" }],
  };
  return fdb.build(meta, [new Blob([enc("DATA")], { type: "text/plain" }), new Blob([enc("TH")], { type: "image/jpeg" })]);
}
async function expectCode(file, code) {
  await assert.rejects(fdb.parse(file), (e) => e instanceof BackupFormatError && e.code === code, "expected " + code);
}
function patched(blob, fn) { return blob.arrayBuffer().then((buf) => { const u = new Uint8Array(buf); fn(u, new DataView(buf)); return new Blob([u]); }); }

test("build → parse round-trips records and payload slices", async () => {
  const file = sample();
  assert.equal(await sniff(file), "fdb");
  const p = await fdb.parse(file);
  assert.equal(p.meta.format, "file-database");
  assert.equal(p.meta.records.files[0].name, "a.txt");
  assert.equal(p.payloads.length, 2);
  assert.equal(p.payloads[0].len, 4);
  assert.equal(await p.payloads[0].blob.text(), "DATA");
  assert.equal(await p.payloads[1].blob.text(), "TH");
  assert.equal(p.payloads[1].type, "image/jpeg");
});

test("every malformed backup is rejected with a stable code", async () => {
  const file = sample();
  await expectCode(new Blob([enc("short")]), "BAD_MAGIC");
  await expectCode(await patched(file, (u) => { u[0] = 0x58; }), "BAD_MAGIC");
  await expectCode(await patched(file, (u, dv) => { dv.setUint32(4, 9, true); }), "BAD_VERSION");
  await expectCode(await patched(file, (u, dv) => { dv.setUint32(8, 1e6, true); }), "BAD_METADATA_LENGTH");
  await expectCode(await patched(file, (u) => { u[12] = 0x21; }), "BAD_METADATA");
  await expectCode(new Blob([file.slice(0, file.size - 1)]), "TRUNCATED_PAYLOAD");
  await expectCode(new Blob([file, enc("!")]), "TRAILING_BYTES");
  const wrongFormat = fdb.build({ records: {}, payloads: [] }, []);
  const bad = await patched(wrongFormat, (u) => { const s = new TextDecoder().decode(u.subarray(12)); const t = s.replace('"file-database"', '"file-vaultxxx"'); u.set(enc(t), 12); });
  await expectCode(bad, "BAD_METADATA");
});

test("build refuses mismatched payload lists", () => {
  assert.throws(() => fdb.build({ records: {}, payloads: [{ store: "blobs", id: "a" }] }, []), /differ in length/);
});
