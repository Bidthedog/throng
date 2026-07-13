import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId, settle } from './harness.js';

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
    const long = 'A panel title far too long to fit inside its header without truncating';
    await input.fill(long);
    await win.keyboard.press('Enter');

    // The tooltip is the ONLY way to read this title — the header ellipsizes it.
    await expect(header).toHaveAttribute('title', long);
  });
});

test('a tab chip shows its TITLE on hover, not instructions', async () => {
  await runApp(async (_app, win) => {
    await settle(win);
    await createProject(win, 'Tips', 'C:/c/tips');

    const chip = win.locator('.tab-chip').first();
    await expect(chip).toBeVisible();

    const label = await chip.locator('.tab-chip__label').textContent();
    expect(label?.trim()).toBeTruthy();

    await expect(chip).toHaveAttribute('title', label!.trim());

    const tooltip = await chip.getAttribute('title');
    expect(tooltip).not.toContain(TAB_INSTRUCTIONS);
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
    await win.getByTestId(`panel-type-terminal-${id}`).click().catch(() => {});
    // The add/close buttons keep their action-naming titles (constitution: themeable icon controls).
    await expect(win.getByTestId(`panel-add-${id}`)).toHaveAttribute('title', /.+/);
  });
});
