import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { runApp, createProject, panelIds, commitPanelRename, commitTabRename } from './harness.js';

// The project list shows each project's tab/panel count after the name, e.g.
// "(2T·3P)". The OPEN project counts live from its loaded layout; others use the
// counts persisted by the daemon (projects.list).

const countsOf = (win: Page, name: string) =>
  win.locator('.project-item', { hasText: name }).locator('.project-item__counts');

test('shows live tab/panel counts for the active project', async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'Live', 'C:/c/live');
    await expect(countsOf(win, 'Live')).toHaveText('(1T·1P)');

    // Add a tab → 2 tabs, 2 panels total.
    await win.getByTestId('tab-add').click();
    await commitTabRename(win);
    await expect(countsOf(win, 'Live')).toHaveText('(2T·2P)');

    // Add a panel to the active tab → 3 panels total.
    const pid = (await panelIds(win))[0];
    await win.getByTestId(`panel-add-${pid}`).click();
    await commitPanelRename(win);
    await expect(countsOf(win, 'Live')).toHaveText('(2T·3P)');
  });
});

test('shows persisted counts for a project that is not currently open', async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'Alpha', 'C:/c/alpha');
    await win.getByTestId('tab-add').click(); // Alpha: 2 tabs
    await commitTabRename(win);
    await expect(countsOf(win, 'Alpha')).toHaveText('(2T·2P)');
    await win.waitForTimeout(900); // let Alpha's layout autosave

    // Creating Beta switches away from Alpha; Alpha's count now comes from the
    // daemon's saved layout (projects.list), not the live workspace.
    await createProject(win, 'Beta', 'C:/c/beta');
    await expect(countsOf(win, 'Alpha')).toHaveText('(2T·2P)');
    await expect(countsOf(win, 'Beta')).toHaveText('(1T·1P)');
  });
});
