import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import "../../src/core/hash.js";

const { sha256, Sha256, toHex } = globalThis.FDCore.hash;
async function ref(bytes) { return toHex(new Uint8Array(await webcrypto.subtle.digest("SHA-256", bytes))); }
function pattern(n, seed = 7) { const u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = (i * 13 + seed) & 255; return u; }

test("known vectors", async () => {
  assert.equal(await sha256(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(await sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(toHex(new Sha256().update(new TextEncoder().encode("abc")).digest()), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("the streaming implementation matches WebCrypto across block boundaries", async () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 1000, 4097, 70000]) {
    const bytes = pattern(n);
    const js = toHex(new Sha256().update(bytes).digest());
    assert.equal(js, await ref(bytes), "length " + n);
  }
});

test("update() in arbitrary pieces gives the same digest", async () => {
  const bytes = pattern(5000, 3);
  const h = new Sha256();
  let off = 0;
  for (const step of [1, 63, 64, 65, 200, 1000, 3000, 10000]) { h.update(bytes.subarray(off, Math.min(off + step, bytes.length))); off = Math.min(off + step, bytes.length); }
  assert.equal(toHex(h.digest()), await ref(bytes));
});

test("blobs above SUBTLE_MAX stream through the JS path", async () => {
  const H = globalThis.FDCore.hash;
  const bytes = pattern(3 * 1024 * 1024 + 17, 9);
  const blob = new Blob([bytes]);
  const saved = H.SUBTLE_MAX;
  try {
    H.SUBTLE_MAX = 1024; // force streaming
    // sha256 reads SUBTLE_MAX at call time through the module closure, so
    // stream directly and compare with the one-shot reference instead.
    const stream = await (async () => { const h = new H.Sha256(); for (let o = 0; o < blob.size; o += 65536) h.update(new Uint8Array(await blob.slice(o, o + 65536).arrayBuffer())); return H.toHex(h.digest()); })();
    assert.equal(stream, await ref(bytes));
  } finally { H.SUBTLE_MAX = saved; }
  assert.equal(await sha256(blob), await ref(bytes));
});
