import test from "node:test";
import assert from "node:assert/strict";
import { FDData, fresh, blobOf } from "./harness/data.mjs";

const jobs = FDData.jobs;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("a registered handler runs queued jobs to done, with progress", async () => {
  await fresh();
  const j = await jobs.enqueue("thumb", ["a", "b"], { n: 1 });
  const ran = [];
  const off = jobs.register("thumb", async (job, ctl) => { ran.push(job.inputIds); await ctl.progress(0.5, "half"); return { made: 2 }; });
  const done = await jobs.whenDone(j.id, 5000);
  off();
  assert.equal(done.state, "done");
  assert.deepEqual(done.result, { made: 2 });
  assert.equal(done.progress, 1);
  assert.deepEqual(ran, [["a", "b"]]);
});

test("a rejecting handler requeues, then fails after MAX_ATTEMPTS; noRetry fails at once", async () => {
  await fresh();
  let calls = 0;
  const off = jobs.register("vin-detect", async () => { calls++; throw new Error("nope"); });
  const j = await jobs.enqueue("vin-detect", ["x"]);
  const done = await jobs.whenDone(j.id, 8000);
  off();
  assert.equal(done.state, "failed");
  assert.equal(done.attempts, jobs.MAX_ATTEMPTS);
  assert.equal(calls, jobs.MAX_ATTEMPTS);
  const off2 = jobs.register("li-import", async () => { const e = new Error("bad file"); e.noRetry = true; throw e; });
  const j2 = await jobs.enqueue("li-import", ["y"]);
  const d2 = await jobs.whenDone(j2.id, 5000);
  off2();
  assert.equal(d2.state, "failed"); assert.equal(d2.attempts, 1); assert.equal(d2.error, "bad file");
});

test("cancel: a queued job is cancelled outright, a running one when the handler yields", async () => {
  await fresh();
  const q = await jobs.enqueue("toolbox-intake", ["q"]);
  await jobs.cancel(q.id);
  assert.equal((await jobs.get(q.id)).state, "cancelled");
  let started = null;
  const off = jobs.register("vin-scan", async (job, ctl) => { started && started(); for (let i = 0; i < 50 && !ctl.cancelled(); i++) await sleep(20); });
  const started$ = new Promise((r) => { started = r; });
  const r = await jobs.enqueue("vin-scan", ["z"]);
  await started$;
  await jobs.cancel(r.id);
  const done = await jobs.whenDone(r.id, 5000);
  off();
  assert.equal(done.state, "cancelled");
});

test("stale running jobs from a dead page are requeued on boot", async () => {
  await fresh();
  const j = await jobs.enqueue("thumb", ["s"]);
  await FDData.db.run(["jobs"], "readwrite", (api) => api.req(api.store("jobs").get(j.id)).then((row) => { row.state = "running"; row.heartbeat = Date.now() - jobs.STALE_MS - 1; return api.req(api.store("jobs").put(row)); }));
  assert.equal(await jobs.requeueStale(), 1);
  assert.equal((await jobs.get(j.id)).state, "queued");
  assert.equal((await jobs.listActive("thumb")).length, 1);
});

test("registering several types back to back starts every one of them", async () => {
  await fresh();
  const a = await jobs.enqueue("thumb", ["a"]);
  const b = await jobs.enqueue("vin-detect", ["b"]);
  const c = await jobs.enqueue("vin-scan", ["c"]);
  const ran = [];
  const offs = [
    jobs.register("thumb", async (j) => { ran.push(j.type); }),
    jobs.register("vin-detect", async (j) => { ran.push(j.type); }),
    jobs.register("vin-scan", async (j) => { ran.push(j.type); }),
  ];
  const done = await Promise.all([a, b, c].map((j) => jobs.whenDone(j.id, 5000)));
  offs.forEach((off) => off());
  assert.deepEqual(done.map((j) => j.state), ["done", "done", "done"]);
  assert.deepEqual(ran.sort(), ["thumb", "vin-detect", "vin-scan"]);
});
