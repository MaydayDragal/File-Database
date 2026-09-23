// Quick-open providers: each feature's `search` export answers from the
// shared database without loading the feature's UI.
import test from "node:test";
import assert from "node:assert/strict";
import { FDData, fresh, blobOf } from "./harness/data.mjs";
import { FEATURES } from "../../src/features/index.js";
import { search as searchFiles } from "../../src/features/files/search.js";
import { search as searchDocs } from "../../src/features/documents/search.js";
import { search as searchTools } from "../../src/features/inventory/search.js";
import { search as searchRos } from "../../src/features/ros/search.js";

const { repos, db } = FDData;
const VIN = "W1K2140471A068698";

async function seed() {
  await repos.files.putFull({ id: "f1", name: "Brake caliper.jpg", vins: [VIN], blob: blobOf("1") });
  await repos.files.putFull({ id: "f2", name: "Brake old.jpg", blob: blobOf("2") });
  await repos.files.putFull({ id: "f3", name: "Brake hidden.pdf", inFiles: 0, blob: blobOf("3") });
  await repos.files.trash(["f2"]);
  await repos.documents.put({ id: "LI42.10-P-000001_1", li: "LI42.10-P-000001", ver: "1", title: "Brake bleeding" });
  await repos.documents.put({ id: "LI42.10-P-000001_2", li: "LI42.10-P-000001", ver: "2", title: "Brake bleeding" });
  await repos.tools.put({ id: "t1", toolNo: "000 589 01 23 00", desc: "Brake piston reset" });
  await repos.ros.put({ id: "r1", ro: "12345", vin: VIN, customer: "Ada", lines: [{ op: "A", text: "Front brake pads worn" }] });
  await repos.ros.put({ id: "r2", ro: "12346", lines: [{ text: "brake noise" }] });
  await repos.ros.trash("r2");
}

test("every registered search export is a module with search()", async () => {
  const withSearch = FEATURES.filter((f) => f.search);
  assert.deepEqual(withSearch.map((f) => f.key), ["vault", "li", "inventory", "ros"]);
  for (const f of withSearch) assert.equal(typeof (await f.search()).search, "function", f.key);
});

test("each store answers the same query; the trash and hidden records stay out", async () => {
  await fresh(); await db.open(); await seed();
  const files = await searchFiles("brake", { repos });
  assert.deepEqual(files.map((r) => r.msg.id), ["f1"]);
  assert.deepEqual(files[0].msg, { type: "vault-open", id: "f1" });
  const docs = await searchDocs("brake bleed", { repos });
  assert.equal(docs.length, 1, "one row per LI number");
  assert.equal(docs[0].detail, "v2", "the newest version");
  assert.deepEqual(docs[0].msg, { type: "li-open", li: "LI42.10-P-000001" });
  assert.equal((await searchDocs("LI4210P", { repos })).length, 1, "a number typed without punctuation");
  const tools = await searchTools("0005890123", { repos });
  assert.deepEqual(tools[0].msg, { type: "inventory-open", toolNo: "000 589 01 23 00" });
  assert.equal((await searchTools("piston", { repos })).length, 1);
  const ros = await searchRos("brake pads", { repos });
  assert.deepEqual(ros.map((r) => r.msg.id), ["r1"]);
  assert.deepEqual((await searchRos(VIN.toLowerCase(), { repos })).map((r) => r.msg.id), ["r1"]);
  assert.deepEqual(await searchRos("noise", { repos }), [], "a trashed RO is not offered");
  assert.deepEqual(await searchFiles("   ", { repos }), []);
});
