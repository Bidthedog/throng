import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { openApp, createProject, geom, type OpenApp } from './harness.js';

// On a narrow window the side panes auto-collapse to their rails (Explorer first,
// then the sidebar) so the app stays usable at half a 1920 screen; they restore to
// expanded when the window widens again (panes the user wants open). This is
// distinct from a manual collapse.

/*
 * ══ ONE APP FOR THE FILE (034 FR-045) — 4 launches → 1 ══
 *
 * Four tests, four `runApp()` calls, four Electron launches and four daemons. Nothing here seeds
 * state before the app starts, so the only question is whether the four can follow one another in
 * one window. Two things said no, and both had fixes that touch no assertion.
 *
 * BLOCKER 1 — ROOT EXCLUSIVITY, which would have killed the run outright. All four called
 * `createProject(win, 'Alpha', 'C:/code/alpha')`. FR-029 (`assertFolderExclusive` /
 * `isFolderConflict`, packages/core/src/projects/project.ts) refuses a root that is identical to,
 * an ancestor of, or a descendant of an existing project's root — so under one app the SECOND
 * creation is refused, `createProject` never sees the active row it waits for, and the test dies
 * inside the harness helper. Each test now has its own name AND its own root. The four roots are
 * siblings (`C:/code/alpha1` … `alpha4`), which `isFolderConflict` compares with a `${y}/` prefix
 * test, so none of them conflicts with any other. The roots are fictional — this file never reads
 * a file — and which project is active is irrelevant to every assertion below; all that matters is
 * that ONE is, because the Explorer pane defaults collapsed without one.
 *
 * BLOCKER 2 — the file's whole subject is pane state, and every test changes it. This looked
 * fatal and is not, and the reason is worth stating because it is the thing an eye-level reading
 * gets wrong: `autoLeft`/`autoRight` (renderer/app.tsx) are RE-DERIVED from width on every
 * ResizeObserver tick, from `userLeft`/`userRight` and the set widths alone. A manual EXPAND
 * therefore leaves no residue past the next resize — it sets the user flag to `true`, which it
 * already was, and clears an auto flag that the next resize recomputes anyway. The only durable
 * user-intent change in the file is test 4's manual COLLAPSE, and test 4 is last.
 *
 * So the leftovers that actually reach the next test are: the window size, and the sidebar's SET
 * width (test 3 drags it to its 400 max, which persists in localStorage). Both are answered by
 * each test resizing before it measures — which every test already did — with one reordering:
 * test 3 now resizes to 1600 BEFORE creating its project rather than after, so it never runs
 * `createProject` against the 600px window test 2 leaves behind. Nothing about what test 3 asserts
 * changed; the same resize call simply happens two lines earlier.
 *
 * Test 4 inherits the 400px sidebar. Checked rather than assumed: at 1500px,
 * 400 + 320 + WORKSPACE_MIN_WIDTH(480) = 1200 ≤ 1500, so nothing auto-collapses and
 * `pane-hide-right` — the button test 4 clicks — is present, exactly as with the 260px default.
 *
 * ORDER IS LOAD-BEARING, so say it: test 1 must run first. Its claim is that panes which were
 * never touched by hand auto-collapse and auto-RESTORE, and it is the only test here entitled to
 * assume nothing has been touched. Declaration order gives it that; do not add a test above it.
 *
 * Deliberately NOT `mode: 'serial'`. Four independent claims about the pane coordinator; a first
 * failure that skipped the other three would replace three answers with one. `fullyParallel: false`
 * already pins a file to one worker in declaration order, so the shared window is never driven by
 * two tests at once — and because every test re-establishes its own window size before measuring,
 * a failure part-way through one does not decide the next one's outcome.
 */
let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp();
});

test.afterAll(async () => {
  await shared?.close();
});

const resize = (app: ElectronApplication, w: number, h: number) =>
  app.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setSize(width, height), [w, h]);

test('side panes auto-collapse on a narrow window and restore when widened', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  const app = shared.app;
  const win = shared.win;
  // Own name AND own root — FR-029 refuses a duplicate root, and all four tests used to share one.
  await createProject(win, 'AutoCollapse1', 'C:/code/alpha1'); // activates the Explorer pane

  // Wide: both side panes expanded.
  await resize(app, 1500, 800);
  await expect(win.getByTestId('pane-hide-left')).toBeVisible();
  await expect(win.getByTestId('pane-hide-right')).toBeVisible();

  // Half a 1920 screen: Explorer contracts first; the sidebar stays expanded.
  await resize(app, 960, 800);
  await expect(win.getByTestId('pane-rail-right')).toBeVisible();
  await expect(win.getByTestId('pane-hide-left')).toBeVisible();

  // Narrower still (at the floor): the sidebar contracts too.
  await resize(app, 600, 800);
  await expect(win.getByTestId('pane-rail-right')).toBeVisible();
  await expect(win.getByTestId('pane-rail-left')).toBeVisible();

  // Widen again: both restore to expanded (they were never manually collapsed).
  await resize(app, 1500, 800);
  await expect(win.getByTestId('pane-hide-left')).toBeVisible();
  await expect(win.getByTestId('pane-hide-right')).toBeVisible();
  await expect(win.getByTestId('pane-rail-left')).toHaveCount(0);
  await expect(win.getByTestId('pane-rail-right')).toHaveCount(0);
});

test('an auto-collapsed pane can be expanded at the minimum window size (and stays open)', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  const app = shared.app;
  const win = shared.win;
  await createProject(win, 'AutoCollapse2', 'C:/code/alpha2');

  // Shrink to the floor: both panes auto-collapse to rails.
  await resize(app, 600, 800);
  await expect(win.getByTestId('pane-rail-left')).toBeVisible();
  await expect(win.getByTestId('pane-rail-right')).toBeVisible();

  // Expand the sidebar — it must open and STAY open (no flash / re-collapse),
  // even though there's no room for the workspace minimum.
  await win.getByTestId('pane-show-left').click();
  await expect(win.getByTestId('pane-hide-left')).toBeVisible();
  // sleep-justified: a delayed re-collapse regression has no event to fence on — it is a bug
  // that would show up SOME TIME after the expand, and nothing marks "that window has passed".
  await win.waitForTimeout(400);
  await expect(win.getByTestId('pane-hide-left')).toBeVisible();
  await expect(win.locator('.pane--sidebar:not(.pane--collapsed)')).toBeVisible();

  // The Explorer can be expanded too.
  await win.getByTestId('pane-show-right').click();
  await expect(win.getByTestId('pane-hide-right')).toBeVisible();
  // sleep-justified: same delayed-re-collapse regression as the sidebar above, for the
  // Explorer pane — no event marks "it will not flip back" either.
  await win.waitForTimeout(400);
  await expect(win.getByTestId('pane-hide-right')).toBeVisible();
});

test('a pane expands only to a sensible width when the window is too narrow, then restores', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  const app = shared.app;
  const win = shared.win;
  /*
   * The resize comes BEFORE the project now (it used to be the line after). The previous test
   * leaves the window at 600px, where the sidebar renders at its clamped 250px minimum, and
   * creating a project through that is a needless narrow-window journey this test is not about.
   * Same call, same value, two lines earlier — no assertion is affected.
   */
  await resize(app, 1600, 800);
  await createProject(win, 'AutoCollapse3', 'C:/code/alpha3');

  // Drag the sidebar out to its max (400) so its SET width is large.
  const h = await win.getByTestId('sidebar-hresize').boundingBox();
  if (!h) throw new Error('no sidebar handle');
  await win.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await win.mouse.down();
  await win.mouse.move(h.x + 600, h.y + h.height / 2, { steps: 10 });
  await win.mouse.up();
  const sideW = () =>
    win.evaluate(() => Math.round((document.querySelector('.pane--sidebar') as HTMLElement).getBoundingClientRect().width));
  expect(await sideW()).toBeGreaterThanOrEqual(390); // ~400 set width

  // Narrow so both panes auto-collapse, then manually expand the sidebar.
  await resize(app, 700, 800);
  await win.getByTestId('pane-show-left').click();
  await expect(win.getByTestId('pane-hide-left')).toBeVisible();
  // It expands to a sensible width (~its 250 min), NOT its 400 set width. geom() measures
  // once the resize-collapse animation has actually stopped, rather than guessing at a delay.
  // not-a-clock: 270 bounds a WIDTH in pixels, not a duration — the pane's ~250px minimum plus a
  // little slack, asserted against its 400px set width. Nothing here is timed, so 034 SC-007 does
  // not govern it; `geom()` above is what removed the timing from this measurement.
  const narrowBox = await geom(win.locator('.pane--sidebar'));
  expect(narrowBox.w).toBeLessThanOrEqual(270);
  expect(narrowBox.w).toBeGreaterThanOrEqual(245);

  // Widen again: it restores to its full set width (the clamp is display-only).
  await resize(app, 1600, 800);
  expect((await geom(win.locator('.pane--sidebar'))).w).toBeGreaterThanOrEqual(390);
});

test('a manually-collapsed pane is NOT auto-restored when the window widens', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  const app = shared.app;
  const win = shared.win;
  await createProject(win, 'AutoCollapse4', 'C:/code/alpha4');
  await resize(app, 1500, 800);

  // Manually collapse the Explorer.
  await win.getByTestId('pane-hide-right').click();
  await expect(win.getByTestId('pane-rail-right')).toBeVisible();

  // Narrow then widen — the manual collapse must persist (not auto-restore).
  await resize(app, 960, 800);
  await resize(app, 1500, 800);
  await expect(win.getByTestId('pane-rail-right')).toBeVisible();
  await expect(win.getByTestId('pane-show-right')).toBeVisible();
});
