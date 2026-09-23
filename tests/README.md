# Tests

Two layers, both run by `npm test`. CI (`.github/workflows/qa.yml`) runs the
fast layer on every push and the browser layer on pull requests:

| Layer | Command | Runs where | What |
| --- | --- | --- | --- |
| Fast | `npm run test:fast` | Node only, seconds | the `tools/test-*.mjs` checks, the generated-file checks and the unit tests |
| Unit | `npm run test:unit` | Node only, seconds | `tests/unit/*.test.mjs` under `node --test` |
| Browser | `npm run test:e2e` | Playwright Chromium | `tools/e2e-*.mjs`, one suite per feature or flow, all against the one page (a feature's elements are reached through its panel: `page.locator("#view-li").locator(…)`) |

A behaviour that a unit test pins exactly is not also a browser suite: the
Mercedes-prefix VIN validation lives in the VIN golden (`vin.test.mjs`), and
the browser suites keep what needs a page — the scan pipeline, the UI, storage.

`tools/test-*.mjs` are the older Node checks (static policy, backup format,
blob integrity, LI number) and stay as they are. The static policy also refuses
any source file over 300 KB outside `vendor/`, so a library can never be inlined
into a page again; `node tools/vendor-pdfjs.mjs --check` verifies the vendored
runtimes themselves, `node tools/build-viewer.mjs --check` that `viewer.js`
(the standalone extractor's classic bundle) matches `src/features/extract/`, and
`node tools/sw-manifest.mjs --check` that the service worker's precache lists
name every file under `src/` — with everything `src/main.js` imports statically
in the required core — so nothing can load online and be missing offline.

## Data layer checks

`src/data/` (REWRITE-PLAN.md Phase 2) is tested in Node against
[fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB); the harness in
`tests/unit/harness/data.mjs` loads the classic scripts onto `globalThis` and
`fresh()` gives every test its own IndexedDB world.

| Check | Covers |
| --- | --- |
| `hash.test.mjs` | `src/core/hash.js` against WebCrypto: known vectors, block boundaries, chunked updates, the streaming path |
| `fdb-format.test.mjs` | the `.fdb` container: round trip and every malformed-file code |
| `data-db.test.mjs` | schema creation, the transaction commit boundary, probing without creating |
| `data-repos.test.mjs` | rev / `expectedRev`, files with blobs and thumbs, documents owning their PDF, unique RO numbers, links, settings, bus events |
| `data-jobs.test.mjs` | run to done, retry and fail, cancel, stale requeue, coalesced kicks |
| `data-intake.test.mjs` | routing, per-target records and jobs, RO links, unreadable files |
| `data-backup.test.mjs` | `.fdb` collect → restore into a new generation, failed verification, a tampered blob |
| `data-migrate.test.mjs` | the four legacy databases → one generation: counts, hashes, shapes, D7 duplicates, a failed verification, `boot()` |
| `data-phase5.test.mjs` | the unified model in use (Phase 5): trash and reference-checked purge, shared bytes (`blobId`) that outlive either record, duplicate review in the intake, one file on two ROs and a renumber that touches no file, the RO delete modes and RO purge, pinned LI versions and tools with the newer-version check, vehicles (check digit, confirmation, `summary`), a backup round trip with ROs/links/vehicles/trash/shared bytes, a pre-Phase-5 backup, the schema v1 → v2 upgrade in place |
| `feature-search.test.mjs` | each feature's quick-open `search` export against the shared database (trash and hidden records left out) |

The browser side of the same seam is `tools/e2e-migrate.mjs` (the first-launch
dialog on a seeded profile, and a forced verification failure), and
`tools/e2e-phase5.mjs` for the Phase 5 flows (trash, duplicates, RO links and
pins, the vehicle view, quick-open, one backup restored).

## Golden checks

The rewrite (`REWRITE-PLAN.md`) moves the parsers out of the single-file apps
without changing what they produce. The proof is a **golden**: the recorded
output of each parser for a fixed set of inputs, captured from the code at one
commit and compared on every run.

| Parser | Inputs | Golden | Check |
| --- | --- | --- | --- |
| LI text extraction (`src/core/li-parse.js`) | `tests/fixtures/inputs/li-text.mjs` | `tests/fixtures/golden/li-parse.json` | `tests/unit/li-parse.test.mjs` |
| VIN / FIN classifier (`src/core/vin.js`) | `tests/fixtures/inputs/vin-text.mjs` | `tests/fixtures/golden/vin.json` | `tests/unit/vin.test.mjs` |
| RO scan parser (`src/core/ro-parse.js`) | `tests/fixtures/inputs/ro-scan.mjs` | `tests/fixtures/golden/ro-scan.json` | `tests/unit/ro-parse.test.mjs` |

Rules:

- **A golden check failing means behaviour changed.** If the change is
  intended, regenerate with `npm run golden:capture` (or `node
  tools/capture-golden.mjs li`) and commit the JSON with the change, so the
  diff shows exactly which outputs moved. Never edit a golden by hand.
- **Adding a case** means adding an input and re-capturing. The check reports
  inputs that have no golden yet.
- The harnesses in `tests/unit/harness/` import the `src/core/` modules
  directly (they are classic scripts that attach to `globalThis.FDCore`, so a
  side-effect import is enough). `lift.mjs` remains for the checks that still
  reach into app source (version grouping, the diff) and goes away as those move.

Baseline: goldens were first captured at `df6a8a3` (tag `v1-pre-rewrite`),
the head of `claude/pwa-file-database-hqbppy` when the rewrite started.
