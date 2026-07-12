import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  runApp,
  createProject,
  firstPanelId,
  panelIds,
  addPanels,
  installResizeProbe,
} from './harness.js';
import { skipIfElevated } from './admin.js';

// 012 US1 (FR-001/002/005, SC-001a/006): the active panel is a single, visible,
// theme-driven focus context per window — the foreground treatment when the
// window is foreground, a dimmed inactive treatment when it is background (it
// persists, never disappears) — that re-homes deterministically when the active
// panel is closed, and that a pure focus change never resizes a terminal (SC-004).

/** The computed outline colour of a panel box (to prove the token actually swaps). */
function outlineColour(win: import('@playwright/test').Page, pid: string): Promise<string> {
  return win
    .getByTestId(`panel-${pid}`)
    .evaluate((el) => getComputedStyle(el).outlineColor);
}

test('exactly one active panel; it dims on window blur and restores on focus, without changing', async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'Focus', 'C:/c/focus');
    await addPanels(win, 2); // → three panels total
    await expect(win.locator('.panel-box')).toHaveCount(3);

    const [p1, p2] = await panelIds(win);
    await win.getByTestId(`panel-${p2}`).click();

    // Exactly one active panel, and it is p2.
    await expect(win.locator('.panel-box--active')).toHaveCount(1);
    await expect(win.getByTestId(`panel-${p2}`)).toHaveAttribute('data-active', 'true');
    const foregroundColour = await outlineColour(win, p2);

    // Send the window to the background → the indicator persists but switches to
    // its dimmed inactive treatment (SC-001a); it does NOT disappear or move.
    await win.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(win.getByTestId(`panel-${p2}`)).toHaveClass(/panel-box--active-dimmed/);
    await expect(win.locator('.panel-box--active')).toHaveCount(1);
    await expect(win.getByTestId(`panel-${p2}`)).toHaveAttribute('data-active', 'true');
    const backgroundColour = await outlineColour(win, p2);
    expect(backgroundColour).not.toBe(foregroundColour); // the token really swapped

    // Bring the window forward again → back to the foreground treatment, same panel.
    await win.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(win.getByTestId(`panel-${p2}`)).not.toHaveClass(/panel-box--active-dimmed/);
    await expect(win.getByTestId(`panel-${p2}`)).toHaveAttribute('data-active', 'true');
    expect(await outlineColour(win, p2)).toBe(foregroundColour);

    // Closing the active panel re-homes focus to the FR-005 deterministic target:
    // the panel PRECEDING it in layout order (p1), never leaving the window inputless.
    await win.getByTestId(`panel-close-${p2}`).click();
    await expect(win.locator('.panel-box')).toHaveCount(2);
    await expect(win.getByTestId(`panel-${p1}`)).toHaveAttribute('data-active', 'true');
    await expect(win.locator('.panel-box--active')).toHaveCount(1);
  });
});

test('changing which panel holds focus sends zero terminal resize messages (SC-004)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-focus-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'FocusTerm', root);
      const pid = await firstPanelId(win);

      // Type the first panel as a terminal and wait for it to be live.
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      const confirm = win.getByTestId(`panel-type-confirm-${pid}`);
      await expect(confirm).toBeEnabled();
      await confirm.click();
      const term = win.getByTestId(`terminal-${pid}`);
      await expect(term).toBeVisible();
      await expect(term).toContainText(basename(root), { timeout: 15000 });

      // Add a second (plain) panel so there is somewhere to move focus TO. This
      // split DOES resize the terminal — so install + reset the probe AFTER it.
      await addPanels(win, 1);
      await expect(win.locator('.panel-box')).toHaveCount(2);
      const [a, b] = await panelIds(win);
      await win.waitForTimeout(500); // let the split-induced resize settle

      const probe = await installResizeProbe(app);
      await probe.reset();

      // Move focus back and forth several times — a pure focus change, no pixel
      // size change → zero terminal resizes (FR-004/SC-004).
      for (let i = 0; i < 4; i += 1) {
        await win.getByTestId(`panel-${b}`).click();
        await win.getByTestId(`panel-${a}`).click();
      }
      await win.waitForTimeout(500);
      expect(await probe.count()).toBe(0);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
