/**
 * Helper for E2E that require ELEVATED (administrator) privileges — the run-as-admin
 * / de-elevation path (FR-025c). Such tests only exercise real behaviour when the
 * TEST PROCESS is itself elevated (so the daemon it spawns is elevated); at medium
 * integrity there is nothing to elevate/de-elevate. Rather than assert a hollow
 * baseline, these tests are **tagged `@admin` and SKIPPED when not elevated**. The
 * `admin-reminder` reporter then reminds, after every E2E run, that the admin path
 * needs an elevated run (`npm run test:e2e:admin`). NOT a `.e2e.ts` file → not
 * collected as a test.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';
import { test } from '@playwright/test';

let cached: boolean | undefined;

/**
 * Whether the current (test) process runs elevated. `net session` succeeds only for
 * an administrator (it needs the Server service admin right) and fails with
 * "Access is denied" otherwise — the check the user specified. Absolute path so a
 * Unix `net` on PATH (Git Bash) can't shadow it. Cached for the process lifetime.
 */
export function isElevated(): boolean {
  if (cached !== undefined) return cached;
  if (process.platform !== 'win32') {
    cached = false;
    return cached;
  }
  const net = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'net.exe');
  try {
    execFileSync(net, ['session'], { stdio: 'ignore', windowsHide: true, timeout: 5000 });
    cached = true;
  } catch {
    cached = false;
  }
  return cached;
}

/**
 * The inverse of `@admin`: skip a test when the process IS elevated. Several
 * terminal specs assume the E2E daemon runs at **normal integrity** (the common
 * case): a non-elevated daemon runs each terminal directly, so its `conhost.exe`
 * host is the daemon's own child, the "run as admin" control is disabled, and a
 * re-typed panel gets a fresh direct PTY. When the test PROCESS is elevated the app
 * respawns an elevated daemon (FR-025b) that routes terminals through the
 * de-elevated agent (FR-025c) — a different process tree those assertions don't
 * hold for. Rather than fail spuriously on an elevated dev machine, skip; the
 * elevated path has its own `@admin` coverage.
 *
 * Where these execute: a developer's non-elevated run, and NOT CI. GitHub's Windows runners are
 * elevated and cannot be made otherwise — dropping admin rights on a hosted runner was attempted and
 * measured impossible (UAC is disabled there, so `schtasks /RL LIMITED` has no filtered token to
 * fall back to; run 30947653266). So a guarded test does not run on CI, and never will.
 *
 * What changed is the SIZE of that hole, not its existence. The guard used to sit at module scope on
 * ~85 files, skipping 208 of 634 tests — including almost the whole `editor-*` cluster, none of which
 * touches the process tree this guard is about. An audit run with
 * `THRONG_E2E_IGNORE_ELEVATION_GUARD=1` (below) established that 71 of those files pass perfectly
 * well elevated. It is now 22 files and 25 tests, each one genuinely about conhost reaping, command
 * observation, cwd reading, run-as-admin or reattach.
 *
 * The history is worth keeping, because this docblock has been wrong twice in opposite directions:
 * it once claimed CI ran non-elevated (it did not), and later claimed the shard job re-entered at
 * normal integrity through a scheduled task (it never did — that was proposed, measured, and
 * abandoned, while this comment kept asserting it). Treat a green E2E stage as saying nothing about
 * the 25 tests below.
 *
 * **Call it INSIDE the test body, never at module scope** — at module scope it skips every test in
 * the file, which is exactly how the hole got to be a third of the suite.
 */
/**
 * Audit hatch: run the guarded specs ANYWAY, to find out which ones the guard is actually for.
 *
 * The guard was applied far more widely than its reason justifies — 38 of 41 `editor-*` files carry
 * it, several of which contain no reference to a terminal at all and so cannot depend on the process
 * tree it describes. The only environment that can settle which specs genuinely need it is an
 * elevated one, and CI is elevated, so this exists to let CI answer the question once.
 *
 * Not a way to make a red suite green: it makes MORE tests run, never fewer.
 */
const IGNORE_ELEVATION_GUARD = process.env.THRONG_E2E_IGNORE_ELEVATION_GUARD === '1';

export function skipIfElevated(): void {
  if (IGNORE_ELEVATION_GUARD) return;
  test.skip(isElevated(), 'assumes a non-elevated (normal-integrity) daemon; the elevated / de-elevation path is covered by @admin tests');
}

/** Running on a headless CI runner (GitHub Actions). No interactive desktop. */
function isHeadlessCi(): boolean {
  return process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
}

/**
 * Skip an `@admin` test that needs REAL de-elevation — a terminal launched without run-as-admin
 * coming up at MEDIUM integrity (FR-024/FR-025c). Dropping integrity from an elevated process
 * requires an interactive elevated desktop's shell token; GitHub's Windows runners are elevated
 * but HEADLESS, so de-elevation there falls back to running elevated and the "must run as User"
 * assertion cannot hold. That is an environment limit, not a product defect — the behaviour is
 * verified locally via `npm run test:e2e:admin` on a real elevated desktop.
 *
 * The no-hang property #94 turns on (`terminal-de-elevation-hang.e2e.ts`) does NOT need this: it
 * accepts a prompt OR a visible error, both reachable on a headless runner, so it stays in the CI
 * `@admin` gate (019 FR-013a / SC-008) and keeps `executed >= 1` there. Call after `runApp` opens
 * the window, once we know the process is elevated.
 */
export function skipWithoutInteractiveDesktop(): void {
  test.skip(
    isHeadlessCi(),
    'de-elevation drops integrity only with an interactive elevated desktop; CI runners are headless — run locally via `npm run test:e2e:admin`',
  );
}

/**
 * Declare an E2E that requires elevation. It is tagged `@admin` (so it can be
 * grep-selected and is counted by the reminder reporter) and SKIPPED at runtime
 * unless the process is elevated. Use exactly like `test(...)` but with a
 * zero-arg body (admin tests drive the app via `runApp`, not Playwright fixtures).
 */
export function adminTest(title: string, body: () => Promise<void>): void {
  test(title, { tag: '@admin' }, async () => {
    test.skip(!isElevated(), 'requires elevated privileges — run `npm run test:e2e:admin`');
    await body();
  });
}
