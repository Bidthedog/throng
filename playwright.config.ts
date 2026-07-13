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

export default defineConfig({
  testDir: 'packages/ui/tests/e2e',
  testMatch: '**/*.e2e.ts',
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
  reporter: [['list'], ['./packages/ui/tests/e2e/admin-reminder.reporter.ts']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
});
