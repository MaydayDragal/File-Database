// Shared Playwright browser launcher for every E2E suite.
//
// Uses Playwright's own managed Chromium (installed with
// `npx playwright install chromium`) instead of a machine-specific
// executable path, so the suites run identically on any machine and in CI.
import { chromium } from "playwright";

function setupHint(err) {
  return [
    "",
    "Could not launch Playwright's managed Chromium.",
    "Install it with:",
    "",
    "  npx playwright install chromium",
    "",
    "Original error: " + String(err && err.message ? err.message.split("\n")[0] : err),
    "",
  ].join("\n");
}

export async function launchBrowser(options = {}) {
  try {
    return await chromium.launch({
      headless: true,
      // Full Chromium (not the headless shell) — matches how the real apps
      // run and keeps file:// behavior consistent for the portable build.
      channel: "chromium",
      args: ["--no-sandbox"],
      ...options,
    });
  } catch (err) {
    console.error(setupHint(err));
    throw err;
  }
}

// Same contract for the one suite that needs a persistent profile.
export async function launchPersistent(dataDir, options = {}) {
  try {
    return await chromium.launchPersistentContext(dataDir, {
      headless: true,
      channel: "chromium",
      args: ["--no-sandbox"],
      ...options,
    });
  } catch (err) {
    console.error(setupHint(err));
    throw err;
  }
}
