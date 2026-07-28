// Embed the app icon + version info into the packaged Windows .exe, using a
// pure-JS PE resource editor (no wine needed). Run after electron-builder.
import { NtExecutable, NtExecutableResource, Resource, Data } from "resedit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const exePath = process.argv[2] || path.join(HERE, "dist", "win-unpacked", "File Database.exe");
const icoPath = path.join(HERE, "icon.ico");

const exe = NtExecutable.from(fs.readFileSync(exePath));
const res = NtExecutableResource.from(exe);

const iconFile = Data.IconFile.from(fs.readFileSync(icoPath));
const iconData = iconFile.icons.map((i) => i.data);

const existing = Resource.IconGroupEntry.fromEntries(res.entries);
const groups = existing.length ? existing.map((e) => ({ id: e.id, lang: e.lang })) : [{ id: 1, lang: 1033 }];
for (const g of groups) Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, iconData);

const vi = Resource.VersionInfo.createEmpty();
vi.setFileVersion(1, 0, 0, 0);
vi.setProductVersion(1, 0, 0, 0);
vi.lang = 1033;
vi.setStringValues({ lang: 1033, codepage: 1200 }, {
  ProductName: "File Database",
  FileDescription: "File Database",
  CompanyName: "MaydayDragal",
  OriginalFilename: "File Database.exe",
  InternalName: "File Database",
  LegalCopyright: "",
});
vi.outputToResourceEntries(res.entries);

res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log("Embedded icon + version info into:", path.basename(exePath), "(" + groups.length + " icon group(s))");
