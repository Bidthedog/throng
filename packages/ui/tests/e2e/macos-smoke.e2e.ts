import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { runApp } from './harness.js';

/**
 * Layer: E2E. Only a real Electron process on a real Mac shows that throng starts, shows its window with macOS's
 * traits, and that About — opened from the app menu macOS draws — reports this build's version (070 SC-001, US1
 * scenario 4). macOS's own lane: `@macos` runs on the hosted macOS runners and nowhere else.
 */
test.skip(process.platform !== 'darwin', 'macOS startup and the app menu');

const PRODUCT_VERSION = (
  JSON.parse(readFileSync(fileURLToPath(new URL('../../../../package.json', import.meta.url)), 'utf8')) as { version: string }
).version;

test('throng starts on macOS, its window shows, and About reports this build’s version', { tag: ['@macos', '@core', '@boot', '@reserve:window'] }, async () => {
  await runApp(async (app, win) => {
    await expect(win.getByTestId('project-new')).toBeVisible();
    expect(await win.evaluate(() => (window as unknown as { throng?: { osName?: string } }).throng?.osName)).toBe('macos');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)).toBe(true);

    const opened = app.waitForEvent('window', { predicate: (w) => w.url().includes('about=1') });
    const clicked = await app.evaluate(({ Menu }) => {
      const appMenu = Menu.getApplicationMenu()?.items.find((i) => i.label === 'throng');
      const about = appMenu?.submenu?.items.find((i) => i.label === 'About throng');
      about?.click();
      return about !== undefined;
    });
    expect(clicked, 'the app menu has no About throng').toBe(true);
    const about = await opened;
    await expect(about.getByTestId('about-version')).toHaveText(PRODUCT_VERSION);
  });
});
