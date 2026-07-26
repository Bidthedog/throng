/**
 * No two panels anywhere in throng share a name (024 follow-up).
 *
 * A panel's name is how a user REFERS to it — in the tab strip, in the window title, in the
 * app-close warning listing what is still running, and out loud to whoever they are pairing with.
 * Two panels called "Build" in two projects make every one of those a riddle. Uniqueness spans
 * every project and every sub-workspace, which is why only the daemon can enforce it.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';

/** Rename the given panel through its header menu, returning the name it ended up with. */
async function renamePanel(win: Page, panelId: string, to: string): Promise<string> {
  await win.getByTestId(`panel-handle-${panelId}`).click({ button: 'right' });
  await win.getByTestId('menu-item-Rename').click();
  const input = win.getByTestId(`panel-rename-input-${panelId}`);
  await expect(input).toBeVisible();
  await input.fill(to);
  await input.press('Enter');
  await expect(win.getByTestId(`panel-rename-input-${panelId}`)).toHaveCount(0);
  return (await win.getByTestId(`panel-title-${panelId}`).textContent()) ?? '';
}

test('a name taken in ANOTHER project is adjusted, and the user is told once', async () => {
  const rootA = mkdtempSync(join(tmpdir(), 'throng-nameA-'));
  const rootB = mkdtempSync(join(tmpdir(), 'throng-nameB-'));
  try {
    await runApp(async (_app, win) => {
      // Project A: name its panel "Build".
      await createProject(win, 'AlphaProj', rootA);
      const a = await firstPanelId(win);
      expect(await renamePanel(win, a, 'Build')).toBe('Build');

      // Project B — a DIFFERENT project, whose layout this window is now showing instead.
      await createProject(win, 'BetaProj', rootB);
      const b = await firstPanelId(win);
      expect(b).not.toBe(a);

      // The clash is in a project that is not even open. Only the daemon can see it.
      const granted = await renamePanel(win, b, 'Build');
      expect(granted).toBe('Build (2)');

      // Told once, in a warning that dismisses itself — nothing was lost and nothing to decide.
      const notice = win.getByTestId('panel-name-adjusted');
      await expect(notice).toBeVisible({ timeout: 8000 });
      await expect(notice).toContainText('Build (2)');
      await expect(notice).toHaveClass(/notice--warning/);

      // Case-insensitively, too: two panels a user cannot tell apart are the same name.
      const third = await win.getByTestId(`panel-add-${b}`).click().then(async () => {
        const ids = await win
          .locator('[data-testid^="panel-type-select-"]')
          .evaluateAll((els) =>
            els.map((e) => (e.getAttribute('data-testid') ?? '').replace('panel-type-select-', '')),
          );
        return ids[0];
      });
      expect(await renamePanel(win, third, 'BUILD')).toBe('BUILD (2)');
    });
  } finally {
    for (const r of [rootA, rootB]) {
      rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    }
  }
});

test('the generated names of two projects do not collide', async () => {
  const rootA = mkdtempSync(join(tmpdir(), 'throng-autoA-'));
  const rootB = mkdtempSync(join(tmpdir(), 'throng-autoB-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'AutoAlpha', rootA);
      const a = await firstPanelId(win);
      await expect(win.getByTestId(`panel-title-${a}`)).toHaveText('Panel 1');
      // The daemon answers from PERSISTED layouts, so give this project's layout time to be written
      // before the next one asks whether its name is taken.
      await win.waitForTimeout(2500);

      await createProject(win, 'AutoBeta', rootB);
      const b = await firstPanelId(win);
      // Every project used to number its panels within its OWN layout, so both were "Panel 1".
      // Generated names now run in ONE sequence across the whole application — so the second
      // project's first panel is "Panel 2". Not "Panel 1 (2)": a suffix is for a name the user
      // typed and wants to keep the words of; a generated name simply rejoins the sequence.
      await expect
        .poll(() => win.getByTestId(`panel-title-${b}`).textContent(), { timeout: 8000 })
        .toBe('Panel 2');
    });
  } finally {
    for (const r of [rootA, rootB]) {
      rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    }
  }
});
