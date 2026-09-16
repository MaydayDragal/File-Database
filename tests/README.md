# Tests

Two layers, both run by `npm test` and by CI (`.github/workflows/qa.yml`):

| Layer | Command | Runs where | What |
| --- | --- | --- | --- |
| Unit | `npm run test:unit` | Node only, seconds | `tests/unit/*.test.mjs` under `node --test` |
| Browser | `npm run test:e2e` | Playwright Chromium | `tools/e2e-*.mjs`, one suite per feature or flow |

`tools/test-*.mjs` are the older Node checks (static policy, backup format,
blob integrity, LI number) and stay as they are.

## Golden checks

The rewrite (`REWRITE-PLAN.md`) moves the parsers out of the single-file apps
without changing what they produce. The proof is a **golden**: the recorded
output of each parser for a fixed set of inputs, captured from the code at one
commit and compared on every run.

| Parser | Inputs | Golden | Check |
| --- | --- | --- | --- |
| LI text extraction (`li/index.html`) | `tests/fixtures/inputs/li-text.mjs` | `tests/fixtures/golden/li-parse.json` | `tests/unit/li-parse.test.mjs` |
| VIN / FIN classifier (`vault/app.js`) | `tests/fixtures/inputs/vin-text.mjs` | `tests/fixtures/golden/vin.json` | `tests/unit/vin.test.mjs` |
| RO scan parser (`ros/index.html`) | `tests/fixtures/inputs/ro-scan.mjs` | `tests/fixtures/golden/ro-scan.json` | `tools/test-golden-ro.mjs` (browser, via `window.__ros`) |

Rules:

- **A golden check failing means behaviour changed.** If the change is
  intended, regenerate with `npm run golden:capture` (or `node
  tools/capture-golden.mjs li`) and commit the JSON with the change, so the
  diff shows exactly which outputs moved. Never edit a golden by hand.
- **Adding a case** means adding an input and re-capturing. The check reports
  inputs that have no golden yet.
- Until Phase 1 extracts the parsers into `src/core/`, the harnesses in
  `tests/unit/harness/` reach them by lifting a marked region out of the app
  source (`lift.mjs`) or through a page's test hook (`ro.mjs`). Phase 1 swaps
  those for plain imports; the goldens do not change.

Baseline: goldens were first captured at `df6a8a3` (tag `v1-pre-rewrite`),
the head of `claude/pwa-file-database-hqbppy` when the rewrite started.
