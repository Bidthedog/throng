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
import { writeSettingsAtomic } from './helpers/config-write.js';

/**
 * Feature 015, FR-015 – FR-018: the per-item affordance gutter and the three actions in it.
 *
 * The behaviour that matters here is the one a green unit suite cannot see: that reset and revert
 * are genuinely different controls. A user who opens the window with a setting ALREADY overridden
 * and then edits it must be able to get *their* value back, not the factory one — so revert has to
 * restore the on-entry value even when that value is itself an override.
 */
const cfgRoots: string[] = [];

/** The isolated config root the shared app runs against. */
function freshCfgRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-rowact-'));
  cfgRoots.push(dir);
  return dir;
}

/*
 * ONE app for this file, not one per test (034 FR-045, SC-010).
 *
 * Seven of the nine tests seeded nothing at all. The two that did — an `autoSaveDebounceMs` already
 * overridden to 900 — needed that override in place before the WINDOW opened, not before the process
 * started: the value revert owes the user back is the one `preferences-app.tsx` photographs when the
 * window mounts. They now write it into the running root instead, atomically.
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

/*
 * MOVED to `packages/ui/tests/component/preferences-row-actions.test.ts` (034 FR-045):
 *   - "all three actions are always present, and the control never moves (FR-015, SC-016)"
 *
 * A statement about GEOMETRY — that a disabled action is shown and greyed rather than hidden,
 * so the row's control cannot slide out from under the pointer at the moment the user touches
 * it. Which is a DOM fact, and needed no application to read.
 */

/*
 * MOVED (034 FR-045) — four tests, to two new component files.
 *
 * To `packages/ui/tests/component/preferences-themes-tab.test.ts`:
 *   - "the Themes tab has a typeahead over its token rows"
 *   - "the icon section takes part in the Themes search, and is not exempt from it"
 *   - "the theme font stack can be emptied outright and re-populated"
 * To `packages/ui/tests/component/preferences-keybindings-tab.test.ts`:
 *   - "the Key Bindings typeahead narrows by name AND by chord"
 *
 * All four opened a SECOND Electron window through the cog menu in order to type into a search
 * box, or click one button, and then count what was left on screen. None of them read a file.
 * `ThemesTab` takes no props and `KeybindingsTab` takes one optional number; both read contexts
 * whose DEFAULTS are the shipped settings, the shipped theme and the shipped key bindings — so a
 * render already holds the state these claims are about.
 *
 * WHAT THE REPLACEMENTS SAY MORE STRONGLY:
 *   - the key-bindings typeahead is asserted against a mutation that empties the CHORD out of the
 *     search haystack. That reddens the by-chord test and leaves the by-name ones green, which is
 *     the exact coupling `settings-search.test.ts` structurally cannot see — it proves the pure
 *     function, not which value this tab feeds it.
 *   - the icon-section claim is asserted against `filter={null}`, so "the section ignores the
 *     search" reddens directly rather than being inferred from a count.
 *   - the font stack runs through the REAL write-then-adopt round trip (`write-config.ts` ->
 *     `config-store.tsx`), with only the process boundary stubbed. Rendered bare, `ThemesTab` is
 *     controlled and nothing on screen would change — which is why a test that merely mounted it
 *     would have passed while the Clear did nothing at all.
 *
 * WHAT DID NOT MOVE, and why:
 *   - "groups tokens by app area, General first and Icons last" reads `boundingBox().y`. jsdom
 *     has no layout — 034 FR-049 and the v5.1.0 real-layout reserve.
 *   - "a built-in theme row offers all three actions" also switches TABS and makes the same claim
 *     about a Settings row. Its themes half is covered; a partial replacement is not a
 *     replacement (FR-047).
 *   - the revert/reset pair turns on which BASELINE a row reads — the shipped record, or the
 *     snapshot `preferences-app.tsx` takes when the WINDOW mounts — and asserts settings.json.
 *   - "clear unbinds an action entirely, and reset brings the chords back" resets through
 *     `window.throng.config.resetBinding`, a main-process IPC, and reads keybindings.json. Its
 *     rendering half IS asserted in the component file, because a tab that wrote `[]` and went on
 *     drawing the old pills would satisfy every file assertion here.
 *
 * ANTI-VACUITY CONTROL, run and failing: aliasing `ResetNoticeProvider` (resp. `ConfirmProvider`)
 * to `Fragment` in each component file withholds a provider whose hook THROWS, so the tab cannot
 * render — 12 and 11 failures respectively. Six of the new assertions are about something being
 * ABSENT after a search, and every one of those passes in a tree that rendered nothing.
 */

/*
 * ── TWO MOVED (035 T055) ──
 *
 * `packages/ui/tests/component/preferences-app.test.ts`, "the row action gutter":
 *
 *   :207  a built-in theme row offers all three actions, like Settings (#76)
 *   :269  reset leaves a revert behind — a reset is itself undoable (FR-016, SC-017)
 *
 * The second is the one that protects the user's work. A reset writes the SHIPPED value over
 * whatever they had; if that were the end of it, one mis-click destroys an override with no way
 * home, and the row looks entirely correct while it does. So a reset must leave a revert behind, and
 * that revert must give back the value the WINDOW OPENED WITH rather than the shipped default it
 * just wrote — which is why reset and revert are two controls and not one glyph with clever wording.
 *
 * Six tests now walk the whole cycle: overridden-and-untouched (reset only), edited (both), reset
 * applied (reset now disabled, revert offered), reverted (back to the first row). Every step is
 * renderer state over a config store.
 *
 * ── THE STUB WAS MISSING TWO THINGS, AND BOTH FAILED SILENTLY ──
 *
 * Worth recording, because both are the shape this spec keeps finding. `writePatch` accepted the
 * patch and re-emitted nothing — exactly the failure that file's own harness comment warns about for
 * `write`, sitting unnoticed beside it because no test had ever driven a patched write. And a RESET
 * does not use either: it has its own `config.resetSetting` channel, deliberately, because it
 * restores the shipped value from feature 010's record rather than any value the renderer computed
 * (FR-011b, `settings-tab.tsx:390`). With no stub for it the reset resolved `undefined`, changed
 * nothing, and the row went on reporting itself overridden.
 *
 * ── WHAT STAYS ──
 *
 * `:227` (revert restores the value the window opened with) keeps its launch: it reads
 * `settings.json` back off disk after every step, which is the only thing that proves the writes
 * land in the right shape and order. The component test proves the row's STATE; that one proves the
 * document.
 */
test('the Themes tab groups tokens by app area, General first and Icons last (021, FR-003a/FR-004)', { tag: ['@extended', '@prefs', '@reserve:layout'] }, async () => {
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

      /*
       * The SEARCH half of this test is gone (034 FR-045).
       *
       * It typed an area name and checked that every token in that area came back — including the
       * syntax colours, whose own names contain no "editor". That is `filterFields`, the same
       * function behind all three tabs' typeaheads, and its section-name behaviour is proved on the
       * registry in `packages/core/tests/unit/settings-search.test.ts` — a group name returning every
       * field of its section INCLUDING nested sub-groups, unioned with name matches, without
       * duplicates. That the Themes typeahead is WIRED to it is asserted at the component
       * layer, in `packages/ui/tests/component/preferences-themes-tab.test.ts`.
       *
       * What is left is the half no lower layer can see: where the groups actually sit on screen.
       */
    },
  );
});

test('revert restores the value the window OPENED with, not the shipped default (FR-016, SC-017)', { tag: ['@extended', '@prefs', '@reserve:window'] }, async () => {
  // The user arrives with autoSaveDebounceMs already overridden to 900. That override is their
  // starting point, and it is what revert owes them back.
  // `version` matters: feature 010's startup seeding rewrites a document it cannot version, and
  // the override would be gone before the window ever opened.
  await runApp(
    async (app, win) => {
      /*
       * The override goes into the RUNNING app's config root rather than being seeded before launch.
       * What revert owes the user back is the value the WINDOW opened with, and that snapshot is
       * captured when the preferences window mounts — so a write that lands before the window opens
       * is the same starting point. `version: 1` still matters: 010's seeding rewrites a document it
       * cannot version, and the override would be gone before the window ever opened.
       */
      writeSettingsAtomic(cfgRoot, { version: 1, editor: { autoSaveDebounceMs: 900 } });
      const prefs = await openPrefs(app, win, 'settings');
      const input = prefs.getByTestId('control-editor.autoSaveDebounceMs');
      await expect(input).toHaveValue('900');

      // On entry it is overridden but UNCHANGED, so reset is offered and revert is not.
      await expect(prefs.getByTestId('setting-reset-editor.autoSaveDebounceMs')).toBeEnabled();
      await expect(prefs.getByTestId('setting-revert-editor.autoSaveDebounceMs')).toBeDisabled();

      // Edit it this session → now it is BOTH overridden and changed, so both are offered.
      await input.fill('1500');
      await input.blur();
      await expect.poll(() => readJson(cfgRoot, 'settings.json')?.editor?.autoSaveDebounceMs, { timeout: FILE_OP_TIMEOUT_MS }).toBe(1500);
      await expect(prefs.getByTestId('setting-revert-editor.autoSaveDebounceMs')).toBeEnabled();
      await expect(prefs.getByTestId('setting-reset-editor.autoSaveDebounceMs')).toBeEnabled();

      // Revert → back to 900, the value they arrived with. NOT the shipped default.
      await prefs.getByTestId('setting-revert-editor.autoSaveDebounceMs').click();
      await expect.poll(() => readJson(cfgRoot, 'settings.json')?.editor?.autoSaveDebounceMs, { timeout: FILE_OP_TIMEOUT_MS }).toBe(900);
      await expect(input).toHaveValue('900');

      // Nothing left to revert; still overridden, so the reset stays.
      await expect(prefs.getByTestId('setting-revert-editor.autoSaveDebounceMs')).toBeDisabled();
      await expect(prefs.getByTestId('setting-reset-editor.autoSaveDebounceMs')).toBeEnabled();
    },
  );
});

test('clear unbinds an action entirely, and reset brings the chords back (FR-016, SC-018)', { tag: ['@extended', '@prefs', '@reserve:window'] }, async () => {
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'keybindings');
      await expect(prefs.getByTestId('keybindings-tab')).toBeVisible();

      const chord = prefs.getByTestId('binding-zoom.in-chord');
      await expect(chord).not.toContainText('unbound');

      // Every action is clearable — unbound is a valid state for all of them.
      await prefs.getByTestId('binding-clear-zoom.in').click();
      await expect(chord).toContainText('unbound');
      await expect.poll(() => readJson(cfgRoot, 'keybindings.json')?.bindings?.['zoom.in'], { timeout: FILE_OP_TIMEOUT_MS }).toEqual([]);

      // An unbound action offers no clear (it would be a no-op) but IS overridden, so it offers
      // a reset — which restores the FULL shipped chord set, not just one chord.
      await expect(prefs.getByTestId('binding-clear-zoom.in')).toBeDisabled();
      await prefs.getByTestId('binding-reset-zoom.in').click();
      await expect(chord).not.toContainText('unbound');
      await expect
        .poll(() => readJson(cfgRoot, 'keybindings.json')?.bindings?.['zoom.in']?.length)
        .toBeGreaterThan(1); // zoom.in ships with several chords
    },
  );
});
