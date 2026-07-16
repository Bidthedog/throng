import { test, expect } from '@playwright/test';
import { runApp, createProject, commitTabRename } from './harness.js';

// US5 (FR-003/004): the main window has a bottom status bar showing the active
// project on the left and the active tab · panel on the right, updating
// immediately. (The sub-workspace status-bar variant is asserted in
// sub-workspaces.e2e.ts / US7.)

test('shows "No project" when nothing is active', async () => {
  await runApp(async (_app, win) => {
    await expect(win.getByTestId('status-bar')).toBeVisible();
    await expect(win.getByTestId('status-project')).toHaveText('No project');
    await expect(win.getByTestId('status-project-dot')).toHaveCount(0);
    await expect(win.getByTestId('status-context')).toHaveText('');
  });
});

test('shows the active project, tab and panel, and updates on change', async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'Bartholomew', 'C:/c/bart');

    await expect(win.getByTestId('status-project')).toContainText('Bartholomew');
    await expect(win.getByTestId('status-project-dot')).toBeVisible();
    await expect(win.getByTestId('status-context')).not.toHaveText('');

    // Open a second tab; the right side reflects the now-active tab's title.
    await win.getByTestId('tab-add').click();
    await commitTabRename(win);
    const activeTabTitle = await win.locator('.tab-chip--active').evaluate((el) => {
      const count = el.querySelector('.tab-chip__count');
      return (el.textContent ?? '').replace(count?.textContent ?? '', '').trim();
    });
    await expect(win.getByTestId('status-context')).toContainText(activeTabTitle);
  });
});
