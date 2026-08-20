import { basename } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
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
 * longer exists, which is worse than no test at all.
 *
 * IT WAS STILL DOING THAT, and 034 found it. Its "no timer fires" half read
 * `expect(diagnostics.reconcile.backstop).toBe(0)` — and `recordReconcile` has ZERO call sites in
 * `packages/ui/src`, so the counter is initialised to 0 and nothing can increment it. That assertion
 * compared a constant against itself, and a reintroduced timer that simply did not call the counter
 * would have sailed past it. The claim now lives in
 * `packages/ui/tests/unit/no-periodic-reconcile.test.ts` as a source check on `use-terminal.ts`,
 * where it costs milliseconds and fails on the change that matters.
 *
 * What is left here is what needs a real ConPTY and a real xterm surface: an idle terminal still
 * shows its content, and the panel reverts to its form when the shell exits.
 */

test('an idle terminal keeps its content, and nothing repaints it on a timer', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
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

      /*
       * THE COUNTER ASSERTION THAT USED TO SIT HERE IS GONE, AND IT COULD NOT FAIL (034 FR-045).
       *
       * It read `expect(d?.reconcile.backstop).toBe(0)`, and 028 removed the timer outright:
       * `recordReconcile` has ZERO call sites in `packages/ui/src`, so the counter is initialised to
       * 0 and nothing in the application can increment it. It compared a constant against itself.
       *
       * Worse than wasteful — it read as protection against the timer coming back and was not.
       * Reintroduce the timer WITHOUT calling `recordReconcile`, which is what a reintroduction
       * actually looks like (nobody adds a feature by remembering to increment the counter that
       * proves it exists), and this stayed green while the terminal repainted every eight seconds.
       *
       * `packages/ui/tests/unit/no-periodic-reconcile.test.ts` now guards it at the layer where the
       * fact lives: a source check that `use-terminal.ts` arms no `setInterval`. It costs
       * milliseconds, it fails on the change that matters, and it does not depend on whoever
       * reintroduced the timer having counted it. Red-proved by splicing a bare
       * `setInterval(() => {}, 8000)` into the module — 1 of 3 fails, and it is that one.
       */
      // sleep-justified: what remains here is the claim in this test's TITLE — that an idle terminal
      // sleep-justified: keeps its content — and idling is the only way to observe an interval in
      // sleep-justified: which nothing happened. There is no event for "no repaint occurred"; the
      // sleep-justified: nine seconds covers the deleted backstop's old 8s period with margin.
      await win.waitForTimeout(9000);
      await expect(term).toContainText(marker);

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
