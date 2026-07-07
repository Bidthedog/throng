import { test, expect } from '@playwright/test';
import { runApp } from './harness.js';

// The create-project form's "Browse" button must be project-NEUTRAL — never tinted
// with the active project's accent colour (which is applied globally as --accent).

async function makeRedProject(win: import('@playwright/test').Page): Promise<void> {
  await win.getByTestId('project-new').click();
  await win.getByTestId('project-name-input').fill('RedProj');
  await win.getByTestId('project-root-input').fill('C:/code/red');
  await win.getByTestId('project-colour-input').evaluate((el) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, '#ff0000');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await win.getByTestId('project-save').click();
  await expect(win.locator('.project-item', { hasText: 'RedProj' })).toBeVisible();
}

test('the create-project Browse button is not tinted with the active project colour', async () => {
  await runApp(async (_app, win) => {
    // A bright-red project → --accent becomes red for the whole window.
    await makeRedProject(win);
    const accent = (await win.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    )) as string;

    // Open the create form again; the Browse button must be neutral (not red),
    // at rest AND on hover.
    await win.getByTestId('project-new').click();
    const browse = win.getByTestId('project-pick-folder');
    await expect(browse).toBeVisible();

    const rest = await browse.evaluate((el) => getComputedStyle(el).color);
    await browse.hover();
    const hover = await browse.evaluate((el) => getComputedStyle(el).color);

    // Red resolves to rgb(255, 0, 0); the button text must never be that.
    expect(accent.toLowerCase()).toContain('ff0000');
    expect(rest).not.toBe('rgb(255, 0, 0)');
    expect(hover).not.toBe('rgb(255, 0, 0)');
    // Rest and hover colours match (no accent flip on hover).
    expect(hover).toBe(rest);
  });
});
