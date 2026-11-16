import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { DEFAULT_ICON_SET } from '@throng/core';
import { openApp, settle, cleanupTemp, type OpenApp } from './harness.js';
import { closePrefsWindow } from './helpers/prefs-window.js';
import { writeConfigAtomic } from './helpers/config-write.js';

/**
 * Spec 069 US4: a user icon set made in Preferences, overridden there, edited on disk outside throng
 * and reloaded, re-skins the MAIN window live.
 *
 * Layer: e2e — two real windows (Preferences and main), a real folder the test writes into as the user
 * would, and the reload broadcast reaching the other window. The service's create/override/reload on a
 * real directory is `integration/icon-set-service.test.ts`; the picker, buttons and Replace prompt are
 * `component/icon-section.test.ts`; which markup a key draws is `core/tests/unit/resolve-icon.test.ts`.
 * None of them can show a file the user replaced reaching a window that never asked for it.
 *
 * Also claims the rendered colour: an override with `stroke="currentColor"` draws in the theme's colour,
 * not black, which needs real style resolution.
 */
const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-cfg-icon-sets-'));
let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp({ env: { THRONG_CONFIG_ROOT: cfgRoot } });
});

test.afterAll(async () => {
  await closePrefsWindow(shared.app);
  await shared?.close();
  cleanupTemp(cfgRoot);
});

/** A drawing no shipped icon uses, so finding it in the main window can only mean the override arrived. */
const MARKER = 'M4 4h16v16H4z';
const MINE = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="${MARKER}"/></svg>\n`;

test('a set made and overridden in Preferences, edited on disk and reloaded, re-skins the main window live', { tag: ['@extended', '@prefs', '@reserve:window'] }, async () => {
  const { app, win } = shared;
  await settle(win);
  const cog = win.getByTestId('title-bar-cog');
  await expect(cog.locator('svg')).toHaveCount(1);

  await cog.click();
  const [prefs] = await Promise.all([app.waitForEvent('window'), win.getByTestId('cog-menu-themes').click()]);
  await prefs.waitForLoadState('domcontentloaded');
  await expect(prefs.getByTestId('themes-tab')).toBeVisible();

  // A fresh install offers only the default set, and it is selected.
  const select = prefs.getByTestId('icon-set-select');
  await expect(select).toHaveValue('throng');

  // New set from the default set: empty, and selected for the theme.
  await prefs.getByTestId('icon-set-copy').click();
  await prefs.getByTestId('icon-set-name-input').fill('Mine');
  await prefs.getByTestId('icon-set-name-confirm').click();
  await expect(select).toHaveValue('Mine');
  await expect(prefs.getByTestId('icon-cell-status-settings')).toHaveText('Default');

  // Override this icon copies the default art in as settings.svg.
  const file = join(cfgRoot, 'icon-packs', 'Mine', 'settings.svg');
  await prefs.getByTestId('icon-override-settings').click();
  await expect.poll(() => existsSync(file)).toBe(true);
  expect(readFileSync(file, 'utf8').trim()).toBe(DEFAULT_ICON_SET.settings);
  await expect(prefs.getByTestId('icon-cell-status-settings')).toHaveText('Overridden');

  // The user replaces the file outside throng; nothing changes until Reload the icon sets from disk.
  writeConfigAtomic(file, MINE);
  await prefs.getByTestId('icon-set-reload').click();

  // The MAIN window draws the user's art, with no restart and no reopened window.
  const path = cog.locator(`svg path[d="${MARKER}"]`);
  await expect(path).toHaveCount(1);
  expect((await cog.innerText()).trim()).toBe('');

  // currentColor resolves against the page: the icon takes the theme's colour, never a fixed black.
  const [stroke, colour] = await cog.locator('svg').evaluate((el) => [getComputedStyle(el).stroke, getComputedStyle(el).color]);
  expect(stroke).toBe(colour);
  expect(stroke).not.toBe('rgb(0, 0, 0)');
});
