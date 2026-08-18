import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { openApp, runApp as runOwnApp, settle, stubFolderDialog, cleanupTemp, type AppOptions, type OpenApp } from './harness.js';
import {
  configRootSeeded,
  settleConfigRoot,
  snapshotConfigRoot,
  type ConfigRootSnapshot,
} from './helpers/config-snapshot.js';
import { closePrefsWindow } from './helpers/prefs-window.js';
import { writeSettingsAtomic } from './helpers/config-write.js';

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
/*
 * ONE app for this file, not one per test (034 FR-045, SC-010).
 *
 * Seven of the nine tests seeded nothing; they edit controls and read settings.json back, which is a
 * change to the CONTENTS of a config root and is exactly what `restoreConfigRoot` undoes. One seeded a
 * stale `explorer.openMode` key, and the key is dropped by the tolerant PARSE — which runs on every
 * read, not only at startup — so it writes it into the running root instead.
 *
 * The ninth keeps its own app, and says why where it stands.
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

test('edits toggle / select / number / array controls and applies + persists each', { tag: ['@extended', '@prefs'] }, async () => {
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

      // 024 US1 — the three new booleans (default On) toggle to false and persist, grouped by surface.
      for (const key of ['editor.defaultWordWrap', 'editor.showStatusBar', 'terminals.showStatusBar']) {
        await expect(prefs.getByTestId(`control-${key}`)).toBeChecked();
        await prefs.getByTestId(`control-${key}`).click();
      }
      await expect.poll(() => readSettings(cfgRoot)?.editor?.defaultWordWrap).toBe(false);
      await expect.poll(() => readSettings(cfgRoot)?.editor?.showStatusBar).toBe(false);
      await expect.poll(() => readSettings(cfgRoot)?.terminals?.showStatusBar).toBe(false);

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
  );
});

/** Rows currently rendered by the Settings form (non-matching rows are unmounted). */
const rowCount = (prefs: Page, key: string): Promise<number> =>
  prefs.getByTestId(`setting-${key}`).count();

test('the Override start folder renders the shared folder picker (browse + typing) (011 FR-042/042a)', { tag: ['@extended', '@prefs'] }, async () => {
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
  );
});

/*
 * MOVED to `packages/ui/tests/component/preferences-enum-labels.test.ts` (034 FR-045):
 *   “enum dropdowns show machine tokens in Title Case; stored value is unchanged (011 polish)”.
 *
 * It launched Electron and opened a second window through the cog menu in order to read the text
 * and the `value` attribute of five `<option>` elements. It wrote nothing, read no file and made
 * no claim about layout: `humanizeOptionLabel` deciding what a `<select>` renders is the whole of
 * it.
 *
 * SEVEN TESTS REPLACE IT, and four of the claims are new:
 *   - `cr` is asserted. It was the third member of the same override table and the one the naive
 *     Title-Caser mangles most quietly — “Cr” is a plausible-looking word, so it would have
 *     shipped.
 *   - “Stored value is unchanged” is now a SWEEP over every static enum in the registry: the
 *     option values are the descriptor’s `allowedValues` verbatim, in order, nothing added. A
 *     display-side change leaking into a stored value would have to survive all of them.
 *   - No option anywhere is shown to the user as a raw camelCase token.
 *   - The E2E never selected anything. Choosing “Override” is now asserted to commit `override`,
 *     which is the display-only claim itself rather than a proxy for it.
 *   - The default is read from `buildShippedDefaults()`, not from whatever the running app had
 *     written into its config root.
 *
 * WHAT DID NOT MOVE: that a selection reaches `settings.json` — “edits toggle / select / number /
 * array controls and applies + persists each” drives the same control through the real write path
 * and stays.
 *
 * Red-proved, two mutations: skipping the abbreviation override table (1 red — and the camelCase
 * sweep stays GREEN, which is why the abbreviations need their own assertion), and labelling an
 * option with its raw token (4 red, while the option-VALUES sweep and the commit test stay green).
 *
 * ANTI-VACUITY CONTROL: in `form-controls.tsx`, change `SelectControl`’s
 * `data-testid={testId(descriptor.key)}` to anything else — all 7 fail on `getByTestId`.
 */

test('the settings search box is wired to the filter, and empties the form when nothing matches (FR-049)', { tag: ['@extended', '@prefs'] }, async () => {
  await runApp(
    async (app, win) => {
      const prefs = await openSettings(app, win);
      const search = prefs.getByTestId('settings-search');

      // It sits at the top of the Settings section, above the first group.
      await expect(search).toBeVisible();
      const searchBox = await search.boundingBox();
      const firstGroup = await prefs.getByTestId('settings-group-Appearance').boundingBox();
      expect(searchBox!.y).toBeLessThan(firstGroup!.y);

      /*
       * ONE query, not five (034 FR-045).
       *
       * This used to type five: a name, a description word, a value, two words for the OR, and a
       * miss. WHAT each of those matches on is `filterFields`, and `filterFields` is a pure
       * function over the settings registry with twenty-three cases against it in
       * `packages/core/tests/unit/settings-search.test.ts` — including the description-only word,
       * the value, the OR, and the section names that used to have a whole test of their own here.
       *
       * What no unit test can see is that the BOX is wired to it: that typing narrows the rendered
       * form and empties the groups that no longer have rows. That is one keystroke's worth of
       * evidence, and it is what is left.
       */
      await search.fill('theme');
      await expect(prefs.getByTestId('setting-appearance.theme')).toBeVisible();
      await expect.poll(() => rowCount(prefs, 'behaviour.tabHoverActivateMs')).toBe(0);
      // A group with no surviving rows goes with them, rather than staying as an empty heading.
      await expect(prefs.getByTestId('settings-group-Confirmations')).toHaveCount(0);

      // No match → an empty state, no groups.
      await search.fill('nosuchsettinganywhere');
      await expect(prefs.getByTestId('settings-search-empty')).toBeVisible();
      await expect(prefs.getByTestId('settings-group-Appearance')).toHaveCount(0);
    },
  );
});

/*
 * DELETED (034 FR-045): "the settings search matches a section (group) name, including nested
 * sub-groups (021)".
 *
 * Every claim it made is proved directly, on the registry, in
 * `packages/core/tests/unit/settings-search.test.ts`: the group is in the haystack; a field matches
 * by its section name when its own name does not contain the query; a group name returns every field
 * of that section INCLUDING nested sub-groups; section matches union with name matches without
 * duplicates; a group-less field is unaffected. Five cases, no app.
 *
 * The one thing it added — that the search box is connected to that function at all — is asserted
 * once, above, and adding it a second time with different words does not make it truer.
 */
/*
 * MOVED to `packages/ui/tests/component/preferences-settings-search.test.ts` (034 FR-045):
 *   “the settings search is debounced and has a reset (X) button (FR-049)”.
 *
 * It launched Electron and opened a second window to assert four things about React state: the X
 * appears only once there is something to clear, typing updates the field before the filter has
 * run, the filter applies once the debounce quiets, and the X restores every row. `SettingsTab`
 * holds two pieces of state — `query` (instant) and `applied` (debounced) — and that is all of it.
 *
 * SIX TESTS REPLACE IT, and the two that matter most were not previously provable:
 *   - The E2E proved the debounce by RACING it: write through the native setter, read the DOM in
 *     the same task, and trust that 150ms had not elapsed. That is a timing assumption dressed as
 *     an assertion, and on a loaded machine it goes quiet rather than red. The clock is fake now
 *     and advanced by hand.
 *   - The E2E polled after pressing the X, so it could not distinguish a reset that applies AT
 *     ONCE from one routed through the same debounce. `clearSearch` calls `applySearch.cancel()`
 *     precisely so it is the former; the replacement asserts the rows are back WITHOUT advancing
 *     the clock, and separately that a keystroke still in flight does not land afterwards and
 *     re-filter a form the user has just emptied.
 *
 * WHAT DID NOT MOVE: WHICH settings a query matches is `filterFields`, a pure function with
 * twenty-three cases in `packages/core/tests/unit/settings-search.test.ts`. And the test above
 * this one stays whole — its first assertion compares the search box’s bounding box against the
 * first group’s, which is real layout and has no meaning in jsdom (FR-049).
 *
 * Red-proved, four mutations: filtering on every keystroke (1 red), `clearSearch` not cancelling
 * the in-flight keystroke (1 red), the reset routed through the debounce (1 red), and the box
 * disconnected from the filter entirely (3 red).
 *
 * ANTI-VACUITY CONTROL: delete `ResetNoticeProvider` from the replacement’s `mount()`.
 * `useResetNotice` throws rather than defaulting, so `SettingsTab` cannot render — all 6 fail
 * before an assertion runs.
 */

/**
 * 019 US5 / #95 (C1, C2, FR-021/FR-023/FR-024): open-on-click has exactly one owner,
 * and it lives where users look for it.
 *
 * The pure guard (`packages/core/tests/unit/settings-open-on-click-single-owner.test.ts`)
 * can see that only one claimant is DECLARED; it cannot see DISCOVERABILITY, which is the
 * whole of C2 — the surviving control keeps the key `editor.openOnClick` (no rename, no
 * migration of a setting that works) and moves to the File Explorer group, where the inert
 * `explorer.openMode` used to sit.
 */
test('open-on-click is one control, in the File Explorer group, offering none (#95, C2)', { tag: ['@extended', '@prefs'] }, async () => {
  await runApp(
    async (app, win) => {
      const prefs = await openSettings(app, win);

      // The surviving control sits in File Explorer — where the inert one used to be —
      // labelled "Open files with", the label the user already knew.
      const row = prefs.getByTestId('setting-editor.openOnClick');
      await expect(row).toBeVisible();
      await expect(row.locator('.settings-row__label')).toHaveText('Open files with');
      await expect(
        prefs.getByTestId('settings-group-File Explorer').getByTestId('setting-editor.openOnClick'),
      ).toHaveCount(1);

      // FR-021: no SECOND control claims the job — anywhere in Preferences.
      await expect(prefs.getByTestId('setting-explorer.openMode')).toHaveCount(0);
      await expect(prefs.getByTestId('control-explorer.openMode')).toHaveCount(0);

      // FR-024 / C2: `none` is retained by the survivor and becomes visible for the
      // first time — the inert control never offered it.
      const control = prefs.getByTestId('control-editor.openOnClick');
      await expect(control.locator('option[value="none"]')).toHaveCount(1);
      await expect(control.locator('option[value="single"]')).toHaveCount(1);
      await expect(control.locator('option[value="double"]')).toHaveCount(1);

      // …and it still works where it always did.
      await control.selectOption('none');
      await expect.poll(() => readSettings(cfgRoot)?.editor?.openOnClick).toBe('none');
    },
  );
});

test('a hand-written explorer.openMode changes nothing, warns nothing, and is stripped (#95, C1)', { tag: ['@extended', '@prefs'] }, async () => {
  await runApp(
    async (app, win) => {
      // A user who set the inert control before the fix. FR-023: it is DROPPED, not migrated —
      // it never had any effect, so dropping preserves exactly the behaviour they have today
      // (single click), while migrating would change it. Written into the RUNNING root: the key is
      // dropped by the tolerant PARSE, which runs on every read, so nothing here needs a launch.
      writeSettingsAtomic(cfgRoot, { version: 1, explorer: { openMode: 'double', deleteMode: 'permanent' } });
      const warnings: string[] = [];
      const prefs = await openSettings(app, win);
      prefs.on('console', (m) => {
        if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text());
      });

      // Changes nothing: the working setting keeps its default (single), untouched by a
      // stale key that claimed to mean 'double'.
      await expect(prefs.getByTestId('control-editor.openOnClick')).toHaveValue('single');
      // …while the neighbours in the same file are honoured as always.
      await expect(prefs.getByTestId('control-explorer.deleteMode')).toHaveValue('permanent');

      // Warns nothing: an unknown key is ignored in silence, as the tolerant parse
      // already does for every other unknown key.
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();
      expect(warnings.filter((w) => /openMode/i.test(w))).toEqual([]);

      // Stripped on the next write: no migration step, no rewrite pass — the key simply
      // does not survive a parse, so the first ordinary write drops it.
      await prefs.getByTestId('control-editor.openOnClick').selectOption('double');
      await expect.poll(() => readSettings(cfgRoot)?.editor?.openOnClick).toBe('double');
      expect(readSettings(cfgRoot)?.explorer?.openMode).toBeUndefined();
      expect(readSettings(cfgRoot)?.explorer?.deleteMode).toBe('permanent');
    },
  );
});

test('an invalid number is not applied and is surfaced; last valid value stays', { tag: ['@extended', '@prefs'] }, async () => {
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
  );
});

test('a malformed settings.json opens the defaults-merged form without crashing (FR-043)', { tag: ['@extended', '@prefs'] }, async () => {
  /*
   * ITS OWN APP (034 FR-045). The claim is that the application STARTS on a broken settings file —
   * which is the whole of FR-043 — so producing the malformed document after startup would prove
   * something else entirely, however similar the assertions looked.
   */
  const ownCfgRoot = freshCfgRoot();
  // Seed a malformed file before launch.
  writeFileSync(join(ownCfgRoot, 'settings.json'), '{ this is : not valid json ', 'utf8');
  await runOwnApp(
    async (app, win) => {
      const prefs = await openSettings(app, win);
      // The form renders (defaults-merged) — a known control is present and shows a default.
      await expect(prefs.getByTestId('control-confirmations.destroyProject')).toBeVisible();
      await expect(prefs.getByTestId('control-confirmations.destroyProject')).toHaveValue('double');
    },
    { env: { THRONG_CONFIG_ROOT: ownCfgRoot } },
  );
});
