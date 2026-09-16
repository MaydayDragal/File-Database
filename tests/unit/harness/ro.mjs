// Run Repair Order parser cases inside the real page, through window.__ros.
//
// The parser is not importable yet (it lives in ros/index.html), so the cases
// are evaluated in a Playwright page served from the repository root. Each
// case is { id, fn, args } where fn is a window.__ros function and args are
// JSON; a regular expression argument is written as { "$re": "source", "flags": "i" }.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { launchBrowser } from "../../../tools/e2e-browser.mjs";
import { ROOT } from "./lift.mjs";

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png" };

function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    let file = path.join(ROOT, p);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("nf"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, () => r(server)));
}

export async function runRoCases(cases) {
  const server = await serve();
  const base = `http://localhost:${server.address().port}/`;
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.goto(base + "ros/index.html", { waitUntil: "load" });
    await page.waitForFunction(() => window.__ros && typeof window.__ros.parseScan === "function", null, { timeout: 15000 });
    return await page.evaluate((list) => {
      const revive = (v) => {
        if (Array.isArray(v)) return v.map(revive);
        if (v && typeof v === "object") {
          if (typeof v.$re === "string") return new RegExp(v.$re, v.flags || "");
          const o = {}; for (const k of Object.keys(v)) o[k] = revive(v[k]); return o;
        }
        return v;
      };
      const out = {};
      for (const c of list) {
        const fn = window.__ros[c.fn];
        if (typeof fn !== "function") { out[c.id] = { $error: "no such hook: " + c.fn }; continue; }
        try { out[c.id] = fn(...revive(c.args)); }
        catch (e) { out[c.id] = { $error: String(e && e.message || e) }; }
      }
      return JSON.parse(JSON.stringify(out));
    }, cases);
  } finally {
    await browser.close();
    server.close();
  }
}
