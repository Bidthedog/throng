import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { runApp } from './harness.js';

// FR-023 (batch 2): the Sidebar Pane hosts ONLY the Projects and Sub-workspaces
// panels — the Terminals panel was removed — and the Sub-workspaces panel is
// pinned to the bottom of the pane (headers stay fixed-size; #2/#3).

test('sidebar shows Projects + Sub-workspaces only (no Terminals panel)', async () => {
  await runApp(async (_app, win) => {
    await expect(win.getByTestId('projects-panel')).toBeVisible();
    await expect(win.locator('.sidebar-panel--subworkspaces')).toBeVisible();
    // The Terminals panel is gone entirely.
    await expect(win.locator('.sidebar-panel--terminals')).toHaveCount(0);
    await expect(win.getByTestId('terminals-panel')).toHaveCount(0);
  });
});

test('pane headers are fixed-size and the Sub-workspaces panel has a min height', async () => {
  await runApp(async (_app, win) => {
    await expect(win.locator('.sidebar-panel--subworkspaces')).toBeVisible();
    const m = await win.evaluate(() => {
      const projPanel = document.querySelector('.sidebar-panel') as HTMLElement; // first = Projects
      const sub = document.querySelector('.sidebar-panel--subworkspaces') as HTMLElement;
      const header = document.querySelector('[data-testid="projects-panel"] .panel__header') as HTMLElement;
      const body = document.querySelector('[data-testid="projects-panel"] .panel__body') as HTMLElement;
      return {
        subMin: getComputedStyle(sub).minHeight,
        projMin: getComputedStyle(projPanel).minHeight,
        headerShrink: getComputedStyle(header).flexShrink,
        headerHeight: Math.round(header.getBoundingClientRect().height),
        bodyOverflow: getComputedStyle(body).overflowY,
      };
    });
    expect(m.subMin).toBe('160px'); // Sub-workspaces always visible
    expect(m.projMin).toBe('34px'); // Projects can shrink to just its header
    expect(m.headerShrink).toBe('0'); // header never squashed (#2)
    expect(m.headerHeight).toBe(34);
    expect(m.bodyOverflow).toBe('auto'); // body (form + list) scrolls instead of overflowing
  });
});

test('Sub-workspaces is pinned to the bottom of the sidebar body', async () => {
  await runApp(async (_app, win) => {
    await expect(win.locator('.sidebar-panel--subworkspaces')).toBeVisible();
    const gap = await win.evaluate(() => {
      const body = (document.querySelector('.pane-sidebar__body') as HTMLElement).getBoundingClientRect();
      const sub = (document.querySelector('.sidebar-panel--subworkspaces') as HTMLElement).getBoundingClientRect();
      return Math.abs(body.bottom - sub.bottom);
    });
    expect(gap).toBeLessThanOrEqual(2); // its bottom edge sits at the pane's bottom
  });
});

test('the Projects / Sub-workspaces divider resizes them independently', async () => {
  await runApp(async (_app, win) => {
    // Two panels → exactly one divider (below Projects); the last panel has none.
    await expect(win.getByTestId('sidebar-vresize')).toBeVisible();
    await expect(win.getByTestId('sidebar-vresize-sub')).toHaveCount(0);

    const panel = win.locator('.sidebar-panel--subworkspaces');
    const before = await panel.boundingBox();
    if (!before) throw new Error('no sub-workspaces panel');

    // Drag the divider UP → Projects shrinks and Sub-workspaces grows.
    const h = await win.getByTestId('sidebar-vresize').boundingBox();
    if (!h) throw new Error('no divider');
    await win.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await win.mouse.down();
    await win.mouse.move(h.x + h.width / 2, h.y + h.height / 2 - 60, { steps: 6 });
    await win.mouse.up();

    const after = await panel.boundingBox();
    expect(after!.height).toBeGreaterThan(before.height + 25);
  });
});

test('on window resize only PROJECTS changes; Sub-workspaces stays pinned to the bottom', async () => {
  await runApp(async (app: ElectronApplication, win) => {
    await expect(win.getByTestId('projects-panel')).toBeVisible();
    const measure = () =>
      win.evaluate(() => {
        const rect = (sel: string): DOMRect =>
          (document.querySelector(sel) as HTMLElement).getBoundingClientRect();
        const body = rect('.pane-sidebar__body');
        const sub = rect('.sidebar-panel--subworkspaces');
        return {
          proj: Math.round(rect('.sidebar-panel').height),
          sub: Math.round(sub.height),
          bottomGap: Math.abs(body.bottom - sub.bottom),
        };
      });

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 900));
    await win.waitForTimeout(300);
    const big = await measure();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 680));
    await win.waitForTimeout(300);
    const small = await measure();

    expect(big.proj - small.proj).toBeGreaterThan(150); // Projects absorbed the change
    expect(Math.abs(big.sub - small.sub)).toBeLessThanOrEqual(2); // pinned, unchanged
    expect(big.bottomGap).toBeLessThanOrEqual(2); // stays anchored to the bottom
    expect(small.bottomGap).toBeLessThanOrEqual(2);
  });
});
