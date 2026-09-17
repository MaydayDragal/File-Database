import test from "node:test";
import assert from "node:assert/strict";
import { FDData, fresh, blobOf } from "./harness/data.mjs";

const { intake, repos, jobs } = FDData;
const F = (name, text, type) => new File([text], name, { type });

test("classifyTarget follows the shell's routing rule", () => {
  assert.equal(intake.classifyTarget(F("LI54.10-P-070001.pdf", "%PDF", "application/pdf")), "li");
  assert.equal(intake.classifyTarget(F("quarterly.pdf", "%PDF", "application/pdf")), "vault");
  assert.equal(intake.classifyTarget(F("notes.txt", "x", "text/plain")), "vault");
  assert.equal(intake.classifyTarget(F("a.tidb", "x", "")), "inventory-import");
  assert.equal(intake.classifyTarget(F("a.fvault", "x", "")), "vault-restore");
  assert.equal(intake.classifyTarget(F("a.lidb", "x", "")), "li-restore");
  assert.equal(intake.classifyTarget(F("a.fdb", "x", "")), "platform-restore");
});

test("ingest to vault: records, pinned VIN, RO link and the follow-up jobs", async () => {
  await fresh();
  const out = await intake.ingest("vault", [F("note.txt", "hello", "text/plain"), F("pic.png", "PNG!", "image/png")], { collection: "RO 42", vin: "wdd2130461a123456", roId: "r42" });
  assert.equal(out.results.filter((r) => r.ok).length, 2);
  const note = await repos.files.get(out.ids[0]);
  assert.equal(note.collection, "RO 42"); assert.deepEqual(note.vins, ["WDD2130461A123456"]); assert.equal(note.inFiles, 1);
  assert.equal((await repos.links.from("ro", "r42", "attachment")).length, 2);
  const active = await jobs.listActive();
  assert.deepEqual(active.map((j) => j.type).sort(), ["thumb", "vin-detect"]);
  assert.deepEqual(active.find((j) => j.type === "thumb").inputIds, [out.ids[1]]);
  assert.equal(await (await repos.files.getBlob(out.ids[0])).text(), "hello");
});

test("ingest to li and toolbox: hidden records and their jobs", async () => {
  await fresh();
  const li = await intake.ingest("li", [F("LI54.10-P-070001.pdf", "%PDF-1.4", "application/pdf")]);
  const f = await repos.files.get(li.ids[0]);
  assert.equal(f.inFiles, 0); assert.equal(f.collection, "LI Documents"); assert.equal(f.kind, "pdf");
  const tb = await intake.ingest("toolbox", [F("a.csv", "1,2", "text/csv")], { tab: "csv" });
  const t = await repos.files.get(tb.ids[0]);
  assert.equal(t.inFiles, 0); assert.equal(t.transient, 1);
  const active = await jobs.listActive();
  assert.deepEqual(active.map((j) => j.type).sort(), ["li-import", "toolbox-intake"]);
  assert.equal(active.find((j) => j.type === "toolbox-intake").meta.tab, "csv");
  assert.equal((await repos.files.listMeta({ inFiles: 1 })).length, 0);
});

test("a file that cannot be read is reported, not stored", async () => {
  await fresh();
  const bad = { name: "ghost.txt", type: "text/plain", size: 5, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) };
  const out = await intake.ingest("vault", [bad, F("ok.txt", "ok", "text/plain")]);
  assert.equal(out.results.length, 2);
  assert.equal(out.results[0].ok, false); assert.match(out.results[0].error, /read/);
  assert.equal(out.ids.length, 1);
});
