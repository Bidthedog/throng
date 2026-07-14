import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp } from './harness.js';

/**
 * The Themes tab — feature 007's base editor (activate, token edits apply + persist,
 * delete) plus feature 014's restore & create controls:
 *  - Restore All (010 FR-008) behind a confirmation;
 *  - per-theme restore-to-shipped (confirmed); a DELETED built-in leaves the list entirely and
 *    is recovered only by Restore All;
 *  - Clone as the sole creation path, via a modal name dialog prefilled
 *    "<source> - Clone" with "Clone" pre-selected, enforcing 010's reserved
 *    built-in-name set (even for a DELETED built-in);
 *  - rename through that same dialog (007's in-place field is gone).
 * The picker is a compact dropdown + one action bar acting on the SELECTED theme, with Restore All
 * set apart (it acts on every built-in). Actions announce failures only — no success banner.
 */
const cfgRoots: string[] = [];
function freshCfgRoot(seedThemes: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-themes-'));
  cfgRoots.push(dir);
  const themesDir = join(dir, 'themes');
  mkdirSync(themesDir, { recursive: true });
  for (const [name, theme] of Object.entries(seedThemes)) {
    writeFileSync(join(themesDir, `${name}.json`), JSON.stringify(theme, null, 2), 'utf8');
  }
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
});

function readTheme(cfgRoot: string, name: string): any {
  try {
    return JSON.parse(readFileSync(join(cfgRoot, 'themes', `${name}.json`), 'utf8'));
  } catch {
    return null;
  }
}
function readActiveTheme(cfgRoot: string): string | null {
  try {
    return JSON.parse(readFileSync(join(cfgRoot, 'settings.json'), 'utf8')).appearance?.theme ?? null;
  } catch {
    return null;
  }
}

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

/** The shipped set is seeded on first run: 15 options (throng + 14). */
async function waitForSeededList(prefs: Page): Promise<void> {
  await expect.poll(() => prefs.getByTestId('theme-select').locator('option').count()).toBe(15);
}

/**
 * Select a theme and wait for the selection to LAND.
 *
 * Selecting activates, and activation round-trips through the config watcher. The dropdown (and the
 * toolbar that acts on it, and the token editor below) all follow the *active* theme, so they stay
 * coherent — but that means an action fired in the same tick as `selectOption` would still target
 * the previously-active theme. Waiting for the dropdown to show the new name is exactly the
 * "activation has landed" signal.
 */
async function pickTheme(prefs: Page, name: string): Promise<void> {
  await prefs.getByTestId('theme-select').selectOption(name);
  await expect(prefs.getByTestId('theme-select')).toHaveValue(name);
}

test('editing a colour token applies to the active theme file and reflects live', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      await prefs.getByTestId('control-colours.accent-hex').fill('#123456');
      await expect.poll(() => readTheme(cfgRoot, 'throng')?.colours?.accent).toBe('#123456');
      // Live: the prefs window repaints from the active theme.
      await expect
        .poll(() =>
          prefs.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--throng-colour-accent').trim(),
          ),
        )
        .toBe('#123456');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('selecting a theme in the dropdown activates it (select = activate)', async () => {
  const cfgRoot = freshCfgRoot({
    CustomOne: { name: 'CustomOne', colours: { accent: '#00ff41' }, fonts: { family: 'Consolas', baseSizePx: 13, weights: { normal: 400, bold: 600 } }, icons: {} },
  });
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      await pickTheme(prefs, 'CustomOne');
      await expect.poll(() => readActiveTheme(cfgRoot)).toBe('CustomOne');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('the rename dialog refuses a reserved built-in name and writes nothing', async () => {
  const cfgRoot = freshCfgRoot({
    CustomOne: { name: 'CustomOne', colours: {}, fonts: { family: 'x', baseSizePx: 13, weights: { normal: 400, bold: 600 } }, icons: {} },
  });
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      // `CustomOne` is a CUSTOM theme (its name does not collide with any built-in, even
      // case-insensitively), so it carries the rename control.
      await pickTheme(prefs, 'CustomOne');
      await prefs.getByTestId('theme-rename').click();
      await expect(prefs.getByTestId('theme-name-dialog')).toBeVisible();
      await prefs.getByTestId('theme-name-input').fill('throng');
      await expect(prefs.getByTestId('theme-name-error')).toBeVisible();
      await expect(prefs.getByTestId('theme-name-confirm')).toBeDisabled();
      // Nothing written: both files still as they were.
      expect(existsSync(join(cfgRoot, 'themes', 'throng.json'))).toBe(true);
      expect(existsSync(join(cfgRoot, 'themes', 'CustomOne.json'))).toBe(true);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('deleting a theme requires a single confirm and removes the file', async () => {
  const cfgRoot = freshCfgRoot({
    CustomOne: { name: 'CustomOne', colours: {}, fonts: { family: 'x', baseSizePx: 13, weights: { normal: 400, bold: 600 } }, icons: {} },
  });
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      await pickTheme(prefs, 'CustomOne');
      await prefs.getByTestId('theme-delete').click();
      await expect(prefs.getByTestId('theme-delete-confirm')).toBeVisible();
      await prefs.getByTestId('theme-confirm-yes').click();
      await expect.poll(() => existsSync(join(cfgRoot, 'themes', 'CustomOne.json'))).toBe(false);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('the font control is a pill editor saving a comma stack; a non-family role exposes it (H4)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      // paneTitle does NOT pin a family in the default theme, yet now exposes the
      // font control (T106).
      const key = 'typography.paneTitle.family';
      const control = prefs.getByTestId(`control-${key}`);
      await expect(control).toBeVisible();

      // Click opens a dropdown; type to filter, then pick two families → two pills.
      await control.click();
      await control.fill('Arial');
      await prefs.getByTestId(`control-${key}-option-Arial`).click();
      await expect(prefs.getByTestId(`control-${key}-pill-0`)).toContainText('Arial');
      await control.fill('Georgia');
      await prefs.getByTestId(`control-${key}-option-Georgia`).click();
      await expect(prefs.getByTestId(`control-${key}-pill-1`)).toContainText('Georgia');

      // Saved to the theme file as a comma-separated stack.
      await expect
        .poll(() => readTheme(cfgRoot, 'throng')?.typography?.paneTitle?.family)
        .toBe('Arial, Georgia');

      // Deleting the first pill updates the saved stack.
      await prefs.getByTestId(`control-${key}-remove-0`).click();
      await expect
        .poll(() => readTheme(cfgRoot, 'throng')?.typography?.paneTitle?.family)
        .toBe('Georgia');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('an existing comma stack loads back as ordered pills (H4, FR-038b)', async () => {
  const cfgRoot = freshCfgRoot({
    stacky: {
      name: 'stacky',
      colours: {},
      fonts: { family: "'Segoe UI', system-ui, sans-serif", baseSizePx: 13, weights: { normal: 400, bold: 600 } },
      icons: {},
    },
  });
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      await pickTheme(prefs, 'stacky');
      const key = 'fonts.family';
      await expect(prefs.getByTestId(`control-${key}-pill-0`)).toContainText('Segoe UI');
      await expect(prefs.getByTestId(`control-${key}-pill-1`)).toContainText('system-ui');
      await expect(prefs.getByTestId(`control-${key}-pill-2`)).toContainText('sans-serif');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('button colour + font tokens appear in the editor and apply live to buttons (H5, FR-046a)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      // The four button colour tokens are exposed as colour controls; the button
      // typography role exposes the (pill) font control.
      await expect(prefs.getByTestId('control-colours.buttonBg-hex')).toBeVisible();
      await expect(prefs.getByTestId('control-colours.buttonHoverBg-hex')).toBeVisible();
      await expect(prefs.getByTestId('control-typography.button.family')).toBeVisible();

      // Edit buttonBg → saved + reflected in the live CSS var + a real button.
      await prefs.getByTestId('control-colours.buttonBg-hex').fill('#123456');
      await expect.poll(() => readTheme(cfgRoot, 'throng')?.colours?.buttonBg).toBe('#123456');
      await expect
        .poll(() =>
          prefs.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--throng-colour-buttonBg').trim(),
          ),
        )
        .toBe('#123456');
      // A real .prefs-toolbtn now renders with the button background.
      await expect
        .poll(() => prefs.getByTestId('prefs-mode-toggle').evaluate((el) => getComputedStyle(el).backgroundColor))
        .toBe('rgb(18, 52, 86)');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

/* ---------------------------------------------------------------------------
 * Feature 014 — restore & create controls
 * ------------------------------------------------------------------------- */

test('US1: Restore All resets edited built-ins, recreates a deleted built-in, and leaves customs untouched', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      await waitForSeededList(prefs);

      // 1. Edit a built-in (the active theme, throng).
      await prefs.getByTestId('control-colours.accent-hex').fill('#123456');
      await expect.poll(() => readTheme(cfgRoot, 'throng')?.colours?.accent).toBe('#123456');

      // 2. Create a custom theme by cloning a built-in (Clone activates the new theme).
      await pickTheme(prefs, 'Matrix');
      await prefs.getByTestId('theme-clone').click();
      await prefs.getByTestId('theme-name-input').fill('MyCustom');
      await prefs.getByTestId('theme-name-confirm').click();
      await expect.poll(() => existsSync(join(cfgRoot, 'themes', 'MyCustom.json'))).toBe(true);
      const customBefore = readFileSync(join(cfgRoot, 'themes', 'MyCustom.json'), 'utf8');

      // 3. Delete a built-in — it disappears from the list entirely (FR-005a).
      await pickTheme(prefs, 'Debian');
      await prefs.getByTestId('theme-delete').click();
      await expect(prefs.getByTestId('theme-delete-confirm')).toBeVisible();
      await prefs.getByTestId('theme-confirm-yes').click();
      await expect.poll(() => existsSync(join(cfgRoot, 'themes', 'Debian.json'))).toBe(false);
      await expect.poll(() => prefs.getByTestId('theme-select').locator('option').allTextContents()).not.toContain('Debian');

      // 4. Restore All — confirmed, because it destroys edits to built-ins (FR-004).
      await prefs.getByTestId('theme-restore-all').click();
      await expect(prefs.getByTestId('theme-confirm-dialog')).toBeVisible();
      await prefs.getByTestId('theme-confirm-yes').click();

      // Edited built-in reverted; deleted built-in recreated; custom byte-identical.
      await expect.poll(() => readTheme(cfgRoot, 'throng')?.colours?.accent).not.toBe('#123456');
      await expect.poll(() => existsSync(join(cfgRoot, 'themes', 'Debian.json'))).toBe(true);
      expect(readFileSync(join(cfgRoot, 'themes', 'MyCustom.json'), 'utf8')).toBe(customBefore);

    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('US2: per-theme restore reverts only that built-in (confirmed); a deleted built-in leaves the list and only Restore All brings it back', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      await waitForSeededList(prefs);

      // Edit two built-ins: throng (active by default) and Matrix.
      await prefs.getByTestId('control-colours.accent-hex').fill('#111111');
      await expect.poll(() => readTheme(cfgRoot, 'throng')?.colours?.accent).toBe('#111111');
      await pickTheme(prefs, 'Matrix');
      await prefs.getByTestId('control-colours.accent-hex').fill('#222222');
      await expect.poll(() => readTheme(cfgRoot, 'Matrix')?.colours?.accent).toBe('#222222');

      // Restore ONLY Matrix (destructive to its edits → confirmed).
      await pickTheme(prefs, 'Matrix');
      await prefs.getByTestId('theme-restore').click();
      await expect(prefs.getByTestId('theme-confirm-dialog')).toBeVisible();
      await prefs.getByTestId('theme-confirm-yes').click();
      await expect.poll(() => readTheme(cfgRoot, 'Matrix')?.colours?.accent).not.toBe('#222222');
      // The other built-in's edit is untouched.
      expect(readTheme(cfgRoot, 'throng')?.colours?.accent).toBe('#111111');

      // Deleting a built-in removes it from the list ENTIRELY (FR-005a) — there is no per-theme
      // recreate control; Restore All is the only way back.
      await pickTheme(prefs, 'Debian');
      await prefs.getByTestId('theme-delete').click();
      await expect(prefs.getByTestId('theme-delete-confirm')).toBeVisible();
      await prefs.getByTestId('theme-confirm-yes').click();
      await expect.poll(() => existsSync(join(cfgRoot, 'themes', 'Debian.json'))).toBe(false);
      await expect
        .poll(() => prefs.getByTestId('theme-select').locator('option').allTextContents())
        .not.toContain('Debian');
      await expect(prefs.getByTestId('theme-recreate')).toHaveCount(0);

      await prefs.getByTestId('theme-restore-all').click();
      await expect(prefs.getByTestId('theme-confirm-dialog')).toBeVisible();
      await prefs.getByTestId('theme-confirm-yes').click();
      await expect.poll(() => existsSync(join(cfgRoot, 'themes', 'Debian.json'))).toBe(true);
      await expect
        .poll(() => prefs.getByTestId('theme-select').locator('option').allTextContents())
        .toContain('Debian');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('US3: Clone is the sole creation path — prefilled "<source> - Clone" with "Clone" pre-selected; rename uses the same dialog', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      await waitForSeededList(prefs);

      await pickTheme(prefs, 'throng');
      await prefs.getByTestId('theme-clone').click();
      const input = prefs.getByTestId('theme-name-input');
      await expect(prefs.getByTestId('theme-name-dialog')).toBeVisible();
      await expect(input).toHaveValue('throng - Clone');
      // The trailing word "Clone" is pre-selected so the user types straight over it.
      expect(
        await input.evaluate((el) => {
          const i = el as HTMLInputElement;
          return i.value.slice(i.selectionStart ?? 0, i.selectionEnd ?? 0);
        }),
      ).toBe('Clone');

      // A reserved built-in name is refused (and cannot be confirmed).
      await input.fill('Matrix');
      await expect(prefs.getByTestId('theme-name-error')).toBeVisible();
      await expect(prefs.getByTestId('theme-name-confirm')).toBeDisabled();

      // ...in ANY case: a theme name is a FILE name, and `MATRIX.json` IS `Matrix.json` on
      // Windows, so a case-only difference would silently overwrite the built-in.
      await input.fill('MATRIX');
      await expect(prefs.getByTestId('theme-name-error')).toBeVisible();
      await expect(prefs.getByTestId('theme-name-confirm')).toBeDisabled();

      // A valid name creates the custom theme (a copy of the source) and activates it.
      await input.fill('MyTheme');
      await prefs.getByTestId('theme-name-confirm').click();
      await expect.poll(() => existsSync(join(cfgRoot, 'themes', 'MyTheme.json'))).toBe(true);
      await expect.poll(() => readActiveTheme(cfgRoot)).toBe('MyTheme');
      await expect.poll(() => prefs.getByTestId('theme-select').locator('option').allTextContents()).toContain('MyTheme');
      // It is a copy of the source, retargeted to the new name.
      expect(readTheme(cfgRoot, 'MyTheme')?.name).toBe('MyTheme');

      // Rename it through the SAME dialog (007's in-place field is gone).
      await pickTheme(prefs, 'MyTheme');
      await prefs.getByTestId('theme-rename').click();
      await prefs.getByTestId('theme-name-input').fill('Renamed');
      await prefs.getByTestId('theme-name-confirm').click();
      await expect.poll(() => existsSync(join(cfgRoot, 'themes', 'Renamed.json'))).toBe(true);
      await expect.poll(() => existsSync(join(cfgRoot, 'themes', 'MyTheme.json'))).toBe(false);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('US3: a DELETED built-in name is still reserved for a new theme (FR-007)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      await waitForSeededList(prefs);

      // Delete a built-in — its name stays reserved even though it is gone from disk.
      await pickTheme(prefs, 'Debian');
      await prefs.getByTestId('theme-delete').click();
      await expect(prefs.getByTestId('theme-delete-confirm')).toBeVisible();
      await prefs.getByTestId('theme-confirm-yes').click();
      await expect.poll(() => prefs.getByTestId('theme-select').locator('option').allTextContents()).not.toContain('Debian');

      await pickTheme(prefs, 'throng');
      await prefs.getByTestId('theme-clone').click();
      await prefs.getByTestId('theme-name-input').fill('Debian');
      await expect(prefs.getByTestId('theme-name-error')).toBeVisible();
      await expect(prefs.getByTestId('theme-name-confirm')).toBeDisabled();
      // Nothing was created.
      expect(existsSync(join(cfgRoot, 'themes', 'Debian.json'))).toBe(false);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
