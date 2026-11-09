import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect } from '@playwright/test';
import { cleanupTemp, createProject, firstPanelId, runApp, TEST_SHELL } from './harness.js';

/**
 * Layer: E2E — #162 / 061 FR-040, FR-041: whether the grid's last row is inside its panel depends on real layout at a
 * fractional device scale, which jsdom does not have. The scale is forced, so no particular monitor is needed.
 *
 * The report: output appears then clears, typed text is invisible, and scrolling up shows the missing content; that is,
 * the bottom rows, where the cursor sits, are drawn below what the panel shows.
 */

const HEIGHTS = [620, 657, 694, 731, 768, 805, 842, 879, 916, 953, 990];
/** Half a CSS pixel: rounding, not a clipped row. */
const TOLERANCE_PX = 0.5;

for (const scale of [1.25, 1.5, 1.75]) {
  test(`every row of the terminal is inside its panel at ${scale * 100}% display scale`, { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
    test.setTimeout(90_000);
    const root = mkdtempSync(join(tmpdir(), 'throng-scale-'));
    try {
      await runApp(
        async (app, win) => {
          // On Windows a forced scale makes Electron report the display at 1/scale of its size, so at 175% the first
          // window opens 630 wide. Both side panes collapse at that width and New project is not on the page.
          await app.evaluate(({ BrowserWindow }, h) => BrowserWindow.getAllWindows()[0]!.setContentSize(1200, h), HEIGHTS[0]!);
          await expect(win.getByTestId('project-new')).toBeVisible();
          await createProject(win, 'Scale', root);
          const panelId = await firstPanelId(win);
          await win.getByTestId(`panel-type-select-${panelId}`).selectOption('terminal');
          await win.getByTestId('terminal-flavour').selectOption(TEST_SHELL);
          await win.getByTestId(`panel-type-confirm-${panelId}`).click();
          await expect(win.getByTestId(`terminal-${panelId}`)).toContainText(basename(root), { timeout: 20_000 });

          const clipped: string[] = [];
          for (const height of HEIGHTS) {
            await app.evaluate(({ BrowserWindow }, h) => BrowserWindow.getAllWindows()[0]!.setContentSize(1200, h), height);
            // sleep-justified: MEASUREMENT WINDOW — the resize's debounce, the grid's round trip and xterm's next render.
            await win.waitForTimeout(400);
            const measured = await win.evaluate((id) => {
              const term = document.querySelector(`[data-testid="terminal-${id}"]`)!;
              const panel = term.closest('.terminal-panel') ?? term;
              const rows = term.querySelectorAll('.xterm-rows > div');
              return {
                rows: rows.length,
                rowBottom: rows[rows.length - 1]!.getBoundingClientRect().bottom,
                panelBottom: panel.getBoundingClientRect().bottom,
              };
            }, panelId);
            if (measured.rowBottom > measured.panelBottom + TOLERANCE_PX) {
              clipped.push(`window ${height}: row ${measured.rows} ends at ${measured.rowBottom}, panel ends at ${measured.panelBottom}`);
            }
          }

          expect(clipped, 'rows drawn below the bottom of the panel').toEqual([]);
        },
        { electronArgs: [`--force-device-scale-factor=${scale}`] },
      );
    } finally {
      cleanupTemp(root);
    }
  });
}
