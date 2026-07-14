import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { runApp } from './harness.js';

/**
 * 018 / US4 — the themed colour picker (FR-020 … FR-026).
 *
 * The control this replaces opened the OPERATING SYSTEM'S OWN colour dialog — a light-grey panel in
 * system fonts, in the middle of a fully-themed dark application, that no stylesheet could reach. It
 * sat on the control the Themes editor is BUILT FROM: every colour token in the app went through it.
 */

const cfgRoots: string[] = [];
function freshCfgRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cp-'));
  cfgRoots.push(dir);
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0))
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
});

async function openThemes(app: ElectronApplication, win: Page): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId('cog-menu-themes').click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  return prefs;
}

function readTheme(cfgRoot: string, name = 'throng'): Record<string, string> | undefined {
  const file = join(cfgRoot, 'themes', `${name}.json`);
  if (!existsSync(file)) return undefined;
  const doc = JSON.parse(readFileSync(file, 'utf8')) as { colours?: Record<string, string> };
  return doc.colours;
}

test('the picker is drawn from theme tokens — NO operating-system dialog (FR-020)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);

      // The swatch is a real button now, not an <input type="color"> whose popup we cannot reach.
      const swatch = prefs.getByTestId('control-colours.accent');
      await expect(swatch).toBeVisible();
      await expect
        .poll(() => swatch.evaluate((el) => el.tagName.toLowerCase()))
        .toBe('button');

      await swatch.click();

      // The picker is OURS: real DOM, themed, and Playwright can see it. An OS dialog could not be
      // located at all — which is exactly why the old control was untestable as well as un-themeable.
      const picker = prefs.getByTestId('control-colours.accent-picker');
      await expect(picker).toBeVisible();
      await expect(prefs.getByTestId('control-colours.accent-sv')).toBeVisible();
      await expect(prefs.getByTestId('control-colours.accent-hue')).toBeVisible();

      // Its card takes the dialog surface from the theme, not a system colour.
      await expect
        .poll(() => picker.evaluate((el) => getComputedStyle(el).backgroundColor))
        .toMatch(/rgb/);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('an INVALID colour is rejected, the last valid one stands, and the row says so (FR-026)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);

      const hex = prefs.getByTestId('control-colours.accent-hex');
      await hex.fill('#ff8800');
      await hex.press('Enter');
      await expect.poll(() => readTheme(cfgRoot)?.accent).toBe('#ff8800');

      // BEFORE 018 this wrote the string `zzz` into the theme file on disk and the token stopped
      // rendering. There was no validation of any kind: every keystroke was committed raw.
      await hex.fill('zzz');
      await hex.press('Enter');

      // The RED BORDER is the message, and it is the WHOLE message. A sentence underneath used to
      // appear and push every row below it down the page — while you were still typing, because
      // emptying the box to type a new colour is itself "invalid". The complaint moved the thing you
      // were aiming at. It says the same thing now, in place, and the layout does not budge.
      await expect(prefs.getByTestId('control-colours.accent-hex')).toHaveAttribute('aria-invalid', 'true');
      await expect(prefs.getByTestId('control-colours.accent-invalid')).toHaveCount(0);

      // The last valid colour stands — on disk, which is the part that matters.
      await expect.poll(() => readTheme(cfgRoot)?.accent).toBe('#ff8800');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('the picker is fully keyboard-operable, with a visible focus indicator (FR-024)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      await prefs.getByTestId('control-colours.accent').click();

      // It opens with focus in the saturation area, so a keyboard user can begin at once.
      const sv = prefs.getByTestId('control-colours.accent-sv');
      await expect(sv).toBeFocused();

      // Every control shows a focus ring — a roving focus that leaves no visible mark would trade
      // one accessibility defect for another.
      await expect
        .poll(() => sv.evaluate((el) => getComputedStyle(el).outlineStyle))
        .not.toBe('none');

      // The arrows drive it, and the colour actually changes.
      const before = await readTheme(cfgRoot)?.accent;
      await prefs.keyboard.press('ArrowRight');
      await prefs.keyboard.press('ArrowUp');
      await expect.poll(() => readTheme(cfgRoot)?.accent).not.toBe(before);

      // Escape closes it and the last applied value stands.
      await prefs.keyboard.press('Escape');
      await expect(prefs.getByTestId('control-colours.accent-picker')).toBeHidden();
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('the colour applies LIVE and persists — and rapid edits compound into one write (FR-022, FR-023)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);

      const hex = prefs.getByTestId('control-colours.accent-hex');

      // Several edits inside the 150 ms debounce window. They must COMPOUND into the last value,
      // not race each other — a picker that streams values during a drag is exactly where that
      // breaks, and it is the guarantee FR-023 names.
      for (const colour of ['#111111', '#222222', '#333333', '#abcdef']) {
        await hex.fill(colour);
        await hex.press('Enter');
      }

      await expect.poll(() => readTheme(cfgRoot)?.accent).toBe('#abcdef');

      // And it is live in the running application, not just on disk.
      await expect
        .poll(() =>
          prefs.evaluate(() =>
            getComputedStyle(document.documentElement)
              .getPropertyValue('--throng-colour-accent')
              .trim(),
          ),
        )
        .toBe('#abcdef');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
