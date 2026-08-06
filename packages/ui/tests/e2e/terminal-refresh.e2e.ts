import { basename } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp} from './harness.js';

/**
 * Nothing repaints a terminal on a timer any more — and an idle one is fine without it.
 *
 * This used to assert that the periodic self-heal repaint (FR-109, 2s, later demoted to an 8s
 * backstop) was non-destructive. 028 removed the timer outright: it re-rendered the visible rows FROM
 * the buffer, so it could never fix the corruption it was aimed at — the buffer is what is wrong —
 * and the real cure is event-driven, a rebuilt view asking the PROGRAM to redraw.
 *
 * Left as it was, this test would have kept passing while asserting a property of a mechanism that no
 * longer exists, which is worse than no test at all. So it now pins the two things the removal is
 * actually accountable for: that no timer fires, and that an idle terminal is none the worse for it.
 */

interface Diagnostics {
  reconcile: Record<string, number>;
}

async function diagnosticsFor(win: Page, panelId: string): Promise<Diagnostics | undefined> {
  return win.evaluate(
    (id) =>
      (
        window as unknown as {
          __throngTerminalDiagnostics?: () => Record<string, Diagnostics>;
        }
      ).__throngTerminalDiagnostics?.()?.[id],
    panelId,
  ) as Promise<Diagnostics | undefined>;
}

test('an idle terminal keeps its content, and nothing repaints it on a timer', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-term-refresh-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Refresh', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      const confirm = win.getByTestId(`panel-type-confirm-${pid}`);
      await expect(confirm).toBeEnabled();
      await confirm.click();

      const term = win.getByTestId(`terminal-${pid}`);
      await expect(term).toBeVisible();
      // The prompt shows the project root (its unique basename).
      const marker = basename(root);
      await expect(term).toContainText(marker, { timeout: 15000 });

      // Longer than the longest period the backstop ever had (8s), so a surviving timer would have
      // fired at least once inside this window.
      await win.waitForTimeout(9000);
      await expect(term).toContainText(marker);

      const d = await diagnosticsFor(win, pid);
      expect(d, 'no diagnostics for the panel under test').toBeDefined();
      expect(
        d?.reconcile.backstop,
        'a periodic repaint fired — the timer removed by 028 is back',
      ).toBe(0);

      // And the view is still live: exit the shell (which unlocks the root) and the Panel reverts to
      // the type-selection form.
      await term.click();
      await win.keyboard.type('exit');
      await win.keyboard.press('Enter');
      await expect(win.getByTestId(`panel-type-form-${pid}`)).toBeVisible({ timeout: 15000 });
    });
  } finally {
    cleanupTemp(root);
  }
});
