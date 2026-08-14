/**
 * 031 US3/US4 — the Tabs preferences, and the picker's binding (#225, #227).
 *
 * Three settings and one chord, all of which exist to be CHANGED by a person who never opens a JSON
 * file. contracts/tab-strip.md T6 requires the binding to appear in the Key Bindings editor and be
 * rebindable; the settings side is FR-030/FR-047 plus the bounds declared in
 * `settings-metadata.ts` — which, since #227, are the ONLY statement of those bounds anywhere.
 * There is no second clamp in `app-settings.ts` to fall back on, so a range that is wrong here is
 * wrong everywhere, and that is exactly why it is asserted from the rendered control.
 *
 * This spec drives the preferences WINDOW, so it belongs in the serial tier: a second headed app
 * stealing focus closes menus and dialogs underneath it.
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { runApp, setSlider, cleanupTemp } from './harness.js';

const cfgRoots: string[] = [];
function freshCfgRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-tabsettings-'));
  cfgRoots.push(dir);
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0)) cleanupTemp(dir);
});

function readSettings(cfgRoot: string): { tabs?: Record<string, number> } | undefined {
  const file = join(cfgRoot, 'settings.json');
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8')) as { tabs?: Record<string, number> };
}

function readBindings(cfgRoot: string): Record<string, string[]> | undefined {
  const file = join(cfgRoot, 'keybindings.json');
  if (!existsSync(file)) return undefined;
  return (JSON.parse(readFileSync(file, 'utf8')) as { bindings: Record<string, string[]> }).bindings;
}

async function openPreferences(
  app: ElectronApplication,
  win: Page,
  tab: 'settings' | 'keybindings',
): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId(`cog-menu-${tab}`).click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  await expect(prefs.getByTestId(`${tab}-tab`)).toBeVisible();
  return prefs;
}

/** Dispatch a synthetic chord on the prefs window (never let a reserved combo reach the OS). */
async function sendChord(prefs: Page, key: string): Promise<void> {
  await prefs.evaluate((k) => {
    const init = { key: k, bubbles: true } as KeyboardEventInit;
    window.dispatchEvent(new KeyboardEvent('keydown', init));
    window.dispatchEvent(new KeyboardEvent('keyup', init));
  }, key);
}

/** Every BOUNDED tab setting, with the range and default the metadata declares. */
const TAB_SETTINGS = [
  // US7 (FR-055, FR-056) narrowed the first two ceilings from 3000 and 2000 to 1500: a delay
  // measured in whole seconds was never a preference, and the top half of the range only cost aim
  // across the half a user would actually visit.
  { key: 'tabs.smoothScrollMs', min: '0', max: '1500', step: '50', value: '300' },
  { key: 'tabs.closeArmingDelayMs', min: '0', max: '1500', step: '50', value: '300' },
  { key: 'tabs.maxNameLength', min: '10', max: '128', step: '2', value: '64' },
  // US6 (FR-050, FR-054a). `maxWidth` shares the name limit's range because it shares its UNIT —
  // characters — so the two can be read against each other.
  { key: 'tabs.maxWidth', min: '10', max: '128', step: '2', value: '32' },
  { key: 'tabs.chevronRepeatDelayMs', min: '100', max: '3000', step: '50', value: '350' },
  // US7 (FR-058). The one Tabs slider stepping in 25s — the delay a user tunes rather than sets
  // once, so it wants finer stops than its neighbours. 500 sits on 0 + 25×20.
  { key: 'tabs.popoverDelayMs', min: '0', max: '1500', step: '25', value: '500' },
  /*
   * The one member of this section whose key does NOT start `tabs.` — it moved here from the
   * Behaviour group, where a tab-strip dwell delay sat under a heading that named no surface at
   * all. Only `group` moved: the key is the settings.json contract, and renaming it would discard
   * the value in every existing file.
   *
   * It is in this list precisely BECAUSE the key disagrees with the section. A reader checking
   * "does the Tabs section expose every tab setting" by eye greps for `tabs.` and misses it, which
   * is exactly the kind of gap this loop exists to close.
   */
  { key: 'behaviour.tabHoverActivateMs', min: '0', max: '5000', step: '50', value: '600' },
] as const;

test('T057 — the Tabs section exposes every setting, with their ranges and defaults', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPreferences(app, win, 'settings');

      // ONE section, named for the thing it configures — the same word the Key Bindings editor uses
      // for the picker's chord, so a user hunting for anything about tabs finds one word in both.
      const group = prefs.getByTestId('settings-group-Tabs');
      await expect(group).toBeVisible();

      for (const setting of TAB_SETTINGS) {
        await expect(
          group.getByTestId(`setting-${setting.key}`),
          `${setting.key} is in the Tabs section`,
        ).toHaveCount(1);

        // A bounded numeric renders a slider AND a field. The slider is where the DECLARED range
        // becomes visible: min, max and the step that makes it aimable.
        const slider = prefs.getByTestId(`control-${setting.key}-slider`);
        await expect(slider).toBeVisible();
        await expect(slider).toHaveAttribute('min', setting.min);
        await expect(slider).toHaveAttribute('max', setting.max);
        await expect(slider).toHaveAttribute('step', setting.step);

        // …and the shipped default is what an untouched install shows.
        await expect(prefs.getByTestId(`control-${setting.key}`)).toHaveValue(setting.value);
        await expect(slider).toHaveValue(setting.value);
      }

      // The values on screen are the ones ON DISK: throng writes its shipped defaults out at first
      // run, so "the default" is a fact about the file as well as about the form, and the two must
      // agree before any of the editing tests below mean anything.
      // The new-tab position is the group's one non-numeric: a select, so it declares a SET rather
      // than a range and is checked here rather than in the loop above.
      await expect(group.getByTestId('setting-tabs.newTabPosition')).toHaveCount(1);
      await expect(prefs.getByTestId('control-tabs.newTabPosition')).toHaveValue('afterActive');

      expect(readSettings(cfgRoot)?.tabs).toEqual({
        smoothScrollMs: 300,
        closeArmingDelayMs: 300,
        maxNameLength: 64,
        maxWidth: 32,
        newTabPosition: 'afterActive',
        chevronRepeatDelayMs: 350,
        popoverDelayMs: 500,
      });
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('T057 — each tab setting is editable by slider and by field, and persists', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPreferences(app, win, 'settings');

      // Drag the scroll duration to a value on its step grid.
      await setSlider(prefs.getByTestId('control-tabs.smoothScrollMs-slider'), '1500');
      await expect.poll(() => readSettings(cfgRoot)?.tabs?.smoothScrollMs).toBe(1500);
      // `1,500`, grouped — REVERSED since this test was written. 018 exempted values under five
      // digits, on the reasoning quoted here before: a four-digit millisecond delay rendered with a
      // separator reads as a typo rather than as a kindness. Constitution 4.5.0 drops that floor,
      // because a threshold makes a COLUMN inconsistent — these tab delays sit directly beside
      // values that do cross it, and a separator appearing halfway up a column teaches the reader
      // it means something when it means only that one value grew a digit. The STORED value above
      // is still plain, which is the half that was never in question.
      await expect(prefs.getByTestId('control-tabs.smoothScrollMs')).toHaveValue('1,500');

      // Type the arming delay instead: the field and the slider drive one value.
      const arming = prefs.getByTestId('control-tabs.closeArmingDelayMs');
      await arming.fill('800');
      await arming.press('Enter');
      await expect.poll(() => readSettings(cfgRoot)?.tabs?.closeArmingDelayMs).toBe(800);
      await expect.poll(() => prefs.getByTestId('control-tabs.closeArmingDelayMs-slider').inputValue()).toBe(
        '800',
      );

      // And the name limit, whose step of 2 exists so that 64 stays reachable from a minimum of 10.
      await setSlider(prefs.getByTestId('control-tabs.maxNameLength-slider'), '30');
      await expect.poll(() => readSettings(cfgRoot)?.tabs?.maxNameLength).toBe(30);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('T057 — a value outside a declared range is refused, and the last valid one stands', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPreferences(app, win, 'settings');

      // Establish a known-good value first, so "unchanged" is a value this test put there rather
      // than a default that would have been present either way.
      const field = prefs.getByTestId('control-tabs.smoothScrollMs');
      await field.fill('900');
      await field.press('Enter');
      await expect.poll(() => readSettings(cfgRoot)?.tabs?.smoothScrollMs).toBe(900);

      // Above the declared maximum: refused, surfaced, not applied.
      await field.fill('9999');
      await field.press('Enter');
      await expect(prefs.getByTestId('control-tabs.smoothScrollMs-invalid')).toBeVisible();
      expect(readSettings(cfgRoot)?.tabs?.smoothScrollMs).toBe(900);

      // Below the declared minimum, on the setting that has a non-zero one.
      const limit = prefs.getByTestId('control-tabs.maxNameLength');
      await limit.fill('4');
      await limit.press('Enter');
      await expect(prefs.getByTestId('control-tabs.maxNameLength-invalid')).toBeVisible();
      expect(readSettings(cfgRoot)?.tabs?.maxNameLength, 'the shipped default stands').toBe(64);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('T057 — tabs.openPicker appears in the Key Bindings editor and is rebindable (T6)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPreferences(app, win, 'keybindings');

      // Listed, under the same "Tabs" heading the Settings editor uses, with its shipped chord and a
      // scope that says it works everywhere — which is what T5's "at any tab count, from anywhere"
      // looks like from the editor's side.
      const row = prefs.getByTestId('binding-tabs.openPicker');
      await expect(row).toBeVisible();
      await expect(
        prefs.getByTestId('keybindings-group-Tabs').getByTestId('binding-tabs.openPicker'),
      ).toHaveCount(1);
      await expect(prefs.getByTestId('binding-tabs.openPicker-chord')).toContainText('Ctrl+Alt+T');
      await expect(prefs.getByTestId('binding-tabs.openPicker-scope')).toHaveText('Everywhere');

      // REBINDABLE — capture is additive, so the shipped chord survives beside the new one.
      await row.dblclick();
      await expect(prefs.getByTestId('capture-modal')).toBeVisible();
      await sendChord(prefs, 'F9');
      await expect(prefs.getByTestId('capture-modal')).toBeHidden();
      await expect
        .poll(() => readBindings(cfgRoot)?.['tabs.openPicker'])
        .toEqual(['Ctrl+Alt+T', 'F9']);

      // …and the new chord is what the editor now shows.
      await expect(prefs.getByTestId('binding-tabs.openPicker-chord')).toContainText('F9');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
