import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { TERMINAL_OUTPUT_TIMEOUT_MS, acceptConfirmations, cleanupTemp, createProject, firstPanelId, runApp, splitPanelViaMenu } from './harness.js';
import { processTable } from './helpers/processes.js';

/**
 * Layer: E2E. Real keystrokes reaching a real shell through the real PTY, and a real process tree ending (062 US2).
 * Which shells are offered is settled by LinuxShellDetection's contract test; this proves a shell works once chosen.
 */
test.skip(process.platform !== 'linux', 'Linux shells');

const installed = (shell: string): boolean => spawnSync('sh', ['-c', `command -v ${shell}`], { stdio: 'ignore' }).status === 0;

async function startShell(win: Page, panelId: string, flavour: string): Promise<ReturnType<Page['getByTestId']>> {
  await win.getByTestId(`panel-type-select-${panelId}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption(flavour);
  const confirm = win.getByTestId(`panel-type-confirm-${panelId}`);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  const term = win.getByTestId(`terminal-${panelId}`);
  await expect(term).toBeVisible();
  await term.click();
  return term;
}

for (const flavour of ['bash', 'zsh', 'fish']) {
  test(`${flavour}: keystrokes reach the shell, and it starts at the project root`, { tag: ['@linux', '@extended', '@terminal', '@reserve:input'] }, async () => {
    // CI installs all three (scripts/ci-linux-setup.sh), so a shell missing there is a failure, not a skip.
    test.skip(!process.env.CI && !installed(flavour), `${flavour} is not installed on this machine`);
    const root = mkdtempSync(join(tmpdir(), `throng-${flavour}-`));
    try {
      await runApp(async (_app, win) => {
        await createProject(win, flavour, root);
        const pid = await firstPanelId(win);
        const term = await startShell(win, pid, flavour);
        await win.keyboard.type('pwd');
        await win.keyboard.press('Enter');
        await expect(term).toContainText(basename(root), { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
        await win.keyboard.type('echo LIVE_$((40+2))_MARK');
        await win.keyboard.press('Enter');
        await expect(term).toContainText(flavour === 'fish' ? 'LIVE_' : 'LIVE_42_MARK', { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
      });
    } finally {
      cleanupTemp(root);
    }
  });
}

test('destroying a terminal panel ends what its shell started', { tag: ['@linux', '@extended', '@terminal', '@reserve:process'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-tree-'));
  const marker = `9${process.pid % 1000}${Date.now() % 1000}`;
  const sleepers = (): number => processTable().filter((p) => p.name === 'sleep' && p.cmd.includes(marker)).length;
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Tree', root);
      const pid = await firstPanelId(win);
      await splitPanelViaMenu(win, pid);
      await startShell(win, pid, 'bash');
      await win.keyboard.type(`sleep ${marker} &`);
      await win.keyboard.press('Enter');
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
