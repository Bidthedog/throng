import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { defineConfig } from '@playwright/test';

// `net session` succeeds only for an administrator; used to cap parallelism below.
function runnerElevated(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    execFileSync('C:\\Windows\\System32\\net.exe', ['session'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

// Default 6 workers (the benchmarked knee, see docs/testing.md), overridable via
// THRONG_E2E_WORKERS. BUT cap to 2 on an elevated runner (unless explicitly
// overridden): an elevated daemon routes terminals through the de-elevated agent
// (FR-025c), which — together with slower app/watcher teardown under contention —
// is not robust at high parallelism, so 6 elevated workers flake. CI / a normal
// shell (the common case) keeps the full count.
const requestedWorkers = Number(process.env.THRONG_E2E_WORKERS) || 6;
const workers =
  !process.env.THRONG_E2E_WORKERS && runnerElevated()
    ? Math.min(requestedWorkers, 2)
    : requestedWorkers;

// E2E layer: drives the real Electron app (see packages/ui/tests/e2e) and docs/testing.md.
// The Electron driver is launched inside the tests via `_electron.launch`. The app
// shows real on-screen windows — Electron has no usable headless mode here, because
// the inline xterm.js terminals only mount and drive their ConPTY in a genuinely
// visible, painting window (a hidden/off-screen/transparent one blanks them).
// Multi-window detach journeys (US4) open several BrowserWindows from one app
// instance, driven via `app.windows()` within a single worker; the timeout is
// generous enough for window creation and focus-group propagation.
//
// Parallelism: `fullyParallel: false` keeps the *file* as the unit of parallelism —
// every test in a file runs in ONE worker, in order — so tests that build on each
// other (kept in the same file, or a `test.describe.serial` block) stay on one
// worker even as workers scale. Each spec is otherwise fully isolated (own app,
// daemon, DB, pipe, temp), so files run safely in parallel. Widen with
// THRONG_E2E_WORKERS; back down to fewer for a calmer machine.
/*
 * Tag exclusions, one independent flag per concern (see grepInvert below).
 *
 * @admin      — environment guard: needs an elevated process; the dedicated elevated runner opts
 *               it back in via THRONG_E2E_INCLUDE_ADMIN. Coverage is ROUTED, not lost.
 * @quarantine — a test that could not be made deterministic. Coverage IS lost, so it stays
 *               enumerable: THRONG_E2E_INCLUDE_QUARANTINE=1 … --grep @quarantine --list
 */
const excludedTags: RegExp[] = [];
if (!process.env.THRONG_E2E_INCLUDE_ADMIN) excludedTags.push(/@admin/);
if (!process.env.THRONG_E2E_INCLUDE_QUARANTINE) excludedTags.push(/@quarantine/);

/*
 * SHARDING IS GONE (034 FR-057), and what it cost is worth recording so nobody reinstates it by
 * reflex.
 *
 * It existed because raising `THRONG_E2E_WORKERS` on one runner reintroduces the CPU and focus
 * contention that turns into red runs, so parallelism ACROSS machines was the only kind available.
 * Three single-worker jobs on separate 4-vCPU runners turned ~12 minutes into ~4-5 — at THREE TIMES
 * the runner-minutes, plus a fixed ~3-4 minute `npm ci` + build toll per shard before a single test
 * ran (#103).
 *
 * That trade paid on a 235-file suite gating every push. It does not pay on the two lanes that
 * replace it: the critical lane is ≤50 tests, where three shards would spend ~12 runner-minutes of
 * pure toll to save two or three minutes of wall-clock, and the full lane runs only at release,
 * where wall-clock is on nobody's critical path.
 *
 * Deleted with it: `shard-plan.json` (235 hand-maintained filenames), `THRONG_E2E_SHARDS`,
 * `THRONG_E2E_GROUP`, the blob reporter and `THRONG_E2E_BLOB_OUT`, the `merge-e2e` job, and
 * `blob-report-naming.test.ts` — the last four being the entire apparatus built for #216, which
 * only ever existed because three shards wrote one filename.
 *
 * If release wall-clock ever becomes a real complaint, Playwright's native `--shard` is adequate at
 * that point: the reason it was originally rejected — the alphabet sorting every `terminal-*` spec
 * into one third, giving 3.7 / 8.3 / 36-minute shards — is an artefact of a 235-file suite, not a
 * sixty-file one.
 */

/*
 * `THRONG_E2E_TIER` splits the suite by whether a spec can tolerate ANOTHER headed window.
 *
 * Focus contention is per-DESKTOP, not per-machine: throng deliberately closes menus and popups when
 * its window loses focus (context-menu.tsx), and the preferences window is a child window that takes
 * focus. So workers are the lever WITHIN a machine — which is the only lever left, now that the
 * across-machines one has been removed for costing more than it saved.
 *
 * The membership in `parallel-plan.json` is MEASURED, not guessed: the whole suite was run at six
 * workers three times with retries off, and the serial tier is every spec that opens the preferences
 * window (the contention mechanism) plus every spec observed failing. A boundary drawn only from
 * observed failures would encode luck, since contention produces a different failure set each run.
 *
 * Measured at 208 specs: 37 serial, 171 parallel. The full suite at six workers ran in ~8-11 minutes
 * against ~35 minutes at one worker. (Current membership is larger — see `parallel-plan.json` — and
 * is re-measured by 034 Story 1 rather than being trusted from this line.)
 *
 * TIERS SURVIVE THE DELETION OF SHARDS, and the distinction is the whole reason: a tier is about
 * contention WITHIN one machine, a shard was about splitting ACROSS machines. Only the second stopped
 * paying for itself.
 */
const tier = process.env.THRONG_E2E_TIER;
const tierIgnores = ((): RegExp[] => {
  if (!tier) return [];
  if (tier !== 'parallel' && tier !== 'serial') {
    throw new Error(`THRONG_E2E_TIER must be 'parallel' or 'serial', got '${tier}'`);
  }
  const plan = JSON.parse(
    readFileSync(new URL('./packages/ui/tests/e2e/parallel-plan.json', import.meta.url), 'utf8'),
    // `serial` maps filename -> the mechanism that put it there (034 FR-001). The tier filter wants
    // only the membership, so it reads the keys; the values exist for the reader, and live in the
    // same object precisely so the list and its reasons cannot drift apart.
  ) as { serial: Record<string, string> };
  const serial = new Set(Object.keys(plan.serial));
  /*
   * The universe of spec files comes from DISK.
   *
   * It used to come from `shard-plan.json` — a file whose purpose was distributing work across
   * machines, quietly doing second duty as the only enumeration of what exists. That coupling is why
   * deleting the shard plan had to be sequenced ahead of the migration rather than after it: a spec
   * absent from the plan was invisible to the tier filter too, so one hand-maintained list decided
   * two unrelated things.
   */
  const every = readdirSync(new URL('./packages/ui/tests/e2e/', import.meta.url)).filter((f) =>
    f.endsWith('.e2e.ts'),
  );
  // Ignore the OTHER tier's files. Anchored to a path separator, which is not fussiness:
  // an unanchored `terminal.e2e.ts$` also matches `subworkspace-owned-terminal.e2e.ts`, which once
  // removed 18 tests from every group at a stroke.
  const exclude = every.filter((f) => (tier === 'serial' ? !serial.has(f) : serial.has(f)));
  return exclude.map((f) => new RegExp(`[\\/]${f.replace(/\./g, '[.]')}$`));
})();

export default defineConfig({
  testDir: 'packages/ui/tests/e2e',
  testMatch: '**/*.e2e.ts',
  // Empty unless THRONG_E2E_TIER is set, so an ordinary run is untouched.
  testIgnore: tierIgnores,
  // Consolidate all E2E scratch under one %TEMP%/throng_e2e_<runhash>/ folder
  // (created here when run directly, or inherited from the top-level wrapper).
  globalSetup: './scripts/playwright-global-setup.mjs',
  globalTeardown: './scripts/playwright-global-teardown.mjs',
  // @admin (run-as-admin / de-elevation) specs belong to the dedicated elevated
  // runner (`npm run test:e2e:admin`, which sets THRONG_E2E_INCLUDE_ADMIN). Exclude
  // them from the normal suite so an elevated dev machine doesn't run them here —
  // they self-skip when unelevated anyway, and the elevated de-elevation path has
  // its own runner. See packages/ui/tests/e2e/admin.ts.
  /*
   * 017 (FR-013b/013c) — ONE FLAG PER CONCERN, composed as an array. Never a single ternary.
   *
   * The obvious implementation — folding @quarantine into the existing @admin ternary — silently
   * defeats itself: `scripts/test-e2e-admin.mjs` sets THRONG_E2E_INCLUDE_ADMIN=1, which would make
   * `grepInvert` undefined in the ELEVATED runner, so quarantined tests would run there and, with
   * the flake gate armed, redden it.
   *
   * @admin is an ENVIRONMENT GUARD: the behaviour cannot be verified unelevated, so it is routed to
   * a runner that can honour it. Coverage moves; it is not lost.
   *
   * @quarantine is an ADMISSION OF DEFEAT: the test is not trustworthy and nothing, anywhere, is
   * checking that behaviour. That coverage IS lost — which is why it must stay countable:
   *
   *   THRONG_E2E_INCLUDE_QUARANTINE=1 npx playwright test --grep @quarantine --list
   *
   * (A bare `--grep @quarantine` lists nothing: a CLI --grep does not clear a config grepInvert.)
   */
  grepInvert: excludedTags.length > 0 ? excludedTags : undefined,
  /*
   * 017 (FR-014) — A FLAKY TEST FAILS THE RUN.
   *
   * A test that fails and then passes on retry has not been fixed; it is flaky, and a flaky test is
   * a defect that launders itself into a green bar. Playwright reports such a test as "flaky" and
   * then exits 0 — which is precisely how #66 survived, and how a retries-disabled baseline came to
   * find TEN tests failing on their first attempt while the suite was reported green.
   *
   * A green run now means every test passed on its FIRST attempt.
   *
   * This lives in the CONFIG, not in the `test:e2e` npm script, deliberately: the suite has three
   * entry points — `npm run test:e2e` (and CI), `npm run test:e2e:admin` (which shells out to `npx
   * playwright test` directly), and a developer typing `npx playwright test <spec>`. A flag on the
   * script would cover only the first, leaving the elevated suite and every ad-hoc run still
   * absorbing flakes. FR-014a requires no environment in which a flake is tolerated, and only
   * config-level enforcement delivers that by construction.
   *
   * Accepted cost: a genuinely transient infrastructure fault now fails a run. The remedy is to fix
   * the test or quarantine it — never to relax the gate.
   */
  failOnFlakyTests: true,
  fullyParallel: false,
  workers,
  /*
   * 017 (FR-014) — retries are kept for their DIAGNOSTIC value, not their absolving value.
   *
   * A retry captures the first failure's assertion, diff and trace, which is genuinely useful. What
   * it must never do is convert a failure into a pass: `failOnFlakyTests` below means a test that
   * only passes on retry FAILS THE RUN. A green run therefore means every test passed on its FIRST
   * attempt.
   *
   * This is what the constitution (Principle V, v3.14.0) already required — "a test that fails and
   * then passes on re-run without a code change is flaky, not fixed… never absorbed into a green
   * bar by repetition" — and what, until now, nothing enforced. Set THRONG_E2E_RETRIES=0 to see raw
   * first-run results without the diagnostic retry.
   */
  retries: process.env.THRONG_E2E_RETRIES !== undefined ? Number(process.env.THRONG_E2E_RETRIES) : 2,
  // `list` for normal output + a reporter that reminds, after every run, that the
  // @admin (run-as-admin / de-elevation) tests only verify when run elevated.
  /*
   * Sharded (CI): blob (mergeable) + list (live log) + json (machine-classifiable). The json
   * report is what lets CI tell a GENUINE test flake/failure apart from a pure INFRA fault
   * (issue #75). `failOnFlakyTests` still reddens a run whose report shows `flaky > 0` or
   * `unexpected > 0`; but a non-zero exit with `flaky === 0 && unexpected === 0` is a worker /
   * global-teardown fault that no test owns and no retry absorbs — CI retries the shard once for
   * that case ONLY (see .github/workflows/ci.yml → "Run E2E shard"). The json report is the
   * evidence for that narrow, safe distinction; it can never turn a real test flake green.
   */
  /*
   * One job, one report. `THRONG_E2E_JSON_OUT` asks for the machine-readable one alongside the
   * human `list`, and CI sets it because `ci-e2e-run.ps1` classifies the outcome from it — a
   * non-zero exit with zero unexpected AND zero flaky is an infrastructure fault rather than a test
   * failure, which is a distinction only the report can make (Principle V).
   *
   * The `blob` reporter is gone with the shards (034 FR-057), and so is the apparatus around it.
   * Blob is the only MERGEABLE format, which is the sole reason it was ever used here, and there is
   * nothing left to merge. Worth remembering why it was fiddly: Playwright appends a shard suffix to
   * a blob's filename ONLY when `config.shard` is set, and this repo deliberately never set it — so
   * all three jobs wrote `blob-report/report.zip`, `merge-multiple: true` collapsed them onto each
   * other, and the merge read a half-written zip. Two attempts over the same artifacts gave
   * different byte counts (3531821, then 3740141), which is how a write race is told apart from one
   * corrupt upload: a bad upload gives the same number twice. Issue #216, and it cannot recur.
   */
  reporter: process.env.THRONG_E2E_JSON_OUT
    ? [['list'], ['json', { outputFile: process.env.THRONG_E2E_JSON_OUT }]]
    : [['list'], ['./packages/ui/tests/e2e/admin-reminder.reporter.ts']],
  /*
   * 60s per test (spec 034). This was 30s, and 30s had become an implicit PERFORMANCE assertion
   * rather than a hang detector — which is the thing FR-018 forbids everywhere else in this suite.
   *
   * MEASURED, on a full run at six workers (specs/034-e2e-harness-integrity/baseline.md):
   * ten tests failed and eight went flaky, and NINE OF THE TEN failures were this timeout. Not one
   * of them was a defect. The tell is in the population: of the real-shell specs in the parallel
   * tier, 0% of the starved ones raise their own `test.setTimeout`, against 36% of the healthy ones
   * — `terminal-launch-failure-config` takes 84.8s per test and passes, because it opted out of
   * this budget. Everything that died was relying on the default.
   *
   * The suite creates its own load, and it has grown: 214 spec files when 30s was chosen, 235 now.
   * The longest LEGITIMATE journeys observed under six-worker contention land ~38s, so 30s was not
   * a safety margin anybody was relying on — it was simply below the working range. Raising it to
   * 60s and changing nothing else took the sixteen affected files from 20 passed / 14 failed to
   * 37 passed / 1 failed, in LESS wall-clock (153s against 159s).
   *
   * WHY THIS DOES NOT REOPEN #75. The old comment here rejected 60s because Playwright applies the
   * test timeout to WORKER TEARDOWN as well, so a wedged app got a second full budget and blew the
   * teardown budget — surfacing as "1 error was not a part of any test", which no retry absorbs.
   * That reasoning is superseded, and the old comment already said why: the harness now bounds its
   * own teardown INDEPENDENTLY of this number. `shutdownApp` allows a 15s graceful window and the
   * `taskkill` behind it a further 10s, so teardown completes within ~25s whatever this is set to
   * (packages/ui/tests/e2e/harness.ts). The Constitution requires exactly that bound — "the harness
   * MUST bound its own teardown… so this fault is prevented at source, not merely retried" — so it
   * is the harness, not this budget, that protects the worker.
   *
   * What this still buys: a genuinely wedged test fails in 60s instead of hanging the suite. What
   * it deliberately does NOT do is assert how fast the product is. `performance.e2e.ts` owns that,
   * with explicit budgets that name the requirement they defend.
   */
  timeout: 60_000,
  /*
   * 15s per assertion (spec 034). This was 10s, and raising the test timeout above exposed it as
   * the NEXT budget down: with 60s tests, the remaining failures at six workers stopped being
   * 60-second timeouts and became 10-second ones — `projects.e2e.ts` failing at 10.0s and 10.1s,
   * which is this budget exactly, not the test's.
   *
   * That is the same mistake in a smaller box. A retrying assertion's timeout is how long the
   * condition is given to become true; on a machine running six Electron apps, six daemons and
   * their shells, 10s is inside the range a perfectly healthy condition takes. It is not a
   * statement about how fast throng is — `performance.e2e.ts` makes those, and names the
   * requirement each one defends.
   *
   * Kept well under the 60s test budget so a genuinely stuck assertion still fails as itself, with
   * its own locator and diff, rather than as an anonymous test timeout that says nothing.
   */
  expect: { timeout: 15_000 },
});
