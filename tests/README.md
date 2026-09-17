# Tests

Two layers, both run by `npm test` and by CI (`.github/workflows/qa.yml`):

| Layer | Command | Runs where | What |
| --- | --- | --- | --- |
| Unit | `npm run test:unit` | Node only, seconds | `tests/unit/*.test.mjs` under `node --test` |
| Browser | `npm run test:e2e` | Playwright Chromium | `tools/e2e-*.mjs`, one suite per feature or flow |

`tools/test-*.mjs` are the older Node checks (static policy, backup format,
blob integrity, LI number) and stay as they are.

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

The browser side of the same seam is `tools/e2e-migrate.mjs` (the first-launch
dialog on a seeded profile, and a forced verification failure).

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
