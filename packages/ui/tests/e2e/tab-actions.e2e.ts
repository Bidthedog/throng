/**
 * 031 US3 — the tab-actions group (#225).
 *
 * contracts/tab-strip.md §4 T1–T4 and §2 S2/S3/S4. The group is the answer to "there are tabs you
 * cannot see": three controls, each carrying the count it concerns, appearing only when there is
 * something hidden to steer towards.
 *
 * Every count assertion here compares the RENDERED BADGE against the strip measured from the DOM,
 * using the definition in the contract (a tab is hidden only when it is *entirely* past an edge).
 * The definition is restated in `helpers/tabs.ts` rather than imported from `@throng/core`, so these
 * tests cannot agree with the implementation by construction — the unit suite already proves the
 * arithmetic, and what is left for E2E is whether the numbers on screen describe the screen.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  commitTabRename,
  cleanupTemp,
  geom,
  settle,
  type OpenApp,
} from './harness.js';
import {
  EPS,
  actionBadges,
  anchorIndex,
  expectCountsInSync,
  expectedCounts,
  seedOverflowingTabs,
  setScrollLeft,
  stripState,
  traceScroll,
} from './helpers/tabs.js';
import { armAndClose } from './helpers/tab-settings.js';

// One app for the file: no test here seeds state per-launch. The config root IS seeded once, before
// the single launch, because destroying a tab must not stop to ask — the confirmation dialog is
// destroy.e2e.ts's subject, not this file's.
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
let cfgRoot: string;
const roots: string[] = [];

test.beforeAll(async () => {
  cfgRoot = mkdtempSync(join(tmpdir(), 'throng-cfg-tabactions-'));
  writeFileSync(
    join(cfgRoot, 'settings.json'),
    JSON.stringify({ confirmations: { destroyTab: 'none' } }, null, 2),
    'utf8',
  );
  shared = await openApp({ env: { THRONG_CONFIG_ROOT: cfgRoot } });
});

test.afterAll(async () => {
  await shared?.close();
  for (const root of roots) cleanupTemp(root);
  if (cfgRoot) cleanupTemp(cfgRoot);
});

let seq = 0;

/**
 * A fresh project, so each test starts from ONE tab and no scroll.
 *
 * Self-sufficiency is not politeness here: these tests share an app, and a test that inherited the
 * previous one's tab set would silently change meaning the first time that previous test was retried
 * or reordered. Seeding is a second; a phantom ordering dependency costs an hour.
 */
async function freshProject(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'throng-tabactions-'));
  roots.push(root);
  await newProject(shared.win, `tabactions-${(seq += 1)}`, root);
  await settle(shared.win);
}

test('T044 — the tab-actions group appears only once the strip overflows (T1)', async () => {
  await freshProject();

  // PRESENT first, absent second. A bare `toHaveCount(0)` is satisfied by a DOM that has not
  // rendered the strip at all, and would pass for the wrong reason forever.
  await expect(shared.win.getByTestId('tab-strip')).toBeVisible();
  await expect(shared.win.getByTestId('tab-add')).toBeVisible();
  const before = await stripState(shared.win);
  expect(expectedCounts(before).overflowing, 'one tab does not overflow the strip').toBe(false);
  await expect(shared.win.getByTestId('tabstrip-actions')).toHaveCount(0);

  await seedOverflowingTabs(shared.win, 'actions-appear');

  await expect(shared.win.getByTestId('tabstrip-actions')).toBeVisible();
  const after = await stripState(shared.win);
  expect(expectedCounts(after).overflowing).toBe(true);
});

test('T044 — the group sits inside the pane, between the tabs and New Tab (T1)', async () => {
  await freshProject();
  await seedOverflowingTabs(shared.win, 'actions-place');

  const strip = await geom(shared.win.getByTestId('tab-strip'));
  const track = await geom(shared.win.getByTestId('tabstrip-track'));
  const actions = await geom(shared.win.getByTestId('tabstrip-actions'));
  const add = await geom(shared.win.getByTestId('tab-add'));

  // Inside the pane's strip, vertically and horizontally.
  expect(actions.x).toBeGreaterThanOrEqual(strip.x - 1);
  expect(actions.x + actions.w).toBeLessThanOrEqual(strip.x + strip.w + 1);
  expect(actions.y).toBeGreaterThanOrEqual(strip.y - 1);

  // AFTER the tabs: the group is outside the scrolling track, which is what stops it scrolling away
  // from the tabs it steers.
  expect(actions.x).toBeGreaterThanOrEqual(track.x + track.w - 1);
  // …and BEFORE New Tab, which stays pinned at the far right (L3).
  expect(actions.x + actions.w).toBeLessThanOrEqual(add.x + 1);
});

test('T044 — three themed icon controls, each with a hover title naming its action (T2, T4)', async () => {
  await freshProject();
  await seedOverflowingTabs(shared.win, 'actions-icons');

  const expected: Array<[string, RegExp]> = [
    ['tabstrip-step-left', /previous tab/i],
    ['tabstrip-step-right', /next tab/i],
    ['tabstrip-show-all', /show all tabs/i],
  ];
  for (const [testId, names] of expected) {
    const control = shared.win.getByTestId(testId);
    await expect(control, `${testId} is present`).toBeVisible();
    // A themed icon, drawn by the shared <Icon> (constitution: themeable icon controls) — never a
    // bare glyph typed into the markup, which no icon pack could ever replace.
    await expect(control.locator('.icon'), `${testId} renders a themed icon`).toHaveCount(1);
    // The action is NAMED by the title, since the icon carries no text.
    const title = await control.getAttribute('title');
    expect(title ?? '', `${testId} names its action on hover`).toMatch(names);
    expect(await control.getAttribute('aria-label')).toBe(title);
  }
});

test('T045 — the three counts are hidden-left, hidden-right and total, and follow a scroll (T3, S2)', async () => {
  await freshProject();
  await seedOverflowingTabs(shared.win, 'actions-counts');

  // At the far left nothing is hidden that way, and everything past the edge is hidden right.
  await setScrollLeft(shared.win, 0);
  const atLeft = await stripState(shared.win);
  const wantLeft = expectedCounts(atLeft);
  expect(wantLeft.hiddenLeft, 'nothing is hidden to the left at scrollLeft 0').toBe(0);
  expect(wantLeft.hiddenRight, 'an overflowing strip hides something to the right').toBeGreaterThan(0);
  expect(await actionBadges(shared.win)).toEqual({
    hiddenLeft: wantLeft.hiddenLeft,
    hiddenRight: wantLeft.hiddenRight,
    total: wantLeft.total,
  });
  expect(wantLeft.total, 'total counts every tab, hidden or not').toBe(atLeft.chips.length);

  // Scroll to the far right: the two sides swap, and the badges follow. `setScrollLeft` polls until
  // the displayed counts agree with the measured strip, so this asserts S2 as well as reaching it.
  await setScrollLeft(shared.win, atLeft.maxScroll);
  const atRight = await stripState(shared.win);
  const wantRight = expectedCounts(atRight);
  expect(wantRight.hiddenRight, 'nothing is hidden to the right at the end').toBe(0);
  expect(wantRight.hiddenLeft, 'tabs are now hidden to the left').toBeGreaterThan(0);
  expect(await actionBadges(shared.win)).toEqual({
    hiddenLeft: wantRight.hiddenLeft,
    hiddenRight: wantRight.hiddenRight,
    total: wantRight.total,
  });

  // A partly-visible tab is counted on NEITHER side (S1), so the two counts and the visible tabs
  // must never add up to more than the total.
  expect(wantRight.hiddenLeft + wantRight.hiddenRight).toBeLessThan(wantRight.total);
});

test('T045 — the counts follow an add and a destroy (S2)', async () => {
  await freshProject();
  await seedOverflowingTabs(shared.win, 'actions-add-destroy');
  await setScrollLeft(shared.win, 0);
  const start = (await expectCountsInSync(shared.win)).total;

  // ADD — the new tab is created active, so the strip also scrolls to reveal it; the counts must
  // describe where it ended up, not where it started.
  await shared.win.getByTestId('tab-add').click();
  await commitTabRename(shared.win);
  const added = await expectCountsInSync(shared.win);
  expect(added.total, 'a new tab is counted').toBe(start + 1);

  /*
   * DESTROY — rest on the tab until its affordance arms, then press it.
   *
   * It used to be one bare click, because P9 exempted the ACTIVE tab from the arming delay. 031 US7
   * / FR-057 supersedes that: the delay now applies to every tab, so a click without the rest is a
   * click inside the arming window and is ignored. `confirmations.destroyTab: none` (seeded before
   * launch) still means no dialog once it does land.
   */
  const active = (await stripState(shared.win)).chips.find((chip) => chip.active);
  expect(active, 'some tab is active').toBeTruthy();
  await armAndClose(shared.win, active!.tabId);
  await expect(shared.win.getByTestId(active!.testId)).toHaveCount(0);
  const destroyed = await expectCountsInSync(shared.win);
  expect(destroyed.total, 'a destroyed tab stops being counted').toBe(start);
});

test('T045 — the counts follow a reorder and a window resize (S2)', async () => {
  await freshProject();
  await seedOverflowingTabs(shared.win, 'actions-reorder-resize');
  await setScrollLeft(shared.win, 0);
  const before = await expectCountsInSync(shared.win);

  // REORDER — drag the last VISIBLE chip onto the leading edge of the first. Only visible chips can
  // be dragged, which is the whole reason this is worth an E2E: reordering changes every offset to
  // the right of the drop, so the counts are computed against a strip that has been rebuilt.
  const state = await stripState(shared.win);
  const order = state.chips.map((chip) => chip.testId);
  const visible = state.chips.filter(
    (chip) => chip.left >= state.scrollLeft - EPS && chip.right <= state.scrollLeft + state.viewportWidth + EPS,
  );
  expect(visible.length, 'at least two tabs are fully visible to drag between').toBeGreaterThan(1);
  const source = shared.win.getByTestId(visible[visible.length - 1]!.testId);
  const target = shared.win.getByTestId(visible[0]!.testId);
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  expect(from && to, 'both chips have boxes').toBeTruthy();
  await shared.win.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await shared.win.mouse.down();
  await shared.win.mouse.move(from!.x + from!.width / 2 - 10, from!.y + from!.height / 2, { steps: 3 });
  await shared.win.mouse.move(to!.x + 4, to!.y + to!.height / 2, { steps: 8 });
  await shared.win.mouse.up();
  await expect
    .poll(async () => (await stripState(shared.win)).chips.map((chip) => chip.testId), {
      message: 'the drag never reordered the strip',
    })
    .not.toEqual(order);
  const reordered = await expectCountsInSync(shared.win);
  expect(reordered.total, 'a reorder moves tabs, it does not create or destroy them').toBe(
    before.total,
  );

  /*
   * RESIZE — the track gets wider, so fewer tabs are hidden and the counts must be recomputed.
   *
   * WIDENING rather than narrowing, deliberately. The workspace pane already sits near its declared
   * minimum at the default window size (workspace-min-width.e2e.ts), so a narrower window collapses
   * the side panes and leaves the track exactly as wide as it was — a resize the strip is right not
   * to react to, and a test that would have asserted nothing. Growing the window always reaches the
   * track.
   */
  //
  // Addressed through `app.browserWindow(page)` rather than `getAllWindows()[0]`: the application
  // owns more than one BrowserWindow (the drag ghost among them), and resizing whichever happened to
  // be first silently resized something the strip has never heard of.
  const browserWindow = await shared.app.browserWindow(shared.win);
  const original = await browserWindow.evaluate((w) => w.getSize());
  const trackWidthBefore = (await stripState(shared.win)).viewportWidth;
  try {
    await browserWindow.evaluate((w, size) => w.setSize(size[0]!, size[1]!), [
      original[0]! + 360,
      original[1]!,
    ]);
    await expect
      .poll(async () => (await stripState(shared.win)).viewportWidth, {
        message: 'the track never widened with the window',
      })
      .toBeGreaterThan(trackWidthBefore);
    const widened = await expectCountsInSync(shared.win);
    expect(widened.total).toBe(before.total);
  } finally {
    await browserWindow.evaluate((w, size) => w.setSize(size[0]!, size[1]!), original);
    await expect
      .poll(async () => (await stripState(shared.win)).viewportWidth, {
        message: 'the track never returned to its original width',
      })
      .toBe(trackWidthBefore);
    await expectCountsInSync(shared.win);
  }
});

test('T046 — a step moves exactly one tab, landing it flush with the left edge (S3)', async () => {
  await freshProject();
  await seedOverflowingTabs(shared.win, 'actions-step');
  await setScrollLeft(shared.win, 0);

  const before = await stripState(shared.win);
  const anchorBefore = anchorIndex(before);

  await traceScroll(shared.win, () => shared.win.getByTestId('tabstrip-step-right').click());

  const after = await stripState(shared.win);
  const anchorAfter = anchorIndex(after);
  expect(anchorAfter, 'a step right moves the strip on by exactly one tab').toBe(anchorBefore + 1);
  expect(
    Math.abs(after.scrollLeft - after.chips[anchorAfter]!.left),
    'the revealed tab is flush with the left edge',
  ).toBeLessThanOrEqual(1);

  // …and back again, which must return the strip to where it started.
  await traceScroll(shared.win, () => shared.win.getByTestId('tabstrip-step-left').click());
  const back = await stripState(shared.win);
  expect(anchorIndex(back)).toBe(anchorBefore);
  expect(Math.abs(back.scrollLeft - before.scrollLeft)).toBeLessThanOrEqual(1);
});

test('T046 — a step control is unavailable when nothing is hidden that way (S4)', async () => {
  await freshProject();
  await seedOverflowingTabs(shared.win, 'actions-unavailable');

  await setScrollLeft(shared.win, 0);
  await expect(
    shared.win.getByTestId('tabstrip-step-left'),
    'nothing is hidden to the left at the start of the strip',
  ).toBeDisabled();
  await expect(shared.win.getByTestId('tabstrip-step-right')).toBeEnabled();

  const state = await stripState(shared.win);
  await setScrollLeft(shared.win, state.maxScroll);
  await expect(
    shared.win.getByTestId('tabstrip-step-right'),
    'nothing is hidden to the right at the end of the strip',
  ).toBeDisabled();
  await expect(shared.win.getByTestId('tabstrip-step-left')).toBeEnabled();

  // Show all is never unavailable: it lists every tab, and there are always tabs.
  await expect(shared.win.getByTestId('tabstrip-show-all')).toBeEnabled();
});
