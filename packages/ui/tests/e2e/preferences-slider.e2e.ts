import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { runApp, setSlider } from './harness.js';

/**
 * 018 / US7 — numbers are editable by dragging and readable at a glance (FR-032 … FR-039).
 *
 * Every numeric preference was a bare text box. The maximum-openable-file-size setting displayed as
 * `10485760`: eight digits with no grouping, which nobody reads as ten megabytes. And sizes, delays
 * and widths are far easier to set by dragging than by typing.
 */

const cfgRoots: string[] = [];
function freshCfgRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-sl-'));
  cfgRoots.push(dir);
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0))
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
});

async function openTab(app: ElectronApplication, win: Page, tab: string): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId(`cog-menu-${tab}`).click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  return prefs;
}

function readSettings(cfgRoot: string): Record<string, unknown> | undefined {
  const file = join(cfgRoot, 'settings.json');
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

test('a bounded numeric renders a slider AND a field; each drives the other (FR-033)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openTab(app, win, 'settings');

      const slider = prefs.getByTestId('control-behaviour.tabHoverActivateMs-slider');
      const field = prefs.getByTestId('control-behaviour.tabHoverActivateMs');
      await expect(slider).toBeVisible();
      await expect(field).toBeVisible();

      // Type in the field → the slider follows.
      await field.fill('1200');
      await field.press('Enter');
      await expect.poll(() => slider.inputValue()).toBe('1200');

      // Drive the slider → the field follows, and the value persists.
      await setSlider(slider, '2000');
      await expect.poll(() => field.inputValue()).toBe('2000');
      await expect
        .poll(() => {
          const s = readSettings(cfgRoot) as { behaviour?: { tabHoverActivateMs?: number } };
          return s?.behaviour?.tabHoverActivateMs;
        })
        .toBe(2000);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('a large value is DISPLAYED grouped, and stored PLAIN (FR-037, FR-038)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openTab(app, win, 'settings');

      // `10485760` is eight digits nobody reads as ten megabytes.
      const field = prefs.getByTestId('control-editor.maxOpenFileBytes');
      await expect(field).toHaveValue('10,485,760');

      // It has a SLIDER now, alongside the field. 018 shipped it typed, arguing that a slider from a
      // kilobyte to gigabytes moves in megabyte jumps per pixel — an argument about the RANGE, which
      // the STEP answers: five megabytes is the unit anyone actually thinks in here, and it collapses
      // the range to fifty positions you can aim at. The field is still there, still typed, still
      // grouped, for anyone who wants an exact number — which is what the rest of this test is about.
      await expect(prefs.getByTestId('control-editor.maxOpenFileBytes-slider')).toHaveCount(1);

      // Type a grouped number: the field must accept what it just rendered.
      await field.fill('20,971,520');
      await field.press('Enter');

      // And what reaches the FILE is a plain number. A grouping character must never get there.
      await expect
        .poll(() => {
          const s = readSettings(cfgRoot) as { editor?: { maxOpenFileBytes?: unknown } };
          return s?.editor?.maxOpenFileBytes;
        })
        .toBe(20971520);

      const raw = readFileSync(join(cfgRoot, 'settings.json'), 'utf8');
      expect(raw).toContain('20971520');
      expect(raw, 'no grouping character may reach the settings file').not.toContain('20,971,520');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('paste-then-blur commits — the stale-render defect must NOT come back (FR-036)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openTab(app, win, 'settings');

      // THIS is the regression the slider work could most easily reintroduce.
      //
      // The field commits on blur/Enter reading the LIVE DOM input, not React state, because a fast
      // fill-then-blur fires before React has re-rendered and a handler closing over the previous
      // state silently drops the edit. It was a real CI flake: a debounce filled to 1500, blurred,
      // and stayed 900.
      //
      // The tempting way to add a slider is to make the field commit on every change so the two
      // "match". That is exactly what would bring the defect back. The slider commits on change
      // because it is bounded and stepped BY CONSTRUCTION; the field does not.
      const field = prefs.getByTestId('control-behaviour.submenuHoverMs');
      await field.fill('1500');
      await field.blur();

      await expect
        .poll(() => {
          const s = readSettings(cfgRoot) as { behaviour?: { submenuHoverMs?: number } };
          return s?.behaviour?.submenuHoverMs;
        })
        .toBe(1500);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('the THEMES editor benefits too, and does not regress (FR-039)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openTab(app, win, 'themes');

      // Both editors share ONE numeric control, so both must benefit. Every other test here drives
      // the Settings tab; a shared control tested on one side is a shared control tested on one side.
      //
      // The font weights had NO BOUNDS AT ALL before 018 — no minimum, no maximum, no step.
      const slider = prefs.getByTestId('control-fonts.weights.normal-slider');
      await expect(slider).toBeVisible();
      await expect(slider).toHaveAttribute('min', '100');
      await expect(slider).toHaveAttribute('max', '900');
      await expect(slider).toHaveAttribute('step', '100');

      await setSlider(slider, '700');
      await expect
        .poll(() => {
          const file = join(cfgRoot, 'themes', 'throng.json');
          if (!existsSync(file)) return undefined;
          const doc = JSON.parse(readFileSync(file, 'utf8')) as {
            fonts?: { weights?: { normal?: number } };
          };
          return doc.fonts?.weights?.normal;
        })
        .toBe(700);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('out-of-bounds and non-numeric entries are rejected, last valid value standing', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openTab(app, win, 'settings');

      const field = prefs.getByTestId('control-behaviour.tabHoverActivateMs');
      await field.fill('900');
      await field.press('Enter');

      await field.fill('not-a-number');
      await field.press('Enter');
      await expect(prefs.getByTestId('control-behaviour.tabHoverActivateMs-invalid')).toBeVisible();

      // Above the declared maximum — rejected too, and the last valid value stands.
      await field.fill('999999');
      await field.press('Enter');

      await expect
        .poll(() => {
          const s = readSettings(cfgRoot) as { behaviour?: { tabHoverActivateMs?: number } };
          return s?.behaviour?.tabHoverActivateMs;
        })
        .toBe(900);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
