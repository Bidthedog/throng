/**
 * 031 US1 — the tab strip stops mangling its own tabs (#225).
 *
 * The reported defect, in one sentence: once the tabs overflow, a native horizontal scrollbar
 * appears INSIDE the strip and takes its height out of the tabs, so they shift up and are clipped.
 *
 * These assertions are deliberately about GEOMETRY rather than about markup. A test that checked for
 * `overflow-x: hidden`, or for the absence of a class, would pass the moment someone wrote the class
 * — including if the tabs were still clipped for some other reason. What the user reported is that
 * the tabs MOVED and got SHORTER, so that is what is measured: `getBoundingClientRect()` before
 * overflow against the same tab after it.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { openApp, createProject as newProject, cleanupTemp, type OpenApp } from './harness.js';
import { seedTabs, stripGeometry, isOverflowing } from './helpers/tabs.js';

// One app for the file (see docs/testing.md): none of these tests seeds state before launch.
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
const roots: string[] = [];

test.beforeAll(async () => {
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
  for (const r of roots) cleanupTemp(r);
});

let seq = 0;
async function project(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'throng-tabstrip-'));
  roots.push(root);
  await newProject(shared.win, `tabstrip-${(seq += 1)}`, root);
}

/** Long enough that a handful of tabs overruns the strip — the reproduction #225 gives. */
const LONG = (n: number): string => `feature-S031-a-deliberately-long-tab-name-number-${n}`;

/**
 * Make the strip overflow, whatever state the shared app is in.
 *
 * Idempotent on purpose: a test that ASSUMES a previous test left the strip overflowing is fine
 * until the previous test retries, at which point the assumption is silently false. Seeding until
 * the condition holds costs a second and removes the ordering dependency entirely.
 */
async function ensureOverflowing(): Promise<void> {
  if (isOverflowing(await stripGeometry(shared.win))) return;
  await project();
  let n = 0;
  while (!isOverflowing(await stripGeometry(shared.win)) && n < 12) {
    await seedTabs(shared.win, [LONG((n += 1))]);
  }
  expect(isOverflowing(await stripGeometry(shared.win)), 'seeded enough tabs to overflow').toBe(true);
}

test('T004 — a tab keeps its height and vertical position when the strip overflows', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
  await project();
  const before = await stripGeometry(shared.win);
  expect(isOverflowing(before), 'strip should not overflow yet').toBe(false);
  const baseline = before.tabs[0];
  expect(baseline, 'the project should start with one tab').toBeTruthy();

  await seedTabs(shared.win, [1, 2, 3, 4, 5, 6].map(LONG));

  /*
   * Compare LIKE WITH LIKE.
   *
   * `.tab-chip--active` carries a 2px top border where an inactive chip carries 1px, so an active
   * tab is legitimately one pixel taller. The baseline above was measured while tab 1 was the only
   * tab and therefore active; seeding makes the LAST tab active, so measuring now would compare an
   * active tab against an inactive one and report a 1px "regression" that is really a border.
   *
   * Activating tab 1 again is what makes the remaining difference attributable to the strip.
   */
  await shared.win.getByTestId(baseline.testId).click();

  const after = await stripGeometry(shared.win);
  expect(isOverflowing(after), 'six long names should overflow the strip').toBe(true);

  const same = after.tabs.find((t) => t.testId === baseline.testId);
  expect(same, 'the original tab is still in the strip').toBeTruthy();

  // The defect: the scrollbar steals vertical space, so the tab loses height and shifts up.
  expect(same!.height, 'a tab must not lose height when the strip overflows').toBeCloseTo(
    baseline.height,
    0,
  );
  expect(same!.top, 'a tab must not move vertically when the strip overflows').toBeCloseTo(
    baseline.top,
    0,
  );
});

test('T003 — an overflowing strip renders no native horizontal scrollbar', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
  // Seeds its own overflow rather than inheriting T004's. Depending on what an earlier test left
  // behind makes the file order-dependent, and a single retry then shifts the ground under
  // everything after it — which is exactly how this spec first went flaky.
  await ensureOverflowing();
  const g = await stripGeometry(shared.win);
  expect(isOverflowing(g), 'precondition: the strip is overflowing').toBe(true);
  expect(
    g.hasNativeScrollbar,
    'a native scrollbar takes its height out of the tabs — that is the defect',
  ).toBe(false);
});

/*
 * T005 — 031 FR-003, with its SHAPE half superseded by #291.
 *
 * What this test asserted, and no longer can: that the button is SQUARE and VERTICALLY CENTRED. It
 * is now shaped as a tab — stretched to the strip's content box, bottom edge on the strip's bottom
 * border — so both of those are false by design. The spec records the supersession against FR-003
 * rather than rewriting it, and this is the test that change is visible in.
 *
 * What survives untouched is the half FR-003 is actually FOR: the control stays VISIBLE and PINNED
 * at every tab count, including while the strip overflows. That was the 031 defect (it used to live
 * inside the scrolling row and drift off with the tabs), and nothing here relaxes it.
 *
 * ══ WHY IT IS MEASURED AGAINST A CHIP RATHER THAN AGAINST NUMBERS ══
 *
 * "Connects to the line below it, just like the tabs do" is a claim about two elements agreeing, not
 * about either one's coordinates. Asserting `height === 29` would encode today's
 * `--pane-header-height` and fail the day a theme changes it, while still not saying the thing that
 * matters. Comparing against a real chip in the same strip is the claim itself, and it holds at any
 * header height, in any theme, at any zoom.
 */
test('T005 — the New Tab button stays pinned, and is shaped as a tab, at every tab count', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
  await ensureOverflowing();
  const add = shared.win.getByTestId('tab-add');
  await expect(add, 'New Tab is visible while the strip overflows').toBeVisible();

  const strip = await shared.win.getByTestId('tab-strip').boundingBox();
  const box = await add.boundingBox();
  // The last chip still on screen — any chip will do, since FR-002 already fixes them all to one
  // height and one y. Taking a VISIBLE one matters though: the strip is overflowing, and a chip
  // scrolled out of the track reports a box that is clipped rather than laid out.
  const chip = await shared.win.locator('.tab-chip').last().boundingBox();
  expect(box).toBeTruthy();
  expect(strip).toBeTruthy();
  expect(chip).toBeTruthy();

  // Pinned to the right-hand edge rather than drifting off with the tabs — FR-003's surviving half.
  const gapToRight = strip!.x + strip!.width - (box!.x + box!.width);
  expect(gapToRight, 'New Tab sits at the right-hand edge of the pane').toBeLessThan(80);

  // Still 24px wide. This one IS a number, deliberately: `.tab-strip::after` offsets the trailing
  // fade by `calc(32px + …)` — this width plus its margin plus the strip's padding — so a change
  // here silently puts the fade in the wrong place, and nothing else would catch that.
  expect(Math.abs(box!.width - 24), 'New Tab keeps its 24px width').toBeLessThanOrEqual(1);

  // ── Shaped as a tab (#291) ──
  // Top edge level with the chips beside it…
  expect(Math.abs(box!.y - chip!.y), 'New Tab starts where the tabs start').toBeLessThanOrEqual(1);
  // …and the same height, which puts its bottom edge on the strip's bottom border exactly as a
  // chip's is. Asserted as height-given-equal-tops rather than as a second coordinate subtraction,
  // so a failure says which of the two edges moved.
  expect(
    Math.abs(box!.height - chip!.height),
    'New Tab is exactly as tall as a tab, so its bottom meets the line below',
  ).toBeLessThanOrEqual(1);

  // Stated once against the STRIP as well, because that is the requirement in the user's own words:
  // the bottom connects to the line below it. Everything above is the button agreeing with a chip,
  // which a pair of equally-wrong elements would also satisfy. The only thing between the button's
  // bottom edge and the bottom of the strip is the strip's own 1px border.
  const gapToBottom = strip!.y + strip!.height - (box!.y + box!.height);
  expect(gapToBottom, 'nothing but the border sits under the New Tab button').toBeLessThanOrEqual(2);
});

test('T007 — a fade never displaces a tab', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
  await ensureOverflowing();
  // Scroll so tabs are hidden to the left, which is when the leading fade shows.
  await shared.win.evaluate(() => {
    const strip = document.querySelector('[data-testid="tab-strip"]');
    const track = strip?.querySelector('[data-testid="tabstrip-track"]') ?? strip;
    (track as HTMLElement).scrollLeft = 200;
  });

  /*
   * WAIT for the fade rather than reading it on the next line.
   *
   * Setting `scrollLeft` from `evaluate` fires a scroll event, but the renderer still has to run its
   * handler and re-render before the attribute exists — and a plain read raced that, passing on a
   * fast machine and failing under a loaded suite. Polling waits on the CONDITION instead of on the
   * clock, which is what makes it deterministic rather than merely slower.
   */
  await expect
    .poll(async () => (await stripGeometry(shared.win)).fades.left, {
      message: 'tabs hidden to the left show the leading fade',
    })
    .toBe(true);
  const faded = await stripGeometry(shared.win);

  const offsets = faded.tabs.map((t) => Math.round(t.left));

  // Turn the fades off and re-measure. An overlay must not change any tab's x position; anything
  // INSERTED into the strip would push every tab to its right.
  await shared.win.evaluate(() => {
    document.querySelector('[data-testid="tab-strip"]')?.setAttribute('data-fade-left', 'false');
  });
  const bare = await stripGeometry(shared.win);
  expect(bare.tabs.map((t) => Math.round(t.left))).toEqual(offsets);
});
