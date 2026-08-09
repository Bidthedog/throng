import { readFileSync } from 'node:fs';
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
 * SHARDING (issue #75, part 2). CI splits the suite across N parallel single-worker jobs, each on
 * its own fresh runner (`--shard=i/N`), and a downstream job MERGES their reports into one — see
 * .github/workflows/ci.yml. A shard must emit a `blob` report (the only mergeable format) instead
 * of the human `list`, so `THRONG_E2E_SHARDS` (the shard total, set by the CI matrix) switches the
 * reporter over. `list` is kept alongside blob so each shard's own log still streams live; the
 * admin-reminder reporter — a developer nicety — is dropped in this mode, since it has nothing to
 * add to a machine-merged report. Sharding changes only HOW the suite is distributed and reported;
 * every gate above (grepInvert, failOnFlakyTests, retries, single-worker) is untouched.
 */
const sharded = Number(process.env.THRONG_E2E_SHARDS) > 0;

/*
 * BALANCED SHARDS. `--shard=i/N` splits by test COUNT in file order, which on this suite means the
 * alphabet decides the split — and every `terminal-*` spec sorts into the same third. Measured, that
 * gave shards of 3.7, 8.3 and 36 minutes, the last of which exceeded a 30-minute job cap and was
 * killed mid-run.
 *
 * `THRONG_E2E_GROUP` selects a group from `shard-plan.json` instead, whose lists are built from
 * MEASURED per-file durations. Nothing else changes: each group still emits a blob report and merges
 * exactly as a shard did.
 *
 * A spec file missing from the plan would silently never run, which is the one failure mode worth
 * more than the balance — so `shard-plan.test.ts` fails if any spec is absent or listed twice.
 */
const shardGroup = process.env.THRONG_E2E_GROUP;
const plannedIgnores = ((): RegExp[] => {
  if (!shardGroup) return [];
  const plan = JSON.parse(
    readFileSync(new URL('./packages/ui/tests/e2e/shard-plan.json', import.meta.url), 'utf8'),
  ) as { groups: Record<string, string[]> };
  const mine = new Set(plan.groups[shardGroup] ?? []);
  if (mine.size === 0) throw new Error(`THRONG_E2E_GROUP=${shardGroup} is not in shard-plan.json`);
  const others = Object.entries(plan.groups)
    .filter(([g]) => g !== shardGroup)
    .flatMap(([, files]) => files)
    .filter((f) => !mine.has(f));
  /*
   * Anchored to a path separator, which is not fussiness: `terminal.e2e.ts$` alone also matches
   * `subworkspace-owned-terminal.e2e.ts`, so listing one file quietly excluded the other from EVERY
   * group and 18 tests stopped running. Caught by counting `--list` per group and finding the totals
   * did not add up to the whole suite.
   */
  return others.map((f) => new RegExp(`[\\/]${f.replace(/\./g, '[.]')}$`));
})();

/*
 * `THRONG_E2E_TIER` splits the suite by whether a spec can tolerate ANOTHER headed window.
 *
 * Focus contention is per-DESKTOP, not per-machine: throng deliberately closes menus and popups when
 * its window loses focus (context-menu.tsx), and the preferences window is a child window that takes
 * focus. So workers are the lever WITHIN a machine and shards are the lever ACROSS machines, and the
 * two compose — this filter is applied on top of `plannedIgnores`, not instead of it.
 *
 * The membership in `parallel-plan.json` is MEASURED, not guessed: the whole suite was run at six
 * workers three times with retries off, and the serial tier is every spec that opens the preferences
 * window (the contention mechanism) plus every spec observed failing. A boundary drawn only from
 * observed failures would encode luck, since contention produces a different failure set each run.
 *
 * Measured: 208 specs, 37 serial, 171 parallel. The full suite at six workers ran in ~8-11 minutes
 * against ~35 minutes at one worker.
 */
const tier = process.env.THRONG_E2E_TIER;
const tierIgnores = ((): RegExp[] => {
  if (!tier) return [];
  if (tier !== 'parallel' && tier !== 'serial') {
    throw new Error(`THRONG_E2E_TIER must be 'parallel' or 'serial', got '${tier}'`);
  }
  const plan = JSON.parse(
    readFileSync(new URL('./packages/ui/tests/e2e/parallel-plan.json', import.meta.url), 'utf8'),
  ) as { serial: string[] };
  const serial = new Set(plan.serial);
  const shardPlan = JSON.parse(
    readFileSync(new URL('./packages/ui/tests/e2e/shard-plan.json', import.meta.url), 'utf8'),
  ) as { groups: Record<string, string[]> };
  const every = Object.values(shardPlan.groups).flat();
  // Ignore the OTHER tier's files. Same path-separator anchoring as above, and for the same reason:
  // an unanchored `terminal.e2e.ts$` also matches `subworkspace-owned-terminal.e2e.ts`.
  const exclude = every.filter((f) => (tier === 'serial' ? !serial.has(f) : serial.has(f)));
  return exclude.map((f) => new RegExp(`[\\/]${f.replace(/\./g, '[.]')}$`));
})();

export default defineConfig({
  testDir: 'packages/ui/tests/e2e',
  testMatch: '**/*.e2e.ts',
  // Empty unless THRONG_E2E_GROUP / THRONG_E2E_TIER are set, so an ordinary run is untouched.
  testIgnore: [...plannedIgnores, ...tierIgnores],
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
   * The blob's FILENAME must be unique per shard, and Playwright will not do it for us here.
   *
   * `_defaultReportName()` appends a shard suffix ONLY when `config.shard` is set — which happens
   * only under Playwright's own `--shard`, and this repo deliberately does not use it (see the
   * THRONG_E2E_GROUP note above). So every shard job wrote `blob-report/report.zip`, all three
   * artifacts were downloaded into ONE directory with `merge-multiple: true`, and they overwrote
   * each other; the merge then read a half-written file and the merged report job failed:
   *
   *     Error: not enough bytes in the stream. expected 4019954. got only 3740141
   *
   * Two attempts over the same artifacts gave DIFFERENT byte counts (3531821, then 3740141), which
   * is how a write race is told apart from one corrupt upload — a bad upload gives the same number
   * twice. Issue #216.
   */
  reporter: sharded
    ? [
        ['blob', { fileName: process.env.THRONG_E2E_BLOB_OUT ?? 'report.zip' }],
        ['list'],
        ['json', { outputFile: process.env.THRONG_E2E_JSON_OUT ?? 'shard-report.json' }],
      ]
    : [['list'], ['./packages/ui/tests/e2e/admin-reminder.reporter.ts']],
  // 30s per test (issue #75). 60s was too generous: when a test genuinely wedges (a window that
  // never opens, a renderer that never settles), the old budget let it sit for a full minute
  // before failing AND — because Playwright applies the test timeout to worker teardown too — gave
  // a hung app a second 60s to blow the *worker-teardown* budget, which surfaces as "1 error was
  // not a part of any test" (no retry absorbs it). 30s still clears the slowest legitimate journey
  // (the multi-window theme/detach specs land ~5-9s) with headroom, and halves how long a real
  // wedge can stall the suite. The harness force-kills a wedged app well inside this now
  // (shutdownApp, packages/ui/tests/e2e/harness.ts), so teardown never rides the budget out.
  timeout: 30_000,
  expect: { timeout: 10_000 },
});
