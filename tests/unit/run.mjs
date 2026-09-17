// Run every tests/unit/*.test.mjs under Node's built-in test runner.
//
// Node 20 (the CI version) does not expand globs itself and does not accept a
// directory, so the files are listed here and passed explicitly.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(DIR).filter((n) => n.endsWith(".test.mjs")).sort().map((n) => path.join(DIR, n));
if (!files.length) { console.error("no tests/unit/*.test.mjs files found"); process.exit(1); }
const res = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(res.status === null ? 1 : res.status);
