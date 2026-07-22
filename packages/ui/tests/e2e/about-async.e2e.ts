/**
 * US4 (#139) — "About throng" paints its static content immediately and loads the third-party
 * packages list asynchronously, showing a loading affordance until it populates in place; closing
 * the dialog before the list resolves cancels the load (no orphaned work).
 */
import { test, expect } from '@playwright/test';
import { runApp } from './harness.js';

test('About paints static content, then loads the third-party list asynchronously (#139)', async () => {
  await runApp(async (app, win) => {
    await win.getByTestId('title-bar-cog').click();
    const [about] = await Promise.all([
      app.waitForEvent('window', { timeout: 15_000 }),
      win.getByTestId('cog-menu-about').click(),
    ]);
    await about.waitForLoadState('domcontentloaded', { timeout: 15_000 });

    // Static identity is present without waiting on the packages list (FR-014).
    await expect(about.getByTestId('about-version')).not.toHaveText('');
    await expect(about.getByTestId('about-build-id')).not.toHaveText('');

    // The packages list loads asynchronously and populates in place (FR-015/FR-017); once ready,
    // the loading affordance is gone and the real content (the full closure) is shown.
    await expect(about.getByTestId('about-thirdparty')).toContainText('better-sqlite3');
    await expect(about.getByTestId('about-thirdparty-loading')).toHaveCount(0);
    expect(await about.getByTestId('about-thirdparty').getByRole('listitem').count()).toBeGreaterThan(50);
  });
});

test('closing About before the list resolves cancels the load without error (#139)', async () => {
  const errors: string[] = [];
  await runApp(async (app, win) => {
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.getByTestId('title-bar-cog').click();
    const [about] = await Promise.all([
      app.waitForEvent('window', { timeout: 15_000 }),
      win.getByTestId('cog-menu-about').click(),
    ]);
    about.on('pageerror', (e) => errors.push(String(e)));
    // Close immediately — the in-flight getThirdParty() result is dropped by the `active` guard
    // (FR-016); no "setState on unmounted" or navigation error is raised.
    await about.close();
    await win.waitForTimeout(300);
  });
  expect(errors, `renderer errors on early close:\n${errors.join('\n')}`).toEqual([]);
});
