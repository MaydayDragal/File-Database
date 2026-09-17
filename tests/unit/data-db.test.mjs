import test from "node:test";
import assert from "node:assert/strict";
import { FDData, FDSchema, fresh, dbExists } from "./harness/data.mjs";

const db = FDData.db;

test("open() creates generation 1 with every store and index, and points at it", async () => {
  await fresh();
  assert.equal(db.currentName(), null);
  const conn = await db.open();
  assert.equal(db.currentName(), "file-database-1");
  for (const s of FDSchema.STORE_NAMES) {
    assert.ok(conn.objectStoreNames.contains(s), "store " + s);
    const os = conn.transaction(s, "readonly").objectStore(s);
    for (const ix of Object.keys(FDSchema.STORES[s].indexes || {})) assert.ok(os.indexNames.contains(ix), s + "." + ix);
  }
  assert.equal(db.nextName(), "file-database-2");
});

test("run() settles on transaction completion and rolls back on abort", async () => {
  await fresh();
  const v = await db.run(["settings"], "readwrite", (api) => api.req(api.store("settings").put({ key: "a", value: 1 })).then(() => "done"));
  assert.equal(v, "done");
  await assert.rejects(db.run(["settings"], "readwrite", (api) => {
    return api.req(api.store("settings").put({ key: "b", value: 2 })).then(() => { api.abort(new Error("no")); });
  }), /no/);
  const rows = await db.run(["settings"], "readonly", (api) => api.req(api.store("settings").getAll()));
  assert.deepEqual(rows.map((r) => r.key), ["a"]);
  // A thrown error inside fn also aborts.
  await assert.rejects(db.run(["settings"], "readwrite", (api) => { api.store("settings").put({ key: "c", value: 3 }); throw new Error("boom"); }), /boom/);
  assert.equal((await db.run(["settings"], "readonly", (api) => api.req(api.store("settings").count()))), 1);
});

test("probe() never creates a database; deleteDatabase removes one", async () => {
  await fresh();
  assert.equal(await dbExists("nothing-here"), false);
  assert.equal(await dbExists("nothing-here"), false);
  await db.open();
  assert.equal(await dbExists("file-database-1"), true);
  await db.deleteDatabase("file-database-1");
  assert.equal(await dbExists("file-database-1"), false);
});
