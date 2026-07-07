import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runApp, createProject } from './harness.js';

// A project not yet loaded this session shows its name italic + muted; opening it
// marks it loaded (normal style). Two app sessions share one daemon DB (same
// dataDir): session 1 creates (and loads) the project, session 2 starts fresh
// (lazy) so it begins UNLOADED. (006 removed the green "loaded" dot — the shared
// red unsaved dot now occupies that slot; loaded state is shown via style only.)

test('indicates loaded vs not-loaded projects', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-e2e-loaded-'));
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'Persist', 'C:/c/persist');
        // Freshly created → loaded.
        await expect(win.locator('.project-item', { hasText: 'Persist' })).toHaveAttribute(
          'data-loaded',
          'true',
        );
      },
      { dataDir },
    );

    await runApp(
      async (_app, win) => {
        const item = win.locator('.project-item', { hasText: 'Persist' });
        await expect(item).toBeVisible();

        // Lazy startup → not loaded: italic name. The green loaded dot no longer
        // exists (006); a clean unloaded project shows no unsaved dot either.
        await expect(item).toHaveAttribute('data-loaded', 'false');
        await expect(item.locator('.project-item__loaded')).toHaveCount(0);
        await expect(item.locator('.throng-unsaved-dot')).toHaveCount(0);
        const italic = await item
          .locator('.project-item__name')
          .evaluate((el) => getComputedStyle(el).fontStyle);
        expect(italic).toBe('italic');

        // Open it → loaded: the name is no longer italic (no dot appears when clean).
        await item.locator('[data-testid^="project-switch-"]').click();
        await expect(item).toHaveAttribute('data-loaded', 'true');
        await expect(item.locator('.throng-unsaved-dot')).toHaveCount(0);
        const normal = await item
          .locator('.project-item__name')
          .evaluate((el) => getComputedStyle(el).fontStyle);
        expect(normal).toBe('normal');
      },
      { dataDir },
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
