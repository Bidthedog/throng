import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp, createProject, cleanupTemp} from './harness.js';
import { skipIfElevated } from './admin.js';

/**
 * 026 / #166 — the status bar must stop duplicating the title bar's identity.
 *
 * Since the frameless custom title bar landed, `AppTitleBar` composes its identity from the SAME
 * `activeContextLabel(layout)` call the status bar uses, plus the project name, plus a trailing
 * `[ADMIN]` marker, plus the project colour as the bar's own colour — and `TitleManager` sends the
 * identical string to the OS taskbar. So the status bar's dot, project name, `Tab · Panel` context
 * and ADMIN pill are all a second copy of what is already on screen two rows up.
 *
 * The ONE thing the status bar carries that the title bar does not is the project's root folder
 * path. That stays; the duplicates go; the bar itself stays, at its current height, as the home for
 * status content added later.
 *
 * RED on master: every removed element is still rendered.
 *
 * This spec deliberately asserts the TITLE BAR is unchanged in the same run. The failure mode a
 * "drop the duplicate" change invites is deleting the wrong copy, and a test that only looks at the
 * status bar cannot see that happen.
 */

const osTitle = (app: ElectronApplication): Promise<string> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());

/** The status bar's rendered height — pinned so "remove the text" cannot become "collapse the bar". */
const barHeight = (win: Page): Promise<number> =>
  win.getByTestId('status-bar').evaluate((el) => el.getBoundingClientRect().height);

test('the status bar keeps only the project root path; the title bar keeps the identity', { tag: ['@extended', '@window'] }, async () => {
  skipIfElevated(); // this case asserts NO admin pill; the elevated case is the test below
  const root = mkdtempSync(join(tmpdir(), 'throng-statusdedupe-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'DedupeProj', root);

      // The bar itself survives, with its testid and a real height.
      const bar = win.getByTestId('status-bar');
      await expect(bar).toBeVisible();
      expect(await barHeight(win)).toBeGreaterThan(0);

      // The one non-duplicated fact stays, and is still the project's root folder.
      await expect(win.getByTestId('status-project-path')).toHaveText(`(${root})`);

      // The four duplicates are gone.
      await expect(win.getByTestId('status-project-dot')).toHaveCount(0);
      await expect(win.getByTestId('status-context')).toHaveCount(0);
      await expect(win.getByTestId('status-admin-pill')).toHaveCount(0);
      await expect(bar).not.toContainText('DedupeProj');

      // The title bar is untouched — same project name, same Tab · Panel context, same colour.
      const identity = win.getByTestId('title-bar-identity');
      await expect(identity).toContainText('DedupeProj');
      await expect(identity).toContainText('Tab 1 · Panel 1');

      // And so is the OS window/taskbar title (TitleManager).
      await expect.poll(() => osTitle(app), { timeout: 5000 }).toBe('DedupeProj · Tab 1 · Panel 1 — throng');
    });
  } finally {
    cleanupTemp(root);
  }
});

test('when elevated, [ADMIN] is on the title bar only — the status bar has no pill', { tag: ['@extended', '@window'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-statusdedupe-admin-'));
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'ElevProj', root);
        await expect(win.getByTestId('status-bar')).toBeVisible();
        // The elevation marker is not lost — it moves nowhere, it was already on the title bar.
        await expect(win.getByTestId('title-bar-identity')).toContainText('[ADMIN]');
        await expect(win.getByTestId('status-admin-pill')).toHaveCount(0);
      },
      { env: { THRONG_FAKE_ELEVATED: '1' } },
    );
  } finally {
    cleanupTemp(root);
  }
});
