import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { runApp, createProject } from './harness.js';

// #3/#4: all resize handles share one thin style and are invisible at rest (the
// pane/panel border is the only divider — no doubled line on the left), brighten
// to the THEME accent on hover. Spacing (hit-area width) is unchanged.

const beforeBg = (win: Page, sel: string): Promise<string> =>
  win.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? getComputedStyle(el, '::before').backgroundColor : 'missing';
  }, sel);

const widthOf = (win: Page, sel: string): Promise<number> =>
  win.evaluate((s) => (document.querySelector(s) as HTMLElement).getBoundingClientRect().width, sel);

test('resize handles draw no line at rest (single border) and keep their hit-area width', async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'Handles', 'C:/c/handles'); // explorer auto-expands; a panel exists

    // The sidebar width handle and the explorer handle both render their line via
    // a ::before that is transparent at rest → only the pane border shows (no
    // double border on the left). transparent === rgba(0, 0, 0, 0).
    expect(await beforeBg(win, '[data-testid="sidebar-hresize"]')).toBe('rgba(0, 0, 0, 0)');
    expect(await beforeBg(win, '[data-testid="explorer-resize"]')).toBe('rgba(0, 0, 0, 0)');

    // The explorer handle keeps its 6px hit area (spacing unchanged).
    expect(Math.round(await widthOf(win, '[data-testid="explorer-resize"]'))).toBe(6);
  });
});
