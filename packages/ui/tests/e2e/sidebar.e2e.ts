import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import {
  openApp,
  geom,
  type AppOptions,
  type OpenApp,
} from './harness.js';

/*
 * ONE app for this file, not one per test.
 *
 * Each test used to launch its own Electron app, daemon and window — roughly two seconds apiece, and
 * 604 such launches across the suite — to run assertions that never needed a pristine app. Only a
 * test that seeds state BEFORE launch genuinely does, and those keep their own app via `runOwnApp`.
 *
 * The shims below exist so the test bodies below are unchanged:
 *   runApp        runs the body against the shared window. It refuses options rather than ignoring
 *                 them: a dropped config root does not fail, it passes for the wrong reason.
 *   createProject appends a counter, because a shared app accumulates projects and duplicate names
 *                 make `.project-item` ambiguous.
 *
 * Serial mode is required — shared window, shared database — and it means a failure skips the rest
 * rather than running them against whatever state the failure left behind.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
test.beforeAll(async () => {
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win'], ctx: { pipeName: string; userDataDir: string }) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win, {
    pipeName: shared.pipeName,
    userDataDir: shared.userDataDir,
  });
};


// FR-023 (batch 2): the Sidebar Pane hosts ONLY the Projects and Sub-workspaces
// panels — the Terminals panel was removed — and the Sub-workspaces panel is
// pinned to the bottom of the pane (headers stay fixed-size; #2/#3).

/*
 * ONE TEST REMOVED (035) — "sidebar shows Projects + Sub-workspaces only (no Terminals panel)", now
 * `packages/ui/tests/unit/sidebar-panels.test.ts`.
 *
 * It is the one migration in this branch that went to a SOURCE GUARD rather than to a render, and
 * the reason is the shape of the claim. Two of its three assertions were ordinary rendering, and
 * both are already made better elsewhere — `component/projects-panel-form.test.ts` and
 * `component/subworkspace-sync.test.ts` each mount their panel against a real store, which is
 * stronger evidence than a visibility check from a spec that created no projects.
 *
 * The third is what the test exists for: **the Terminals panel is gone entirely.** That is a claim
 * about ABSENCE across the whole renderer, and a render test is at its weakest there —
 * `queryByTestId('terminals-panel')` returning null is satisfied by the panel existing somewhere
 * this mount did not reach, by the testid having been renamed, and by the tree failing to render at
 * all. The guard walks the renderer instead and checks all three names the panel had, because a
 * partial revert (a component restored without its testid) is the realistic failure.
 *
 * It also reads the sidebar's panel LIST out of `app.tsx` and asserts the order, which nothing did:
 * a stack whose two members were swapped satisfied every assertion the E2E made.
 *
 * The two tests below stay. They read COMPUTED heights and a pinned position out of a real layout
 * engine, which is `@reserve:layout`.
 */

test('pane headers are fixed-size and the Sub-workspaces panel has a min height', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
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

test('Sub-workspaces is pinned to the bottom of the sidebar body', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
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

test('the Projects / Sub-workspaces divider resizes them independently', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
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

test('on window resize only PROJECTS changes; Sub-workspaces stays pinned to the bottom', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
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
    // Wait for Projects — the panel that actually absorbs the resize — to stop moving before
    // measuring, rather than assuming a fixed duration is always enough for it to propagate.
    await geom(win.getByTestId('projects-panel'));
    const big = await measure();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 680));
    await geom(win.getByTestId('projects-panel'));
    const small = await measure();

    expect(big.proj - small.proj).toBeGreaterThan(150); // Projects absorbed the change
    expect(Math.abs(big.sub - small.sub)).toBeLessThanOrEqual(2); // pinned, unchanged
    expect(big.bottomGap).toBeLessThanOrEqual(2); // stays anchored to the bottom
    expect(small.bottomGap).toBeLessThanOrEqual(2);
  });
});
