/**
 * 031 US3 — the tab picker (#225).
 *
 * contracts/tab-strip.md §5 K1–K3 and K9–K12, plus §4's T5, T7, T8 and K10's visible marking.
 *
 * The picker is where "I know which tab I want" stops being an aiming problem. Two things make it
 * worth an E2E rather than only the unit tests over `matches`/`matchSpans`: the ORDER-INDEPENDENT
 * matching has to hold against tabs the user can actually see (K4 in the app, not in a string), and
 * every keyboard route through it — narrow, arrow, choose, dismiss — has to end somewhere sensible,
 * including putting focus back where it came from.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  cleanupTemp,
  settle,
  type OpenApp,
} from './harness.js';
import {
  isFullyVisible,
  seedOverflowingTabs,
  seedTabs,
  setScrollLeft,
  stripState,
} from './helpers/tabs.js';

test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
const roots: string[] = [];

test.beforeAll(async () => {
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
  for (const root of roots) cleanupTemp(root);
});

let seq = 0;
async function freshProject(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'throng-tabpicker-'));
  roots.push(root);
  await newProject(shared.win, `tabpicker-${(seq += 1)}`, root);
  await settle(shared.win);
}

/** The picker's rows, in the order it is showing them. */
async function rowIds(): Promise<string[]> {
  return shared.win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="tabpicker-row-"]')).map((row) =>
      (row.getAttribute('data-testid') ?? '').replace('tabpicker-row-', ''),
    ),
  );
}

/**
 * Open the picker one of the two ways it can be opened.
 *
 * `control` is only available while the strip OVERFLOWS — the tab-actions group does not exist
 * otherwise (T1) — so a test seeded with a handful of short names must ask for the chord. Getting
 * this wrong does not fail cleanly: the click waits out the whole test timeout on a control that was
 * never going to appear.
 */
async function openPicker(via: 'chord' | 'control'): Promise<void> {
  if (via === 'chord') await shared.win.keyboard.press('Control+Alt+T');
  else await shared.win.getByTestId('tabstrip-show-all').click();
  await expect(shared.win.getByTestId('tabpicker')).toBeVisible();
  await expect(shared.win.getByTestId('tabpicker-input')).toBeFocused();
}

test('T054 — every tab, in strip order, with its panel count, and the active one marked (K1, K9, K11)', { tag: ['@extended', '@window'] }, async () => {
  await freshProject();
  await seedOverflowingTabs(shared.win, 'picker-list');
  await setScrollLeft(shared.win, 0);

  const state = await stripState(shared.win);
  const hidden = state.chips.filter((chip) => !isFullyVisible(state, chip));
  expect(hidden.length, 'precondition: some tabs are off screen').toBeGreaterThan(0);

  await openPicker('control');

  // K1 — every tab, whether the strip is showing it or not, in the strip's own order (K11).
  expect(await rowIds()).toEqual(state.chips.map((chip) => chip.tabId));

  // K9 — the name AND the panel count, so two similarly named tabs can be told apart without
  // opening either.
  const first = shared.win.getByTestId(`tabpicker-row-${state.chips[0]!.tabId}`);
  await expect(first.locator('.picker__meta')).toHaveText(/^\d+ panels?$/);

  // K9 — and the tab the user is already on is marked, so "where am I?" needs no guess.
  const active = state.chips.find((chip) => chip.active)!;
  await expect(shared.win.getByTestId(`tabpicker-row-${active.tabId}`)).toHaveAttribute(
    'data-current',
    'true',
  );
  await expect(shared.win.locator('[data-testid^="tabpicker-row-"][data-current="true"]')).toHaveCount(
    1,
  );

  await shared.win.keyboard.press('Escape');
  await expect(shared.win.getByTestId('tabpicker')).toHaveCount(0);
});

/*
 * MOVED (034 FR-045) — four tests, to two layers that were already most of the way there.
 *
 * `packages/ui/tests/component/picker.test.ts` — the tab picker and Quick Open are the SAME
 * component, `common/picker.tsx`, which takes no context. So the list, the highlight, the marks and
 * the empty state are one set of claims about one component, not two sets about two screens:
 *   - typing narrows, ArrowDown/ArrowUp walk the highlight (asserted as `data-highlighted`, so a
 *     picker that highlighted the right row while Enter chose another is distinguishable)
 *   - Enter chooses the highlighted row; Escape dismisses without choosing
 *   - every term of a multi-word query is marked, and an empty query marks nothing
 *   - a no-match query says so and stays OPEN, Enter on it chooses nothing, and correcting the
 *     query brings the rows back — a typo is a backspace, not a re-open
 *
 * `packages/core/tests/unit/picker-match.test.ts` — "every term must match, in ANY order, across
 * separators" is `compileQuery`, and that file already carries the spec’s three worked examples
 * verbatim, including this test's own `'file find.txt'` against `'find file'`, plus
 * order-independence, case-insensitivity in text and query, contiguity, regex punctuation treated
 * as literal, and a whitespace-only query matching everything. Nothing was left for an app to add.
 *
 * Red-proved on the component: disabling ArrowUp, marking only the first span, and making Enter on
 * an empty list dismiss. The mark mutation had to be re-aimed — the first attempt renamed
 * `matchSpans` where it appears in a COMMENT, and passed while proving nothing.
 *
 * WHAT STAYS BELOW, and why none of it is the same claim: the rows are built from the real tab
 * strip in strip order with real panel counts and the real active tab marked; choosing scrolls the
 * strip and changes which tab is active; the chord opens it at any tab count; the chord and the
 * control open the same picker; and dismissing returns focus where it was. Every one of those is
 * about the strip, the window or the keyboard — none of them is about a list.
 */

test('T055 — choosing an entry scrolls the strip to that tab AND makes it active (K2)', { tag: ['@extended', '@window'] }, async () => {
  await freshProject();
  await seedOverflowingTabs(shared.win, 'picker-choose');

  // Park at the FAR END and choose the FIRST tab. Seeding leaves the last tab active, so choosing it
  // would test neither half of K2: it is already active, and the strip is already showing it.
  const start = await stripState(shared.win);
  await setScrollLeft(shared.win, start.maxScroll);

  const before = await stripState(shared.win);
  const target = before.chips[0]!;
  expect(isFullyVisible(before, target), 'precondition: the target is off screen').toBe(false);
  expect(target.active, 'precondition: the target is not already active').toBe(false);

  await openPicker('control');
  await shared.win.getByTestId(`tabpicker-row-${target.tabId}`).click();
  await expect(shared.win.getByTestId('tabpicker')).toHaveCount(0);

  await expect
    .poll(
      async () => {
        const state = await stripState(shared.win);
        const chip = state.chips.find((c) => c.testId === target.testId);
        return chip ? chip.active && isFullyVisible(state, chip) : false;
      },
      { message: 'choosing a tab did not both activate it and scroll it into view' },
    )
    .toBe(true);
});

test('T056 — Ctrl+Alt+T opens the picker at ANY tab count, including with nothing hidden (T5)', { tag: ['@extended', '@window'] }, async () => {
  await freshProject();
  // Deliberately NOT overflowing: the picker is a navigation aid, not an overflow affordance, and a
  // user who knows the name of the tab they want should not first have to make the strip too small.
  await seedTabs(shared.win, ['first', 'second']);
  const state = await stripState(shared.win);
  expect(state.contentWidth, 'precondition: nothing overflows').toBeLessThanOrEqual(
    state.viewportWidth + 0.5,
  );
  await expect(shared.win.getByTestId('tabstrip-actions')).toHaveCount(0);

  await openPicker('chord');
  expect((await rowIds()).length, 'every tab is listed even with room to spare').toBe(
    state.chips.length,
  );
  await shared.win.keyboard.press('Escape');
  await expect(shared.win.getByTestId('tabpicker')).toHaveCount(0);
});

test('T056 — the chord and the control open the SAME picker, with the same behaviour (T7)', { tag: ['@extended', '@window'] }, async () => {
  await freshProject();
  await seedOverflowingTabs(shared.win, 'picker-same');
  await setScrollLeft(shared.win, 0);

  await openPicker('control');
  const viaControl = await rowIds();
  const controlTitle = await shared.win.getByTestId('tabpicker').getAttribute('aria-label');
  const controlPlaceholder = await shared.win
    .getByTestId('tabpicker-input')
    .getAttribute('placeholder');
  await shared.win.keyboard.press('Escape');
  await expect(shared.win.getByTestId('tabpicker')).toHaveCount(0);

  await openPicker('chord');
  expect(await rowIds(), 'the chord lists exactly what the control lists').toEqual(viaControl);
  expect(await shared.win.getByTestId('tabpicker').getAttribute('aria-label')).toBe(controlTitle);
  expect(await shared.win.getByTestId('tabpicker-input').getAttribute('placeholder')).toBe(
    controlPlaceholder,
  );
  // …and there is only ever ONE of it.
  await expect(shared.win.getByTestId('tabpicker')).toHaveCount(1);

  await shared.win.keyboard.press('Escape');
  await expect(shared.win.getByTestId('tabpicker')).toHaveCount(0);
});

test('T056 — dismissing returns focus to where it was (T8)', { tag: ['@extended', '@window'] }, async () => {
  await freshProject();
  await seedTabs(shared.win, ['focus-return']);

  // Somewhere real to come back TO. New Tab is a focusable control in the strip itself, so this
  // asserts the restore without dragging a terminal or an editor into the test.
  await shared.win.getByTestId('tab-add').focus();
  await expect(shared.win.getByTestId('tab-add')).toBeFocused();

  await openPicker('chord');
  // The picker took focus (that is what the input assertion in `openPicker` established)…
  await shared.win.keyboard.press('Escape');
  await expect(shared.win.getByTestId('tabpicker')).toHaveCount(0);
  /*
   * Measured, before the fix: `document.activeElement` after the dismissal was `BODY` — focus was
   * not returned to the control it came from, and was not left on the picker either. It was simply
   * lost.
   *
   * The mechanism was an ordering one. `Picker` recorded where focus was in a `useEffect`, but the
   * query input carries `autoFocus`, which React applies during the COMMIT phase — before passive
   * effects run. So the value recorded as "where focus was" was already the picker's own input; on
   * unmount that element is gone, `document.contains(previous)` is false, and the restore was
   * skipped. The capture happens during RENDER now, which is the only phase early enough.
   */
  // …and gave it back. Leaving focus on a dismissed overlay's corpse strands the user.
  await expect(shared.win.getByTestId('tab-add')).toBeFocused();
});
