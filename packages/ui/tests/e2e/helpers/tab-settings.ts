/**
 * `settings.tabs.*` helpers for the 031 US4/US5 E2E specs.
 *
 * Two things every one of those specs needs and neither `harness.ts` nor `helpers/tabs.ts` owns:
 *
 *  - **Putting a value into `settings.tabs`.** The name limit and the close-arming delay are
 *    settings, and both stories are ABOUT what happens when they change. Driving the preferences
 *    window to change them would open a second window and steal focus — throng closes menus on
 *    blur, so that alone would make unrelated specs flake — so these write `settings.json` in the
 *    run's own config root and let the app's hot-reload (#108) pick it up, exactly as
 *    `config-hotreload.e2e.ts` and `explorer-follow-active-editor.e2e.ts` already do.
 *
 *  - **Opening a rename box and reading its counter.** `tab-rename-input-<id>` /
 *    `tabstrip-rename-count-<id>` and their panel twins are the surface C1–C6 are stated over.
 *
 * ══ WHY THERE IS NO "WAIT FOR THE SETTING TO APPLY" HELPER ══
 *
 * There is deliberately none, because there is no way to write one that is not a sleep. A settings
 * write is picked up asynchronously, and the only honest sync point is the CONDITION the test is
 * about — a counter whose total reads the new limit, a title that shortened to it. Every caller
 * therefore polls its own assertion, which can only come true once the setting is live. That makes
 * the wait self-verifying instead of timed.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';

/** The subset of `settings.tabs` these stories drive. */
export interface TabSettingsPatch {
  /** `tabs.maxNameLength` — 10–128 (settings-metadata.ts), in grapheme clusters. */
  maxNameLength?: number;
  /** `tabs.closeArmingDelayMs` — 0–2000. How long a hover-revealed close affordance stays inert. */
  closeArmingDelayMs?: number;
}

/**
 * Write `settings.json` in `cfgRoot` with these `tabs` values (and optionally other sections).
 *
 * The whole file is replaced rather than merged: the app fills every key it does not find from its
 * defaults, so a test that states only what it cares about gets defaults for everything else — the
 * same starting point every time, whatever an earlier test in the file wrote.
 */
export function writeTabSettings(
  cfgRoot: string,
  tabs: TabSettingsPatch,
  otherSections: Record<string, unknown> = {},
): void {
  writeFileSync(
    join(cfgRoot, 'settings.json'),
    JSON.stringify({ ...otherSections, tabs }, null, 2),
    'utf8',
  );
}

/** The tab id behind a `tab-<id>` test id, as {@link import('./tabs.js').seedTabs} hands them back. */
export function tabIdOf(testId: string): string {
  return testId.replace(/^tab-/, '');
}

/** Open a tab's inline rename box (double-click, as a user would) and return its input. */
export async function startTabRename(win: Page, tabId: string): Promise<Locator> {
  // The LABEL, not the chip's middle: the middle can be the count pill or the close affordance,
  // and one of those deliberately swallows the double-click (P8). The label bubbles to the chip.
  await win.getByTestId(`tab-title-${tabId}`).dblclick();
  const input = win.getByTestId(`tab-rename-input-${tabId}`);
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  return input;
}

/** The tab rename counter (`C1`–`C6`). Absent from the DOM entirely while it is not shown. */
export function tabRenameCounter(win: Page, tabId: string): Locator {
  return win.getByTestId(`tabstrip-rename-count-${tabId}`);
}

/** The panel rename counter — the same control, the same limit (FR-035g). */
export function panelRenameCounter(win: Page, panelId: string): Locator {
  return win.getByTestId(`panel-rename-count-${panelId}`);
}

/**
 * The counter's text, or `null` when it is not shown.
 *
 * Returned rather than asserted so callers can `expect.poll` it: C1's "hidden" and C2's "reads
 * used/total" are the same observation at two limits, and a poll over one function expresses the
 * transition between them.
 */
export async function counterText(counter: Locator): Promise<string | null> {
  return (await counter.count()) === 0 ? null : ((await counter.textContent()) ?? '').trim();
}

/**
 * A string longer than any limit `tabs.maxNameLength` permits (its ceiling is 128).
 *
 * Offering this to a rename field always fills it to exactly the live limit, whatever that limit
 * is — which is what makes {@link awaitFieldLimit} work at every value.
 */
const OVER_ANY_LIMIT = 'z'.repeat(140);

/**
 * Wait until the open rename field is enforcing `limit`, and leave it full.
 *
 * ══ WHY A PROBE, AND WHY THIS ONE ══
 *
 * A settings write is applied asynchronously, so a test that writes the limit and then types its
 * fixture straight away is racing: at the OLD limit the field caps the fixture short, and when the
 * new limit arrives the field keeps that shortened draft (it only ever truncates further, C5). The
 * counter is then hidden — more than ten from the new limit — and no amount of polling recovers,
 * because nothing is going to type the missing characters. That is a real failure mode, not a
 * theoretical one: it is exactly how T081 failed first time round, silently and only when the
 * preceding test had left a LOWER limit behind.
 *
 * Offering more than any limit allows removes the race entirely. The field caps it at whatever
 * limit is live, so the counter reads `n/n` for that limit and nothing else — a condition that
 * cannot come true at the old value.
 *
 * The offer is repeated on every poll, and that repetition is not belt-and-braces: a field only
 * ever truncates further (C5), so one fill made while a LOWER limit was live leaves a draft that a
 * raised limit can never refill. Filling again each time is what makes the probe work in both
 * directions — which is the difference between this and the version that passed while the limit was
 * being lowered and hung for fifteen seconds when it was being raised.
 */
export async function awaitFieldLimit(
  input: Locator,
  counter: Locator,
  limit: number,
): Promise<void> {
  await expect
    .poll(
      async () => {
        await input.fill(OVER_ANY_LIMIT);
        return counterText(counter);
      },
      {
        timeout: 15_000,
        message: `the rename field never started enforcing a limit of ${limit}`,
      },
    )
    .toBe(`${limit}/${limit}`);
}

/** How the counter is styled right now — the evidence for C3 ("not an error state"). */
export async function counterStyle(
  counter: Locator,
): Promise<{ color: string; fontWeight: string; atLimit: string | null }> {
  const style = await counter.evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.color, fontWeight: s.fontWeight };
  });
  return { ...style, atLimit: await counter.getAttribute('data-at-limit') };
}

/**
 * A tab's close affordance, and whether it is shown / inert / disabled.
 *
 * `visibility: hidden` is what reserves its space (P5), and Playwright treats such an element as
 * not visible — so `toBeVisible()` is exactly the P4 question, with no class-name coupling.
 */
export function tabClose(win: Page, tabId: string): Locator {
  return win.getByTestId(`tabstrip-close-${tabId}`);
}

/** True while the affordance is drawn subdued because it is not yet armed (FR-044f, P6). */
export async function closeIsInert(win: Page, tabId: string): Promise<boolean> {
  return tabClose(win, tabId).evaluate((el) => el.classList.contains('tab-chip__close--inert'));
}

/**
 * Rest on a tab until its close affordance is live, then press it (031 US7 / FR-057).
 *
 * FR-057 supersedes FR-044g: the arming delay now applies to EVERY tab, the active one included, so
 * "the active tab's X is always live" is no longer true and a bare `tabClose(...).click()` on it is
 * simply a click inside the arming window — ignored, and correctly so.
 *
 * The wait is on the control's own `data-armed`, which is a CONDITION rather than a duration. A
 * sleep of `closeArmingDelayMs` would be the same claim made worse: it would assert that the delay
 * is the only thing between a hover and a live control, and it would go on passing at the wrong
 * value for as long as the machine happened to be fast enough.
 */
export async function armAndClose(win: Page, tabId: string): Promise<void> {
  await win.getByTestId(`tab-${tabId}`).hover();
  await expect(tabClose(win, tabId), `the close affordance on ${tabId} never armed`).toHaveAttribute(
    'data-armed',
    'true',
    { timeout: 10_000 },
  );
  await tabClose(win, tabId).click();
}

/**
 * Rest the pointer on a tab until its popover appears, and hand the popover back (031 US7/FR-058).
 *
 * ══ WHY THIS IS A RETRY AND NOT A BARE `hover()` ══
 *
 * FR-058 made the popover WAIT for `tabs.popoverDelayMs` with the pointer at rest, which turns a
 * single `hover()` into a precondition that has to HOLD for 300ms rather than an event that has to
 * happen. A pointer parked on a chip that then moves out from under it — a strip still settling on a
 * cold start — has genuinely left the tab, and the popover is right not to appear; but the test that
 * moved the pointer once, ten seconds earlier, reads that as a missing surface.
 *
 * So each attempt re-performs the gesture from a known state (away, then on), and then WAITS on the
 * popover rather than sampling for it. That is the same shape `awaitFieldLimit` above uses and for
 * the same reason: repeating the stimulus is what makes a poll about the condition instead of about
 * the moment the stimulus happened to land.
 */
export async function restOnTabForPopover(win: Page, chip: Locator): Promise<Locator> {
  const popover = win.getByTestId('tabstrip-popover');
  await expect
    .poll(
      async () => {
        await pointerAwayFromStrip(win);
        await chip.hover();
        return popover.waitFor({ state: 'visible', timeout: 3000 }).then(
          () => true,
          () => false,
        );
      },
      { timeout: 20_000, message: 'the tab popover never appeared for a resting pointer' },
    )
    .toBe(true);
  return popover;
}

/** Move the pointer well away from every tab, so no tab is hovered (P4's "pointer away"). */
export async function pointerAwayFromStrip(win: Page): Promise<void> {
  const strip = await win.getByTestId('tab-strip').boundingBox();
  if (!strip) throw new Error('pointerAwayFromStrip: the tab strip has no box');
  // Below the strip, inside the window: leaves every chip without leaving the page.
  await win.mouse.move(strip.x + strip.width / 2, strip.y + strip.height + 120);
}
