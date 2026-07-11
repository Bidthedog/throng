import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

// 011 US5 (FR-020..023): the unsaved dot pulses continuously wherever it appears,
// in step, never invisible; and renders static at full opacity under reduced motion.

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

const animationOf = (win: Page, testId: string): Promise<string> =>
  win.getByTestId(testId).evaluate((el) => getComputedStyle(el).animationName);

test('the unsaved dot pulses in step across panel, tab and project', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-pulse-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'Pulse', root);
      const pid = await newEditor(win);
      const tabId = await win
        .locator('.tab-chip')
        .first()
        .evaluate((el) => (el as HTMLElement).dataset.testid?.replace('tab-', '') ?? '');

      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.type('dirty');

      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();
      // All three carry the SAME pulse animation (one shared class -> in step, FR-022).
      expect(await animationOf(win, `panel-unsaved-${pid}`)).toBe('throng-unsaved-pulse');
      expect(await animationOf(win, `tab-unsaved-${tabId}`)).toBe('throng-unsaved-pulse');
      const projDot = win.locator('.project-item .throng-unsaved-dot').first();
      expect(await projDot.evaluate((el) => getComputedStyle(el).animationName)).toBe(
        'throng-unsaved-pulse',
      );

      // Saving clears the changes → the dot stops the instant it is saved (US5 #3 /
      // SC-005): it is removed, since there are then no unsaved changes.
      await app.evaluate(({ dialog }, p) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
      }, join(root, 'scratch.txt'));
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.press('Control+s');
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('the unsaved dot is static at full opacity under reduced motion', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-pulse-rm-'));
  try {
    await runApp(async (_app, win) => {
      await win.emulateMedia({ reducedMotion: 'reduce' });
      await createProject(win, 'PulseRM', root);
      const pid = await newEditor(win);
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.type('dirty');

      const dot = win.getByTestId(`panel-unsaved-${pid}`);
      await expect(dot).toBeVisible();
      const style = await dot.evaluate((el) => {
        const s = getComputedStyle(el);
        return { animationName: s.animationName, opacity: s.opacity };
      });
      expect(style.animationName).toBe('none');
      expect(style.opacity).toBe('1');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
