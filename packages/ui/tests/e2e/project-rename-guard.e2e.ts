import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject } from './harness.js';
import { skipIfElevated } from './admin.js';

// Project name is capped at 120 chars: typing is restricted to 120 so the user never
// hits the error; and if a rename IS rejected, the inline editor stays OPEN (edits
// preserved) instead of closing.

async function projectId(win: Page): Promise<string> {
  const tid = await win
    .locator('[data-testid^="project-switch-"]')
    .first()
    .getAttribute('data-testid');
  return (tid ?? '').replace('project-switch-', '');
}

test('typing a project rename is capped at 120 characters', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-cap-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Proj', root);
      const pid = await projectId(win);
      await win.getByTestId(`project-switch-${pid}`).dblclick();
      const input = win.getByTestId(`project-rename-input-${pid}`);
      await input.fill('');
      await input.pressSequentially('x'.repeat(130), { delay: 0 });
      const len = await input.evaluate((el) => (el as HTMLInputElement).value.length);
      expect(len).toBe(120);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('a rejected rename keeps the inline editor open (no lost edits)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-keep-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Proj', root);
      const pid = await projectId(win);
      await win.getByTestId(`project-switch-${pid}`).dblclick();
      const input = win.getByTestId(`project-rename-input-${pid}`);

      // Force a >120 value past the maxLength cap (as if pasted), then commit.
      await input.evaluate((el) => {
        const i = el as HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(i, 'y'.repeat(130));
        i.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await input.press('Enter');

      // The editor stays open (edits not lost) and an error is shown.
      await expect(win.getByTestId(`project-rename-input-${pid}`)).toBeVisible();
      await expect(win.getByTestId('project-error')).toBeVisible({ timeout: 6000 });
      // The over-long value is still there to be trimmed down.
      const len = await win
        .getByTestId(`project-rename-input-${pid}`)
        .evaluate((el) => (el as HTMLInputElement).value.length);
      expect(len).toBe(130);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
