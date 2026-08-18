import { mkdirSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { openApp, settle, cleanupTemp, type AppOptions, type OpenApp } from './harness.js';
import {
  configRootSeeded,
  settleConfigRoot,
  snapshotConfigRoot,
  type ConfigRootSnapshot,
} from './helpers/config-snapshot.js';
import { closePrefsWindow } from './helpers/prefs-window.js';
import { writeConfigAtomic } from './helpers/config-write.js';

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
function freshCfgRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-themes-'));
  cfgRoots.push(dir);
  mkdirSync(join(dir, 'themes'), { recursive: true });
  return dir;
}

/**
 * Put a custom theme into the RUNNING app's themes directory.
 *
 * `listThemes` and `readRaw` are read straight off disk on every call, and the preferences window
 * asks for both when it MOUNTS — so a theme written before the window opens is indistinguishable
 * from one seeded before the process started, which is all these three tests ever needed.
 * `restoreConfigRoot` removes it again in `afterEach`, which is what keeps the theme LIST (asserted
 * at exactly the shipped count by `waitForSeededList`) correct for the tests that follow.
 */
function seedTheme(name: string, theme: unknown): void {
  writeConfigAtomic(join(cfgRoot, 'themes', `${name}.json`), `${JSON.stringify(theme, null, 2)}\n`);
}

/*
 * ONE app for this file, not one per test (034 FR-045, SC-010).
 *
 * Eight of the eleven tests seeded nothing. The other three seeded ONE custom theme file, and a theme
 * file is read per call — `listThemes` and `readRaw` both go to disk every time, and the preferences
 * window asks on mount — so writing it into the running root before the window opens proves the same
 * thing a pre-launch seed did.
 *
 * The destructive ones are the reason `restoreConfigRoot` exists rather than a tidy-up per test: these
 * tests DELETE built-in theme files, clone new ones, rename them and edit tokens in place. The restore
 * puts every deleted built-in back, removes every clone, and rewrites every edited token.
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

test('editing a colour token applies to the active theme file and reflects live', { tag: ['@extended', '@prefs'] }, async () => {
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
  );
});

test('selecting a theme in the dropdown activates it (select = activate)', { tag: ['@extended', '@prefs'] }, async () => {
  await runApp(
    async (app, win) => {
      seedTheme('CustomOne', { name: 'CustomOne', colours: { accent: '#00ff41' }, fonts: { family: 'Consolas', baseSizePx: 13, weights: { normal: 400, bold: 600 } }, icons: {} });
      const prefs = await openThemes(app, win);
      await pickTheme(prefs, 'CustomOne');
      await expect.poll(() => readActiveTheme(cfgRoot)).toBe('CustomOne');
    },
  );
});

/*
 * MOVED to `packages/ui/tests/component/preferences-name-dialog.test.ts` (034 FR-045):
 *   “the rename dialog refuses a reserved built-in name and writes nothing”.
 *
 * It launched Electron, seeded a custom theme into the running config root, opened the
 * preferences window and selected a theme — in order to make three assertions about a modal
 * (the dialog is visible, the error is visible, confirm is disabled) and two `existsSync` calls
 * standing in for “nothing was written”. `NameDialog` takes `reserved`, `existing`,
 * `renamingFrom`, `onConfirm` and `onCancel` as props and reaches nothing else — no context, no
 * bridge, no store.
 *
 * TEN TESTS REPLACE IT, and three of them assert something this one could not:
 *   - “nothing was written” was two files that were already there, which a dialog writing a
 *     THIRD file satisfies perfectly. `onConfirm` is the dialog’s only output, so asserting it
 *     was never called covers the whole surface rather than two paths of it.
 *   - **Enter** submits too, and a disabled button does not disable a keyboard handler. That is
 *     how this guard would realistically be lost, and no test at any layer asked before.
 *   - The three refusal REASONS now read differently — reserved, duplicate, empty — where the
 *     E2E only asked whether the error element existed at all.
 *
 * WHAT DID NOT MOVE, and is still witnessed below: that clicking `theme-rename` OPENS the
 * dialog, and that confirming a valid name renames the FILE — both are in “US3: Clone is the
 * sole creation path”, which stays (FR-047). And that the reserved set comes from
 * `reservedThemeNames()` rather than from the themes on disk is `themes-tab.tsx` WIRING, which a
 * component handed the list cannot see — “US3: a DELETED built-in name is still reserved” stays
 * for exactly that reason.
 *
 * Red-proved, three mutations: confirm never disabled (5 red), `submit()` dropping its validation
 * guard so Enter confirms an invalid name (1 red — only the Enter test, which is the point), and
 * the reserved sentence collapsing to “Invalid name.” (3 red, with duplicate and empty staying
 * green).
 *
 * ANTI-VACUITY CONTROL: rename the field’s `data-testid="theme-name-input"` in `name-dialog.tsx`.
 * Every one of the ten reaches the input through `getByTestId`, which throws — all 10 fail.
 */

test('deleting a theme requires a single confirm and removes the file', { tag: ['@extended', '@prefs'] }, async () => {
  await runApp(
    async (app, win) => {
      seedTheme('CustomOne', { name: 'CustomOne', colours: {}, fonts: { family: 'x', baseSizePx: 13, weights: { normal: 400, bold: 600 } }, icons: {} });
      const prefs = await openThemes(app, win);
      await pickTheme(prefs, 'CustomOne');
      await prefs.getByTestId('theme-delete').click();
      await expect(prefs.getByTestId('theme-delete-confirm')).toBeVisible();
      await prefs.getByTestId('theme-confirm-yes').click();
      await expect.poll(() => existsSync(join(cfgRoot, 'themes', 'CustomOne.json'))).toBe(false);
    },
  );
});

test('the font control is a pill editor saving a comma stack; a non-family role exposes it (H4)', { tag: ['@extended', '@prefs'] }, async () => {
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      // paneTitle does NOT pin a family in the default theme, yet now exposes the
      // font control (T106).
      const key = 'typography.paneTitle.family';
      const control = prefs.getByTestId(`control-${key}`);
      await expect(control).toBeVisible();

      /*
       * The PILLS are asserted at the component layer now (034 FR-045) — ordering, appending rather
       * than replacing, filtering the typeahead, and re-serialising after a removal, in
       * `tests/component/preferences-font-pills.test.ts`. What is left here is the claim that layer
       * cannot make: the stack the control commits reaches <theme>.json, which is the file the
       * live-reload path reads.
       */
      await control.click();
      await control.fill('Arial');
      await prefs.getByTestId(`control-${key}-option-Arial`).click();
      await control.fill('Georgia');
      await prefs.getByTestId(`control-${key}-option-Georgia`).click();

      // Saved to the theme file as a comma-separated stack.
      await expect
        .poll(() => readTheme(cfgRoot, 'throng')?.typography?.paneTitle?.family)
        .toBe('Arial, Georgia');
    },
  );
});

/*
 * MOVED to `packages/ui/tests/component/preferences-font-pills.test.ts` (034 FR-045):
 * "an existing comma stack loads back as ordered pills (H4, FR-038b)".
 *
 * It seeded a theme with `'Segoe UI', system-ui, sans-serif`, launched Electron, opened the
 * preferences window, switched theme, and asserted three pills read the three families in order.
 * `ThemeTokenControl` is exported and takes `descriptor`, `value`, `fonts` and `onCommit` — no
 * context at all — so the same claim is a render and three assertions.
 *
 * Eight tests replace it, covering what the one could not afford to: the ordering (a font stack IS a
 * fallback chain, so the right families in the wrong order look correct and mean something else),
 * the quote stripping, a role that pins NO family and must still draw the control, appending rather
 * than replacing, the typeahead's filtering, and re-serialising after a removal — including the last
 * family going, which commits an empty stack.
 *
 * Red-proved: reversing the parse at BOTH sites (the initial state and the resync effect — mutating
 * only the first proved nothing, because the effect immediately overwrote it), making a pick replace
 * the stack, removing the wrong index, and dropping the typeahead filter. Four mutations, four reds.
 */
test('the three-type button tokens appear in the editor and apply live (021, US7, FR-027)', { tag: ['@extended', '@prefs'] }, async () => {
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      // The three button TYPES each expose their six colour tokens; the button typography role
      // exposes the (pill) font control. Spot one representative colour token from each type.
      await expect(prefs.getByTestId('control-colours.confirmButtonBg-hex')).toBeVisible();
      await expect(prefs.getByTestId('control-colours.cancelButtonBg-hex')).toBeVisible();
      await expect(prefs.getByTestId('control-colours.destroyButtonBg-hex')).toBeVisible();
      await expect(prefs.getByTestId('control-typography.button.family')).toBeVisible();

      // Edit confirmButtonBg → saved + reflected in the live CSS var. (The live BUTTON render across
      // all three types, rest + hover, is proven end-to-end in theme-buttons.e2e.ts.)
      await prefs.getByTestId('control-colours.confirmButtonBg-hex').fill('#123456');
      await expect.poll(() => readTheme(cfgRoot, 'throng')?.colours?.confirmButtonBg).toBe('#123456');
      await expect
        .poll(() =>
          prefs.evaluate(() =>
            getComputedStyle(document.documentElement)
              .getPropertyValue('--throng-colour-confirmButtonBg')
              .trim(),
          ),
        )
        .toBe('#123456');
    },
  );
});

/* ---------------------------------------------------------------------------
 * Feature 014 — restore & create controls
 * ------------------------------------------------------------------------- */

test('US1: Restore All resets edited built-ins, recreates a deleted built-in, and leaves customs untouched', { tag: ['@extended', '@prefs'] }, async () => {
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
  );
});

test('US2: per-theme restore reverts only that built-in (confirmed); a deleted built-in leaves the list and only Restore All brings it back', { tag: ['@extended', '@prefs'] }, async () => {
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
  );
});

test('US3: Clone is the sole creation path — prefilled "<source> - Clone" with "Clone" pre-selected; rename uses the same dialog', { tag: ['@extended', '@prefs'] }, async () => {
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
  );
});

test('the mode-toggle glyph stays on ONE line in every monospace-font theme (regression: two-line wrap)', { tag: ['@extended', '@prefs'] }, async () => {
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      await waitForSeededList(prefs);

      // The `editJson` token's glyph is the literal text "{ }" — three characters with a SPACE in
      // the middle. The five bundled themes below are the ones whose ui font is MONOSPACE: their
      // fixed-width "{ }" overflows the 16px icon box, and the browser's default line-breaking then
      // splits it at the space, stacking "{" over "}". Every other theme uses a proportional font
      // that keeps "{ }" narrow enough to fit, which is exactly why only these five wrapped — so
      // this is the exhaustive at-risk set. The app-side fix (white-space: nowrap on the glyph)
      // must hold it to a single line in ALL of them without any theme file being touched.
      const monoThemes = ['Windows Terminal', 'Bash', 'VI-VIM', 'Matrix', 'Cyberpunk'];
      const glyph = prefs.getByTestId('prefs-mode-toggle').locator('.icon');
      await expect(glyph).toBeVisible();

      for (const theme of monoThemes) {
        // Selecting activates the theme; the prefs window repaints live from it, so the glyph is
        // now rendered in this theme's monospace font.
        await pickTheme(prefs, theme);

        // The contract that prevents the wrap — deterministic, font-metric-independent, and it
        // FAILS on the pre-fix code (whose glyph inherited the default `white-space: normal`).
        await expect(glyph).toHaveCSS('white-space', 'nowrap');

        // ...and the behaviour it buys: the glyph text occupies a single line box, never two.
        const lineBoxes = await glyph.evaluate((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return range.getClientRects().length;
        });
        expect(lineBoxes, `mode-toggle glyph occupied ${lineBoxes} line boxes in the "${theme}" theme`).toBe(1);
      }
    },
  );
});

test('US3: a DELETED built-in name is still reserved for a new theme (FR-007)', { tag: ['@extended', '@prefs'] }, async () => {
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
  );
});
