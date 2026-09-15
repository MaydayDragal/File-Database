// Unit-level checks for ocr.js — the shared text-recognition helper every app
// reads scans through. Covers the two things that were silently wrong:
//   - the engine's default page segmentation reads a form as one block, so
//     every read must ask for document mode (3) first;
//   - a page fed through the scanner sideways is not reported as a failure, so
//     the orientation is measured, and the probe deliberately measures in
//     single-block mode (6), the mode that cannot cope with rotated text.
// The engine itself is a scripted fake: these check the decisions, not the
// recognition (no CDN, no traineddata, runs offline in about a second).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./e2e-browser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
let failures = 0;
const check = (c, l, extra) => { console.log((c ? "  ✓ " : "  ✗ ") + l + (c || extra === undefined ? "" : " — got " + JSON.stringify(extra))); if (!c) failures++; };

await page.goto("about:blank");
await page.addScriptTag({ path: path.join(ROOT, "ocr.js") });
check(await page.evaluate(() => typeof window.OcrOrient === "object"), "ocr.js publishes OcrOrient");

// A source page: white, with a black bar across the top-left quarter.
await page.evaluate(() => {
  const c = document.createElement("canvas");
  c.width = 400; c.height = 300;
  const x = c.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, 400, 300);
  x.fillStyle = "#000"; x.fillRect(20, 20, 160, 60);
  window.__src = c;
  // A scripted engine. Every recognize() is recorded with the page-segmentation
  // mode in force, so the tests can see what was asked of it and when.
  window.__mk = (script) => {
    const calls = [];
    let psm = null;
    const words = (n, conf) => Array.from({ length: n }, (_, i) => ({ text: "word" + i, confidence: conf }));
    return {
      calls,
      worker: {
        setParameters: (p) => { psm = String(p.tessedit_pageseg_mode); return Promise.resolve(); },
        recognize: (canvas) => {
          const probe = psm === "6";
          const seen = calls.filter((c) => c.probe).length;
          const r = script({ probe, probeIndex: probe ? seen + 1 : 0, psm, w: canvas.width, h: canvas.height });
          calls.push({ psm, probe, w: canvas.width, h: canvas.height, gave: r.good });
          return Promise.resolve({ data: { text: r.text || "", confidence: r.conf, words: words(r.good, Math.max(60, r.conf)) } });
        },
      },
    };
  };
});

// ---------- render(): geometry and rotation ----------
const geom = await page.evaluate(() => {
  const out = {};
  for (const a of [0, 90, 180, 270]) {
    const c = OcrOrient.render(window.__src, a, 800, 0);
    out[a] = { w: c.width, h: c.height };
  }
  const band = OcrOrient.render(window.__src, 0, 800, 0.5);
  out.band = { w: band.width, h: band.height };
  // Where did the black bar actually end up? Measure it rather than guess.
  const darkBox = (canvas) => {
    const g = canvas.getContext("2d");
    const d = g.getImageData(0, 0, canvas.width, canvas.height).data;
    let x0 = canvas.width, y0 = canvas.height, x1 = -1, y1 = -1;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      if (d[(y * canvas.width + x) * 4] < 128) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };
  out.bar0 = darkBox(OcrOrient.render(window.__src, 0, 800, 0));
  out.bar90 = darkBox(OcrOrient.render(window.__src, 90, 800, 0));
  return out;
});
check(geom[0].w === 800 && geom[0].h === 600, "render keeps the page shape at 0°", geom[0]);
check(geom[90].w === 600 && geom[90].h === 800, "render swaps width and height at 90°", geom[90]);
check(geom[270].w === 600 && geom[270].h === 800, "render swaps width and height at 270°", geom[270]);
check(geom.band.w === 800 && geom.band.h === 300, "a band keeps the full width and half the height", geom.band);
// The bar sits across the top-left of the page: 40,40 320x120 once scaled to 800px.
const near = (a, b, tol = 8) => a && Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol;
check(near(geom.bar0, { x: 40, y: 40, w: 320, h: 120 }), "at 0° the page is drawn as it is", geom.bar0);
check(near(geom.bar90, { x: 440, y: 40, w: 120, h: 320 }),
  "turning 90° carries the top-left of the page to the top-right, upended", geom.bar90);

// ---------- inkBox(): aim the probe at the marks, not the paper ----------
const box = await page.evaluate(() => OcrOrient.inkBox(window.__src));
check(!!box && box.x <= 20 && box.y <= 20 && box.x + box.w >= 180 && box.y + box.h >= 80,
  "inkBox covers the marked area", box);
check(!!box && box.w < 400 && box.h < 300, "inkBox leaves out the blank paper around it", box);
const blank = await page.evaluate(() => {
  const c = document.createElement("canvas"); c.width = 200; c.height = 200;
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, 200, 200);
  return OcrOrient.inkBox(c);
});
check(blank === null, "a blank page has no ink box (the whole page is used)", blank);

// ---------- bestAngle(): pick the rotation the engine can actually read ----------
// Probes run in the order 0, 90, 270, 180 — here only the third reads well.
const sideways = await page.evaluate(async () => {
  const m = window.__mk(({ probe, probeIndex }) =>
    probe && probeIndex === 3 ? { good: 60, conf: 88 } : { good: 2, conf: 30 });
  const angle = await OcrOrient.bestAngle(m.worker, window.__src, {});
  return { angle, probes: m.calls.filter((c) => c.probe).length, psms: m.calls.map((c) => c.psm) };
});
check(sideways.angle === 270, "the rotation the engine reads well is the one chosen", sideways);
check(sideways.probes === 3, "probing stops as soon as a rotation reads well", sideways.probes);
check(sideways.psms.every((p) => p === "6"), "the probe measures in single-block mode", sideways.psms);

const upright = await page.evaluate(async () => {
  const m = window.__mk(({ probeIndex }) => (probeIndex === 1 ? { good: 60, conf: 88 } : { good: 0, conf: 10 }));
  const angle = await OcrOrient.bestAngle(m.worker, window.__src, {});
  return { angle, probes: m.calls.length };
});
check(upright.angle === 0 && upright.probes === 1, "an upright page is settled by a single probe", upright);

const unreadable = await page.evaluate(async () => {
  const m = window.__mk(() => ({ good: 0, conf: 8 }));
  const angle = await OcrOrient.bestAngle(m.worker, window.__src, {});
  return { angle, probes: m.calls.length };
});
check(unreadable.angle === 0 && unreadable.probes === 4,
  "a page that reads as nothing at any rotation is left alone", unreadable);

// ---------- reading: document mode, and probing only when it's needed ----------
const readModes = await page.evaluate(async () => {
  const m = window.__mk(() => ({ good: 40, conf: 90, text: "hello" }));
  const r = await OcrOrient.readAt(m.worker, window.__src, 0, {});
  return { psm: m.calls[0].psm, text: r.text, angle: r.angle };
});
check(readModes.psm === "3", "a read asks for document mode, not the engine's one-block default", readModes.psm);
check(readModes.text === "hello", "readAt returns the recognized text", readModes.text);

const accepted = await page.evaluate(async () => {
  const m = window.__mk(() => ({ good: 40, conf: 90, text: "VIN W1N0G8DB0MV000000" }));
  const r = await OcrOrient.readSmart(m.worker, window.__src, { accept: (t) => /W1N/.test(t) });
  return { probed: r.probed, calls: m.calls.length, angle: r.angle };
});
check(accepted.probed === false && accepted.calls === 1,
  "a read that found what the caller wanted never pays for a probe", accepted);

const rejected = await page.evaluate(async () => {
  const m = window.__mk(({ probe, probeIndex }) =>
    probe ? (probeIndex === 2 ? { good: 60, conf: 88 } : { good: 1, conf: 20 })
          : { good: 3, conf: 25, text: "scraps" });
  const r = await OcrOrient.readSmart(m.worker, window.__src, { accept: (t) => /W1N/.test(t) });
  const modes = m.calls.map((c) => c.psm).join(",");
  return { probed: r.probed, angle: r.angle, modes, calls: m.calls.length };
});
check(rejected.probed === true && rejected.angle === 90,
  "a read that came back with nothing is followed by a which-way-up check", rejected);
check(rejected.modes === "3,6,6,3", "…which measures in block mode, then re-reads in document mode", rejected.modes);

const nothingBetter = await page.evaluate(async () => {
  const m = window.__mk(({ probe }) => (probe ? { good: 0, conf: 5 } : { good: 3, conf: 25, text: "scraps" }));
  const r = await OcrOrient.readSmart(m.worker, window.__src, { accept: () => false });
  return { angle: r.angle, text: r.text, calls: m.calls.length };
});
check(nothingBetter.angle === 0 && nothingBetter.text === "scraps" && nothingBetter.calls === 5,
  "when no rotation reads better, the first read is kept rather than read again", nothingBetter);

console.log(errors.length ? "\nErrors:\n" + errors.join("\n") : "\nNo page errors.");
check(errors.length === 0, "no page errors");
await browser.close();
console.log(failures === 0 ? "\nOCR ORIENTATION CHECKS PASSED ✅" : `\n${failures} OCR ORIENTATION CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
