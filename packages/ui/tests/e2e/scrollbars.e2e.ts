import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { createProject, firstPanelId, runApp } from './harness.js';

/**
 * 018 / US3 — scrollbars are part of the theme (FR-009 … FR-012).
 *
 * Before this feature exactly one scrollbar in the application was styled: the terminal's. Every
 * other scrollable surface rendered the browser engine's default, which on a dark theme is a
 * light-grey bar in an otherwise dark application.
 */

test('every scrollable surface takes its scrollbar colours from the theme (FR-010)', async () => {
  await runApp(async (_app, win) => {
    // The rule is applied globally (`*`), not per-surface, so any element proves it — and proving it
    // on an arbitrary element is exactly the point: the requirement is "every scrollable surface",
    // and the next one somebody adds is covered without anyone remembering to add it to a list.
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

    // And the global rule actually applies them, rather than leaving the engine's `auto`.
    await expect
      .poll(() => win.evaluate(() => getComputedStyle(document.body).scrollbarColor))
      .not.toBe('auto');
  });
});

test('the terminal keeps its classic, non-overlay bar — MEASURED, not read from the stylesheet (FR-011)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-sb-'));
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
    // Constitution, Principle V: a test cleans up the artefacts it creates — but a FAILURE to clean
    // up is not a failure of the test. `runApp` has already closed the app by here, yet on a slow CI
    // runner the de-elevated `cmd.exe` this test spawned can still hold a handle to the project root
    // for a moment after the window is gone, so `rmSync` throws EBUSY. Swallowing it keeps a teardown
    // race from turning a green measurement red; the temp dir is under the OS temp root and is reaped
    // regardless. (retryDelay matches the other terminal-spawning suites, which clean up in 250ms steps.)
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
    } catch {
      /* the OS will reap the temp dir; a locked handle here is not a product defect */
    }
  }
});
