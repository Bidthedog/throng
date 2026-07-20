import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { runApp, setSlider } from './harness.js';

/** Open the preferences window on a tab, through the cog — the same route every prefs suite uses. */
async function openPrefs(app: ElectronApplication, win: Page, tab: string): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId(`cog-menu-${tab}`).click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  return prefs;
}

/**
 * 018 follow-up — the eight things that were wrong when the feature was actually driven.
 *
 * Every one of these was found by USING the application rather than by reading the spec, which is the
 * point of shipping something a person can open. The spec said the theme editor was complete; it was
 * complete against a model that quietly offered a role only the attributes its author had happened to
 * pin, and pinned a numeric weight that no ordinary font can draw.
 */

const cfgRoots: string[] = [];

function freshCfg(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-'));
  cfgRoots.push(dir);
  return dir;
}

test.afterAll(() => {
  for (const dir of cfgRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

function readSettings(cfg: string): Record<string, never> & { editor: { maxOpenFileBytes: number } } {
  return JSON.parse(readFileSync(join(cfg, 'settings.json'), 'utf8')) as never;
}

function readTheme(cfg: string, name: string): { typography?: Record<string, Record<string, unknown>> } {
  const file = join(cfg, 'themes', `${name}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as never) : {};
}

test('a menu opens with NOTHING highlighted (the first item is not chosen for you)', async () => {
  await runApp(async (_app, win) => {
    await win.getByTestId('title-bar-cog').click();
    await expect(win.getByTestId('cog-menu')).toBeVisible();
    // The menu holds focus so the arrows reach it — but no ITEM does, because a highlighted item is an
    // answer to a question the user has not asked yet.
    await expect(win.locator('.context-menu__item:focus')).toHaveCount(0);
    await expect(win.locator('[data-testid="cog-menu"]:focus')).toHaveCount(1);
  });
});

test('the max open file size is a slider that moves in 5 MB steps', async () => {
  const cfg = freshCfg();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'settings');
      const slider = prefs.getByTestId('control-editor.maxOpenFileBytes-slider');
      await expect(slider).toBeVisible();
      const MiB = 1024 * 1024;
      await expect(slider).toHaveAttribute('step', String(5 * MiB));
      await expect(slider).toHaveAttribute('min', String(5 * MiB));

      // Drag it, and the value that lands on disk is a whole number of 5 MB steps.
      await setSlider(slider, String(25 * MiB));
      await expect.poll(() => readSettings(cfg).editor.maxOpenFileBytes).toBe(25 * MiB);
    },
    { env: { THRONG_CONFIG_ROOT: cfg } },
  );
});

test('a slider writes when you LET GO — not on every pixel, and not on a timer', async () => {
  const cfg = freshCfg();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'settings');
      const slider = prefs.getByTestId('control-behaviour.tabHoverActivateMs-slider');
      await expect(slider).toBeVisible();
      const read = (): number =>
        (readSettings(cfg) as unknown as { behaviour: { tabHoverActivateMs: number } }).behaviour
          .tabHoverActivateMs;
      const before = read();
      expect(before).not.toBe(800);

      // The thumb is DOWN and moving. Every `change` a range input fires used to be a write — out to
      // the settings file, back through the file watcher, re-theming the whole application — so a drag
      // flickered the window through every value on the way to the one you wanted.
      await slider.fill('800');

      // The FIELD beside it follows the thumb at once: the number you are aiming for must be the number
      // you are looking at.
      await expect(prefs.getByTestId('control-behaviour.tabHoverActivateMs')).toHaveValue('800');
      // But nothing is written while you are still holding it.
      expect(read(), 'the slider wrote mid-drag').toBe(before);

      // Let go. A slider has a gesture with a natural END, and that is when it means it.
      await slider.evaluate((el) => el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
      await expect.poll(() => read(), { timeout: 5000 }).toBe(800);
    },
    { env: { THRONG_CONFIG_ROOT: cfg } },
  );
});

test('EVERY typography role offers EVERY attribute — including the two it never had', async () => {
  const cfg = freshCfg();
  await runApp(
    async (app, win) => {
      const prefs = await openThemesTab(app, win);
      // `tab` used to expose a weight and a family and nothing else, so a tab title could not be
      // italicised however much you wanted to. Every non-editor/terminal role now offers the full set,
      // with a WEIGHT slider in place of the old Bold toggle (021 follow-up).
      for (const key of [
        'typography.tab.italic',
        'typography.tab.underline',
        'typography.tab.strikethrough',
        'typography.tab.case',
        'typography.tab.sizePx',
        'typography.tab.weight',
        'typography.tab.family',
      ]) {
        await expect(prefs.getByTestId(`control-${key}`), `${key} is not editable`).toHaveCount(1);
      }
      // The retired `dialog` role is gone — the preferences window inherits the base application font.
      await expect(prefs.getByTestId('control-typography.dialog.family')).toHaveCount(0);
      // And the editor sheds casing/decoration (source text is not prose) — those controls are absent.
      for (const gone of ['case', 'italic', 'underline', 'strikethrough']) {
        await expect(
          prefs.getByTestId(`control-typography.editor.${gone}`),
          `editor.${gone} must be gone`,
        ).toHaveCount(0);
      }
    },
    { env: { THRONG_CONFIG_ROOT: cfg } },
  );
});

test('a role WEIGHT is a slider on the real 100-900 scale (021 follow-up)', async () => {
  const cfg = freshCfg();
  await runApp(
    async (app, win) => {
      const prefs = await openThemesTab(app, win);
      // The old Bold CHECKBOX could render a role lighter than a sibling when the theme's bold weight was
      // set low; it is now a slider that says exactly what weight it will apply.
      const weight = prefs.getByTestId('control-typography.tab.weight-slider');
      await expect(weight).toBeVisible();
      await expect(weight).toHaveAttribute('min', '100');
      await expect(weight).toHaveAttribute('max', '900');
      await setSlider(weight, '700');
      await expect.poll(() => readTheme(cfg, 'throng').typography?.tab?.weight).toBe(700);

      // The base weights remain sliders on the same scale — what every unset role inherits.
      await expect(prefs.getByTestId('control-fonts.weights.bold-slider')).toHaveCount(1);
    },
    { env: { THRONG_CONFIG_ROOT: cfg } },
  );
});

test('the preferences window inherits the BASE application font (no separate dialog font)', async () => {
  const cfg = freshCfg();
  await runApp(
    async (app, win) => {
      const prefs = await openThemesTab(app, win);
      // The `dialog` role was retired: the preferences window is no longer themed apart from the app, so
      // changing the BASE font size moves the window with everything else.
      await setSlider(prefs.getByTestId('control-fonts.baseSizePx-slider'), '18');
      await expect
        .poll(() =>
          prefs.evaluate(() => {
            const root = document.querySelector('.prefs-root');
            return root ? getComputedStyle(root).fontSize : '';
          }),
        )
        .toBe('18px');
    },
    { env: { THRONG_CONFIG_ROOT: cfg } },
  );
});

test('Revert this theme undoes THIS SITTING’s edits, and only offers itself when there are any', async () => {
  const cfg = freshCfg();
  await runApp(
    async (app, win) => {
      const prefs = await openThemesTab(app, win);
      // Nothing has changed, so there is nothing to revert — and a no-op affordance is noise.
      await expect(prefs.getByTestId('theme-revert')).toHaveCount(0);

      const size = prefs.getByTestId('control-fonts.baseSizePx');
      const original = await size.inputValue();
      expect(original).not.toBe('20');

      await setSlider(prefs.getByTestId('control-fonts.baseSizePx-slider'), '20');
      await expect
        .poll(() => (readTheme(cfg, 'throng') as { fonts?: { baseSizePx?: number } }).fonts?.baseSizePx, {
          timeout: 5000,
        })
        .toBe(20);

      // NOW it is offered.
      await prefs.getByTestId('theme-revert').click();
      await expect(prefs.getByTestId('theme-confirm-dialog')).toBeVisible();
      await prefs.getByTestId('theme-confirm-yes').click();

      // Back to what the window opened with — not to the shipped default, which is what Restore means.
      await expect.poll(() => size.inputValue(), { timeout: 5000 }).toBe(original);
    },
    { env: { THRONG_CONFIG_ROOT: cfg } },
  );
});

/** Open Preferences on the Themes tab. */
async function openThemesTab(app: ElectronApplication, win: Page): Promise<Page> {
  const prefs = await openPrefs(app, win, 'themes');
  await expect(prefs.getByTestId('themes-tab')).toBeVisible();
  return prefs;
}
