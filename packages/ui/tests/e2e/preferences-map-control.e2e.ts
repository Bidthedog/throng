import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { FILE_OP_TIMEOUT_MS, openApp, settle, cleanupTemp, type AppOptions, type OpenApp } from './harness.js';
import {
  configRootSeeded,
  settleConfigRoot,
  snapshotConfigRoot,
  type ConfigRootSnapshot,
} from './helpers/config-snapshot.js';
import { closePrefsWindow } from './helpers/prefs-window.js';

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
/*
 * ONE app for this file, not one per test (034 FR-045, SC-010).
 *
 * All three tests seeded nothing. Each adds or removes a map row and reads settings.json back —
 * writes to the CONTENTS of a config root, which `restoreConfigRoot` undoes. That matters more here
 * than elsewhere: the middle test asserts that the extension map is EMPTY after a reset, which is
 * only true if the previous test's `.bar` entry has gone.
 *
 * The shim below REFUSES launch options rather than ignoring them: a swallowed config root does not
 * fail, it makes a test pass for the wrong reason.
 *
 * Serial mode is not optional. These tests share a window, a config root and the ONE preferences
 * window throng allows, so they must not interleave — and when one fails the rest are SKIPPED rather
 * than run against whatever state the failure left behind (see `openApp` in harness.ts).
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
let cfgRoot: string;
let baseline: ConfigRootSnapshot;

test.beforeAll(async () => {
  cfgRoot = freshCfgRoot();
  shared = await openApp({ env: { THRONG_CONFIG_ROOT: cfgRoot } });
  await settle(shared.win);
  // Photograph the root only once first-run seeding has finished — settings, key bindings and every
  // shipped theme. A partial snapshot would have every later restore DELETE whatever arrived late.
  await expect.poll(() => configRootSeeded(cfgRoot), { timeout: 30_000 }).toBe(true);
  baseline = snapshotConfigRoot(cfgRoot);
});

/*
 * Put the config root back between tests — with the preferences window CLOSED FIRST.
 *
 * The order is load-bearing twice over. A dirty JSON buffer raises `json-external-change` when the
 * file changes underneath it, so restoring against an open window would hand the next test a notice
 * it never asked for. And the on-entry snapshot that Revert and Revert All compare against is
 * captured when the preferences window MOUNTS (`preferences-app.tsx`), so carrying one window across
 * tests would carry the first test's baseline into the last one.
 */
test.afterEach(async () => {
  await closePrefsWindow(shared.app);
  await settleConfigRoot(baseline);
});

test.afterAll(async () => {
  await shared?.close();
  for (const dir of cfgRoots.splice(0)) cleanupTemp(dir);
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win']) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win);
};

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

/*
 * MOVED to `packages/ui/tests/component/preferences-map-control.test.ts` (034 FR-045):
 *   - "both maps render as keyed tables — not as “[object Object]” in a text box"
 *   - "a row can be added, and a duplicate or invalid key is REFUSED with a reason"
 *
 * Both are about what the control RENDERS and what it refuses. The defect the first one guards
 * — a `map` descriptor falling through to the default arm and rendering as a text field full of
 * "[object Object]" — throws nothing and fails no type check; only looking at it reveals it,
 * which is what a DOM does. The second is `validateKey`, which is exported and pure, plus the
 * control showing its message.
 *
 * The add case also asserted that the new key reached settings.json. That half is not lost: the
 * removal test below adds a row, watches it reach the file, and then removes it — so the write
 * path keeps a witness, and FR-022c (an empty map means empty, rather than falling back to the
 * shipped value) keeps the end-to-end test it actually needs.
 */
test('a row can be removed, and the removal STICKS — an empty map means empty (FR-022c)', { tag: ['@extended', '@prefs'] }, async () => {
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
  );
});

test('reset CLEARS the extension map and REPOPULATES the indentation map', { tag: ['@extended', '@prefs'] }, async () => {
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
      await expect.poll(() => readSettings(cfgRoot)?.editor?.languageByExtension ?? {}, { timeout: FILE_OP_TIMEOUT_MS }).toEqual({});
      // …and the indentation map comes BACK, because empty is not a valid state for it: it would
      // silently indent Go with spaces.
      await expect
        .poll(() => readSettings(cfgRoot)?.editor?.indentByLanguage?.go?.style)
        .toBe('tabs');
    },
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
/*
 * ONE TEST REMOVED (035 T055) — "the language map names its key column, shows real language names,
 * and offers a picker", now `packages/ui/tests/component/preferences-map-control.test.ts`.
 *
 * It opened a preferences window to read a `<th>`.
 *
 * All three claims are `keyKind: 'language'` changing what `MapControl` renders: the key column's
 * label, how a key is DISPLAYED (`C#`, not `csharp` — not a name anybody writes), and whether a new
 * key is typed or CHOSEN from a filtered list. The component file already drove the other variant,
 * `editor.languageByExtension`, whose keys the user types; this one was covered nowhere.
 *
 * The descriptor there is the SHIPPED one, pulled from `SETTINGS_METADATA` rather than written by
 * hand, so "the column says Language" is a claim about what users see and not about a literal the
 * test chose — a fixture would pass happily after someone relabelled the real setting.
 *
 * Red-proven: raw-id-shown, no-column-label, unfiltered-picker — one red each.
 *
 * The two tests that stay assert config-store writes reaching `settings.json` and a reset
 * repopulating the map. Those are the store's, not the control's.
 */

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
