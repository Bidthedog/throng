/**
 * 018 / US7 — the preferences window and the config store are actually wired to each other.
 *
 * ONE test, deliberately. This file held five, and the other four asserted things about the numeric
 * CONTROL — that a bounded numeric renders a slider beside its field, that a large value is shown
 * grouped and stored plain, that a fast fill-then-blur still commits, that an out-of-bounds entry is
 * refused, that the slider carries the descriptor's min/max/step. Every one of those is a claim
 * about what a component renders and when it calls `onCommit`, and every one of them opened a
 * second Electron window to check it.
 *
 * They now live in `packages/ui/tests/component/preferences-number-control.test.ts` — ten tests in
 * under four seconds, against five app launches (034 FR-045).
 *
 * WHAT IS LEFT IS NOT A CONTROL TEST. It is the seam: the cog menu opens a real preferences window,
 * the control in it is bound to the real config store, and a value typed there reaches
 * settings.json on disk. No lower layer can see that, because it is the wiring BETWEEN the layers
 * the other tests now cover separately — the component knows nothing about a config file, and the
 * config tests know nothing about a window.
 *
 * Writing the component tests found that the slider does NOT commit on every change — it shows the
 * value as the thumb moves and writes when the user lets go — while the comment in
 * `form-controls.tsx` claimed the opposite. The comment is corrected.
 *
 * An earlier version of this note went further and said no end-to-end test could have caught that.
 * It was wrong: `preferences-fonts-and-sliders.e2e.ts` ("a slider writes when you LET GO — not on
 * every pixel, and not on a timer") reads settings.json MID-DRAG and requires it unchanged. The
 * behaviour was covered; only the comment had drifted. Left corrected rather than quietly deleted,
 * because "the E2E layer structurally cannot see this" is the argument this whole feature rests on,
 * and it is worth being accurate about where it does and does not apply.
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { runApp, setSlider, cleanupTemp} from './harness.js';

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
    cleanupTemp(dir);
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

test('a bounded numeric renders a slider AND a field; each drives the other (FR-033)', { tag: ['@extended', '@prefs', '@reserve:window'] }, async () => {
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
      //
      // The field shows `2,000`, not `2000`: constitution 4.5.0 groups at every magnitude, dropping
      // 018 FR-037's five-digit floor. The slider's own value stays plain — it is an `input[range]`,
      // whose value is a number and never a rendering.
      await setSlider(slider, '2000');
      await expect.poll(() => field.inputValue()).toBe('2,000');
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
