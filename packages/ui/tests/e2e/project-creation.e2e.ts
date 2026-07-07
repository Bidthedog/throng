import { test, expect } from '@playwright/test';
import { runApp, createProject, stubFolderDialog } from './harness.js';

// US4 (FR-026/027/028 + folder exclusivity): project creation polish and the
// fundamental rule that no two projects may share / nest their root folders.

test('auto-fills and selects the name from the picked folder, with an unused accent colour', async () => {
  await runApp(async (app, win) => {
    await stubFolderDialog(app, 'C:\\code\\AutoName'); // the picker returns this folder
    await win.getByTestId('project-new').click();
    await expect(win.getByTestId('project-form')).toBeVisible();

    await expect(win.getByTestId('project-root-input')).toHaveValue('C:\\code\\AutoName');
    await expect(win.getByTestId('project-name-input')).toHaveValue('AutoName'); // basename (FR-026)
    await expect(win.getByTestId('project-colour-input')).toHaveValue(/^#[0-9a-f]{6}$/i); // FR-027
    await expect(win.locator('.project-form__colour-label')).toBeVisible();
  });
});

test('rejects a duplicate/nested root folder on create and on edit, keeping the form open', async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'Alpha', 'C:/code/alpha');

    // Identical root → rejected; form stays open with a folder error (FR-028).
    await win.getByTestId('project-new').click();
    await win.getByTestId('project-root-input').fill('C:/code/alpha');
    await win.getByTestId('project-name-input').fill('Beta');
    await win.getByTestId('project-save').click();
    await expect(win.getByTestId('project-form')).toBeVisible();
    await expect(win.getByTestId('project-error')).toBeVisible();
    await expect(win.getByTestId('project-root-input')).toHaveClass(/project-form__field--error/);

    // Descendant root → still rejected.
    await win.getByTestId('project-root-input').fill('C:/code/alpha/sub');
    await win.getByTestId('project-save').click();
    await expect(win.getByTestId('project-form')).toBeVisible();
    await expect(win.getByTestId('project-error')).toBeVisible();

    // A non-overlapping root → accepted; form closes.
    await win.getByTestId('project-root-input').fill('C:/code/beta');
    await win.getByTestId('project-save').click();
    await expect(win.locator('.project-item', { hasText: 'Beta' })).toBeVisible();
    await expect(win.getByTestId('project-form')).toHaveCount(0);

    // Editing Beta to overlap Alpha is also rejected.
    await win.locator('.project-item', { hasText: 'Beta' }).locator('[data-testid^="project-edit-"]').click();
    await expect(win.getByTestId('project-form')).toBeVisible();
    await win.getByTestId('project-root-input').fill('C:/code/alpha');
    await win.getByTestId('project-save').click();
    await expect(win.getByTestId('project-form')).toBeVisible();
    await expect(win.getByTestId('project-error')).toBeVisible();
  });
});
