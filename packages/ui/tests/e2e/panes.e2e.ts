import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { runApp, createProject } from './harness.js';

// FR #3: the collapse control lives next to the pane title (no permanent rail
// strip when expanded); when collapsed, only the rail remains and the button
// stays in the SAME position + size. We measure the button's gap from the pane's
// OUTER window edge (robust to the window settling to its final size).

// Read the button rect AND the window width atomically (one evaluate) so the gap
// from the pane's outer edge is from a consistent snapshot, even while the window
// is still settling to its final size.
async function buttonGeom(
  win: Page,
  testid: string,
  side: 'left' | 'right',
): Promise<{ gap: number; y: number; w: number; h: number }> {
  return win.evaluate(
    ({ id, edge }) => {
      const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
      const r = el.getBoundingClientRect();
      const gap = edge === 'left' ? r.left : window.innerWidth - r.right;
      return { gap, y: r.top, w: r.width, h: r.height };
    },
    { id: testid, edge: side },
  );
}

function approxSame(a: { gap: number; y: number; w: number; h: number }, b: typeof a): void {
  expect(Math.abs(a.gap - b.gap)).toBeLessThan(2);
  expect(Math.abs(a.y - b.y)).toBeLessThan(2);
  expect(Math.abs(a.w - b.w)).toBeLessThan(2);
  expect(Math.abs(a.h - b.h)).toBeLessThan(2);
}

test('left pane: no rail strip when expanded; collapse keeps the button fixed', async () => {
  await runApp(async (_app, win) => {
    await expect(win.getByTestId('pane-rail-left')).toHaveCount(0); // no strip when expanded
    const expanded = await buttonGeom(win, 'pane-hide-left', 'left');

    await win.getByTestId('pane-hide-left').click();
    await expect(win.getByTestId('pane-rail-left')).toBeVisible();
    await win.waitForTimeout(300); // let the collapse animation settle
    const collapsed = await buttonGeom(win, 'pane-show-left', 'left');
    approxSame(expanded, collapsed);

    await win.getByTestId('pane-show-left').click();
    await expect(win.getByTestId('pane-rail-left')).toHaveCount(0);
  });
});

test('right pane: rail only while collapsed; expand reveals the explorer', async () => {
  await runApp(async (_app, win) => {
    // No project → right pane defaults collapsed: rail shown, button present.
    await expect(win.getByTestId('pane-rail-right')).toBeVisible();
    const collapsed = await buttonGeom(win, 'pane-show-right', 'right');

    await win.getByTestId('pane-show-right').click();
    await expect(win.getByTestId('file-explorer-empty')).toBeVisible();
    await expect(win.getByTestId('pane-rail-right')).toHaveCount(0);
    await win.waitForTimeout(300); // let the expand animation settle
    const expanded = await buttonGeom(win, 'pane-hide-right', 'right');
    approxSame(collapsed, expanded);
  });
});

test('a collapsed rail gives the button an equal margin on both sides (#1)', async () => {
  await runApp(async (_app, win) => {
    await win.getByTestId('pane-hide-left').click();
    await expect(win.getByTestId('pane-rail-left')).toBeVisible();
    await win.waitForTimeout(300); // let the collapse animation settle
    const margins = await win.evaluate(() => {
      const rail = document.querySelector('[data-testid="sidebar-pane"]') as HTMLElement;
      const btn = document.querySelector('[data-testid="pane-show-left"]') as HTMLElement;
      const rr = rail.getBoundingClientRect();
      const br = btn.getBoundingClientRect();
      return { left: br.left - rr.left, right: rr.right - br.right };
    });
    expect(Math.abs(margins.left - margins.right)).toBeLessThan(2); // equal margins
  });
});

test('the three pane headers share a bottom border line (#6)', async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'Aligned', 'C:/c/aligned'); // opens a tab-strip; explorer auto-expands
    // Creating a project makes it active, so the explorer shows the TREE (not the
    // no-active-project empty state). Wait for the tree so the pane has laid out.
    await expect(win.getByTestId('file-explorer-tree')).toBeVisible();

    const bottoms = await win.evaluate(() => {
      const r = (sel: string): number =>
        (document.querySelector(sel) as HTMLElement).getBoundingClientRect().bottom;
      return {
        projects: r('[data-testid="projects-panel"] .panel__header'),
        tabs: r('.tab-strip'),
        files: r('[data-testid="file-explorer-pane"] .panel__header'),
      };
    });
    expect(Math.abs(bottoms.projects - bottoms.tabs)).toBeLessThan(2);
    expect(Math.abs(bottoms.files - bottoms.tabs)).toBeLessThan(2);
  });
});
