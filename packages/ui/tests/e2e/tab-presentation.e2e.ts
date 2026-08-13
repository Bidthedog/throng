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

  test('T095 — the panel count is a pill, and no square-bracket form survives (P1)', async () => {
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
   * FR-051 (US6) SUPERSEDES FR-043's "one per line" phrasing, and says why in as many words: a
   * native `title` attribute is one run of plain text, so it cannot indent the panels under the tab
   * that contains them. The hover is now a formatted HTML surface, and the chip deliberately
   * carries no `title` at all — two tooltips for one chip is one too many.
   *
   * P2's actual CLAIM is unchanged and is still asserted in full here: the tab names itself, says
   * how many panels it holds, and then lists them. Only the surface it is read from has moved.
   */
  test('T096 — hovering a tab shows its name, its panel count, and each panel (P2, FR-051)', async () => {
    const win = shared.win;
    await project(win, 'Tooltip');
    await addPanels(win, 1); // two panels
    const tab = await activeTabId(win);

    const panelNames = await win
      .locator('[data-testid^="panel-title-"]')
      .evaluateAll((els) => els.map((el) => (el.textContent ?? '').trim()));
    expect(panelNames.length, 'two panels to be listed').toBe(2);

    await pointerAwayFromStrip(win);
    await expect(
      win.getByTestId('tabstrip-popover'),
      'nothing is hovered, so nothing is described',
    ).toHaveCount(0);

    // FR-058 — a RESTING pointer, not a passing one. `restOnTabForPopover` re-performs the gesture
    // if the strip moved out from under it, which a bare `hover()` cannot notice.
    const popover = await restOnTabForPopover(win, win.getByTestId(`tab-${tab}`));
    await expect(popover).toBeVisible();
    await expect(popover, 'the popover describes the tab under the pointer').toHaveAttribute(
      'data-tab-id',
      tab,
    );

    const label = (await win.getByTestId(`tab-title-${tab}`).textContent()) ?? '';
    await expect(
      win.getByTestId('tabstrip-popover-name'),
      'P2: the tab names itself first',
    ).toHaveText(label);
    await expect(
      win.getByTestId('tabstrip-popover-count'),
      'P2: then how many panels it holds',
    ).toHaveText('2 panels');
    expect(
      await win
        .getByTestId('tabstrip-popover-panels')
        .locator('.tabstrip-popover__panel')
        .evaluateAll((els) => els.map((el) => (el.textContent ?? '').trim())),
      "P2: then each panel's name",
    ).toEqual(panelNames);

    // FR-051's own claim — the panels are INDENTED under the tab, not a flat run of peers.
    const nameLeft = (await geom(win.getByTestId('tabstrip-popover-name'))).x;
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

  test('T097 — the affordance is on the active tab always, and on the tab under the pointer (P4)', async () => {
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

  test('T098 — revealing the affordance moves nothing: its space is reserved (P5, SC-007b)', async () => {
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

  test('T102 — sweeping the pointer across the whole strip destroys no tab (SC-007a)', async () => {
    const win = shared.win;
    await project(win, 'Sweep');
    await seedTabs(win, ['bravo', 'charlie', 'delta']);
    const before = await tabIds(win);
    expect(before.length, 'four tabs to sweep across').toBe(4);

    const strip = await geom(win.getByTestId('tab-strip'));
    /*
     * Two passes, left to right and back, resting long enough at each step for the affordances to
     * arm — which is the dangerous state, not the inert one. No click is issued anywhere.
     */
    for (const pass of [0, 1]) {
      for (let i = 0; i <= 20; i += 1) {
        const t = pass === 0 ? i / 20 : 1 - i / 20;
        await win.mouse.move(strip.x + 4 + t * (strip.w - 8), strip.y + strip.h / 2);
      }
    }
    await pointerAwayFromStrip(win);

    expect(await tabIds(win), 'SC-007a: a pointer that only passed over destroyed nothing').toEqual(
      before,
    );
    await expect(win.getByTestId('confirm-dialog'), 'and asked nothing, either').toHaveCount(0);
  });

  test('T104 — the last tab in the main window offers no usable close affordance (P10)', async () => {
    const win = shared.win;
    await project(win, 'Lonely');
    const ids = await tabIds(win);
    expect(ids.length, 'a fresh project has exactly one tab').toBe(1);
    const only = ids[0]!;

    // It is the active tab, so it is drawn — P10 is about it being unavailable, not absent.
    await expect(tabClose(win, only)).toBeVisible();
    await expect(
      tabClose(win, only),
      'P10: unavailable exactly where Destroy Tab is — the last tab of the main window',
    ).toBeDisabled();

    // And a second tab makes both usable again, so the disabling really is the one-tab rule.
    await seedTabs(win, ['bravo']);
    for (const id of await tabIds(win)) {
      await win.getByTestId(`tab-${id}`).hover();
      await expect(tabClose(win, id), 'with two tabs, Destroy Tab is available again').toBeEnabled();
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

  test('T099 — a click inside the arming window does nothing, then and later (P6, P7, P8)', async () => {
    const win = shared.win;
    await project(win, 'Inert');
    await seedTabs(win, ['bravo', 'charlie']);
    const ids = await tabIds(win);
    const active = await activeTabId(win);
    const target = ids.find((id) => id !== active)!;

    await pointerAwayFromStrip(win);
    await win.getByTestId(`tab-${target}`).hover();
    await expect(tabClose(win, target)).toBeVisible();
    expect(await closeIsInert(win, target), 'P6: a hover-revealed affordance starts inert').toBe(true);

    // The click that must be ignored.
    await tabClose(win, target).click();

    expect(await tabIds(win), 'P7: nothing was destroyed by the click itself').toEqual(ids);
    await expect(
      win.getByTestId(`tab-${target}`),
      'P8: and the click did not activate the tab either',
    ).toHaveAttribute('data-active', 'false');
    await expect(
      win.locator('[data-testid^="tab-rename-input-"]'),
      'P8: nor start a rename',
    ).toHaveCount(0);
    await expect(win.getByTestId('confirm-dialog'), 'and asked nothing').toHaveCount(0);

    /*
     * P7's real claim — IGNORED, NOT QUEUED.
     *
     * Wait for the affordance to arm, which is the arming window having elapsed expressed as a
     * condition rather than as a sleep. If the click had been queued behind the delay, this is
     * where the tab would quietly disappear.
     */
    await waitUntilArmed(win, target);
    expect(await tabIds(win), 'P7: nothing fired when the delay elapsed, either').toEqual(ids);
    await expect(win.getByTestId('confirm-dialog'), 'P7: and nothing was asked later').toHaveCount(0);
  });

  test('T100 — after the delay the affordance runs Destroy Tab; leaving re-arms it from scratch (P3, P7)', async () => {
    const win = shared.win;
    await project(win, 'Destroyer');
    await seedTabs(win, ['bravo', 'charlie']);
    const ids = await tabIds(win);
    const active = await activeTabId(win);
    const target = ids.find((id) => id !== active)!;

    await pointerAwayFromStrip(win);
    await win.getByTestId(`tab-${target}`).hover();
    await waitUntilArmed(win, target);

    /*
     * P7 — the delay RESTARTS on each appearance. Leaving and returning must wait it out again,
     * rather than the tab staying armed because it was armed a moment ago.
     */
    await pointerAwayFromStrip(win);
    await expect(tabClose(win, target), 'the affordance went away with the pointer').toBeHidden();
    await win.getByTestId(`tab-${target}`).hover();
    await expect(tabClose(win, target)).toBeVisible();
    expect(await closeIsInert(win, target), 'P7: re-entering re-arms from scratch').toBe(true);
    await waitUntilArmed(win, target);

    /*
     * P3 — the SAME Destroy Tab action, with the same confirmations. `confirmations.destroyTab`
     * ships as `double`, so the affordance earns both dialogs; anything less would mean the strip
     * had grown its own quieter route to the same destruction.
     */
    await tabClose(win, target).click();
    const dialog = win.getByTestId('confirm-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Destroy');
    await win.getByTestId('confirm-accept').click();
    await expect(dialog).toContainText('absolutely sure');
    await win.getByTestId('confirm-accept').click();

    await expect(win.getByTestId(`tab-${target}`)).toHaveCount(0);
    expect(await tabIds(win), 'exactly the one tab went').toEqual(ids.filter((id) => id !== target));
  });

  /*
   * ══ THIS TEST USED TO ASSERT THE OPPOSITE, AND WAS RIGHT TO ══
   *
   * It read "the active tab's always-present affordance has no arming delay (P9)" and proved it by
   * clicking with the pointer away from the strip. FR-044g's reasoning was that the affordance is
   * always present on the active tab, so nothing materialises under a pointer already in motion and
   * there is nothing to guard against.
   *
   * 031 US7 / **FR-057 supersedes FR-044g** on evidence from using it. The active tab's X is the one
   * most often adjacent to where the pointer already is, so it is the likeliest of all of them to be
   * caught in passing; and a rule that changes depending on which tab you are over is harder to hold
   * than "the X arms once you rest on it". So the assertion is INVERTED rather than deleted — the
   * same control, at the same delay, now has to be inert until it has been rested on, and the P7
   * "ignored, not queued" proof is carried over intact because a click that lands early on the
   * ACTIVE tab must not destroy anything later either.
   */
  test('T101 — the active tab’s affordance arms on a rest like every other one (FR-057)', async () => {
    const win = shared.win;
    await project(win, 'Immediate');
    await seedTabs(win, ['bravo']);
    const active = await activeTabId(win);

    /*
     * Read with the pointer AWAY from the strip. The affordance is still DRAWN — it is the active
     * tab, and P4 has not changed — but it is no longer live merely for being drawn.
     */
    await pointerAwayFromStrip(win);
    await expect(tabClose(win, active), 'P4: still always present on the active tab').toBeVisible();
    expect(
      await closeIsInert(win, active),
      'FR-057: the active tab is not exempt — unrested, it is inert',
    ).toBe(true);

    // A click now is a click inside the arming window: ignored, and not queued behind it either.
    await tabClose(win, active).click();
    await expect(
      win.getByTestId('confirm-dialog'),
      'FR-057: an unrested click on the active tab does nothing',
    ).toHaveCount(0);

    // Resting on the tab arms it, and then it acts — the same control, reached the same way as any
    // other tab's.
    await win.getByTestId(`tab-${active}`).hover();
    await waitUntilArmed(win, active);
    expect(await tabIds(win), 'P7: and the early click never fired late').toContain(active);
    await expect(win.getByTestId('confirm-dialog'), 'P7: nor asked late').toHaveCount(0);

    await tabClose(win, active).click();
    await expect(win.getByTestId('confirm-dialog'), 'armed, so it acts').toBeVisible();
    await win.getByTestId('confirm-cancel').click();
    await expect(win.getByTestId('confirm-dialog')).toHaveCount(0);
    await expect(win.getByTestId(`tab-${active}`), 'cancelled, so nothing was destroyed').toBeVisible();
  });

  test('T104a — the affordance is subdued while inert and normal once armed (FR-044f)', async () => {
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

// ══ With no arming delay at all ══

test.describe('with the arming delay turned off', () => {
  let shared: OpenApp;
  let cfgRoot: string;

  test.beforeAll(async () => {
    cfgRoot = mkdtempSync(join(tmpdir(), 'throng-tabpres-fast-cfg-'));
    writeTabSettings(cfgRoot, { closeArmingDelayMs: 0 });
    shared = await openApp({ env: { THRONG_CONFIG_ROOT: cfgRoot } });
    await settle(shared.win);
  });
  test.afterAll(async () => {
    await shared?.close();
    cleanupTemp(cfgRoot);
  });

  test('T103 — a delay of zero makes a hover-revealed affordance live immediately (FR-044h)', async () => {
    const win = shared.win;
    await project(win, 'NoDelay');
    await seedTabs(win, ['bravo']);
    const ids = await tabIds(win);
    const active = await activeTabId(win);
    const target = ids.find((id) => id !== active)!;

    await pointerAwayFromStrip(win);
    await win.getByTestId(`tab-${target}`).hover();
    await expect(tabClose(win, target)).toBeVisible();
    expect(
      await closeIsInert(win, target),
      'FR-044h: zero means live, with no window to wait out',
    ).toBe(false);

    // The proof that "not inert" means "acts": the very first click reaches Destroy Tab.
    await tabClose(win, target).click();
    await expect(win.getByTestId('confirm-dialog')).toBeVisible();
    await win.getByTestId('confirm-cancel').click();
    expect(await tabIds(win), 'cancelled, so the strip is untouched').toEqual(ids);
  });
});
