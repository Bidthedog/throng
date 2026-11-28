import { basename } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp, pressAction, TEST_SHELL } from './harness.js';

/**
 * 028 / #163 — "Refresh / redraw terminal".
 *
 * The user's only cure for a mis-rendered terminal was dragging a panel divider a pixel or two: an
 * accidental discovery, undiscoverable to anyone not told about it, dependent on landing the drag
 * precisely enough to change the character grid, and destructive to the layout they arranged. This
 * is that nudge as a named action on the panel's title menu (FR-041; the v1 review, #732, took it out of the
 * terminal's body menu, FR-040), with Ctrl+F5 as an accelerator over it rather than instead of it (FR-049c).
 *
 * What the action must NOT do is most of the requirement: no content, scrollback, cursor, selection,
 * focus or layout change, no input typed at the shell, and safe to repeat (FR-043–046).
 */


test('a redraw from the title menu, and from Ctrl+F5 three times, loses nothing and types nothing', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-redraw-'));
  const marker = basename(root);
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Redraw', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption(TEST_SHELL);
      const confirm = win.getByTestId(`panel-type-confirm-${pid}`);
      await expect(confirm).toBeEnabled();
      await confirm.click();
      const term = win.getByTestId(`terminal-${pid}`);
      await expect(term).toBeVisible();
      await expect(term).toContainText(marker, { timeout: 20000 });

      // Put a distinctive line on screen so "nothing was lost" is checkable rather than assumed.
      await term.click();
      await win.keyboard.type('echo redraw-fence');
      await win.keyboard.press('Enter');
      await expect(term).toContainText('redraw-fence', { timeout: 20000 });

      // --- the terminal's own right-click menu no longer offers it (v1 review, #732): it acts on the panel ---
      await term.click({ button: 'right' });
      await expect(win.getByTestId('menu-item-Copy')).toBeVisible();
      await expect(win.getByTestId('menu-item-Refresh / redraw terminal')).toHaveCount(0);
      await win.keyboard.press('Escape');
      await expect(win.getByTestId('menu-item-Copy')).toHaveCount(0);

      // --- the panel title menu (FR-041). The chord it shows is `tests/unit/redraw-menu-parity.test.ts`'s (034 FR-045). ---
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      const headerItem = win.getByText('Refresh / redraw terminal', { exact: true });
      await expect(headerItem).toBeVisible();
      await headerItem.click();
      // Nothing was lost, and nothing was typed: a redraw is never a keystroke (FR-044).
      await expect(term).toContainText('redraw-fence');
      await expect(term).not.toContainText('redraw-fence redraw-fence');

      // --- the chord (FR-049a), and repeat-safety (FR-046) ---
      await term.click();
      await pressAction(win, 'terminal.redraw');
      await pressAction(win, 'terminal.redraw');
      await pressAction(win, 'terminal.redraw');
      await expect(term).toContainText('redraw-fence');

      // The shell is still live and still ours: the fence line is the last thing on screen, no
      // stray characters arrived from any of the three gestures.
      await win.keyboard.type('echo still-alive');
      await win.keyboard.press('Enter');
      await expect(term).toContainText('still-alive', { timeout: 20000 });
    });
  } finally {
    cleanupTemp(root);
  }
});
