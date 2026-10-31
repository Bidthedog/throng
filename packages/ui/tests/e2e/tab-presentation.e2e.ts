/**
 * 031 US5 — what a tab SHOWS, and the close affordance on it (#225, contracts/tab-strip.md §6).
 *
 * P1–P10 are all statements about a real strip under a real pointer, so none of them can be settled
 * anywhere but here: whether an affordance is drawn, whether revealing it moves anything, and —
 * the whole point of the arming delay — whether a click that lands during it does nothing NOW and
 * nothing LATER either.
 *
 * ══ THE TEST THAT MATTERS MOST, AND HOW IT IS NOT ALLOWED TO CHEAT ══
 *
 * P7 says a click inside the arming window is "ignored, not queued". A test that clicked and then
 * asserted "the tab is still there" would pass against an implementation that had merely deferred
 * the destruction by a few hundred milliseconds — the assertion would run first and the tab would
 * die immediately afterwards, silently, in whatever test came next. So the click is followed by
 * waiting for the affordance to ARM (a condition, not a clock: the inert class going away is the
 * delay having elapsed), and only then is the tab asserted to be alive.
 *
 * ══ WHY THREE APPS ══
 *
 * The arming delay is a setting, and three of these stories are about three different values of it.
 * Rather than hot-reload the setting and hope, each group pre-seeds `settings.json` in its own
 * config root BEFORE launch, so the value is simply in force — there is no window in which the app
 * is running at the old one. Within a group the app is shared, and every test still creates its own
 * project, so no test inherits a strip from the one above it.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  addPanels,
  cleanupTemp,
  geom,
  settle,
  type OpenApp,
} from './harness.js';
import { seedTabs, stripGeometry } from './helpers/tabs.js';
import {
  writeTabSettings,
  tabIdOf,
  tabClose,
  closeIsInert,
  pointerAwayFromStrip,
  restOnTabForPopover,
} from './helpers/tab-settings.js';

test.describe.configure({ mode: 'serial' });

const roots: string[] = [];
let seq = 0;

/** A fresh project for the test about to run — one tab, one panel, nothing inherited. */
async function project(win: Page, prefix: string): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'throng-tabpres-'));
  roots.push(root);
  await newProject(win, `${prefix}-${(seq += 1)}`, root);
}

/** Every tab id in the strip, in strip order. */
async function tabIds(win: Page): Promise<string[]> {
  const g = await stripGeometry(win);
  return g.tabs.map((t) => tabIdOf(t.testId));
}

/** Which tab the strip says is active. */
async function activeTabId(win: Page): Promise<string> {
  const id = await win
    .locator('.tab-chip[data-active="true"]')
    .evaluate((el) => (el.getAttribute('data-testid') ?? '').replace(/^tab-/, ''));
  expect(id, 'exactly one tab is active').not.toBe('');
  return id;
}

/** Wait for a hover-revealed affordance to become live. The CONDITION, never the clock. */
async function waitUntilArmed(win: Page, tabId: string): Promise<void> {
  await expect
    .poll(() => closeIsInert(win, tabId), {
      timeout: 10_000,
      message: `the close affordance on ${tabId} never armed`,
    })
    .toBe(false);
}

test.afterAll(() => {
  for (const r of roots) cleanupTemp(r);
});

// ══ At the shipped arming delay (300ms) — presentation, reservation, and the pointer sweep ══

test.describe('at the shipped arming delay', () => {
  let shared: OpenApp;

  test.beforeAll(async () => {
    shared = await openApp();
    await settle(shared.win);
  });
  test.afterAll(async () => {
    await shared?.close();
  });

  test('T095 — the panel count is a pill, and no square-bracket form survives (P1)', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
    const win = shared.win;
    await project(win, 'Pill');
    await addPanels(win, 2); // three panels in the one tab
    const tab = await activeTabId(win);

    const count = win.getByTestId(`tab-count-${tab}`);
    await expect(count, 'the tab says how many panels it holds').toHaveText('3');

    /*
     * A PILL, asserted as roundness rather than as a class name: `border-radius: 999px` on a
     * ~15px-tall element is what makes it read as a pill, and a class could be renamed without
     * anything changing for the user.
     */
    const pill = await count.evaluate((el) => {
      const s = getComputedStyle(el);
      return { radius: parseFloat(s.borderTopLeftRadius), height: el.getBoundingClientRect().height };
    });
    expect(pill.radius, 'P1: the count is drawn as a pill').toBeGreaterThanOrEqual(
      pill.height / 2 - 0.5,
    );

    // P1's other half — the `[3]` form is gone from the strip entirely.
    const stripText = (await win.getByTestId('tab-strip').textContent()) ?? '';
    expect(stripText, 'P1: no `[3]` square-bracket count remains anywhere in the strip').not.toMatch(
      /\[\d+\]/,
    );
  });

  /*
   * ══ WHY THIS TEST READS A POPOVER AND NOT A `title` ══
   *
   * FR-051 (US6) SUPERSEDES FR-043's "one per line" phrasing: a native `title` is one run of plain text,
   * so it cannot indent the panels under the tab that contains them. The hover is a formatted HTML
   * surface, and the chip deliberately carries no `title` at all.
   *
   * NARROWED (test-suite audit). What the popover SAYS — the panel count line ("2 panels"), each panel's
   * name in layout order, the tab name being omitted when the chip already shows it (#296), and the
   * `data-tab-id` it describes — is `component/tab-popover.test.ts` ("names the tab, counts its
   * panels, and lists them in layout order", "omits it when the chip is already showing the name in
   * full", "identifies whose tab it is describing"). What stays is what needs a real pointer and real
   * layout: the popover opens under a RESTING pointer and goes with it, the panels are drawn indented,
   * and the native tooltip is not left behind.
   */
  test('T096 — hovering a tab shows a popover that lists its panels indented, and goes with the pointer (P2, FR-051)', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
    const win = shared.win;
    await project(win, 'Tooltip');
    await addPanels(win, 1); // two panels
    const tab = await activeTabId(win);

    await pointerAwayFromStrip(win);
    await expect(
      win.getByTestId('tabstrip-popover'),
      'nothing is hovered, so nothing is described',
    ).toHaveCount(0);

    // FR-058 — a RESTING pointer, not a passing one. `restOnTabForPopover` re-performs the gesture
    // if the strip moved out from under it, which a bare `hover()` cannot notice.
    const popover = await restOnTabForPopover(win, win.getByTestId(`tab-${tab}`));
    await expect(popover).toBeVisible();

    // FR-051's own claim — the panels are INDENTED under the tab, not a flat run of peers.
    // Measured against the COUNT line (#296: the name is omitted when the chip shows it); both are the
    // surface's own top-level rows, so either establishes the outer edge the panels sit inside.
    const nameLeft = (await geom(win.getByTestId('tabstrip-popover-count'))).x;
    const firstPanelLeft = (await geom(popover.locator('.tabstrip-popover__panel').first())).x;
    expect(firstPanelLeft, 'FR-051: the panels sit inside the tab, and are drawn that way').toBeGreaterThan(
      nameLeft,
    );

    // The superseded mechanism is gone: a `title` here would sit on top of this surface.
    expect(
      await win.getByTestId(`tab-${tab}`).getAttribute('title'),
      'FR-051: the native tooltip is not left behind alongside the popover',
    ).toBeNull();

    await pointerAwayFromStrip(win);
    await expect(popover, 'and it goes away with the pointer').toHaveCount(0);
  });

  test('T097 — the affordance is on the active tab always, and on the tab under the pointer (P4)', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
    const win = shared.win;
    await project(win, 'Reveal');
    await seedTabs(win, ['bravo', 'charlie']);
    const ids = await tabIds(win);
    expect(ids.length, 'three tabs to choose between').toBe(3);
    const active = await activeTabId(win);
    const others = ids.filter((id) => id !== active);

    await pointerAwayFromStrip(win);
    await expect(tabClose(win, active), 'P4: the active tab always offers it').toBeVisible();
    for (const id of others) {
      await expect(
        tabClose(win, id),
        'P4: NOT permanently on every tab — that is the state this replaced',
      ).toBeHidden();
    }

    // Hovering an inactive tab reveals its own, and does not take the active tab's away.
    await win.getByTestId(`tab-${others[0]!}`).hover();
    await expect(tabClose(win, others[0]!), 'P4: revealed under the pointer').toBeVisible();
    await expect(tabClose(win, active), 'P4: and the active tab keeps its own').toBeVisible();
    await expect(tabClose(win, others[1]!), 'P4: but no other tab gains one').toBeHidden();
  });

  test('T098 — revealing the affordance moves nothing: its space is reserved (P5, SC-007b)', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
    const win = shared.win;
    await project(win, 'Reserved');
    await seedTabs(win, ['bravo', 'charlie']);
    const ids = await tabIds(win);
    const active = await activeTabId(win);
    const target = ids.find((id) => id !== active)!;

    await pointerAwayFromStrip(win);
    const before: Array<{
      id: string;
      chip: { x: number; y: number; w: number; h: number };
      label: { x: number; y: number; w: number; h: number };
    }> = [];
    for (const id of ids) {
      before.push({
        id,
        chip: await geom(win.getByTestId(`tab-${id}`)),
        label: await geom(win.getByTestId(`tab-title-${id}`)),
      });
    }

    await win.getByTestId(`tab-${target}`).hover();
    await expect(tabClose(win, target), 'the affordance really did appear').toBeVisible();

    /*
     * Measured, not inferred. `visibility: hidden` reserves the box and `display: none` does not,
     * and the difference is invisible in the markup but obvious to a user: every tab to the right
     * of the pointer would shuffle as the pointer moved along the strip.
     */
    for (const was of before) {
      const chip = await geom(win.getByTestId(`tab-${was.id}`));
      const label = await geom(win.getByTestId(`tab-title-${was.id}`));
      expect(chip.w, `P5: tab ${was.id} kept its width`).toBeCloseTo(was.chip.w, 0);
      expect(chip.x, `P5: tab ${was.id} did not move`).toBeCloseTo(was.chip.x, 0);
      expect(label.x, `P5: the label in tab ${was.id} did not move`).toBeCloseTo(was.label.x, 0);
      expect(label.y, `P5: nor shift vertically`).toBeCloseTo(was.label.y, 0);
    }
  });
});

// ══ With a long arming delay — the window itself, and what happens inside it ══

test.describe('with a long arming delay', () => {
  /*
   * The setting's own ceiling, deliberately.
   *
   * Three tests here read "the affordance is still inert" in the moments after a hover, and that
   * read is a couple of CDP round trips — cheap on an idle machine, and not necessarily cheap in a
   * six-worker parallel tier on a loaded one. Every millisecond of headroom here is a millisecond
   * of margin against the one failure this file could plausibly produce, and the whole delay is
   * waited out only twice in the file.
   */
  const ARMING_MS = 2000;
  let shared: OpenApp;
  let cfgRoot: string;

  test.beforeAll(async () => {
    cfgRoot = mkdtempSync(join(tmpdir(), 'throng-tabpres-slow-cfg-'));
    // Seeded BEFORE launch: the delay is simply in force, with no reload to race.
    writeTabSettings(cfgRoot, { closeArmingDelayMs: ARMING_MS });
    shared = await openApp({ env: { THRONG_CONFIG_ROOT: cfgRoot } });
    await settle(shared.win);
  });
  test.afterAll(async () => {
    await shared?.close();
    cleanupTemp(cfgRoot);
  });

  /*
   * MOVED DOWN (test-suite audit) — T099 (a click inside the arming window is ignored and not queued),
   * T100 (armed, it runs Destroy Tab with both confirmations; leaving re-arms from scratch), T101 (the
   * active tab arms on a rest like every other), T102 (a sweep destroys nothing), T103 (a delay of 0 is
   * live at once) and T104 (the last tab's close is disabled) are
   * `component/tab-strip.test.ts` "the close affordance arms only after a rest (P6)", on fake timers:
   * the attribute they observe is `data-armed`, and what they exercise is the click handler, neither
   * of which needs an engine. Each was red-proven against the guard it names. What stays here is what
   * needs a real engine: T104a's computed opacity, and the layout/hover tests above.
   */

  test('T104a — the affordance is subdued while inert and normal once armed (FR-044f)', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
    const win = shared.win;
    await project(win, 'Subdued');
    await seedTabs(win, ['bravo']);
    const ids = await tabIds(win);
    const active = await activeTabId(win);
    const target = ids.find((id) => id !== active)!;

    await pointerAwayFromStrip(win);
    await win.getByTestId(`tab-${target}`).hover();
    await expect(tabClose(win, target)).toBeVisible();

    const opacity = async (): Promise<number> =>
      Number(await tabClose(win, target).evaluate((el) => getComputedStyle(el).opacity));

    const inert = await opacity();
    expect(await closeIsInert(win, target), 'still inside the arming window').toBe(true);
    expect(inert, 'FR-044f: a deliberately dead control is drawn as one').toBeLessThan(1);

    await waitUntilArmed(win, target);
    const armed = await opacity();
    expect(
      armed,
      'FR-044f: and looks live once it is — otherwise the dead click is inexplicable',
    ).toBeGreaterThan(inert);
  });
});
