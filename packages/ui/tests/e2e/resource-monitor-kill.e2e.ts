import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { cleanupTemp, createProject, firstPanelId, runApp, runTypedCommand } from './harness.js';
import { closeMonitorWindow, openMonitorWindow } from './helpers/monitor-window.js';
import { processesMatching, processTable } from './helpers/processes.js';

/**
 * Kill All Below from the Resource Monitor (055 FR-063a, FR-065, FR-066, SC-007), on a real process tree.
 *
 * Layer: E2E, because the claim is about real processes: a `node` that spawns two children, under a real
 * shell under a real ConPTY, ended through the real collector by (pid, create time) — and then the OS
 * is asked whether they are gone. The menu, the confirmations and the notice are pinned in
 * `node-actions.test.ts`; the leaves-first order and the identity check in the collector's integration
 * test. Nothing below this layer can make a process die.
 *
 * Run it: `npx playwright test packages/ui/tests/e2e/resource-monitor-kill.e2e.ts --workers=1`
 */
const MARK = 'RMKILLMARK';

/** A parent `node` that spawns two children, all three carrying MARK in their command lines. */
const PARENT_COMMAND =
  `node -e "/*${MARK}*/var c=require('child_process');` +
  `c.spawn('node',['-e','/*${MARK}*/setInterval(function(){},1000)'],{stdio:'ignore'});` +
  `c.spawn('node',['-e','/*${MARK}*/setInterval(function(){},1000)'],{stdio:'ignore'});` +
  `setInterval(function(){},1000)"`;

const alive = (): number => processesMatching('node.exe', MARK).length;

/** Click through the kill confirmations (`killProcesses` ships at double). */
async function acceptKill(win: Page): Promise<void> {
  const dialog = win.getByTestId('confirm-dialog');
  await expect(dialog).toBeVisible();
  await win.getByTestId('confirm-accept').click();
  await expect(dialog).toContainText(/absolutely sure/i);
  await win.getByTestId('confirm-accept').click();
  await expect(dialog).toHaveCount(0);
}

/** The row for a node whose id starts `prefix`, optionally the one with the given text. */
const rowOf = (win: Page, prefix: string, text?: string): Locator =>
  win.locator(`[data-testid^="breakdown-row-${prefix}"]`, text === undefined ? {} : { hasText: text });

test('Kill All Below ends a parent and its two children, which show ended while the shell lives; on the panel it ends the shell too and the panel keeps its place', { tag: ['@extended', '@terminal', '@reserve:process'] }, async () => {
  test.setTimeout(180_000);
  const root = mkdtempSync(join(tmpdir(), 'throng-resmon-kill-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'KillTree', root);
      const panelId = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${panelId}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${panelId}`).click();
      const term = win.getByTestId(`terminal-${panelId}`);
      await expect(term).toBeVisible();
      await runTypedCommand(win, term, 'set /a 40+2', { echoed: 'set /a 40+2', output: '42' });

      // Three node.exe under the shell, by the OS's own count.
      await term.click();
      await win.keyboard.type(PARENT_COMMAND, { delay: 10 });
      await win.keyboard.press('Enter');
      await expect.poll(alive, { timeout: 30_000, message: 'the parent and its two children never all started' }).toBe(3);

      // Into the monitor, down to the panel.
      // The monitor is a window of its own (FR-081); everything it shows and asks happens in IT.
      let mon = await openMonitorWindow(app, () => win.keyboard.press('Control+Shift+Alt+R'));
      await mon.getByTestId('breakdown-section-projects').locator('[role="treeitem"][data-testid^="breakdown-row-p:"]').first().dblclick();
      await mon.locator('[role="treeitem"][data-testid^="breakdown-row-t:"]').first().dblclick();
      await mon.locator('[role="treeitem"][data-testid^="breakdown-row-n:"]').first().dblclick();

      const nodes = rowOf(mon, 'x:', 'node.exe');
      await expect(nodes).toHaveCount(3, { timeout: 20_000 });
      // The parent is the shallowest of the three.
      const levels = await nodes.evaluateAll((els) => els.map((e) => Number(e.getAttribute('aria-level'))));
      const parentIndex = levels.indexOf(Math.min(...levels));
      const parent = nodes.nth(parentIndex);
      const shell = rowOf(mon, 'x:', 'cmd.exe').first();
      await expect(shell).toBeVisible();

      // Kill All Below on the parent: all three end, the shell does not.
      await parent.click({ button: 'right' });
      await mon.getByTestId('menu-item-Kill All Below').click();
      await acceptKill(mon);
      // The list holds still while the pointer is over it (FR-095): move away so it catches up to the kill.
      await mon.mouse.move(1, 1);

      await expect.poll(alive, { timeout: 30_000, message: 'a marked node.exe survived Kill All Below' }).toBe(0);
      // They stay where they were, ended (FR-065a), and the shell is not.
      await expect(rowOf(mon, 'x:', 'node.exe')).toHaveCount(3);
      for (let i = 0; i < 3; i += 1) await expect(nodes.nth(i)).toHaveAttribute('data-ended', 'true', { timeout: 15_000 });
      await expect(shell).not.toHaveAttribute('data-ended', 'true');
      expect(processesMatching('cmd.exe', '', processTable()).length, 'the shell is still running').toBeGreaterThan(0);
      await expect(mon.getByTestId('monitor-notice')).toHaveCount(0);

      // The shell keeps working: close the monitor and ask it something.
      await closeMonitorWindow(app);
      await runTypedCommand(win, term, 'set /a 6*7', { echoed: 'set /a 6*7', output: '42' });

      // Kill All Below on the PANEL ends the shell as well, and the panel keeps its place (FR-066).
      mon = await openMonitorWindow(app, () => win.keyboard.press('Control+Shift+Alt+R'));
      await mon.getByTestId('breakdown-section-projects').locator('[role="treeitem"][data-testid^="breakdown-row-p:"]').first().dblclick();
      await mon.locator('[role="treeitem"][data-testid^="breakdown-row-t:"]').first().dblclick();
      await rowOf(mon, 'n:').first().click({ button: 'right' });
      await mon.getByTestId('menu-item-Kill All Below').click();
      await acceptKill(mon);

      await closeMonitorWindow(app);
      // Same state as any other shell exit: the panel is still there, and offers its type form again.
      await expect(win.getByTestId(`panel-type-select-${panelId}`)).toBeVisible({ timeout: 30_000 });
    });
  } finally {
    cleanupTemp(root);
  }
});
