/**
 * #123 — an installed throng leaves a durable, reachable record of itself.
 *
 * A developer runs throng from a terminal and watches it. An installed one is launched from a
 * shortcut with no console at all, so its diagnostics went nowhere and its crashes left nothing
 * behind — not even in the machine's event log, because Electron's own crash handling suppresses
 * that. This drives the real application and proves the record now exists, in the per-user data
 * directory, before anyone has to ask the user for it.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, openedPaths } from './harness.js';

/** The harness gives every run its own `--user-data-dir`; logs live beside the rest of that state. */
const logsIn = (userData: string): string => join(userData, 'logs');

test('the main process writes a durable log into the per-user data directory', async () => {
  await runApp(async (_app, win, ctx) => {
    await expect(win.getByTestId('title-bar-cog')).toBeVisible({ timeout: 15000 });

    const dir = logsIn(ctx.userDataDir);
    await expect.poll(() => existsSync(join(dir, 'main.log')), { timeout: 10000 }).toBe(true);

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

test('the daemon writes its own durable log beside the UI’s', async () => {
  // `skipDaemon` so the APP spawns its own daemon through `ensureDaemon` — which is the path that
  // gives it a log directory at all. A daemon the harness pre-spawned was never told where to write.
  await runApp(async (_app, win, ctx) => {
    await expect(win.getByTestId('title-bar-cog')).toBeVisible({ timeout: 15000 });
    const dir = logsIn(ctx.userDataDir);

    // The daemon is spawned detached with no console; its diagnostics used to go to `stdio: 'ignore'`.
    await expect
      .poll(() => existsSync(join(dir, 'daemon.log')) || existsSync(join(dir, 'daemon-startup.log')), {
        timeout: 15000,
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

test('a user can reach the logs folder without knowing its path', async () => {
  await runApp(async (app, win, ctx) => {
    await win.getByTestId('title-bar-cog').click();
    // The affordance is discoverable where About is — both are things you go looking for when
    // reporting a problem.
    await expect(win.getByTestId('cog-menu-logs')).toBeVisible();

    /*
     * It resolves to the run's own logs directory, and it really does ask the OS to open it.
     *
     * The comment here used to claim "the OS file manager is not opened during the test". That was
     * simply untrue: this drives the same handler the menu item does, and the handler calls
     * `shell.openPath` — so every run left a real Explorer window on the developer's desktop. Worse
     * than untidy: a window appearing steals focus, and throng closes menus on blur by design, so a
     * stray Explorer window can fail an unrelated test that had a menu open.
     *
     * `runApp` now stubs `shell.openPath` for every app and records what was asked for, so the
     * request is asserted — which is the actual claim — without launching anything.
     */
    const result = await win.evaluate(() => window.throng?.diagnostics?.openLogs?.());
    expect(result?.ok).toBe(true);
    expect((result as { path: string }).path).toBe(logsIn(ctx.userDataDir));
    expect(
      await openedPaths(app),
      'the handler should have asked the OS to open the logs directory',
    ).toEqual([logsIn(ctx.userDataDir)]);
  });
});
