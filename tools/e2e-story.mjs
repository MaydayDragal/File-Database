// End-to-end test for the Story Studio tab: create/edit/persist a story,
// Markdown live preview, built-in text tools (case + find/replace), and the
// embedded platform integration (deep link, tab activation, Alt switching).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./e2e-browser.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  let file = path.join(ROOT, p);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;
console.log("serving", base);

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: "dark" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
let failures = 0;
const check = (c, l) => { console.log((c ? "  ✓ " : "  ✗ ") + l); if (!c) failures++; };
const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(100); } return false; };

// ---------- standalone ----------
await page.goto(base + "story/index.html", { waitUntil: "load" });
await page.waitForTimeout(400);
check(await page.locator("#body").count() === 1, "story editor loads");
// Empty DB → a fresh untitled story is created automatically.
check(await page.evaluate(() => window.__story.count()) >= 1, "a starter story exists on first run");

// Type a title and Markdown body.
await page.fill("#title", "Brake job writeup");
await page.click("#body");
await page.type("#body", "# Summary\n\nReplaced **front pads** and rotors.\n\n- torque to spec\n- bled the system\n");
await page.waitForTimeout(300);

// Live preview renders Markdown.
const pv = await page.locator("#preview").innerHTML();
check(/<h1>Summary<\/h1>/.test(pv), "Markdown heading renders in the preview");
check(/<strong>front pads<\/strong>/.test(pv), "Markdown bold renders in the preview");
check(/<ul><li>torque to spec<\/li>/.test(pv), "Markdown bullet list renders in the preview");

// Stats update.
check(/\d+ words/.test(await page.locator("#stat-words").textContent()), "word count shows");

// ---------- persistence across reload ----------
await page.waitForTimeout(600); // let autosave commit
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(500);
check((await page.inputValue("#title")) === "Brake job writeup", "title persisted across reload");
check(/Replaced/.test(await page.inputValue("#body")), "body persisted across reload");

// ---------- built-in text tool: UPPER on whole doc ----------
await page.click("#body");
await page.evaluate(() => { const t = document.querySelector("#body"); t.selectionStart = t.selectionEnd = 0; }); // no selection → whole doc
await page.click("#tools-btn");
await page.waitForTimeout(150);
await page.click('[data-case="upper"]');
await page.waitForTimeout(200);
check((await page.inputValue("#body")).includes("REPLACED **FRONT PADS**"), "UPPER tool transforms the whole story");

// ---------- find & replace ----------
await page.fill("#fr-find", "ROTORS");
await page.fill("#fr-replace", "DISCS");
await page.click("#fr-go");
await page.waitForTimeout(200);
check((await page.inputValue("#body")).includes("DISCS"), "find & replace applies");
await page.click("#drawer-close"); // close the tools drawer (its scrim is modal)
await page.waitForTimeout(250);

// ---------- new story ----------
const before = await page.evaluate(() => window.__story.count());
await page.click("#new-btn");
await page.waitForTimeout(200);
check((await page.evaluate(() => window.__story.count())) === before + 1, "New starts another story");

// ---------- embedded in the platform shell ----------
await page.goto(base + "#story", { waitUntil: "load" });
await page.waitForTimeout(600);
check(await page.locator("#tab-story.is-active, #tab-story[aria-selected='true']").count() >= 1, "deep link #story activates the Story tab");
const storyFrame = await waitFor(async () => !!page.frames().find((f) => f.url().includes("/story/")));
check(storyFrame, "the Story iframe is loaded in the shell");
const sf = page.frames().find((f) => f.url().includes("/story/"));
check(await sf.locator("#body").count() === 1, "the embedded Story editor is present");

// Alt+5 from inside the story frame switches to Extract? No — Alt maps 1..6:
// vault,li,inventory,toolbox,story,viewer. Story is #5; press Alt+1 to jump to Files.
await sf.locator("#body").click();
await page.keyboard.press("Alt+1");
await page.waitForTimeout(400);
check(await page.locator("#tab-vault.is-active, #tab-vault[aria-selected='true']").count() >= 1, "Alt+1 inside the Story frame switches apps via the shell");

console.log(errors.length ? "\nErrors:\n" + errors.join("\n") : "\nNo page errors.");
check(errors.length === 0, "no page errors");

await browser.close();
server.close();
console.log(failures === 0 ? "\nSTORY CHECKS PASSED ✅" : `\n${failures} STORY CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
