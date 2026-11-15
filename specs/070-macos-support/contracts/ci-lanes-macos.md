# Contract: macOS CI Lanes

## Runner list (FR-037)

`.github/macos-runners.json` → `{ "current": "<label>", "previous": "<label>" }`. A `macos-runners` job in each workflow
reads it and outputs `labels` (a JSON array). `packages/ui/tests/unit/macos-runners.test.ts` fails if any workflow names a
macOS runner label other than through that output.

## Pull-request CI (`ci.yml`, FR-036)

| Job | Matrix | Steps |
|---|---|---|
| `macos-fast` | both labels | `npm ci`, install-electron, `test:unit`, `test:component` |
| `macos-test` | both labels | `npm run build`, `test:integration`, `test:contract` |
| `macos-e2e` | both labels | `scripts/ci-macos-setup.sh`, `npm run build`, `npx playwright test --grep '@core\|@macos'`, upload `test-results/` |

Same `if: github.event.pull_request.draft != true` and concurrency as the other jobs. Windows and Linux jobs are unchanged.

## Gate (`gate.yml`)

| Job | Matrix | Steps |
|---|---|---|
| `gate-macos` | both labels | `scripts/ci-macos-setup.sh`, `npm run gate` (every stage; E2E `@core|@macos`, as the Linux gate runs `@core|@linux`), then the latency step |
| latency step | — | `THRONG_MEASURE_BUSY=10 THRONG_MEASURE_ASSERT_P95_MS=100 npx playwright test -c packages/ui/tests/measure/playwright.measure.config.ts`; prints `MEASURE {…}` always, fails above 100 ms |

`report-failure` needs `gate-macos`.

## Release (`release.yml`)

| Job | Runner | Steps |
|---|---|---|
| `build-macos` | `current` | `npm run package -- --publish never`, `reconcile --platform darwin`, role guard `"dmg macarchive"`, build the older fixture, upload |
| `verify-macos` | matrix: both labels × roles | `verify-macos-package.mjs` per role, upload verdicts |
| `render-body`, `publish` | existing | need `build-macos` and `verify-macos`; verdict files include macOS |

## Clean-up

`gate.mjs`, `clear-dev-state.mjs`, the Playwright global setup and `helpers/processes.ts` list processes on darwin with
two BSD `ps` calls joined on pid (`-axo pid=,ppid=,comm=` and `-axo pid=,args= -ww`, because macOS `comm` is a full
path that can hold spaces) and kill trees deepest first, as on Linux (FR-047).

## Tags

`@macos` is a platform category tag like `@linux`: specs carrying it start with
`test.skip(process.platform !== 'darwin', …)`, and `e2e-budget.json` has its count.
