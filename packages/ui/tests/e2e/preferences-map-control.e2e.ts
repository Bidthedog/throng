import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp, cleanupTemp} from './harness.js';

/**
 * The keyed-table control (016, F5/FR-022/FR-022c · T076).
 *
 * Two maps, and they must behave DIFFERENTLY on reset — which is the whole point of declaring
 * clearability honestly:
 *
 *   • `editor.languageByExtension` ships EMPTY and is clearable. Clearing it leaves it empty.
 *   • `editor.indentByLanguage` ships POPULATED and is NOT clearable. Resetting it REPOPULATES it —
 *     because an empty per-language indentation map does not "turn the feature off", it silently
 *     indents Go with spaces.
 */
const cfgRoots: string[] = [];
function freshCfgRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-map-'));
  cfgRoots.push(dir);
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0)) {
    cleanupTemp(dir);
  }
});

function readSettings(cfgRoot: string): any {
  try {
    return JSON.parse(readFileSync(join(cfgRoot, 'settings.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function openPrefs(app: ElectronApplication, win: Page): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId('cog-menu-settings').click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  await expect(prefs.getByTestId('settings-tab')).toBeVisible();
  return prefs;
}

test('both maps render as keyed tables — not as “[object Object]” in a text box', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win);

      // The failure this guards against is not a crash: a `map` descriptor with no case in the
      // control dispatch falls through to the DEFAULT arm and renders as a text field showing
      // "[object Object]". Valid descriptor, valid control, nonsense on screen.
      await expect(prefs.getByTestId('control-editor.indentByLanguage')).toBeVisible();
      await expect(prefs.getByTestId('control-editor.languageByExtension')).toBeVisible();

      // The indentation map ships POPULATED, from the language registry.
      await expect(prefs.getByTestId('map-row-editor.indentByLanguage-go')).toBeVisible();
      await expect(
        prefs.getByTestId('map-cell-editor.indentByLanguage-go-style'),
      ).toHaveValue('tabs');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('a row can be added, and a duplicate or invalid key is REFUSED with a reason', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win);

      // An extension must look like an extension. Rejected with a REASON — "invalid" with no reason
      // is a dead end for a user who cannot see what the rule is.
      await prefs.getByTestId('map-new-key-editor.languageByExtension').fill('foo');
      await prefs.getByTestId('map-add-editor.languageByExtension').click();
      await expect(prefs.getByTestId('map-error-editor.languageByExtension')).toContainText('dot');

      // …and a valid one is accepted and persisted.
      await prefs.getByTestId('map-new-key-editor.languageByExtension').fill('.foo');
      await prefs.getByTestId('map-add-editor.languageByExtension').click();
      await expect(prefs.getByTestId('map-row-editor.languageByExtension-.foo')).toBeVisible();
      await expect
        .poll(() => Object.keys(readSettings(cfgRoot)?.editor?.languageByExtension ?? {}))
        .toContain('.foo');

      /*
       * A successful add CLEARS the new-key input, and that clear is asynchronous. Typing the
       * duplicate before it arrives means the clear wipes what was just typed, the click then adds
       * an empty key, and no duplicate is ever attempted — so the error below never appears and the
       * failure reads as "the product stopped refusing duplicates". Measured: 1 in 12 under eight
       * CPU hogs. Waiting for the field to be empty is waiting for the add to have fully settled.
       */
      await expect(prefs.getByTestId('map-new-key-editor.languageByExtension')).toHaveValue('');
      // A duplicate is refused — two rows claiming one extension have no defined winner.
      await prefs.getByTestId('map-new-key-editor.languageByExtension').fill('.foo');
      await prefs.getByTestId('map-add-editor.languageByExtension').click();
      await expect(prefs.getByTestId('map-error-editor.languageByExtension')).toContainText(
        'already mapped',
      );
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('a row can be removed, and the removal STICKS — an empty map means empty (FR-022c)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win);

      await prefs.getByTestId('map-new-key-editor.languageByExtension').fill('.bar');
      await prefs.getByTestId('map-add-editor.languageByExtension').click();
      await expect
        .poll(() => Object.keys(readSettings(cfgRoot)?.editor?.languageByExtension ?? {}))
        .toContain('.bar');

      await prefs.getByTestId('map-remove-editor.languageByExtension-.bar').click();

      // The whole of FR-022c: a map that fell back to its shipped value whenever it was empty could
      // never be cleared — the user deletes the row, saves, and watches it come straight back.
      await expect
        .poll(() => readSettings(cfgRoot)?.editor?.languageByExtension)
        .toEqual({});
      await expect(prefs.getByTestId('map-row-editor.languageByExtension-.bar')).toHaveCount(0);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('reset CLEARS the extension map and REPOPULATES the indentation map', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win);

      // Add an extension mapping, and remove a language's indentation.
      await prefs.getByTestId('map-new-key-editor.languageByExtension').fill('.zig');
      await prefs.getByTestId('map-add-editor.languageByExtension').click();
      await prefs.getByTestId('map-remove-editor.indentByLanguage-go').click();
      /*
       * Wait for BOTH edits to have been written before resetting.
       *
       * Polling only for the `go` removal proves one of the two writes landed, not both. The adds
       * are debounced, so a reset issued in the gap is followed by the still-pending `.zig` write —
       * which lands AFTER the shipped defaults and puts the mapping back. The assertion below then
       * reports `{".zig": "csharp"}` where it expected `{}`, blaming reset for a write that
       * overtook it. Measured once in a full-suite run under six CPU hogs.
       */
      await expect
        .poll(() => {
          const e = readSettings(cfgRoot)?.editor;
          return `${e?.languageByExtension?.['.zig'] !== undefined},${e?.indentByLanguage?.go === undefined}`;
        })
        .toBe('true,true');

      // Reset the tab.
      await prefs.getByTestId('prefs-reset-current').click();
      await expect(prefs.getByTestId('prefs-reset-confirm')).toBeVisible();
      await prefs.getByTestId('prefs-reset-confirm-yes').click();

      // The extension map goes back to EMPTY — its shipped state.
      await expect.poll(() => readSettings(cfgRoot)?.editor?.languageByExtension ?? {}).toEqual({});
      // …and the indentation map comes BACK, because empty is not a valid state for it: it would
      // silently indent Go with spaces.
      await expect
        .poll(() => readSettings(cfgRoot)?.editor?.indentByLanguage?.go?.style)
        .toBe('tabs');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

/**
 * The keyed-map table is a table of LANGUAGES, not of internal identifiers (016, FR-022).
 *
 * It used to head the column "Key" and print the raw registry id in it — so the per-language
 * indentation table read `csharp`, `cpp`, `powershell`, which is not what any of those languages is
 * called. And adding a row meant TYPING one of those ids from memory into a free-text box that
 * accepted anything: get it wrong and you had silently mapped a language that does not exist.
 */
test('the language map names its key column, shows real language names, and offers a picker', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win);
      const table = prefs.getByTestId('control-editor.indentByLanguage');

      // The column says what a key IS.
      await expect(table.locator('th').first()).toHaveText('Language');

      // …and a row is labelled the way the language is actually spelled.
      await expect(prefs.getByTestId('map-row-editor.indentByLanguage-csharp')).toContainText('C#');
      await expect(prefs.getByTestId('map-row-editor.indentByLanguage-cpp')).toContainText('C++');
      await expect(
        prefs.getByTestId('map-row-editor.indentByLanguage-powershell'),
      ).toContainText('PowerShell');
      // The internal id must not be what the user reads.
      await expect(prefs.getByTestId('map-row-editor.indentByLanguage-csharp')).not.toContainText(
        'csharp',
      );

      // Adding a row is a CHOICE from the known languages, not a typed identifier.
      const picker = prefs.getByTestId('map-new-key-editor.indentByLanguage');
      await expect(picker).toHaveJSProperty('tagName', 'SELECT');

      // …and it offers only what is NOT already in the table. A language that already has a row
      // cannot be added twice, so it is not offered — the duplicate is prevented rather than
      // refused after the fact.
      const offered = await picker.locator('option').allTextContents();
      expect(offered).not.toContain('SQL'); // …already mapped
      expect(offered).toContain('Ruby'); // …not mapped

      await picker.selectOption({ label: 'Ruby' });
      await prefs.getByTestId('map-add-editor.indentByLanguage').click();

      await expect(prefs.getByTestId('map-row-editor.indentByLanguage-ruby')).toContainText('Ruby');
      await expect
        .poll(() => readSettings(cfgRoot)?.editor?.indentByLanguage?.ruby)
        .toBeDefined();
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

/*
 * REMOVED for v1.0.0: the map TEXT-column test that drove `terminals.defaultShellArguments` (019, C14 —
 * T040). That setting is one of the three terminal-flavour controls HIDDEN pending #67's proper
 * implementation in vNext (see `SETTINGS_INTERNAL_KEYS`), so it no longer renders a control — its
 * descriptor is withheld from the rendered registry. This test asserted the control was VISIBLE and
 * typeable, which is the exact opposite of the intended v1.0.0 behaviour, and it cannot be inverted
 * in place because `terminals.defaultShellArguments` was the only map with a `control: 'text'` column — the
 * MapCell text arm now has no visible consumer, exactly as intended. The arm itself stays in
 * `map-control.tsx` (dormant), and this coverage returns with #67 in vNext. The two EDITOR maps
 * (`editor.indentByLanguage`, `editor.languageByExtension`) remain visible and fully tested above.
 */
