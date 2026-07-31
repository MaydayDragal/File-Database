// Node-runnable fixtures for the .fvault (v2) backup parser. Every malformed
// backup must be rejected with a stable BackupFormatError code BEFORE any
// entry is returned; only a well-formed backup parses.
//
// The parser is a classic browser script (attaches to a global); it's loaded
// here by evaluating its source with a stand-in global object. Node provides
// Blob, DataView, TextEncoder/Decoder — everything the parser uses.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "vault", "backup-format.js"), "utf8");
const sandbox = {};
// The script's IIFE resolves its root as `typeof self !== "undefined" ? self : globalThis`.
new Function("self", src)(sandbox);
const { parseBinary, BackupFormatError } = sandbox.FileVaultBackup;

let failures = 0;
const check = (ok, label, detail) => { console.log((ok ? "  ✓ " : "  ✗ ") + label + (ok || !detail ? "" : " — " + detail)); if (!ok) failures++; };

const MAGIC = [0x46, 0x56, 0x4c, 0x54];
function encode(str) { return new TextEncoder().encode(str); }
// Build a .fvault Blob from a meta object and per-file [blobBytes, thumbBytes].
// opts.trailing appends extra bytes; opts.metaLenOverride forces the header
// length field; opts.badMagic / opts.version tweak the header.
function buildBackup(meta, payloads, opts = {}) {
  const metaBytes = encode(JSON.stringify(meta));
  const header = new ArrayBuffer(12);
  const dv = new DataView(header);
  const magic = opts.badMagic || MAGIC;
  magic.forEach((b, i) => dv.setUint8(i, b));
  dv.setUint32(4, opts.version != null ? opts.version : 2, true);
  dv.setUint32(8, opts.metaLenOverride != null ? opts.metaLenOverride : metaBytes.length, true);
  const parts = [header, metaBytes];
  for (const [blob, thumb] of payloads) {
    if (blob) parts.push(blob);
    if (thumb) parts.push(thumb);
  }
  if (opts.trailing) parts.push(opts.trailing);
  return new Blob(parts, { type: "application/octet-stream" });
}
function fileMeta(over = {}) {
  return Object.assign({ id: "a", name: "a.bin", type: "application/octet-stream", blobLen: 4, thumbLen: 0, size: 4 }, over);
}
async function expectCode(file, code, label) {
  try {
    await parseBinary(file);
    check(false, label, "expected " + code + " but parsing succeeded");
  } catch (e) {
    check(e instanceof BackupFormatError && e.code === code, label, e && (e.code || e.message));
  }
}

// 1) A valid v2 backup with one blob and one thumbnail.
{
  const blob = encode("DATA");           // 4 bytes
  const thumb = encode("TH");            // 2 bytes
  const meta = { format: "file-vault", version: 2, files: [fileMeta({ blobLen: 4, thumbLen: 2, thumbType: "image/jpeg" })] };
  const file = buildBackup(meta, [[blob, thumb]]);
  const parsed = await parseBinary(file);
  check(parsed.entries.length === 1, "valid backup parses one entry");
  check(parsed.entries[0].blob.size === 4 && parsed.entries[0].thumb.size === 2, "entry blob and thumb have the declared sizes");
  check((await parsed.entries[0].blob.text()) === "DATA", "entry blob bytes are the stored bytes");
}

// 2) Metadata block that extends past the file.
{
  const meta = { format: "file-vault", version: 2, files: [] };
  const file = buildBackup(meta, [], { metaLenOverride: 100000 });
  await expectCode(file, "BAD_METADATA_LENGTH", "metadata longer than the file is rejected");
}

// 3) Blob length larger than the remaining bytes.
{
  const blob = encode("DATA");
  const meta = { format: "file-vault", version: 2, files: [fileMeta({ blobLen: 999, size: 999 })] };
  const file = buildBackup(meta, [[blob, null]]);
  await expectCode(file, "TRUNCATED_BLOB", "blob length past end of file is rejected");
}

// 4) Thumbnail length larger than the remaining bytes.
{
  const blob = encode("DATA");
  const meta = { format: "file-vault", version: 2, files: [fileMeta({ blobLen: 4, thumbLen: 999, size: 4 })] };
  const file = buildBackup(meta, [[blob, null]]);
  await expectCode(file, "TRUNCATED_THUMB", "thumbnail length past end of file is rejected");
}

// 5) A declared size that differs from the actual blob length.
{
  const blob = encode("DATA");
  const meta = { format: "file-vault", version: 2, files: [fileMeta({ blobLen: 4, size: 8 })] };
  const file = buildBackup(meta, [[blob, null]]);
  await expectCode(file, "SIZE_MISMATCH", "declared size ≠ stored bytes is rejected");
}

// 6) Valid records followed by trailing bytes.
{
  const blob = encode("DATA");
  const meta = { format: "file-vault", version: 2, files: [fileMeta({ blobLen: 4, size: 4 })] };
  const file = buildBackup(meta, [[blob, null]], { trailing: encode("EXTRA") });
  await expectCode(file, "TRAILING_BYTES", "trailing bytes after the last record are rejected");
}

// 7) Bad magic and wrong version.
{
  await expectCode(buildBackup({ format: "file-vault", version: 2, files: [] }, [], { badMagic: [0, 0, 0, 0] }), "BAD_MAGIC", "wrong signature is rejected");
  await expectCode(buildBackup({ format: "file-vault", version: 2, files: [] }, [], { version: 9 }), "BAD_VERSION", "unsupported version is rejected");
}

// 8) Not-a-backup JSON.
{
  await expectCode(buildBackup({ format: "something-else", files: [] }, []), "BAD_METADATA", "non-vault metadata is rejected");
}

console.log(failures === 0 ? "\nBACKUP-FORMAT CHECKS PASSED ✅" : `\n${failures} BACKUP-FORMAT CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
