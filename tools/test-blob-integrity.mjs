// Node-runnable fixtures for full-byte Blob comparison. The key regression:
// two same-size Blobs whose first eight bytes match but whose middle bytes
// differ must compare UNEQUAL (the old first-eight-bytes check said equal).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "vault", "blob-integrity.js"), "utf8");
const sandbox = {};
new Function("self", src)(sandbox);
const { equalBlobs } = sandbox.FileVaultIntegrity;

let failures = 0;
const check = (ok, label) => { console.log((ok ? "  ✓ " : "  ✗ ") + label); if (!ok) failures++; };

function blobOf(bytes) { return new Blob([Uint8Array.from(bytes)]); }
function seq(n, fill) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = fill == null ? i % 256 : fill; return a; }

// 1) Same size, first 8 bytes equal, a middle byte differs → NOT equal.
{
  const base = seq(2048);
  const a = base.slice();
  const b = base.slice(); b[1000] = (b[1000] + 1) & 0xff; // differs well past byte 8
  check(a.slice(0, 8).every((v, i) => v === b[i]), "fixture: first 8 bytes match (old check would pass)");
  check((await equalBlobs(blobOf(a), blobOf(b))) === false, "same-size mid-file corruption is detected as unequal");
}

// 2) Differing final byte.
{
  const a = seq(4096);
  const b = a.slice(); b[b.length - 1] = (b[b.length - 1] + 1) & 0xff;
  check((await equalBlobs(blobOf(a), blobOf(b))) === false, "a differing final byte is detected");
}

// 3) Size mismatch.
{
  check((await equalBlobs(blobOf(seq(1000)), blobOf(seq(1001)))) === false, "different sizes are unequal");
}

// 4) Identical zero-byte Blobs.
{
  check((await equalBlobs(new Blob([]), new Blob([]))) === true, "two empty blobs are equal");
}

// 5) Identical multi-chunk content compares equal without a whole-file copy.
{
  const big = seq(3 * 1024 * 1024 + 123); // spans >3 chunks at 1 MiB
  check((await equalBlobs(blobOf(big), blobOf(big), 1024 * 1024)) === true, "identical multi-chunk blobs compare equal");
}

// 6) A difference in a later chunk (not the first) is caught.
{
  const big = seq(3 * 1024 * 1024);
  const b = big.slice(); b[2_500_000] = (b[2_500_000] + 1) & 0xff;
  check((await equalBlobs(blobOf(big), blobOf(b), 1024 * 1024)) === false, "corruption in a later chunk is detected");
}

console.log(failures === 0 ? "\nBLOB-INTEGRITY CHECKS PASSED ✅" : `\n${failures} BLOB-INTEGRITY CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
