import { test, expect } from '@playwright/test';
import { createProject, runApp } from './harness.js';

// US7 / T074: detach a Tab or Panel out of the main workspace into a brand-new
// sub-workspace window. The reliable, discoverable trigger is the context-menu
// "Detach to new window" action (the same handler also fires on a drag that drops
// beyond the window edge). After detach: a new window renders the detached
// content, the main workspace is trimmed, and the sub-workspace is listed in the
// sidebar with an auto name ("Sub-workspace 1").

test('detaches a Tab into a new sub-workspace window', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  await runApp(async (app, win) => {
    await createProject(win, 'Detacher', 'C:/c/detacher');
    await expect(win.getByTestId('tab-strip')).toBeVisible();

    // Two Tabs (to prove the *cloned* one is left behind, not the only one).
    await win.getByTestId('tab-add').click();
    await expect(win.locator('.tab-chip')).toHaveCount(2);

    // Switch to the first Tab (also commits the new Tab's rename input), then
    // open its context menu and detach it.
    const firstTab = win.locator('.tab-chip').first();
    await firstTab.click();
    await firstTab.click({ button: 'right' });
    await expect(win.getByTestId('context-menu')).toBeVisible();
    await win.getByTestId('menu-item-Sync to').click(); // open the submenu

    const [child] = await Promise.all([
      app.waitForEvent('window'),
      win.getByTestId('menu-item-New Sub-workspace').click(),
    ]);
    await child.waitForLoadState('domcontentloaded');

    // The detached Tab's Panel renders in the new sub-workspace window.
    await expect(child.getByTestId('subworkspace-window')).toBeVisible();
    await expect(child.locator('.panel-box')).toHaveCount(1);

    // Clone, not move: the main workspace KEEPS both Tabs, and the sidebar lists
    // the new sub-workspace with its tab/panel counts (1 tab · 1 panel).
    await expect(win.locator('.tab-chip')).toHaveCount(2);
    await expect(win.getByTestId('subworkspace-list')).toContainText('Sub-workspace 1');
    await expect(win.getByTestId('subworkspace-list')).toContainText('1T·1P');
  });
});

/*
 * MOVED to `packages/ui/tests/component/subworkspace-sync.test.ts` (034 FR-045) — one test,
 * "detaches a Panel into a new sub-workspace window".
 *
 * WHY THE PANEL ONE AND NOT THE TAB ONE. Their window halves were IDENTICAL: both launched
 * Electron, detached, waited for `app.waitForEvent('window')` and asserted one
 * `subworkspace-window` with one `.panel-box`. Everything that actually distinguished the two
 * specs is state — `detachPanel` versus `detachTab` — and both are proved at
 * `packages/core/tests/unit/sub-workspace.test.ts:89` and `:159`. So this was a second Electron
 * launch, plus a second daemon, spent to observe the same window twice.
 *
 * WHAT THE REPLACEMENT ASSERTS MORE STRONGLY THAN THIS DID:
 *   - the PERSISTED document, not the sidebar text: the created sub-workspace holds exactly one
 *     Tab holding exactly the detached Panel, and is APPENDED to the existing set rather than
 *     replacing it — this spec could only see "Sub-workspace 1" appear in a list
 *   - "clone, not move" against the WHOLE main layout rather than a `.panel-box` count, so a
 *     detach that re-parented or re-identified the Panel fails instead of passing on a count
 *   - that no `workspace.save` is issued for the main project at all
 *
 * WHAT DID NOT MOVE, AND IS WHY THE TAB TEST BELOW STAYS: a real second BrowserWindow opening
 * and rendering the detached content. That is window lifecycle — a constitution v5.1.0
 * Principle V reserve — and no fake bridge reaches it. The component test asserts only that
 * `window.throng.subWorkspace.open` was called with the new id, which is the call the surviving
 * test’s `waitForEvent('window')` sits downstream of.
 *
 * ANTI-VACUITY CONTROL: drop the `DetachProvider` wrapper from the replacement’s `mount()`.
 * `useDetach()` then returns null, the host draws `no-detach`, and all SIX of its tests fail.
 */
