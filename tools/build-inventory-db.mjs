// Build a self-contained Tool Inventory database file (.tidb) from the source
// data (inventory-data/tools.json + inventory-data/img/*.png).
//
// Format (little-endian):
//   "TIDB" (4 bytes) | uint32 version | uint32 metaLen
//   metaLen bytes: UTF-8 JSON { format, version, exportedAt, source, updated,
//                               tools:[...], photos:[{id,len}] }
//   then: each photo's raw PNG bytes, concatenated in photos[] order.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "inventory-data");
const IMG = path.join(SRC, "img");
const OUT = path.join(ROOT, "dist-db", "FileInventory.tidb");

const data = JSON.parse(fs.readFileSync(path.join(SRC, "tools.json"), "utf8"));
const tools = data.tools || [];

// Collect the unique photos actually referenced by tools and present on disk.
const seen = new Set();
const photos = [];
const photoBufs = [];
for (const t of tools) {
  const id = t.photo;
  if (!id || seen.has(id)) continue;
  const p = path.join(IMG, id + ".png");
  if (!fs.existsSync(p)) continue;
  seen.add(id);
  const buf = fs.readFileSync(p);
  photos.push({ id, len: buf.length });
  photoBufs.push(buf);
}

const meta = {
  format: "tool-inventory-db",
  version: 1,
  exportedAt: 0,
  source: data.source || "Master Tool List",
  updated: data.updated || "",
  tools,
  photos,
};
const metaBytes = Buffer.from(JSON.stringify(meta), "utf8");

const header = Buffer.alloc(12);
header.write("TIDB", 0, "ascii");
header.writeUInt32LE(1, 4);
header.writeUInt32LE(metaBytes.length, 8);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const out = fs.createWriteStream(OUT);
out.write(header);
out.write(metaBytes);
for (const b of photoBufs) out.write(b);
out.end();
out.on("finish", () => {
  const total = 12 + metaBytes.length + photoBufs.reduce((n, b) => n + b.length, 0);
  console.log(`Wrote ${OUT}`);
  console.log(`  tools: ${tools.length}  photos: ${photos.length}  size: ${(total / 1048576).toFixed(2)} MB`);
});
