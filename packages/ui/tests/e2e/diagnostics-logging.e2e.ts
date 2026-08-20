/**
 * #123 — an installed throng leaves a durable, reachable record of itself.
 *
 * A developer runs throng from a terminal and watches it. An installed one is launched from a
 * shortcut with no console at all, so its diagnostics went nowhere and its crashes left nothing
 * behind — not even in the machine's event log, because Electron's own crash handling suppresses
 * that. This drives the real application and proves the record now exists, in the per-user data
 * directory, before anyone has to ask the user for it.
 *
 * ══ ONE APP FOR TWO OF THE THREE (034 FR-045) ══
 *
 * Every `runApp()` is an Electron launch and a daemon — around two seconds apiece. Two of the tests
 * here only READ what the running app already wrote into the user-data directory it was given, and
 * that directory is WRITE ISOLATION, not pre-launch state: nothing is seeded before the app starts,
 * so they share one app.
 *
 * The daemon test is the exception and keeps its own, because `skipDaemon: true` is a claim ABOUT
 * THE STARTUP PATH — the app must spawn its own daemon through `ensureDaemon`, which is the only
 * path that tells the daemon where to write. A pre-spawned daemon was never told, so sharing would
 * not merely be slower to fail, it would prove nothing.
 *
 * Serial mode is required: shared window, shared log file, and `openedPaths` is a per-app recorder
 * that accumulates across the tests that share it (which is why the last test reads its TAIL rather
 * than demanding the whole array).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  openApp,
  runApp as runOwnApp,
  FILE_OP_TIMEOUT_MS,
  type AppOptions,
  type OpenApp,
} from './harness.js';

/** The harness gives every run its own `--user-data-dir`; logs live beside the rest of that state. */
const logsIn = (userData: string): string => join(userData, 'logs');

test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
test.beforeAll(async () => {
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
});

/**
 * Run a body against the shared window. It REFUSES options rather than ignoring them: a dropped
 * `skipDaemon` would not fail, it would pass for the wrong reason.
 */
const runApp = (
  fn: (
    app: OpenApp['app'],
    win: OpenApp['win'],
    ctx: { pipeName: string; userDataDir: string },
  ) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win, {
    pipeName: shared.pipeName,
    userDataDir: shared.userDataDir,
  });
};

/*
 * ── ONE REMOVED (035 T056) ──
 *
 * `:123` "a user can reach the logs folder without knowing its path" — three claims, and two
 * already had homes:
 *
 *   the cog menu OFFERS it, with that test id and that icon
 *     → `unit/menu-sections.test.ts:562` (the whole cog menu, in order) and
 *       `unit/menu-icon-tokens.test.ts:221`
 *   the folder it names is THIS run's log directory, and the OS is really asked to open it
 *     → `contract/open-logs.contract.test.ts`
 *
 * The handler was four lines inside an `ipcMain.handle`, so the only thing that could observe it
 * was an app. It is now `main/open-logs.ts`, taking its two collaborators as parameters (035
 * FR-006) — which is also what makes the FAILURE path reachable: `shell.openPath` cannot be made to
 * fail on demand from outside the process, so the migrated test asserted only the success half.
 *
 * The inverted-signal case is the one worth having. `shell.openPath` resolves to an EMPTY STRING on
 * success and to a message on failure, and reading that the wrong way round is silent in both
 * directions: every open reports failure while working, or every failure reports success and leaves
 * the user hunting for a window that was never opened.
 *
 * ── WHAT STAYS ──
 *
 * Both remaining tests, `@reserve:runtime`: they assert that a real main process and a real daemon
 * each write a durable log into the per-user data directory of a real run. That is application
 * identity on disk, and there is nothing below this layer that has one.
 */
test('the main process writes a durable log into the per-user data directory', { tag: ['@extended', '@failure', '@reserve:runtime'] }, async () => {
  await runApp(async (_app, win, ctx) => {
    await expect(win.getByTestId('title-bar-cog')).toBeVisible({ timeout: 15000 });

    const dir = logsIn(ctx.userDataDir);
    await expect.poll(() => existsSync(join(dir, 'main.log')), { timeout: FILE_OP_TIMEOUT_MS }).toBe(true);

    const text = readFileSync(join(dir, 'main.log'), 'utf8');
    // The startup record: what a "it won't start" report needs to begin with.
    expect(text).toContain('[ui-main]');
    expect(text).toMatch(/throng starting — pid \d+/);
    // Levels are carried, so a reader can tell a failure from a narration.
    expect(text).toMatch(/\b(INFO|WARN|ERROR)\b/);
    // One record per line — a log that can be tailed and pasted into an issue.
    const lines = text.trimEnd().split('\n');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z \w+\s+\[[^\]]+\]/);

    // Nothing is written under the install root (spec 020 FR-008) — the logs are in the per-user
    // directory this run was given, and that is the ONLY place they are.
    expect(dir.startsWith(ctx.userDataDir)).toBe(true);
  });
});

test('the daemon writes its own durable log beside the UI’s', { tag: ['@extended', '@failure', '@reserve:runtime'] }, async () => {
  // `skipDaemon` so the APP spawns its own daemon through `ensureDaemon` — which is the path that
  // gives it a log directory at all. A daemon the harness pre-spawned was never told where to write.
  // This is the one test in the file that seeds the LAUNCH, so it keeps its own app.
  await runOwnApp(async (_app, win, ctx) => {
    await expect(win.getByTestId('title-bar-cog')).toBeVisible({ timeout: 15000 });
    const dir = logsIn(ctx.userDataDir);

    // The daemon is spawned detached with no console; its diagnostics used to go to `stdio: 'ignore'`.
    await expect
      .poll(() => existsSync(join(dir, 'daemon.log')) || existsSync(join(dir, 'daemon-startup.log')), {
        timeout: FILE_OP_TIMEOUT_MS,
      })
      .toBe(true);

    // Whichever of the two exists, it must contain the daemon actually saying something — a file
    // that is merely present proves only that we created it.
    const contents = readdirSync(dir)
      .filter((f) => f.startsWith('daemon'))
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n');
    expect(contents).toMatch(/throng-daemon|\[daemon\]/);
  }, { skipDaemon: true });
});

