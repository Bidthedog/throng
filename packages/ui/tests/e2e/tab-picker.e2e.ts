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

test('T054 — every tab, in strip order, with its panel count, and the active one marked (K1, K9, K11)', async () => {
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

test('T054 — typing narrows, arrows move, Enter chooses, Escape dismisses (K3)', async () => {
  await freshProject();
  const ids = await seedTabs(shared.win, ['alpha report', 'beta report', 'gamma notes']);
  await openPicker('chord');

  const all = await rowIds();
  expect(all.length, 'the picker lists the seeded tabs and the project default').toBeGreaterThan(3);

  // TYPING NARROWS — and to the right rows, in strip order.
  await shared.win.getByTestId('tabpicker-input').fill('report');
  await expect
    .poll(rowIds, { message: 'typing never narrowed the list' })
    .toEqual([ids[0]!.replace('tab-', ''), ids[1]!.replace('tab-', '')]);

  // ARROWS MOVE the highlight; the first row starts highlighted.
  const alpha = shared.win.getByTestId(`tabpicker-row-${ids[0]!.replace('tab-', '')}`);
  const beta = shared.win.getByTestId(`tabpicker-row-${ids[1]!.replace('tab-', '')}`);
  await expect(alpha).toHaveAttribute('data-highlighted', 'true');
  await shared.win.keyboard.press('ArrowDown');
  await expect(beta).toHaveAttribute('data-highlighted', 'true');
  await expect(alpha).toHaveAttribute('data-highlighted', 'false');
  await shared.win.keyboard.press('ArrowUp');
  await expect(alpha).toHaveAttribute('data-highlighted', 'true');

  // ENTER CHOOSES the highlighted row.
  await shared.win.keyboard.press('ArrowDown');
  await shared.win.keyboard.press('Enter');
  await expect(shared.win.getByTestId('tabpicker')).toHaveCount(0);
  await expect
    .poll(async () => (await stripState(shared.win)).chips.find((c) => c.active)?.testId)
    .toBe(ids[1]);

  // ESCAPE DISMISSES, choosing nothing: the active tab is the one Enter just chose.
  await openPicker('chord');
  await shared.win.getByTestId('tabpicker-input').fill('gamma');
  await expect.poll(rowIds).toEqual([ids[2]!.replace('tab-', '')]);
  await shared.win.keyboard.press('Escape');
  await expect(shared.win.getByTestId('tabpicker')).toHaveCount(0);
  expect((await stripState(shared.win)).chips.find((c) => c.active)?.testId).toBe(ids[1]);
});

test('T054 — every term must match, in ANY order, across separators (K4, K5, K7)', async () => {
  await freshProject();
  // The name is deliberately the terms REVERSED, and split by a separator: `find file` must find
  // `file find.txt`, and `src/find/file.ts` too. A picker that matched the query as one substring
  // finds neither, and would pass a test that only ever typed the words in the order they appear.
  const ids = await seedTabs(shared.win, [
    'file find.txt',
    'src/find/file.ts',
    'unrelated scratch',
  ]);
  const [reversed, pathish, unrelated] = ids.map((id) => id.replace('tab-', ''));

  await openPicker('chord');
  await shared.win.getByTestId('tabpicker-input').fill('find file');
  await expect
    .poll(rowIds, { message: 'order-independent matching did not find the reversed name' })
    .toEqual([reversed, pathish]);
  expect(await rowIds()).not.toContain(unrelated);

  // K5 — case-insensitive, same two rows.
  await shared.win.getByTestId('tabpicker-input').fill('FIND FILE');
  await expect.poll(rowIds).toEqual([reversed, pathish]);

  // K6 — a whitespace-only query matches everything again.
  await shared.win.getByTestId('tabpicker-input').fill('   ');
  await expect.poll(async () => (await rowIds()).length).toBeGreaterThan(3);

  await shared.win.keyboard.press('Escape');
  await expect(shared.win.getByTestId('tabpicker')).toHaveCount(0);
});

test('T057b — matched terms are visibly marked in each row (K10)', async () => {
  await freshProject();
  const ids = await seedTabs(shared.win, ['marker alpha one', 'marker beta two']);
  await openPicker('chord');

  await shared.win.getByTestId('tabpicker-input').fill('beta marker');
  const row = shared.win.getByTestId(`tabpicker-row-${ids[1]!.replace('tab-', '')}`);
  await expect(row).toBeVisible();

  // BOTH terms are marked, and only the terms. A row that matched but showed no marks leaves the
  // user re-reading the whole name to find out why it is there.
  const marks = row.locator('mark.picker__mark');
  await expect(marks).toHaveCount(2);
  expect((await marks.allInnerTexts()).map((t) => t.toLowerCase()).sort()).toEqual([
    'beta',
    'marker',
  ]);

  // An empty query marks nothing — everything matches, so marking everything says nothing.
  await shared.win.getByTestId('tabpicker-input').fill('');
  await expect(shared.win.locator('mark.picker__mark')).toHaveCount(0);

  await shared.win.keyboard.press('Escape');
  await expect(shared.win.getByTestId('tabpicker')).toHaveCount(0);
});

test('T054 — no match keeps the picker open and says so (K12)', async () => {
  await freshProject();
  await seedTabs(shared.win, ['findable one']);
  await openPicker('chord');

  await shared.win.getByTestId('tabpicker-input').fill('zzz-no-such-tab-anywhere');
  await expect(shared.win.getByTestId('tabpicker-empty')).toBeVisible();
  await expect(shared.win.getByTestId('tabpicker-empty')).toHaveText(/no tabs match/i);
  // OPEN — a typo is a backspace, not a re-open.
  await expect(shared.win.getByTestId('tabpicker')).toBeVisible();
  await expect(shared.win.locator('[data-testid^="tabpicker-row-"]')).toHaveCount(0);
  // Enter on nothing chooses nothing and does not close it.
  await shared.win.keyboard.press('Enter');
  await expect(shared.win.getByTestId('tabpicker')).toBeVisible();

  // Backspacing to something that matches brings the rows back.
  await shared.win.getByTestId('tabpicker-input').fill('findable');
  await expect.poll(async () => (await rowIds()).length).toBe(1);

  await shared.win.keyboard.press('Escape');
  await expect(shared.win.getByTestId('tabpicker')).toHaveCount(0);
});

test('T055 — choosing an entry scrolls the strip to that tab AND makes it active (K2)', async () => {
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

test('T056 — Ctrl+Alt+T opens the picker at ANY tab count, including with nothing hidden (T5)', async () => {
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

test('T056 — the chord and the control open the SAME picker, with the same behaviour (T7)', async () => {
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

test('T056 — dismissing returns focus to where it was (T8)', async () => {
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
   * KNOWN RED. Measured: `document.activeElement` after the dismissal is `BODY` — focus is not
   * returned to the control it came from, and is not left on the picker either. It is simply lost.
   *
   * The mechanism is an ordering one. `Picker` records where focus was in a `useEffect`, but the
   * query input carries `autoFocus`, which React applies during the COMMIT phase — before passive
   * effects run. So the value recorded as "where focus was" is already the picker's own input; on
   * unmount that element is gone, `document.contains(previous)` is false, and the restore is skipped.
   * The capture has to happen before the picker mounts (or in a layout effect), not after.
   */
  // …and gave it back. Leaving focus on a dismissed overlay's corpse strands the user.
  await expect(shared.win.getByTestId('tab-add')).toBeFocused();
});
