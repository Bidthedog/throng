import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import {
  createProject,
  firstPanelId,
  openApp,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';

/**
 * 018 / US3 — scrollbars are part of the theme (FR-009 … FR-012).
 *
 * Before this feature exactly one scrollbar in the application was styled: the terminal's. Every
 * other scrollable surface rendered the browser engine's default, which on a dark theme is a
 * light-grey bar in an otherwise dark application.
 */

/*
 * ONE app for this file, not one per test (034 FR-045, SC-027) — 2 launches -> 1.
 *
 * The live `cmd` shell that made this file two apps is in the LAST test, so no test runs after
 * it. Its own `finally` already records that the shell can still hold the project root after
 * teardown; that cleanup therefore moves to `afterAll`, where the app has actually closed —
 * keeping the swallow, for the same reason it was written.
 *
 * Nothing is seeded before launch. Test 1 makes no project at all and measures a throwaway
 * element it creates and removes itself, so it neither leaves nor reads any shared state; test
 * 2's `.terminal-panel .xterm-viewport` is window-wide but test 1 opens no terminal.
 */
const ownedRoots: string[] = [];
/** Register a project root for removal in `afterAll`, once the shared app has closed. */
function own(dir: string): string {
  ownedRoots.push(dir);
  return dir;
}

test.describe.configure({ mode: 'serial' });

let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp();
});

test.afterAll(async () => {
  await shared?.close();
  for (const dir of ownedRoots.splice(0)) {
    // Principle V: a test cleans up after itself — but a FAILURE to clean up is not a failure
    // of the test. The app has closed by here, yet on a slow runner the de-elevated cmd.exe
    // test 2 spawned can still hold a handle to the root for a moment, so rmSync throws EBUSY.
    try {
      cleanupTemp(dir);
    } catch {
      /* the OS reaps the temp dir; a locked handle here is not a product defect */
    }
  }
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

test('every scrollable surface gets a classic themed bar of the theme WIDTH (FR-010 / #130)', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
  await runApp(async (_app, win) => {
    // The provider writes the custom properties onto :root in an effect, so poll rather than
    // sampling the first frame. An UNDEFINED custom property resolves to the empty string — which
    // is exactly what would leave the engine's light-grey default bar in place, so "" is the
    // failure this asserts against.
    const token = (name: string) =>
      win.evaluate(
        (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
        name,
      );

    await expect.poll(() => token('--throng-colour-scrollbarTrack')).toMatch(/^#|rgb/);
    await expect.poll(() => token('--throng-colour-scrollbarThumb')).toMatch(/^#|rgb/);
    await expect.poll(() => token('--throng-size-scrollbar')).toMatch(/\d/);

    // #130 — the theme's px WIDTH must reach an ARBITRARY scrollable surface, not just the terminal.
    // This is the regression this test exists to catch: with the old global `scrollbar-color` on `*`,
    // Chromium rendered STANDARD overlay bars everywhere, which have NO layout width and ignore the
    // `::-webkit-scrollbar { width }` rule — so changing the theme's scrollbar width moved nothing.
    // Classic (webkit) bars occupy REAL layout width, so `offsetWidth − clientWidth` on a force-scrolled
    // throwaway element IS the bar's width. An overlay/inert bar measures 0 — the #130 failure — and a
    // classic bar measures the theme width. Proving it on an arbitrary element is the point: "every
    // scrollable surface", covered without a per-surface list to forget the next one from.
    const measured = await win.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.cssText =
        'position:absolute;top:-9999px;left:-9999px;width:100px;height:100px;overflow-y:scroll';
      probe.innerHTML = '<div style="height:400px"></div>';
      document.body.appendChild(probe);
      const width = probe.offsetWidth - probe.clientWidth;
      probe.remove();
      return width;
    });
    const themeWidth = Number.parseInt(await token('--throng-size-scrollbar'), 10);
    expect(themeWidth, 'the theme must define a concrete scrollbar width').toBeGreaterThan(0);
    expect(
      measured,
      'an arbitrary scrollable surface must show a CLASSIC bar of the theme width, not a 0-width overlay (#130)',
    ).toBe(themeWidth);
  });
});

test('the terminal keeps its classic, non-overlay bar — MEASURED, not read from the stylesheet (FR-011)', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
  const root = own(mkdtempSync(join(tmpdir(), 'throng-sb-')));
  try {
    await runApp(async (_app, win) => {
    // Open a real terminal: there is nothing to measure otherwise, and a test that passes because
    // it found nothing to check is the kind of test this whole feature exists to stop shipping.
    await createProject(win, 'Scrollbars', root);
    const pid = await firstPanelId(win);
    await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
    await win.getByTestId('terminal-flavour').selectOption('cmd');
    await win.getByTestId(`panel-type-confirm-${pid}`).click();
    await expect(win.locator('.terminal-panel .xterm-viewport')).toBeVisible();
    // THE test of this story, and it must MEASURE.
    //
    // The terminal's scrollbar is load-bearing for LAYOUT, not just colour: it must occupy real
    // width so xterm's fit calculation wraps text BEFORE it. An overlay bar — which is what you get
    // by default — makes xterm wrap text UNDERNEATH the bar and the last column is overlapped.
    //
    // The hazard this feature actually created: setting the standard `scrollbar-color` property on
    // `*` makes Chromium ignore the `::-webkit-scrollbar-*` rules on that element, which would
    // silently turn the terminal's classic 12px bar into a thin overlay one. So `.xterm-viewport`
    // opts back out (terminal.css), and this test proves it — by measuring the gap between the
    // element's border box and its content box, which IS the scrollbar's real layout width.
    //
    // An earlier version of this test read `width: 12px` back out of the stylesheet text. It would
    // have passed with the rule completely inert, which makes it worse than no test at all.
    const scrollbarWidth = await win.evaluate(() => {
      const vp = document.querySelector('.terminal-panel .xterm-viewport');
      if (vp === null) return null;
      return (vp as HTMLElement).offsetWidth - (vp as HTMLElement).clientWidth;
    });

    // No terminal open in the default workspace → nothing to measure, and the assertion below would
    // be vacuous. Fail loudly rather than pass silently.
    expect(scrollbarWidth, 'expected a terminal viewport to measure').not.toBeNull();
    expect(
      scrollbarWidth,
      'the terminal scrollbar must occupy REAL layout width (non-overlay), or xterm wraps text underneath it',
    ).toBe(12);
    });
  } finally {
    // The root is deleted in `afterAll`, once the SHARED app has closed — the swallow that used
    // to live here moved with it, because the reason for it (a cmd.exe still holding a handle)
    // is unchanged.
  }
});
