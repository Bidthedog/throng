import { test, expect, type Page } from '@playwright/test';
import { openApp, createProject, settle, geom, viewport, type OpenApp } from './harness.js';

// FR #3: the collapse control lives next to the pane title (no permanent rail
// strip when expanded); when collapsed, only the rail remains and the button
// stays in the SAME position + size. We measure the button's gap from the pane's
// OUTER window edge (robust to the window settling to its final size).
//
// 017 (#66) — this file used to be flaky, and it contained the whole defect class:
//
//   1. It OPENED with `expect(pane-rail-left).toHaveCount(0)` — a NEGATIVE assertion,
//      which a DOM that has not rendered anything satisfies vacuously. It looked like
//      a settle and settled nothing.
//   2. It then measured geometry through `win.evaluate(() => document.querySelector(…)
//      .getBoundingClientRect())`, which does NOT auto-wait — so it either threw on a
//      null element or measured one the stylesheet had not reached yet.
//   3. It papered over both with `waitForTimeout(300)` "let the animation settle".
//
// For the FIRST test — the one #66 is actually about — the sleep was never load-bearing:
// that button is `position: absolute` at a fixed offset from the window's left edge, and
// the only transition is the shell's 180ms `grid-template-columns`, which cannot move it.
// The missing SETTLE was the bug.
//
// But the other tests here DO measure something that animates: the pane's own width is the
// grid column being transitioned. So their sleep was load-bearing, and simply deleting it
// makes them read mid-animation (measured: 98px and 163px out).
//
// The answer is not to put the sleep back. `geom()` polls until the element has STOPPED
// MOVING — a real condition — so it replaces "wait 300ms and hope" with "wait until the
// thing you are about to measure has settled". No sleeps, and no timing assumptions.

/*
 * ══ ONE APP FOR THE FILE (034 FR-045) — 4 launches → 1 ══
 *
 * Four tests, four `runApp()` calls, four Electron launches and four daemons, none of which
 * seeds anything before the app starts. What made this file unsafe to share was NOT a launch
 * option: it was ONE test leaving a pane collapsed.
 *
 * THE BLOCKER, and the fix. Test 3 collapsed the LEFT pane and never restored it. Test 4 then
 * measures `[data-testid="projects-panel"] .panel__header`, which lives INSIDE that pane — and a
 * collapsed pane renders only its rail (test 1 asserts exactly that). `geom()` throws rather than
 * returning null, so test 4 would have failed with "never became visible", a failure with nothing
 * to do with pane-header alignment. Test 3 now restores the pane in a `finally`, so it cleans up
 * even when its own assertion fails — which is the case that matters, since a failed test is
 * precisely when the next one inherits the mess.
 *
 * NOTHING ELSE CHANGED. Every assertion below is byte-for-byte the original. In particular test
 * 1 already restored what it collapsed, and test 4 is the only test that creates a project — so
 * its name and root cannot collide with anything (FR-029 root exclusivity is not in play here).
 *
 * WHAT IS ORDER-DEPENDENT, stated rather than left to be discovered. Test 2's opening claim —
 * "No project → right pane defaults collapsed" — is about the whole session's history, not about
 * anything test 2 does. It holds here because test 1 touches only the left pane and test 4 (the
 * one that creates a project) runs after it. That was equally true of the old file's declaration
 * order; a shared app does not weaken it, but it does make it matter, so: DO NOT move test 4
 * above test 2, and do not add a project-creating test before it.
 *
 * Test 2 leaves the right pane expanded. That is harmless: test 3 touches only the left pane, and
 * test 4 makes a project active, which expands the right pane anyway.
 *
 * Deliberately NOT `mode: 'serial'`. These four ask four independent questions about pane
 * geometry, and a first failure that skipped the rest would turn "the collapsed rail's margins
 * are wrong" into "something about panes is wrong". `fullyParallel: false` (playwright.config.ts)
 * already keeps a file to one worker, in declaration order, so the shared app is never driven by
 * two tests at once — serial mode would only add the skipping, which is the part we do not want.
 * The `finally` above is what makes that choice safe: the cleanup a serial skip would have made
 * unnecessary happens regardless of the outcome.
 */
let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp();
});

test.afterAll(async () => {
  await shared?.close();
});

/**
 * The button's gap from its pane's outer window edge, plus its size.
 *
 * `geom()` FIRST — it auto-waits, and so establishes that the layout has settled —
 * then read the viewport. That ordering is what makes the two values consistent.
 */
async function buttonGeom(
  win: Page,
  testid: string,
  side: 'left' | 'right',
): Promise<{ gap: number; y: number; w: number; h: number }> {
  const b = await geom(win.getByTestId(testid));
  const vp = await viewport(win);
  const gap = side === 'left' ? b.x : vp.width - (b.x + b.w);
  return { gap, y: b.y, w: b.w, h: b.h };
}

function approxSame(a: { gap: number; y: number; w: number; h: number }, b: typeof a): void {
  expect(Math.abs(a.gap - b.gap)).toBeLessThan(2);
  expect(Math.abs(a.y - b.y)).toBeLessThan(2);
  expect(Math.abs(a.w - b.w)).toBeLessThan(2);
  expect(Math.abs(a.h - b.h)).toBeLessThan(2);
}

test('left pane: no rail strip when expanded; collapse keeps the button fixed', { tag: ['@extended', '@window'] }, async () => {
  const win = shared.win;
  // POSITIVE settle first. The rail-absence check below is only meaningful once we
  // know the app has actually rendered — otherwise it passes against a blank page.
  await settle(win);
  await expect(win.getByTestId('pane-hide-left')).toBeVisible();
  await expect(win.getByTestId('pane-rail-left')).toHaveCount(0); // no strip when expanded

  const expanded = await buttonGeom(win, 'pane-hide-left', 'left');

  await win.getByTestId('pane-hide-left').click();
  await expect(win.getByTestId('pane-rail-left')).toBeVisible();
  // No sleep: `pane-show-left` only exists after the collapse has re-rendered, so
  // awaiting it IS the settle. geom() waits for it to be visible before measuring.
  const collapsed = await buttonGeom(win, 'pane-show-left', 'left');
  approxSame(expanded, collapsed);

  await win.getByTestId('pane-show-left').click();
  await expect(win.getByTestId('pane-hide-left')).toBeVisible();
  await expect(win.getByTestId('pane-rail-left')).toHaveCount(0);
});

test('right pane: rail only while collapsed; expand reveals the explorer', { tag: ['@extended', '@window'] }, async () => {
  const win = shared.win;
  await settle(win);
  // No project → right pane defaults collapsed: rail shown, button present.
  //
  // This is a claim about the session's HISTORY, not about anything this test does: it holds
  // only while no project has ever been made active in this window and nobody has expanded the
  // pane by hand. See the file header — test 4 is the only test that creates a project, and it
  // runs after this one. Nothing here is weakened; the dependency is simply named.
  await expect(win.getByTestId('pane-rail-right')).toBeVisible();
  const collapsed = await buttonGeom(win, 'pane-show-right', 'right');

  await win.getByTestId('pane-show-right').click();
  await expect(win.getByTestId('file-explorer-empty')).toBeVisible();
  await expect(win.getByTestId('pane-rail-right')).toHaveCount(0);
  const expanded = await buttonGeom(win, 'pane-hide-right', 'right');
  approxSame(collapsed, expanded);
});

test('a collapsed rail gives the button an equal margin on both sides (#1)', { tag: ['@extended', '@window'] }, async () => {
  const win = shared.win;
  await settle(win);
  await win.getByTestId('pane-hide-left').click();
  try {
    await expect(win.getByTestId('pane-rail-left')).toBeVisible();

    const rail = await geom(win.getByTestId('sidebar-pane'));
    const btn = await geom(win.getByTestId('pane-show-left'));
    const left = btn.x - rail.x;
    const right = rail.x + rail.w - (btn.x + btn.w);
    expect(Math.abs(left - right)).toBeLessThan(2); // equal margins
  } finally {
    /*
     * THE ONE FIX THIS FILE NEEDED (034 FR-045).
     *
     * Pane collapse state is per-window and survives everything short of a relaunch, so under a
     * shared app this test's collapse is permanent for the file. The next test measures the
     * projects panel's header — which is inside this pane — and a collapsed pane renders only its
     * rail, so it would fail on an element that can never appear.
     *
     * In a `finally` on purpose: the state to restore exists from the click above onwards, so a
     * failed assertion in between must not be allowed to leave it behind.
     */
    await win.getByTestId('pane-show-left').click();
    await expect(win.getByTestId('pane-hide-left')).toBeVisible();
    await expect(win.getByTestId('pane-rail-left')).toHaveCount(0);
  }
});

test('the three pane headers share a bottom border line (#6)', { tag: ['@extended', '@window'] }, async () => {
  const win = shared.win;
  await settle(win);
  await createProject(win, 'Aligned', 'C:/c/aligned'); // opens a tab-strip; explorer auto-expands
  // Creating a project makes it active, so the explorer shows the TREE (not the
  // no-active-project empty state). Wait for the tree so the pane has laid out.
  await expect(win.getByTestId('file-explorer-tree')).toBeVisible();

  const bottom = async (selector: string): Promise<number> => {
    const g = await geom(win.locator(selector));
    return g.y + g.h;
  };
  const projects = await bottom('[data-testid="projects-panel"] .panel__header');
  const tabs = await bottom('.tab-strip');
  const files = await bottom('[data-testid="file-explorer-pane"] .panel__header');

  expect(Math.abs(projects - tabs)).toBeLessThan(2);
  expect(Math.abs(files - tabs)).toBeLessThan(2);
});
