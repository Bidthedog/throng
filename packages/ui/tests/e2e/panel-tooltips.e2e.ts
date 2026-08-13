import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId, settle } from './harness.js';
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
 */

const PANEL_INSTRUCTIONS = 'Click: Activate';
const TAB_INSTRUCTIONS = 'Click: Switch';

test('a panel header shows its TITLE on hover, not instructions', async () => {
  await runApp(async (_app, win) => {
    await settle(win);
    await createProject(win, 'Tips', 'C:/c/tips');

    const id = await firstPanelId(win);
    const header = win.getByTestId(`panel-handle-${id}`);
    await expect(header).toBeVisible();

    const title = await win.getByTestId(`panel-title-${id}`).textContent();
    expect(title?.trim()).toBeTruthy();

    await expect(header).toHaveAttribute('title', title!.trim());

    const tooltip = await header.getAttribute('title');
    expect(tooltip).not.toContain(PANEL_INSTRUCTIONS);
  });
});

test('a renamed panel shows its NEW title on hover', async () => {
  await runApp(async (_app, win) => {
    await settle(win);
    await createProject(win, 'Tips', 'C:/c/tips');

    const id = await firstPanelId(win);
    const header = win.getByTestId(`panel-handle-${id}`);
    await header.dblclick();

    const input = win.getByTestId(`panel-rename-input-${id}`);
    await expect(input).toBeFocused();
    /*
     * 031 — this fixture was 70 characters, and `tabs.maxNameLength` now defaults to 64, so the
     * rename field capped the input and the header could never have shown all of it. Shortened to
     * 60: still far wider than the header, so the ellipsis this test is about still happens, but
     * within the limit, so the test goes on asking its own question instead of the name limit's.
     * The limit has its own coverage in `tab-name-limit.e2e.ts`.
     */
    const long = 'A panel title too long to fit inside its header at all';
    await input.fill(long);
    await win.keyboard.press('Enter');

    // The tooltip is the ONLY way to read this title — the header ellipsizes it.
    await expect(header).toHaveAttribute('title', long);
  });
});

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
test('a tab chip shows its TITLE on hover, not instructions', async () => {
  await runApp(async (_app, win) => {
    await settle(win);
    await createProject(win, 'Tips', 'C:/c/tips');

    const chip = win.locator('.tab-chip').first();
    await expect(chip).toBeVisible();

    const label = await chip.locator('.tab-chip__label').textContent();
    expect(label?.trim()).toBeTruthy();

    await expect(chip, 'FR-051: the native tooltip is gone, so it cannot compete').not.toHaveAttribute(
      'title',
      /./,
    );

    // 031 US7 / FR-058 — the popover WAITS for a resting pointer now, so the gesture is "rest on
    // the tab" rather than "move onto it once". See `restOnTabForPopover`.
    const popover = await restOnTabForPopover(win, chip);
    await expect(popover).toBeVisible();
    await expect(win.getByTestId('tabstrip-popover-name')).toHaveText(label!.trim());
    await expect(popover).not.toContainText(TAB_INSTRUCTIONS);
  });
});

test('the interaction instructions appear NOWHERE in the workspace chrome', async () => {
  await runApp(async (_app, win) => {
    await settle(win);
    await createProject(win, 'Tips', 'C:/c/tips');

    // Not merely absent from the elements we changed — absent from every title attribute on the
    // page. A guard shaped like the change would pass while the string survived somewhere else.
    const titles = await win.locator('[title]').evaluateAll((els) =>
      els.map((el) => el.getAttribute('title') ?? ''),
    );
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.filter((t) => t.includes(PANEL_INSTRUCTIONS))).toEqual([]);
    expect(titles.filter((t) => t.includes(TAB_INSTRUCTIONS))).toEqual([]);
  });
});

test('the tooltips that already showed CONTENT are untouched (FR-010)', async () => {
  await runApp(async (_app, win) => {
    await settle(win);
    await createProject(win, 'Tips', 'C:/c/tips');

    const id = await firstPanelId(win);
    // The panel-type marker still names the type — it is an action/content tooltip, not an
    // instruction list, and #57 does not touch it.
    // Best-effort probe of the panel-type marker: bound it (issue #75). Without an explicit
    // timeout a click on an absent testid auto-waits the whole per-test budget before the .catch
    // swallows it — invisible at 60s, but at 30s it consumed the test before the real assertion
    // below ever ran. A short bound keeps the probe best-effort and fast.
    await win.getByTestId(`panel-type-terminal-${id}`).click({ timeout: 2000 }).catch(() => {});
    // The add/close buttons keep their action-naming titles (constitution: themeable icon controls).
    await expect(win.getByTestId(`panel-add-${id}`)).toHaveAttribute('title', /.+/);
  });
});
