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
  grepInvert: process.env.THRONG_E2E_INCLUDE_ADMIN ? undefined : /@admin/,
  fullyParallel: false,
  workers,
  // Retry to absorb load-transient E2E flakiness at high worker counts — a slow
  // Electron close that briefly EPERM-locks its userData dir, a 15s render just
  // exceeded under contention, a ConPTY repaint stressed by many parallel terminals.
  // A real failure still fails all attempts; a genuinely flaky one is surfaced as
  // "flaky" in the report. Set THRONG_E2E_RETRIES=0 to see raw first-run results.
  retries: process.env.THRONG_E2E_RETRIES !== undefined ? Number(process.env.THRONG_E2E_RETRIES) : 2,
  // `list` for normal output + a reporter that reminds, after every run, that the
  // @admin (run-as-admin / de-elevation) tests only verify when run elevated.
  reporter: [['list'], ['./packages/ui/tests/e2e/admin-reminder.reporter.ts']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
});
