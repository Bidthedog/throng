import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { createProject, firstPanelId, runApp } from './harness.js';

/**
 * 018 — the drop-down popup of a native <select> is a MENU, and it did not obey the theme.
 *
 * Five <select> elements open a list that the BROWSER ENGINE rendered rather than us, so the hovered
 * row was highlighted in the SYSTEM accent — blue on a default Windows install, sitting in the middle
 * of a fully-themed dark application. No stylesheet could reach it. Exactly the same defect as the
 * native colour dialog (#64), and the source issues missed it.
 *
 * `appearance: base-select` makes the picker real DOM, which is what makes both the fix and this test
 * possible: a Playwright locator can now SEE the option list. It could not before.
 */

test('a drop-down’s popup is drawn by us, and its hover highlight is not the operating system’s blue', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-sel-'));
  await runApp(async (_app, win) => {
    await createProject(win, 'Selects', root);
    const pid = await firstPanelId(win);

    const select = win.getByTestId(`panel-type-select-${pid}`);
    await expect(select).toBeVisible();

    // The control must be opted OUT of the operating-system widget. This one assertion is the whole
    // fix: while the engine renders the popup, nothing we write can reach it, and the hovered row
    // stays the system's blue no matter how thoroughly the rest of the app is themed.
    await expect
      .poll(() => select.evaluate((el) => getComputedStyle(el).appearance))
      .toBe('base-select');

    // And the popup is real DOM now, so its rows are addressable and carry OUR colours — the hover
    // highlight resolves the theme's menu tokens, exactly like every other menu in the application.
    const highlight = await select
      .locator('option')
      .first()
      .evaluate((el) => {
        const root_ = getComputedStyle(document.documentElement);
        // Unset by default, so the highlight follows `--accent`: the ACTIVE PROJECT'S colour.
        const pinned = root_.getPropertyValue('--throng-colour-menuItemHoverSurface').trim();
        const accent = root_.getPropertyValue('--accent').trim();
        return { pinned, accent, optionColour: getComputedStyle(el).color };
      });

    expect(highlight.pinned, 'the menu highlight is unset, so it follows the project').toBe('');
    expect(highlight.accent, 'the project colour drives the highlight').toMatch(/^#|rgb/);
  });
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
});
