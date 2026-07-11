import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp, stubFolderDialog } from './harness.js';

/**
 * US2 (007 Phase B): the Settings tab edits every control type from a visual form
 * and applies each valid change immediately (write → live), refuses invalid
 * values, and tolerates a malformed settings.json.
 */

const cfgRoots: string[] = [];
function freshCfgRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-settings-'));
  cfgRoots.push(dir);
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
});

function readSettings(cfgRoot: string): Record<string, any> | null {
  try {
    return JSON.parse(readFileSync(join(cfgRoot, 'settings.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** Open the preferences window on the Settings tab and return its Page. */
async function openSettings(app: ElectronApplication, win: Page): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId('cog-menu-settings').click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  await expect(prefs.getByTestId('settings-tab')).toBeVisible();
  return prefs;
}

test('edits toggle / select / number / array controls and applies + persists each', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openSettings(app, win);

      // Toggle: editor.autoSave false → true.
      await prefs.getByTestId('control-editor.autoSave').click();
      await expect
        .poll(() => readSettings(cfgRoot)?.editor?.autoSave)
        .toBe(true);
      // Reflects live: the checkbox stays checked after the round-trip.
      await expect(prefs.getByTestId('control-editor.autoSave')).toBeChecked();

      // Select (enum): confirmations.destroyProject double → none.
      await prefs.getByTestId('control-confirmations.destroyProject').selectOption('none');
      await expect
        .poll(() => readSettings(cfgRoot)?.confirmations?.destroyProject)
        .toBe('none');

      // Number: behaviour.submenuHoverMs 100 → 250 (Enter commits).
      const num = prefs.getByTestId('control-behaviour.submenuHoverMs');
      await num.fill('250');
      await num.press('Enter');
      await expect
        .poll(() => readSettings(cfgRoot)?.behaviour?.submenuHoverMs)
        .toBe(250);

      // Array (string): add an explorer.excludeGlobs entry.
      const before = readSettings(cfgRoot)?.explorer?.excludeGlobs?.length ?? 0;
      await prefs.getByTestId('control-explorer.excludeGlobs-add').click();
      const newIdx = before;
      await prefs.getByTestId(`control-explorer.excludeGlobs-item-${newIdx}`).fill('**/dist');
      await expect
        .poll(() => readSettings(cfgRoot)?.explorer?.excludeGlobs)
        .toContain('**/dist');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

/** Rows currently rendered by the Settings form (non-matching rows are unmounted). */
const rowCount = (prefs: Page, key: string): Promise<number> =>
  prefs.getByTestId(`setting-${key}`).count();

test('the Override start folder renders the shared folder picker (browse + typing) (011 FR-042/042a)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openSettings(app, win);

      // The override-path setting is NOT a bare text box: it renders the shared folder
      // picker — an editable path input PLUS a themeable browse control that opens the
      // OS dialog on demand (settings variant never auto-pops).
      const input = prefs.getByTestId('control-newProject.overridePath');
      const browse = prefs.getByTestId('control-newProject.overridePath-browse');
      await expect(input).toBeVisible();
      await expect(browse).toBeVisible();

      // Browsing writes the picked folder immediately.
      await stubFolderDialog(app, 'C:/picked/override');
      await browse.click();
      await expect
        .poll(() => readSettings(cfgRoot)?.newProject?.overridePath)
        .toBe('C:/picked/override');

      // Typing/pasting a path also persists (commit on blur).
      await input.fill('C:/typed/override');
      await input.blur();
      await expect
        .poll(() => readSettings(cfgRoot)?.newProject?.overridePath)
        .toBe('C:/typed/override');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('enum dropdowns show machine tokens in Title Case; stored value is unchanged (011 polish)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openSettings(app, win);

      // The New Project starting-folder enum: each token renders EXACTLY Title-cased
      // (option text) while its stored value stays the machine token (option value).
      const start = prefs.getByTestId('control-newProject.startingFolder');
      await expect(start.locator('option[value="lastViewed"]')).toHaveText('Last Viewed');
      await expect(start.locator('option[value="override"]')).toHaveText('Override');
      await expect(start.locator('option[value="profile"]')).toHaveText('Profile');
      // …and the DEFAULT is Last Viewed.
      await expect(start).toHaveValue('lastViewed');

      // Line-ending abbreviations keep their casing (LF/CRLF/CR, never "Lf"/"Crlf").
      const le = prefs.getByTestId('control-editor.defaultLineEnding');
      await expect(le.locator('option[value="crlf"]')).toHaveText('CRLF');
      await expect(le.locator('option[value="lf"]')).toHaveText('LF');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('the settings search filters by name, description and value (FR-049)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openSettings(app, win);
      const search = prefs.getByTestId('settings-search');

      // It sits at the top of the Settings section, above the first group.
      await expect(search).toBeVisible();
      const searchBox = await search.boundingBox();
      const firstGroup = await prefs.getByTestId('settings-group-Appearance').boundingBox();
      expect(searchBox!.y).toBeLessThan(firstGroup!.y);

      // Matches a NAME (label/key): only the Theme row survives; other groups vanish.
      await search.fill('theme');
      await expect(prefs.getByTestId('setting-appearance.theme')).toBeVisible();
      await expect.poll(() => rowCount(prefs, 'behaviour.tabHoverActivateMs')).toBe(0);
      await expect(prefs.getByTestId('settings-group-Confirmations')).toHaveCount(0);

      // Matches a DESCRIPTION word ('Dwell time (ms) hovering a tab…').
      await search.fill('dwell');
      await expect(prefs.getByTestId('setting-behaviour.tabHoverActivateMs')).toBeVisible();
      await expect.poll(() => rowCount(prefs, 'appearance.theme')).toBe(0);

      // Matches a VALUE (tabHoverActivateMs defaults to 600).
      await search.fill('600');
      await expect(prefs.getByTestId('setting-behaviour.tabHoverActivateMs')).toBeVisible();
      await expect.poll(() => rowCount(prefs, 'appearance.theme')).toBe(0);

      // ANY typed word matches (OR), so several words WIDEN the results.
      await search.fill('theme globs');
      await expect(prefs.getByTestId('setting-appearance.theme')).toBeVisible();
      await expect(prefs.getByTestId('setting-explorer.excludeGlobs')).toBeVisible();

      // No match → an empty state, no groups.
      await search.fill('nosuchsettinganywhere');
      await expect(prefs.getByTestId('settings-search-empty')).toBeVisible();
      await expect(prefs.getByTestId('settings-group-Appearance')).toHaveCount(0);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('the settings search is debounced and has a reset (X) button (FR-049)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openSettings(app, win);
      const search = prefs.getByTestId('settings-search');

      // The reset button only appears once there is something to reset.
      await expect(prefs.getByTestId('settings-search-clear')).toHaveCount(0);

      // Debounce: type, then read the DOM in the SAME task. React flushes the
      // controlled input synchronously for a discrete event, so the text is
      // already there — while the filter, being debounced, provably has not run.
      const immediate = await prefs.evaluate(() => {
        const input = document.querySelector('[data-testid="settings-search"]') as HTMLInputElement;
        const setValue = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value',
        )!.set!;
        setValue.call(input, 'theme');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return {
          typed: input.value,
          unmatchedStillRendered: Boolean(
            document.querySelector('[data-testid="setting-behaviour.tabHoverActivateMs"]'),
          ),
        };
      });
      expect(immediate.typed).toBe('theme'); // typing is never laggy
      expect(immediate.unmatchedStillRendered).toBe(true); // …but the filter waited

      // Once the debounce quiets, the filter applies.
      await expect.poll(() => rowCount(prefs, 'behaviour.tabHoverActivateMs')).toBe(0);

      // The reset (X) button clears the query and restores every row at once.
      const clear = prefs.getByTestId('settings-search-clear');
      await expect(clear).toBeVisible();
      await clear.click();
      await expect(search).toHaveValue('');
      await expect(prefs.getByTestId('setting-behaviour.tabHoverActivateMs')).toBeVisible();
      await expect(prefs.getByTestId('setting-appearance.theme')).toBeVisible();
      await expect(clear).toHaveCount(0); // hidden again when empty
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('an invalid number is not applied and is surfaced; last valid value stays', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openSettings(app, win);
      const num = prefs.getByTestId('control-behaviour.tabHoverActivateMs');
      await num.fill('not-a-number');
      await num.press('Enter');
      // Invalidity surfaced; the file keeps the default (600), not applied.
      await expect(prefs.getByTestId('control-behaviour.tabHoverActivateMs-invalid')).toBeVisible();
      expect(readSettings(cfgRoot)?.behaviour?.tabHoverActivateMs).toBe(600);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('a malformed settings.json opens the defaults-merged form without crashing (FR-043)', async () => {
  const cfgRoot = freshCfgRoot();
  // Seed a malformed file before launch.
  writeFileSync(join(cfgRoot, 'settings.json'), '{ this is : not valid json ', 'utf8');
  await runApp(
    async (app, win) => {
      const prefs = await openSettings(app, win);
      // The form renders (defaults-merged) — a known control is present and shows a default.
      await expect(prefs.getByTestId('control-confirmations.destroyProject')).toBeVisible();
      await expect(prefs.getByTestId('control-confirmations.destroyProject')).toHaveValue('double');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
