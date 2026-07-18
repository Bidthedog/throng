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
 * Where these actually execute: a **developer's non-elevated run**. NOT in CI — GitHub's
 * Windows runners run as administrator, so every `skipIfElevated()` spec self-skips there
 * (019 FR-013a). This docblock used to claim the opposite ("CI runs non-elevated so these
 * still execute there"), which is why the gap went unnoticed for so long. Treat a green CI
 * as saying nothing about these specs. Call at the top of the test body.
 */
export function skipIfElevated(): void {
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
