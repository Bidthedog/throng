import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  APP_CLOSE_TIMEOUT_MS,
  TERMINAL_OUTPUT_TIMEOUT_MS,
  acceptConfirmations,
  cleanupTemp,
  createProject,
  firstPanelId,
  killAppSpawnedDaemon,
  runApp,
  runTypedCommand,
  splitPanelViaMenu,
  stopTracingBeforeExit,
} from './harness.js';
import { processTable } from './helpers/processes.js';

/**
 * Layer: E2E. A real zsh behind macOS's real PTY, a real detached daemon keeping it alive while the app is gone, and a
 * real process tree ending (070 US2 scenarios 1–4). Which shells are offered, the login environment and the process
 * table are proven at the contract layer on the macOS runners; this proves a terminal works through the app.
 * macOS's own lane: `@macos` runs on the hosted macOS runners and nowhere else.
 */
test.skip(process.platform !== 'darwin', 'macOS terminals');

/** A terminal panel's own view, `terminal-<panel uuid>` — not the flavour select or any other `terminal-…` id. */
const TERMINAL_VIEW = /^terminal-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function startZsh(win: Page, panelId: string): Promise<ReturnType<Page['getByTestId']>> {
  await win.getByTestId(`panel-type-select-${panelId}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption('zsh');
  const confirm = win.getByTestId(`panel-type-confirm-${panelId}`);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  const term = win.getByTestId(`terminal-${panelId}`);
  await expect(term).toBeVisible();
  return term;
}

test('a zsh terminal starts at the project root and keystrokes reach it', { tag: ['@macos', '@extended', '@terminal', '@reserve:input'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-zsh-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Zsh', root);
      const term = await startZsh(win, await firstPanelId(win));
      await runTypedCommand(win, term, 'pwd', { echoed: 'pwd', output: basename(root) });
      await runTypedCommand(win, term, 'echo $ZSH_VERSION LIVE_$((40+2))', { echoed: 'echo $ZSH_VERSION', output: 'LIVE_42' });
    });
  } finally {
    cleanupTemp(root);
  }
});

test('a long-running program survives a quit and relaunch, with its screen intact', { tag: ['@macos', '@extended', '@terminal', '@reserve:process'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-survive-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-survive-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-survive-ud-'));
  const configRoot = mkdtempSync(join(tmpdir(), 'throng-survive-cfg-'));
  const pipe = `\\\\.\\pipe\\throng-e2e-survive-${process.pid}-${Date.now()}`;
  const marker = `SURVIVE_${process.pid % 1000}`;
  // The app spawns its own detached daemon on this pipe, so the daemon (and the terminal) outlive the first launch.
  const opts = { skipDaemon: true, dataDir, userDataDir, env: { THRONG_PIPE_NAME: pipe, THRONG_CONFIG_ROOT: configRoot } };
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'Survive', root);
      const term = await startZsh(win, await firstPanelId(win));
      await runTypedCommand(win, term, `while true; do echo ${marker}; sleep 1; done`, { echoed: 'while true', output: marker });

      const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()));
      await stopTracingBeforeExit(app);
      // Quit throng is the native `quit` role, which a JavaScript click cannot run on macOS: quit as it ends in.
      const quitRole = await app.evaluate(({ Menu, app: a }) => {
        const quit = Menu.getApplicationMenu()?.items.find((m) => m.label === 'throng')?.submenu?.items.find((i) => i.label === 'Quit throng');
        a.quit();
        return quit?.role;
      });
      expect(quitRole).toBe('quit');
      await win.getByTestId('app-close-leave').click();
      await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('no exit after Quit')), APP_CLOSE_TIMEOUT_MS))]);
    }, opts);

    await runApp(async (_app, win) => {
      // A relaunch opens on no project, with the terminal still running behind it, as terminal-reattach.e2e.ts has it.
      await win.locator('.project-item', { hasText: 'Survive' }).click();
      const term = win.getByTestId(TERMINAL_VIEW).first();
      await expect(term).toContainText(marker, { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
      // Still running, not a replayed screen: the loop keeps printing after the reattach.
      const count = async (): Promise<number> => ((await term.textContent()) ?? '').split(marker).length;
      const before = await count();
      await expect.poll(count, { timeout: TERMINAL_OUTPUT_TIMEOUT_MS }).toBeGreaterThan(before);
    }, opts);
  } finally {
    await killAppSpawnedDaemon(pipe);
    for (const dir of [root, dataDir, userDataDir, configRoot]) cleanupTemp(dir);
  }
});

test('destroying a terminal panel ends what its shell started', { tag: ['@macos', '@extended', '@terminal', '@reserve:process'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-tree-'));
  const marker = `9${process.pid % 1000}${Date.now() % 1000}`;
  const sleepers = (): number => processTable().filter((p) => p.name === 'sleep' && p.cmd.includes(marker)).length;
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Tree', root);
      const pid = await firstPanelId(win);
      await splitPanelViaMenu(win, pid);
      const term = await startZsh(win, pid);
      await runTypedCommand(win, term, `sleep ${marker} &`, { echoed: `sleep ${marker}`, output: `sleep ${marker}` });
      await expect.poll(sleepers, { timeout: TERMINAL_OUTPUT_TIMEOUT_MS }).toBe(1);

      await win.getByTestId(`panel-close-${pid}`).click();
      await expect(win.getByTestId('confirm-dialog')).toBeVisible();
      await acceptConfirmations(win);
      await expect.poll(sleepers, { timeout: TERMINAL_OUTPUT_TIMEOUT_MS }).toBe(0);
    });
  } finally {
    cleanupTemp(root);
  }
});
