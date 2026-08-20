import { test, expect, type Page } from '@playwright/test';
import { openApp, createProject, settle, type OpenApp } from './harness.js';
import { restOnTabForPopover } from './helpers/tab-settings.js';

/**
 * 017 / #57 — a header tooltip must show the TITLE, not a list of instructions.
 *
 * A panel title is truncated with an ellipsis, so hovering it is the only way to read it in full —
 * and that tooltip was occupied by "Click: Activate · Drag: Move · …". The one piece of information
 * a tooltip exists to give was the one piece it withheld.
 *
 * The instructions are not moved elsewhere: they remain discoverable from the right-click menu,
 * which is where they belong.
 *
 * ══ ONE APP, ONE PROJECT (034 FR-045) ══
 *
 * Five tests, five `runApp()` calls, five Electron launches and five daemons — each opening an app
 * and creating the same project `Tips` in order to read a `title` attribute off it. Nothing here
 * seeds state before the app starts, so the file now shares one app and creates that project once.
 *
 * Only one test MUTATES anything: the rename below. It is harmless to the others BY CONSTRUCTION,
 * which is the property that made this file safe to share and is worth stating rather than assuming
 * — every assertion here is relative to whatever the current title IS, never to a literal. A
 * renamed panel changes what the tooltip must equal, not whether the claim holds.
 *
 * Deliberately NOT `mode: 'serial'`. These five ask five independent questions, and a first failure
 * that skipped the rest would turn "the panel header tooltip is wrong" into "something about
 * tooltips is wrong". `fullyParallel: false` already keeps the file to one worker, in order, so the
 * shared app is never driven by two tests at once.
 */

const TAB_INSTRUCTIONS = 'Click: Switch';

let shared: OpenApp;
/** The one window every test below drives. */
const win = (): Page => shared.win;

test.beforeAll(async () => {
  shared = await openApp();
  await settle(shared.win);
  await createProject(shared.win, 'Tips', 'C:/c/tips');
});

test.afterAll(async () => {
  await shared?.close();
});



/*
 * THREE TESTS REMOVED (035 T055) — now `packages/ui/tests/component/panel-box.test.ts`:
 *
 *   - "a panel header shows its TITLE on hover, not instructions"
 *   - "a renamed panel shows its NEW title on hover"
 *   - "the tooltips that already showed CONTENT are untouched (FR-010)"
 *
 * Each asserted a `title` ATTRIBUTE on a rendered element, and two of the three compared it against
 * the panel's own rendered title — a comparison between two things one component draws. They opened
 * an app and created a project to read an attribute off it.
 *
 * STRONGER THERE THAN HERE: the component versions add a sweep over EVERY rendered `[title]` for the
 * instruction strings, so a control that grew an instruction list would fail on the rule rather than
 * on whichever three examples someone remembered to check.
 *
 * Red-proven against four mutations: instructions-back (3 red — #57 itself), stale-title (2 red — a
 * tooltip captured once and no longer tracking the title), strip-add (2 red) and strip-all (1 red),
 * the last two being the over-broad fix that removes the action controls' naming titles.
 *
 * ── WHAT STAYS, AND WHY THE FILE SURVIVES ──
 *
 * The tab-chip test below. Its "no native tooltip on the chip" half already moved to
 * `unit/tooltip-instructions.test.ts`; what remains is that the popover appears only once the
 * pointer RESTS on the chip (031 US7 / FR-058) — a gesture nothing below this layer drives.
 */
/*
 * 031 FR-051 — the tab hover is a POPOVER now, not a `title` attribute.
 *
 * The claim this test makes is unchanged and still the right one: hovering a tab tells you what the
 * tab IS, and never how to interact with it. Only the mechanism moved, because a `title` attribute
 * cannot indent or format, which is what the maintainer asked for after using the strip.
 *
 * Asserting the absence of `title` is deliberate rather than incidental: leaving both would give one
 * chip two tooltips, and the native one would win the race and show the unformatted version.
 */
test('a tab chip shows its TITLE on hover, not instructions', { tag: ['@extended', '@window'] }, async () => {
  const chip = win().locator('.tab-chip').first();
  await expect(chip).toBeVisible();

  const label = await chip.locator('.tab-chip__label').textContent();
  expect(label?.trim()).toBeTruthy();

  await expect(chip, 'FR-051: the native tooltip is gone, so it cannot compete').not.toHaveAttribute(
    'title',
    /./,
  );

  // 031 US7 / FR-058 — the popover WAITS for a resting pointer now, so the gesture is "rest on
  // the tab" rather than "move onto it once". See `restOnTabForPopover`.
  const popover = await restOnTabForPopover(win(), chip);
  await expect(popover).toBeVisible();
  await expect(win().getByTestId('tabstrip-popover-name')).toHaveText(label!.trim());
  await expect(popover).not.toContainText(TAB_INSTRUCTIONS);
});

/*
 * MOVED (035 FR-001) — "the interaction instructions appear NOWHERE in the workspace chrome" now
 * lives at `packages/ui/tests/unit/tooltip-instructions.test.ts`, and is stronger there.
 *
 * It swept every `[title]` element ON THE PAGE, which could only ever mean the elements this one
 * window had rendered: one project, one tab, one untyped panel — no terminal, no editor, no failure
 * banner, no sub-workspace. An instruction list on a control that renders only for a terminal panel
 * would have passed it every time. The unit guard reads the SOURCE, so it sees every tooltip the
 * app can draw, and it strips comments first so `panel-placeholder.tsx:465` may keep explaining
 * why the rule exists.
 *
 * The chip's "no native tooltip" half of `:95` moved with it. What stays here is that test's real
 * remainder: the popover appears only once the pointer RESTS, which is a gesture nothing below this
 * layer drives.
 */

