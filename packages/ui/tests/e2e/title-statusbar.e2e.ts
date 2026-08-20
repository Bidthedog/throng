import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { runApp } from './harness.js';

// FR-040: the OS window title shows the active project name + the active Tab · Panel
// context (the same `activeContextLabel` the status bar uses), NO path and NO
// project/tab/panel totals, plus a trailing `[ADMIN]` marker when elevated (FR-025e).
// #5: the bottom status bar still shows the active project's path in brackets.

const title = (app: ElectronApplication): Promise<string> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());

/*
 * DELETED (034 FR-045): "window title shows active project · Tab · Panel (no path, no totals);
 * status bar keeps the path".
 *
 * A strict subset of `status-bar-deduped.e2e.ts` — "the status bar keeps only the project root
 * path; the title bar keeps the identity". That test polls the same OS title for the same exact
 * string, reads the same `status-project-path`, and makes the same `not.toContainText(project)`
 * assertion on the status bar. The three negative assertions here — no path, no totals, no
 * [ADMIN] — are all implied by the exact-equality on the title that both tests already make.
 *
 * The elevated test below is NOT a duplicate, and the difference is worth stating because it
 * nearly went with it: it asserts the OS/taskbar title carries [ADMIN], which is `TitleManager`
 * in main. `status-bar-deduped.e2e.ts` asserts the IN-APP title bar carries it. Two surfaces, one
 * marker, and only one of them is what a user sees in the taskbar.
 */

test('window title gains a [ADMIN] marker when elevated', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  await runApp(
    async (app) => {
      await expect.poll(() => title(app), { timeout: 5000 }).toContain('[ADMIN]');
      // Suffix form (021): "No project [ADMIN] — throng" — [ADMIN] folded in before the brand suffix.
      const t = await title(app);
      expect(t).toContain('No project');
      expect(t.endsWith(' — throng')).toBe(true);
    },
    { env: { THRONG_FAKE_ELEVATED: '1' } },
  );
});
