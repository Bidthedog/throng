/**
 * 031 US3 — the tab strip's scrolling (#225).
 *
 * contracts/tab-strip.md §3, A1–A3 and A6–A14. Half of these guarantees are about the SHAPE of a
 * motion rather than its destination — it must not move at all (A2), must not jump back (A6/A8),
 * must settle once (A7), must not be animated (A10/A11) — and none of those can be read from a final
 * position. So `scrollLeft` is sampled once per animation frame and the resulting series is what
 * gets asserted (see `helpers/tabs.ts`).
 *
 * Three apps, because the scroll DURATION is a launch-time seed and it is the independent variable:
 * an eased one for the ordinary guarantees, a deliberately long one for everything that has to be
 * caught mid-flight, and a zero one for A10. Sharing one app and hot-editing the setting would make
 * every test depend on a settings round-trip landing before the gesture — a race, in the file whose
 * whole subject is races.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  commitTabRename,
  cleanupTemp,

  settle,
  type OpenApp,
} from './harness.js';
import {
  EPS,
  anchorIndex,
  beginScrollTrace,
  endScrollTrace,
  expectCountsInSync,
  intermediateSamples,
  isFullyVisible,
  isMonotonic,
  seedOverflowingTabs,
  setScrollLeft,
  stripState,
  waitForScrollStill,
  waitForTraceFrames,
  type Chip,
  type StripState,
} from './helpers/tabs.js';

test.describe.configure({ mode: 'serial' });

const roots: string[] = [];
const cfgRoots: string[] = [];

test.afterAll(() => {
  for (const root of roots) cleanupTemp(root);
  for (const root of cfgRoots) cleanupTemp(root);
});

/** A config root seeded BEFORE launch: the scroll duration is what each group is varying. */
function seedConfig(tabs: Record<string, number>): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-tabscroll-'));
  cfgRoots.push(dir);
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({ tabs, confirmations: { destroyTab: 'none' } }, null, 2),
    'utf8',
  );
  return dir;
}

let seq = 0;
/** A fresh project (and its name), so every test starts from one tab and no scroll. */
async function freshProject(win: Page): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'throng-tabscroll-'));
  roots.push(root);
  const name = `tabscroll-${(seq += 1)}`;
  await newProject(win, name, root);
  await settle(win);
  return name;
}

/**
 * Put a tab deliberately STRADDLING the right edge, and say which one.
 *
 * Derived from the measured strip rather than from a nudge like "scroll by 17px": a nudge produces a
 * partly-visible tab on most runs and, on the run where a chip boundary happens to land on the edge,
 * silently tests nothing. This computes the scroll position that cuts a specific tab by a specific
 * number of pixels, so the precondition either holds or fails loudly.
 */
function cutAtRightEdge(state: StripState, cut = 24): { chip: Chip; scrollLeft: number } {
  for (let i = 0; i < state.chips.length - 1; i += 1) {
    const chip = state.chips[i]!;
    // Put the viewport's right edge `cut` pixels SHORT of the chip's right edge, so exactly that
    // many pixels of it are off screen and the rest — including its leading edge — is clickable.
    const target = chip.right - state.viewportWidth - cut;
    if (target > EPS && target < state.maxScroll - EPS && chip.right - chip.left > cut + 60) {
      return { chip, scrollLeft: target };
    }
  }
  throw new Error('no tab could be positioned straddling the right edge');
}

/** The tab currently marked active. */
function activeChip(state: StripState): Chip {
  const chip = state.chips.find((c) => c.active);
  if (!chip) throw new Error('no tab is marked active');
  return chip;
}

/** The strip has not moved for another window of frames — "settled", not merely "slow". */
async function expectStillAfterSettling(win: Page): Promise<number> {
  await waitForScrollStill(win);
  const resting = (await stripState(win)).scrollLeft;
  await beginScrollTrace(win); // a fresh window of observation, after the settle
  await waitForTraceFrames(win, 24);
  const trace = await endScrollTrace(win);
  for (const sample of trace) {
    expect(
      Math.abs(sample - resting),
      'the strip moved again after it had settled — a queued or superseded scroll left residue',
    ).toBeLessThanOrEqual(1);
  }
  return resting;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * An eased strip (400ms) — the ordinary guarantees.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */
test.describe('an eased strip', () => {
  let shared: OpenApp;

  test.beforeAll(async () => {
    shared = await openApp({ env: { THRONG_CONFIG_ROOT: seedConfig({ smoothScrollMs: 400 }) } });
  });
  test.afterAll(async () => {
    await shared?.close();
  });

  test('T048 — a newly created tab is brought into view (A1: created)', async () => {
    await freshProject(shared.win);
    await seedOverflowingTabs(shared.win, 'scroll-created');
    await setScrollLeft(shared.win, 0);

    // Creating a tab also opens its rename box, and the reveal is measured against the chip as it is
    // AT THAT MOMENT. So the scroll is allowed to finish before the name is committed — committing
    // mid-flight changes the chip's width underneath a target already chosen, which is a different
    // question (and one the user, typing a name, never asks).
    await beginScrollTrace(shared.win);
    await shared.win.getByTestId('tab-add').click();
    await waitForScrollStill(shared.win);

    const state = await stripState(shared.win);
    const created = state.chips[state.chips.length - 1]!;
    expect(created.active, 'a new tab is created active').toBe(true);
    expect(
      isFullyVisible(state, created),
      'the tab that was just created is fully in view, not off the end of the strip',
    ).toBe(true);

    await commitTabRename(shared.win);
    await expectCountsInSync(shared.win);
  });

  test('T048 — clicking a partly-visible tab brings it fully into view (A1: clicked)', async () => {
    await freshProject(shared.win);
    await seedOverflowingTabs(shared.win, 'scroll-clicked');
    await setScrollLeft(shared.win, 0);

    const before = await stripState(shared.win);
    const { chip, scrollLeft } = cutAtRightEdge(before);
    await setScrollLeft(shared.win, scrollLeft);

    const positioned = await stripState(shared.win);
    const cutChip = positioned.chips.find((c) => c.testId === chip.testId)!;
    expect(isFullyVisible(positioned, cutChip), 'precondition: the tab is cut off').toBe(false);

    await beginScrollTrace(shared.win);
    // Click the LEADING edge of the chip — the part that is on screen, and well clear of the close
    // affordance at its trailing edge, which would destroy the tab instead of activating it.
    await shared.win.getByTestId(chip.testId).click({ position: { x: 8, y: 8 } });
    await waitForScrollStill(shared.win);

    const after = await stripState(shared.win);
    const now = after.chips.find((c) => c.testId === chip.testId)!;
    expect(now.active, 'clicking a tab makes it active').toBe(true);
    expect(isFullyVisible(after, now), 'the clicked tab is brought fully into view').toBe(true);
  });

  test('T048 — the picker chord brings a hidden tab into view (A1: chord, picker)', async () => {
    await freshProject(shared.win);
    await seedOverflowingTabs(shared.win, 'scroll-chord');
    await setScrollLeft(shared.win, 0);

    const before = await stripState(shared.win);
    const target = before.chips[before.chips.length - 1]!;
    expect(isFullyVisible(before, target), 'precondition: the target tab is off screen').toBe(false);

    // The CHORD route, not the control: `tabs.openPicker` is window-level, so it opens the same
    // picker from wherever focus happens to be.
    await beginScrollTrace(shared.win);
    await shared.win.keyboard.press('Control+Alt+T');
    await expect(shared.win.getByTestId('tabpicker')).toBeVisible();
    await shared.win.getByTestId(`tabpicker-row-${target.tabId}`).click();
    await expect(shared.win.getByTestId('tabpicker')).toHaveCount(0);
    await waitForScrollStill(shared.win);

    const after = await stripState(shared.win);
    const now = after.chips.find((c) => c.testId === target.testId)!;
    expect(now.active).toBe(true);
    expect(isFullyVisible(after, now), 'the chosen tab is scrolled into view').toBe(true);
  });

  test('T048 — a restored layout brings the active tab into view (A1: layout restore)', async () => {
    const name = await freshProject(shared.win);
    const ids = await seedOverflowingTabs(shared.win, 'scroll-restore');
    const wanted = ids[ids.length - 1]!;
    await setScrollLeft(shared.win, 0);

    /*
     * LAYOUT RESTORE, by leaving the project and coming back.
     *
     * Switching projects unmounts the strip and remounts it from persistence, so the track starts at
     * zero and the restored `activeTabId` has to be brought into view by the same effect every other
     * route goes through. (A renderer reload would be the other way to reach this, but throng
     * deliberately auto-opens NO project at startup, so a reload restores nothing to look at.)
     */
    await freshProject(shared.win);
    await shared.win
      .locator('.project-item', { hasText: name })
      .locator('[data-testid^="project-switch-"]')
      .click();
    await expect(shared.win.locator('.project-item', { hasText: name })).toHaveClass(
      /project-item--active/,
    );
    await expect(shared.win.getByTestId(wanted)).toBeVisible();
    /*
     * KNOWN RED, and the measurement is worth writing down because the number identifies the cause.
     *
     * On a restore the strip DOES scroll — sampled frame by frame it eases from 1 to 1501 and stops
     * — but it stops 118px short of the 1619 that would put the active tab flush with the right
     * edge, leaving the tab the user was last on cut off. 118px is the width of the tab-actions
     * group: the reveal target is computed while the strip still believes its track is 664px wide,
     * and the group then appears and takes those 118px out of the track. Nothing recomputes, so the
     * strip rests against a viewport that no longer exists.
     *
     * That is FR-029's own scenario ("restored") and A2's arithmetic done against a stale
     * `viewportWidth`; the fix belongs in `tab-group.tsx`'s reveal effect, not here.
     */
    await expect
      .poll(
        async () => {
          const state = await stripState(shared.win);
          const chip = state.chips.find((c) => c.testId === wanted);
          return chip ? isFullyVisible(state, chip) : false;
        },
        { message: 'the restored active tab was never brought into view' },
      )
      .toBe(true);
    const state = await stripState(shared.win);
    expect(activeChip(state).testId, 'the restored layout keeps its active tab').toBe(wanted);
    await expectCountsInSync(shared.win);
  });

  test('T049 — an already-fully-visible tab causes no movement at all (A2)', async () => {
    await freshProject(shared.win);
    // SHORT names on purpose: this test needs a fully visible tab that is not the active one, and a
    // 340px chip in a 546px track means at most one tab is ever fully visible at all.
    await seedOverflowingTabs(shared.win, 'scroll-nomove', {
      initial: 8,
      nameFor: (n) => `nm-${n}`,
    });

    // Somewhere in the middle, so movement in EITHER direction would be visible.
    const initial = await stripState(shared.win);
    await setScrollLeft(shared.win, Math.round(initial.maxScroll / 2));

    const positioned = await stripState(shared.win);
    const candidates = positioned.chips.filter(
      (chip) => isFullyVisible(positioned, chip) && !chip.active,
    );
    expect(candidates.length, 'some fully visible tab is not already active').toBeGreaterThan(0);
    const chosen = candidates[0]!;
    const restingAt = positioned.scrollLeft;

    await beginScrollTrace(shared.win);
    await shared.win.getByTestId(chosen.testId).click({ position: { x: 8, y: 8 } });
    // A negative claim needs an observation window, and this one is counted in FRAMES rather than
    // milliseconds: "the renderer had forty chances to move it and did not".
    await waitForTraceFrames(shared.win, 40);
    const trace = await endScrollTrace(shared.win);

    const after = await stripState(shared.win);
    expect(after.chips.find((c) => c.testId === chosen.testId)!.active).toBe(true);
    expect(after.scrollLeft, 'the strip is exactly where it was').toBeCloseTo(restingAt, 0);
    for (const sample of trace) {
      expect(
        Math.abs(sample - restingAt),
        'activating an already-visible tab moved the strip',
      ).toBeLessThanOrEqual(0.5);
    }
  });

  test('T050 — destroying the active tab brings its successor into view, leaving no gap (A3)', async () => {
    await freshProject(shared.win);
    await seedOverflowingTabs(shared.win, 'scroll-destroy');

    // At the far right, where the active tab sits after seeding. Destroying it shrinks the content,
    // so a strip that simply stayed put would be resting past the end of what is left.
    const before = await stripState(shared.win);
    await setScrollLeft(shared.win, before.maxScroll);
    const doomed = activeChip(await stripState(shared.win));

    await beginScrollTrace(shared.win);
    await shared.win.getByTestId(`tabstrip-close-${doomed.tabId}`).click();
    await expect(shared.win.getByTestId(doomed.testId)).toHaveCount(0);
    await waitForScrollStill(shared.win);

    const after = await stripState(shared.win);
    const successor = activeChip(after);
    expect(successor.testId, 'a different tab is active now').not.toBe(doomed.testId);
    expect(isFullyVisible(after, successor), 'the new active tab is in view').toBe(true);
    // No gap: the strip does not rest beyond the content it now has.
    expect(after.scrollLeft, 'the strip is not resting past the end').toBeLessThanOrEqual(
      after.maxScroll + 1,
    );
    await expectCountsInSync(shared.win);
  });

  test('T047 — two quick steps move TWO tabs and settle once (A6, A7, A8)', async () => {
    await freshProject(shared.win);
    await seedOverflowingTabs(shared.win, 'scroll-twostep');
    await setScrollLeft(shared.win, 0);

    const before = await stripState(shared.win);
    const anchorBefore = anchorIndex(before);
    expect(before.chips.length, 'enough tabs to step twice').toBeGreaterThan(anchorBefore + 2);

    await beginScrollTrace(shared.win);
    const step = shared.win.getByTestId('tabstrip-step-right');
    await step.click();
    await step.click(); // the second press lands while the first scroll is still in flight
    await waitForScrollStill(shared.win);

    const trace = await endScrollTrace(shared.win);
    const after = await stripState(shared.win);

    /*
     * A6/A8 first, because they PASS and A7 does not — asserting them ahead of the failure keeps the
     * red pointing at the one guarantee that is actually unmet.
     *
     * The superseding scroll starts from where the strip IS and leaves nothing behind: the series
     * only ever moves one way, so there is no jump back and no drift towards the old target…
     */
    expect(isMonotonic(trace), 'the strip reversed direction — a superseded scroll left residue').toBe(
      true,
    );
    // …and having settled, it stays settled. A queued second animation would show up here.
    const resting = await expectStillAfterSettling(shared.win);
    expect(Math.abs(resting - after.scrollLeft)).toBeLessThanOrEqual(1);

    /*
     * A7 — two presses, TWO tabs. KNOWN RED.
     *
     * Measured: the frame-by-frame trace is a single clean ease from 0 to 110 and stops there — one
     * tab, not two. The cause is visible in the arithmetic rather than in the animation, and the
     * animation is not where the fix goes: `step()` recomputes `stepTarget` from the track's LIVE
     * `scrollLeft`, which 50ms into a 400ms glide is still essentially zero, so the second press
     * chooses the SAME destination the first one did. Superseding is working exactly as designed;
     * what is missing is that a step should be measured from the scroll's PENDING target, so that
     * presses accumulate.
     *
     * This is the guarantee the contract's implementation note assumed fell out of the one-rAF-loop
     * design ("A7 and A8 are then structural"). A8 does; A7 does not.
     */
    expect(anchorIndex(after), 'two quick steps move the strip on by two tabs').toBe(
      anchorBefore + 2,
    );
    expect(
      Math.abs(after.scrollLeft - after.chips[anchorBefore + 2]!.left),
      'the second revealed tab is flush with the left edge',
    ).toBeLessThanOrEqual(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * A deliberately SLOW strip (3000ms) — everything that must be caught mid-flight.
 *
 * Three seconds is the declared maximum for `tabs.smoothScrollMs`, chosen here so that "did the
 * interruption take effect?" is answerable without a stopwatch: a scroll that reaches its target
 * within a second and a half plainly did not run its course.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */
test.describe('a slow strip', () => {
  let shared: OpenApp;
  let cfgRoot: string;

  test.beforeAll(async () => {
    cfgRoot = seedConfig({ smoothScrollMs: 3000, closeArmingDelayMs: 0 });
    shared = await openApp({ env: { THRONG_CONFIG_ROOT: cfgRoot } });
  });
  test.afterAll(async () => {
    await shared?.close();
  });

  // Reduce-motion is emulated per test and must never leak into the next one — a test that inherited
  // it would pass while proving the opposite of what it says.
  test.beforeEach(async () => {
    await shared.win.emulateMedia({ reducedMotion: 'no-preference' });
  });

  /** What the settings FILE says the scroll duration is — the value A12 forbids anything rewriting. */
  const storedSmoothScrollMs = (): number | undefined => {
    const doc = JSON.parse(readFileSync(join(cfgRoot, 'settings.json'), 'utf8')) as {
      tabs?: { smoothScrollMs?: number };
    };
    return doc.tabs?.smoothScrollMs;
  };

  /** Start a 3-second scroll to the far end of the strip, via the picker. */
  async function startLongScrollToLastTab(): Promise<Chip> {
    const before = await stripState(shared.win);
    const target = before.chips[before.chips.length - 1]!;
    expect(isFullyVisible(before, target), 'precondition: the target is off screen').toBe(false);
    await shared.win.getByTestId('tabstrip-show-all').click();
    await expect(shared.win.getByTestId('tabpicker')).toBeVisible();
    await shared.win.getByTestId(`tabpicker-row-${target.tabId}`).click();
    await expect(shared.win.getByTestId('tabpicker')).toHaveCount(0);
    return target;
  }

  test('T052 — reduce motion forces an instant scroll, and does not rewrite the setting (A11, A12)', async () => {
    await freshProject(shared.win);
    await seedOverflowingTabs(shared.win, 'scroll-reduce');
    await setScrollLeft(shared.win, 0);
    await shared.win.emulateMedia({ reducedMotion: 'reduce' });

    const before = await stripState(shared.win);
    const anchorBefore = anchorIndex(before);
    await beginScrollTrace(shared.win);
    await shared.win.getByTestId('tabstrip-step-right').click();

    // A11 — instant, whatever the setting says. A 3000ms eased scroll is 25% of the way at 1200ms,
    // so arriving inside a second is only possible if the animation was never run.
    await expect
      .poll(async () => anchorIndex(await stripState(shared.win)), {
        timeout: 1000,
        message: 'reduce-motion did not force the scroll to be instant',
      })
      .toBe(anchorBefore + 1);

    const after = await stripState(shared.win);
    const trace = await endScrollTrace(shared.win);
    expect(
      intermediateSamples(trace, before.scrollLeft, after.scrollLeft),
      'an instant scroll renders no intermediate positions',
    ).toEqual([]);
    expect(Math.abs(after.scrollLeft - after.chips[anchorBefore + 1]!.left)).toBeLessThanOrEqual(1);

    // A12 — the OS preference is an override, not an edit. Nothing wrote to the settings file.
    expect(
      storedSmoothScrollMs(),
      'reduce motion must not rewrite the configured duration',
    ).toBe(3000);
  });

  test('T053 — reduce motion applied MID-FLIGHT settles the scroll immediately (A13)', async () => {
    await freshProject(shared.win);
    await seedOverflowingTabs(shared.win, 'scroll-reduce-live');
    await setScrollLeft(shared.win, 0);

    const before = await stripState(shared.win);
    const anchorBefore = anchorIndex(before);
    await beginScrollTrace(shared.win);
    await shared.win.getByTestId('tabstrip-step-right').click();

    /*
     * Wait for the glide to be genuinely UNDER WAY before turning the preference on.
     *
     * Without this the test is vacuous in the most misleading way: `emulateMedia` lands within a few
     * milliseconds, before the first animation frame, so the scroll is instant from the outset and
     * nothing has been interrupted at all — a pass that proves the instant path (A11) a second time
     * and says nothing about A13. Waiting on the CONDITION "the strip has moved off its mark" is
     * what makes the interruption real.
     */
    await expect
      .poll(async () => (await stripState(shared.win)).scrollLeft, {
        timeout: 2000,
        message: 'the eased scroll never got under way, so there was nothing to interrupt',
      })
      .toBeGreaterThan(before.scrollLeft + 1);

    // The preference turns on while the scroll is running. A user who asks for less motion
    // mid-glide has asked about THIS glide.
    await shared.win.emulateMedia({ reducedMotion: 'reduce' });

    await expect
      .poll(async () => anchorIndex(await stripState(shared.win)), {
        timeout: 1500,
        message: 'a scroll in flight did not settle when reduce-motion turned on',
      })
      .toBe(anchorBefore + 1);

    const after = await stripState(shared.win);
    const trace = await endScrollTrace(shared.win);
    // Non-vacuous: the scroll really was animating when the preference arrived.
    expect(
      intermediateSamples(trace, before.scrollLeft, after.scrollLeft).length,
      'the scroll had not started, so nothing was interrupted',
    ).toBeGreaterThan(0);
    // A14 — it settles AT ITS TARGET, not wherever it had got to.
    expect(
      Math.abs(after.scrollLeft - after.chips[anchorBefore + 1]!.left),
      'the interrupted scroll finished its journey rather than stopping where it was',
    ).toBeLessThanOrEqual(1);
  });

  test('T053 — an instant scroll reaches the same rest position, active tab and counts (A14)', async () => {
    await freshProject(shared.win);
    await seedOverflowingTabs(shared.win, 'scroll-instant-outcome');

    /*
     * Animated, to establish what the outcome IS.
     *
     * The wait is on the ANCHOR reaching its new tab, not on the strip going still. A 3000ms glide
     * over 110px moves less than a physical pixel per frame at the start, and Chromium snaps
     * `scrollLeft` to whole device pixels — so a value-based stillness test reads a moving strip as
     * a stopped one and hands back a rest position of nearly zero. A semantic condition cannot be
     * fooled that way.
     */
    await setScrollLeft(shared.win, 0);
    const anchorBefore = anchorIndex(await stripState(shared.win));
    await beginScrollTrace(shared.win);
    await shared.win.getByTestId('tabstrip-step-right').click();
    await expect
      .poll(async () => anchorIndex(await stripState(shared.win)), { timeout: 8000 })
      .toBe(anchorBefore + 1);
    await waitForScrollStill(shared.win);
    const animated = await stripState(shared.win);
    const animatedCounts = await expectCountsInSync(shared.win);

    // The same gesture, instant.
    await setScrollLeft(shared.win, 0);
    await shared.win.emulateMedia({ reducedMotion: 'reduce' });
    await beginScrollTrace(shared.win);
    await shared.win.getByTestId('tabstrip-step-right').click();
    await expect
      .poll(async () => anchorIndex(await stripState(shared.win)), { timeout: 8000 })
      .toBe(anchorBefore + 1);
    await waitForScrollStill(shared.win);
    const instant = await stripState(shared.win);
    const instantCounts = await expectCountsInSync(shared.win);

    expect(instant.scrollLeft, 'the same rest position').toBeCloseTo(animated.scrollLeft, 0);
    expect(anchorIndex(instant)).toBe(anchorIndex(animated));
    expect(instantCounts).toEqual(animatedCounts);
  });

  test('T051 — a tab destroyed mid-scroll leaves the strip at a valid position (A9)', async () => {
    await freshProject(shared.win);
    await seedOverflowingTabs(shared.win, 'scroll-destroy-inflight');
    await setScrollLeft(shared.win, 0);

    await beginScrollTrace(shared.win);
    const doomed = await startLongScrollToLastTab();

    /*
     * Destroy the tab the strip is travelling TOWARDS, while it is still travelling.
     *
     * The close affordance is dispatched rather than clicked: the target tab is off screen, so there
     * is nothing to aim at, and a real click would wait for the strip to stop moving — which is
     * precisely the state this test exists to avoid. The affordance is armed regardless, because it
     * belongs to the active tab (P9).
     */
    await shared.win.getByTestId(`tabstrip-close-${doomed.tabId}`).dispatchEvent('click');
    await expect(shared.win.getByTestId(doomed.testId)).toHaveCount(0);
    // Semantic wait, for the same reason A14 uses one: a long glide's opening frames move less than
    // a device pixel, so "the value stopped changing" is not evidence that it stopped.
    await expect
      .poll(
        async () => {
          const state = await stripState(shared.win);
          return isFullyVisible(state, activeChip(state));
        },
        { timeout: 8000, message: 'the surviving active tab never came into view' },
      )
      .toBe(true);
    await waitForScrollStill(shared.win);

    const after = await stripState(shared.win);
    // eslint-disable-next-line no-console
    console.log(
      'DEBUG A9',
      JSON.stringify({
        scrollLeft: after.scrollLeft,
        max: after.maxScroll,
        vw: after.viewportWidth,
        active: after.chips.findIndex((c) => c.active),
        chips: after.chips.map((c) => [c.left, c.right]),
      }),
    );
    expect(
      after.scrollLeft,
      'the strip rested past the end of what is left — it scrolled to a tab that no longer exists',
    ).toBeLessThanOrEqual(after.maxScroll + 1);
    expect(after.scrollLeft).toBeGreaterThanOrEqual(-1);
    expect(isFullyVisible(after, activeChip(after)), 'the surviving active tab is in view').toBe(
      true,
    );
    await expectCountsInSync(shared.win);
  });

  test('T057a — a window resize mid-scroll settles the strip and recomputes the counts', async () => {
    await freshProject(shared.win);
    await seedOverflowingTabs(shared.win, 'scroll-resize-inflight');
    await setScrollLeft(shared.win, 0);

    const original = await shared.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.getSize(),
    );
    const widthBefore = (await stripState(shared.win)).viewportWidth;

    await beginScrollTrace(shared.win);
    await startLongScrollToLastTab();
    try {
      // Widened, not narrowed: at the default window size the workspace pane is already at its
      // declared minimum, so narrowing collapses the side panes and never reaches the track.
      await shared.app.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]!.setSize(size[0], size[1]);
      }, [original[0]! + 360, original[1]!] as [number, number]);
      await expect
        .poll(async () => (await stripState(shared.win)).viewportWidth, {
          message: 'the track never widened with the window',
        })
        .toBeGreaterThan(widthBefore);
      await expect
        .poll(
          async () => {
            const state = await stripState(shared.win);
            return isFullyVisible(state, activeChip(state));
          },
          { timeout: 8000, message: 'the strip never brought its active tab into the new width' },
        )
        .toBe(true);
      await waitForScrollStill(shared.win);

      const after = await stripState(shared.win);
      expect(after.scrollLeft, 'the strip is not resting past the end').toBeLessThanOrEqual(
        after.maxScroll + 1,
      );
      expect(after.scrollLeft).toBeGreaterThanOrEqual(-1);
      // Counts and overflow state are recomputed against the NEW width, not the old one.
      await expectCountsInSync(shared.win);
    } finally {
      await shared.app.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]!.setSize(size[0], size[1]);
      }, original as [number, number]);
      await expectCountsInSync(shared.win);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * A strip with the animation switched off (0ms) — A10.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */
test.describe('an unanimated strip', () => {
  let shared: OpenApp;

  test.beforeAll(async () => {
    shared = await openApp({ env: { THRONG_CONFIG_ROOT: seedConfig({ smoothScrollMs: 0 }) } });
  });
  test.afterAll(async () => {
    await shared?.close();
  });

  test('T052 — duration 0 is instant: no animation, no easing (A10)', async () => {
    await freshProject(shared.win);
    await seedOverflowingTabs(shared.win, 'scroll-zero');
    await setScrollLeft(shared.win, 0);

    const before = await stripState(shared.win);
    const anchorBefore = anchorIndex(before);

    await beginScrollTrace(shared.win);
    await shared.win.getByTestId('tabstrip-step-right').click();
    await waitForTraceFrames(shared.win, 20);
    const trace = await endScrollTrace(shared.win);

    const after = await stripState(shared.win);
    expect(anchorIndex(after), 'the step still moves exactly one tab').toBe(anchorBefore + 1);
    expect(
      Math.abs(after.scrollLeft - after.chips[anchorBefore + 1]!.left),
      'the revealed tab is flush with the left edge',
    ).toBeLessThanOrEqual(1);
    expect(
      intermediateSamples(trace, before.scrollLeft, after.scrollLeft),
      'duration 0 rendered intermediate positions — it animated',
    ).toEqual([]);
  });
});
