import { mkdtempSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

// FR-074: terminals ARE app-stylable — xterm renders from fontFamily/fontSize
// options, now sourced from the themeable `terminal` typography role (default
// Consolas monospace). This E2E confirms the terminal font applies (rather than
// silently assuming terminals cannot be styled).

test('a terminal renders in the themeable monospace font (terminals are stylable)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-tf-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'TermFont', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();

      const term = win.getByTestId(`terminal-${pid}`);
      await expect(term).toBeVisible();
      // Wait for the shell to render output so xterm has laid out its DOM.
      await expect(term).toContainText(basename(root), { timeout: 15000 });

      // xterm applies the configured font to its measurement/text DOM. The default
      // terminal typography role is Consolas — assert it took effect somewhere in
      // the xterm subtree (canvas renderer keeps it on the char-measure element).
      const fonts = await term.evaluate((host) =>
        Array.from(host.querySelectorAll('*'))
          .map((el) => getComputedStyle(el as HTMLElement).fontFamily)
          .filter((f) => f && f !== 'inherit'),
      );
      expect(fonts.some((f) => f.toLowerCase().includes('consolas'))).toBe(true);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
