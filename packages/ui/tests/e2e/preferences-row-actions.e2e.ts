import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp } from './harness.js';

/**
 * Feature 015, FR-015 – FR-018: the per-item affordance gutter and the three actions in it.
 *
 * The behaviour that matters here is the one a green unit suite cannot see: that reset and revert
 * are genuinely different controls. A user who opens the window with a setting ALREADY overridden
 * and then edits it must be able to get *their* value back, not the factory one — so revert has to
 * restore the on-entry value even when that value is itself an override.
 */
const cfgRoots: string[] = [];

/** A config root seeded with settings/keybindings already overridden BEFORE the window opens. */
function freshCfgRoot(seed: { settings?: unknown; keybindings?: unknown } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-rowact-'));
  cfgRoots.push(dir);
  if (seed.settings) writeFileSync(join(dir, 'settings.json'), JSON.stringify(seed.settings, null, 2), 'utf8');
  if (seed.keybindings) writeFileSync(join(dir, 'keybindings.json'), JSON.stringify(seed.keybindings, null, 2), 'utf8');
  return dir;
}

test.afterAll(() => {
  for (const dir of cfgRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

function readJson(cfgRoot: string, file: string): any {
  try {
    return JSON.parse(readFileSync(join(cfgRoot, file), 'utf8'));
  } catch {
    return null;
  }
}

async function openPrefs(
  app: ElectronApplication,
  win: Page,
  tab: 'settings' | 'keybindings' | 'themes',
): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId(`cog-menu-${tab}`).click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  return prefs;
}

test('all three actions are always present, and the control never moves (FR-015, SC-016)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'settings');
      const row = prefs.getByTestId('setting-editor.autoSave');
      await expect(row).toBeVisible();

      const control = row.locator('.settings-row__control');
      const actions = prefs.getByTestId('setting-actions-editor.autoSave');

      // Nothing is overridden, changed or clearable on a pristine row — and yet all THREE
      // actions are on screen, disabled. That is the requirement, not a side-effect: an
      // affordance that comes and goes moves the control, and one the user cannot see until
      // they have already changed something teaches them nothing.
      await expect(actions.locator('button')).toHaveCount(3);
      const reset = prefs.getByTestId('setting-reset-editor.autoSave');
      const revert = prefs.getByTestId('setting-revert-editor.autoSave');
      const clear = prefs.getByTestId('setting-clear-editor.autoSave');
      await expect(reset).toBeDisabled();
      await expect(revert).toBeDisabled();
      await expect(clear).toBeDisabled(); // editor.autoSave is required — never clearable

      // A disabled action says WHY it will not respond (FR-015a).
      await expect(reset).toHaveAttribute('title', /already at its default/i);
      await expect(revert).toHaveAttribute('title', /has not changed/i);

      // The actions sit AFTER the control.
      const controlBefore = await control.boundingBox();
      const actionsBox = await actions.boundingBox();
      expect(actionsBox!.x).toBeGreaterThanOrEqual(controlBefore!.x + controlBefore!.width - 1);

      // Override the setting — reset and revert become live...
      await prefs.getByTestId('control-editor.autoSave').click();
      await expect(reset).toBeEnabled();
      await expect(revert).toBeEnabled(); // it changed this session too
      await expect(clear).toBeDisabled(); // still required

      // ...and the control has NOT moved a pixel, because nothing appeared or vanished.
      const controlAfter = await control.boundingBox();
      expect(controlAfter!.x).toBeCloseTo(controlBefore!.x, 0);
      expect(controlAfter!.width).toBeCloseTo(controlBefore!.width, 0);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('the Themes tab has a typeahead over its token rows (FR-021, SC-024)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'themes');
      const search = prefs.getByTestId('themes-search');
      await expect(search).toBeVisible();

      const terminalBg = prefs.getByTestId('theme-row-colours.terminalBg');
      const editorBg = prefs.getByTestId('theme-row-colours.editorBg');
      await expect(terminalBg).toBeVisible();
      await expect(editorBg).toBeVisible();

      // The Themes tab has several hundred rows and was the only one of the three with no way
      // to find anything in it.
      await search.fill('terminal');
      await expect(terminalBg).toBeVisible();
      await expect(editorBg).toHaveCount(0);

      await search.fill('zzzznothing');
      await expect(prefs.getByTestId('themes-search-empty')).toBeVisible();

      await prefs.getByTestId('themes-search-clear').click();
      await expect(search).toHaveValue('');
      await expect(editorBg).toBeVisible();
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('the Themes tab groups tokens by app area, and search matches a section name (021)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'themes');

      // Tokens render under AREA headings, not one flat "Colours" list (FR-001). General is first and
      // the Icons section is last; a dense area nests an "Editor · Syntax" sub-group (FR-003a/FR-004).
      const general = prefs.getByTestId('settings-group-General');
      const icons = prefs.getByTestId('settings-group-Icons');
      const syntax = prefs.getByTestId('settings-group-Editor · Syntax');
      await expect(general).toBeVisible();
      await expect(syntax).toBeVisible();
      await expect(icons).toBeVisible();
      const gy = await general.boundingBox();
      const iy = await icons.boundingBox();
      expect(gy!.y).toBeLessThan(iy!.y); // General first, Icons last

      // Section-name search: typing an AREA name returns every token in it — including the syntax
      // colours, whose own names contain no "editor" (FR-015/FR-016). Terminal tokens are excluded.
      const search = prefs.getByTestId('themes-search');
      await search.fill('editor');
      await expect(prefs.getByTestId('theme-row-colours.syntaxKeyword')).toBeVisible();
      await expect(prefs.getByTestId('theme-row-colours.editorBg')).toBeVisible();
      await expect(prefs.getByTestId('theme-row-colours.terminalBg')).toHaveCount(0);

      // Name search still works regardless of group (US3/FR-013).
      await search.fill('gutter');
      await expect(prefs.getByTestId('theme-row-colours.editorGutterBg')).toBeVisible();
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('the icon section takes part in the Themes search, and is not exempt from it', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'themes');
      const iconGrid = prefs.getByTestId('icon-grid');
      const iconSection = prefs.getByTestId('settings-group-Icons');
      await expect(iconGrid).toBeVisible();
      const matchAll = await iconGrid.locator('.icon-cell').count(); // the unfiltered grid
      expect(matchAll).toBeGreaterThan(5);

      // A query that matches NO icon and no colour must empty the tab — icons included. The
      // section used to sit outside the filter, so it survived every search and looked like a
      // result. A section that ignores the filter is worse than one with no filter at all.
      await prefs.getByTestId('themes-search').fill('zzzznothing');
      await expect(iconSection).toHaveCount(0);
      await expect(prefs.getByTestId('themes-search-empty')).toBeVisible();

      // A query that matches an icon TOKEN keeps the section, narrowed to the matching cells.
      await prefs.getByTestId('themes-search').fill('destroy');
      await expect(iconSection).toBeVisible();
      await expect(prefs.getByTestId('icon-cell-destroy')).toBeVisible();
      await expect(prefs.getByTestId('icon-cell-rename')).toHaveCount(0);

      // …and it is a REAL result, not the whole grid surviving the filter untouched.
      //
      // Not an exact count: the search matches an icon's description as well as its name, and
      // `dismiss` is described as clearing a message "without destroying anything" — so it
      // legitimately matches "destroy" too. That is the search working, not failing. What the
      // requirement actually says is that the grid NARROWS, so that is what this asserts.
      const shown = await iconGrid.locator('.icon-cell').count();
      expect(shown).toBeGreaterThan(0);
      expect(shown).toBeLessThan(matchAll);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('a built-in theme row offers all three actions, like Settings (issue #76)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'themes');
      // A built-in theme is active by default, so its token rows now carry reset + revert + clear —
      // the Themes tab used to decline reset/revert wholesale (015 FR-013); #76 supersedes that,
      // because a per-token reset is a different write scope from 014's whole-theme restore.
      const themeActions = prefs.getByTestId('theme-actions-colours.editorBg');
      await expect(themeActions).toBeVisible();
      await expect(themeActions.locator('button')).toHaveCount(3);

      // …the same three-slot gutter a Settings row has (the window is reused across tabs).
      await prefs.getByTestId('prefs-tab-settings').click();
      const settingActions = prefs.getByTestId('setting-actions-editor.autoSave');
      await expect(settingActions).toBeVisible();
      await expect(settingActions.locator('button')).toHaveCount(3);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('revert restores the value the window OPENED with, not the shipped default (FR-016, SC-017)', async () => {
  // The user arrives with autoSaveDebounceMs already overridden to 900. That override is their
  // starting point, and it is what revert owes them back.
  // `version` matters: feature 010's startup seeding rewrites a document it cannot version, and
  // the override would be gone before the window ever opened.
  const cfgRoot = freshCfgRoot({ settings: { version: 1, editor: { autoSaveDebounceMs: 900 } } });
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'settings');
      const input = prefs.getByTestId('control-editor.autoSaveDebounceMs');
      await expect(input).toHaveValue('900');

      // On entry it is overridden but UNCHANGED, so reset is offered and revert is not.
      await expect(prefs.getByTestId('setting-reset-editor.autoSaveDebounceMs')).toBeEnabled();
      await expect(prefs.getByTestId('setting-revert-editor.autoSaveDebounceMs')).toBeDisabled();

      // Edit it this session → now it is BOTH overridden and changed, so both are offered.
      await input.fill('1500');
      await input.blur();
      await expect.poll(() => readJson(cfgRoot, 'settings.json')?.editor?.autoSaveDebounceMs).toBe(1500);
      await expect(prefs.getByTestId('setting-revert-editor.autoSaveDebounceMs')).toBeEnabled();
      await expect(prefs.getByTestId('setting-reset-editor.autoSaveDebounceMs')).toBeEnabled();

      // Revert → back to 900, the value they arrived with. NOT the shipped default.
      await prefs.getByTestId('setting-revert-editor.autoSaveDebounceMs').click();
      await expect.poll(() => readJson(cfgRoot, 'settings.json')?.editor?.autoSaveDebounceMs).toBe(900);
      await expect(input).toHaveValue('900');

      // Nothing left to revert; still overridden, so the reset stays.
      await expect(prefs.getByTestId('setting-revert-editor.autoSaveDebounceMs')).toBeDisabled();
      await expect(prefs.getByTestId('setting-reset-editor.autoSaveDebounceMs')).toBeEnabled();
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('reset leaves a revert behind — a reset is itself undoable (FR-016, SC-017)', async () => {
  // `version` matters: feature 010's startup seeding rewrites a document it cannot version, and
  // the override would be gone before the window ever opened.
  const cfgRoot = freshCfgRoot({ settings: { version: 1, editor: { autoSaveDebounceMs: 900 } } });
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'settings');
      await expect(prefs.getByTestId('control-editor.autoSaveDebounceMs')).toHaveValue('900');

      // Reset to the shipped value. That IS a change from where the session started...
      await prefs.getByTestId('setting-reset-editor.autoSaveDebounceMs').click();
      await expect(prefs.getByTestId('setting-reset-editor.autoSaveDebounceMs')).toBeDisabled();

      // ...so the row now offers a revert, and taking it gives the user their 900 back. Without
      // this, a mis-clicked reset would silently destroy an override with no way home.
      const revert = prefs.getByTestId('setting-revert-editor.autoSaveDebounceMs');
      await expect(revert).toBeVisible();
      await revert.click();
      await expect(prefs.getByTestId('control-editor.autoSaveDebounceMs')).toHaveValue('900');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('clear unbinds an action entirely, and reset brings the chords back (FR-016, SC-018)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'keybindings');
      await expect(prefs.getByTestId('keybindings-tab')).toBeVisible();

      const chord = prefs.getByTestId('binding-zoom.in-chord');
      await expect(chord).not.toContainText('unbound');

      // Every action is clearable — unbound is a valid state for all of them.
      await prefs.getByTestId('binding-clear-zoom.in').click();
      await expect(chord).toContainText('unbound');
      await expect.poll(() => readJson(cfgRoot, 'keybindings.json')?.bindings?.['zoom.in']).toEqual([]);

      // An unbound action offers no clear (it would be a no-op) but IS overridden, so it offers
      // a reset — which restores the FULL shipped chord set, not just one chord.
      await expect(prefs.getByTestId('binding-clear-zoom.in')).toBeDisabled();
      await prefs.getByTestId('binding-reset-zoom.in').click();
      await expect(chord).not.toContainText('unbound');
      await expect
        .poll(() => readJson(cfgRoot, 'keybindings.json')?.bindings?.['zoom.in']?.length)
        .toBeGreaterThan(1); // zoom.in ships with several chords
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('the Key Bindings typeahead narrows by name AND by chord (FR-017, SC-019)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'keybindings');
      const search = prefs.getByTestId('keybindings-search');
      await expect(search).toBeVisible();

      const zoomIn = prefs.getByTestId('binding-zoom.in');
      await expect(zoomIn).toBeVisible();

      // By name.
      await search.fill('zoom');
      await expect(zoomIn).toBeVisible();

      // A query matching nothing empties the list and says so.
      await search.fill('zzzznothing');
      await expect(prefs.getByTestId('keybindings-search-empty')).toBeVisible();
      await expect(zoomIn).toHaveCount(0);

      // By CHORD — the thing you actually remember when you want to know what a key does.
      // Best-effort read of the (currently filtered-out) chord: bound it (issue #75). The list is
      // empty here from the 'zzzznothing' query above, so this testid is absent; without a timeout
      // the read auto-waits the whole per-test budget before the .catch — fine at 60s, a 30s
      // timeout at 30s. A short bound keeps it a best-effort read.
      const chords: string[] = (await prefs
        .getByTestId('binding-zoom.in-chord')
        .textContent({ timeout: 2000 })
        .catch(() => '')) as string;
      await prefs.getByTestId('keybindings-search-clear').click();
      await expect(search).toHaveValue('');
      const oneChord = (chords || '').trim().split(/\s+/)[0] ?? 'Ctrl';
      await search.fill(oneChord);
      await expect(zoomIn).toBeVisible();
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('the theme font stack can be emptied outright and re-populated (FR-018, SC-020)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'themes');
      await expect(prefs.getByTestId('themes-tab')).toBeVisible();

      // The font stack ships POPULATED and is still clearable — the value's validity when empty
      // is what makes it clearable, not the shape of its default (FR-016a).
      const clear = prefs.getByTestId('theme-clear-fonts.family');
      await expect(clear).toBeVisible();
      await clear.click();

      // Emptied: no pills left, and the add control survives so a family can be put back.
      await expect(prefs.locator('[data-testid^="control-fonts.family-pill-"]')).toHaveCount(0);
      const input = prefs.getByTestId('control-fonts.family');
      await expect(input).toBeVisible();
      await expect(input).toHaveAttribute('placeholder', 'Add a font family…');

      // An empty stack is a value, not a hole — and clearing it again would be a no-op, so the
      // affordance goes inert. It stays on screen (FR-015): the row's geometry must not change
      // just because the user emptied something.
      await expect(clear).toBeDisabled();

      // Put one back.
      await input.fill('Consolas');
      await input.press('Enter');
      await expect(prefs.getByTestId('control-fonts.family-pill-0')).toBeVisible();
      await expect(prefs.getByTestId('theme-clear-fonts.family')).toBeEnabled();
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
