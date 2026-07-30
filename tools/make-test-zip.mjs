// Build a test ZIP using EXACTLY the same writer logic as viewer.html
// (STORE + CRC32 + UTF-8 name flag), so CI can validate it on real Windows
// with Explorer's own zip handler. Node port — byte-identical output layout.
import fs from "node:fs";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let crc = 0xffffffff;
  for (let i = 0; i < u8.length; i++) crc = CRC_TABLE[(crc ^ u8[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const files = [
  { path: "Jobs/report.pdf", data: Buffer.from("%PDF-1.4 fake report") },
  { path: "notes.txt", data: Buffer.from("hello vault") },
  { path: "LI Documents/LI54.10-P-070001_2 - Brake procedure.pdf", data: Buffer.from("%PDF-1.4 fake LI doc") },
  { path: "photos/000589011000.png", data: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64") },
];

const enc = new TextEncoder();
const parts = [], central = [];
let offset = 0;
const now = new Date();
const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
for (const f of files) {
  const buf = new Uint8Array(f.data);
  const crc = crc32(buf);
  const nameBytes = enc.encode(f.path);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(0x0800, 6);
  lh.writeUInt16LE(0, 8);
  lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(buf.length, 18); lh.writeUInt32LE(buf.length, 22);
  lh.writeUInt16LE(nameBytes.length, 26); lh.writeUInt16LE(0, 28);
  parts.push(lh, Buffer.from(nameBytes), Buffer.from(buf));
  central.push({ name: nameBytes, crc, size: buf.length, offset });
  offset += 30 + nameBytes.length + buf.length;
}
const cdStart = offset;
let cdSize = 0;
for (const c of central) {
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
  ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
  ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14);
  ch.writeUInt32LE(c.crc, 16);
  ch.writeUInt32LE(c.size, 20); ch.writeUInt32LE(c.size, 24);
  ch.writeUInt16LE(c.name.length, 28);
  ch.writeUInt32LE(c.offset, 42);
  parts.push(ch, Buffer.from(c.name));
  cdSize += 46 + c.name.length;
}
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(central.length, 8); eocd.writeUInt16LE(central.length, 10);
eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(cdStart, 16);
parts.push(eocd);
fs.writeFileSync(process.argv[2] || "test-out.zip", Buffer.concat(parts));
console.log("wrote", process.argv[2] || "test-out.zip", Buffer.concat(parts).length, "bytes,", files.length, "entries");
