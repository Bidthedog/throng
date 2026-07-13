import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp } from './harness.js';

/**
 * Issue #76 — per-token Reset and Revert on the Themes tab.
 *
 * The Themes tab used to decline reset/revert wholesale (015 FR-013, on the grounds that 014's
 * per-theme "Restore to default" already writes the theme file). #76 supersedes that for individual
 * tokens: a per-token reset is a DIFFERENT write scope (one token vs the whole theme) and takes the
 * editor's own token-write path, so it does not reintroduce the duplicate-write hazard FR-013
 * guarded against. Reset restores the SHIPPED value; Revert restores the value the window OPENED
 * with; both match Settings and Key Bindings.
 */
const cfgRoots: string[] = [];
function freshCfgRoot(seedThemes: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-thmreset-'));
  cfgRoots.push(dir);
  for (const [name, theme] of Object.entries(seedThemes)) {
    mkdirSync(join(dir, 'themes'), { recursive: true });
    writeFileSync(join(dir, 'themes', `${name}.json`), JSON.stringify(theme, null, 2), 'utf8');
  }
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

async function openThemes(app: ElectronApplication, win: Page): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId('cog-menu-themes').click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  await expect(prefs.getByTestId('themes-tab')).toBeVisible();
  return prefs;
}

const KEY = 'colours.accent';
const control = (prefs: Page) => prefs.getByTestId(`control-${KEY}-hex`);
const reset = (prefs: Page) => prefs.getByTestId(`theme-reset-${KEY}`);
const revert = (prefs: Page) => prefs.getByTestId(`theme-revert-${KEY}`);

test('Reset returns a built-in theme token to its shipped value (#76)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win); // a built-in (throng) is active by default
      const shipped = await control(prefs).inputValue();
      expect(shipped).toMatch(/^#/);

      // Unedited: at its shipped value, so Reset does not apply (it is present but disabled).
      await expect(reset(prefs)).toBeDisabled();

      // Edit the token → now it is overridden, so Reset lights up.
      await control(prefs).fill('#abcdef');
      await expect(reset(prefs)).toBeEnabled();

      // Reset → back to the shipped value, and Reset goes quiet again.
      await reset(prefs).click();
      await expect(control(prefs)).toHaveValue(shipped);
      await expect(reset(prefs)).toBeDisabled();
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('Revert returns a token to the value the window opened with (#76)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      const onEntry = await control(prefs).inputValue();

      // Nothing changed yet → Revert does not apply.
      await expect(revert(prefs)).toBeDisabled();

      await control(prefs).fill('#0f0f0f');
      await expect(revert(prefs)).toBeEnabled();

      // Revert → back to the on-entry value, and Revert goes quiet.
      await revert(prefs).click();
      await expect(control(prefs)).toHaveValue(onEntry);
      await expect(revert(prefs)).toBeDisabled();
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('a CUSTOM theme declines Reset (no shipped baseline) but still offers Revert (#76)', async () => {
  // A custom/cloned theme has no factory value to return to, so Reset is DECLINED — absent, not
  // merely disabled. Revert still applies: the on-entry value exists for any theme.
  const cfgRoot = freshCfgRoot({
    MyCustom: {
      name: 'MyCustom',
      colours: { accent: '#00ff41' },
      fonts: { family: 'Consolas', baseSizePx: 13, weights: { normal: 400, bold: 600 } },
      icons: {},
    },
  });
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      await expect
        .poll(() => prefs.getByTestId('theme-select').locator('option').count())
        .toBeGreaterThan(14);
      await prefs.getByTestId('theme-select').selectOption('MyCustom');
      await expect(prefs.getByTestId('theme-select')).toHaveValue('MyCustom');

      // Reset is DECLINED for a custom theme — the button is not rendered at all.
      await expect(reset(prefs)).toHaveCount(0);
      // Revert is still present (disabled until something changes).
      await expect(revert(prefs)).toBeVisible();

      // And it works: edit, then revert restores the value the custom theme opened with.
      const onEntry = await control(prefs).inputValue();
      await control(prefs).fill('#123456');
      await expect(revert(prefs)).toBeEnabled();
      await revert(prefs).click();
      await expect(control(prefs)).toHaveValue(onEntry);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
