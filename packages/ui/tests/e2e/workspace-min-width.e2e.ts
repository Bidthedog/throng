import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { runApp, createProject } from './harness.js';

// The middle (workspace) pane must never be squeezed away when the window narrows
// while the side panes are wide. The side panes are NOT shrunk — they keep the
// user's set width and COLLAPSE (Explorer/right first) to preserve the workspace
// minimum.

test('the workspace keeps its minimum; side panes collapse (not shrink), Explorer first', async () => {
  await runApp(async (app: ElectronApplication, win) => {
    // A project activates the right Explorer pane so all three columns are present.
    await createProject(win, 'Alpha', 'C:/code/alpha');
    await expect(win.getByTestId('file-explorer-pane')).toBeVisible();

    const measure = () =>
      win.evaluate(() => {
        const w = (sel: string): number =>
          Math.round((document.querySelector(sel) as HTMLElement).getBoundingClientRect().width);
        return {
          side: w('.pane--sidebar'),
          mid: w('.pane--workspace'),
        };
      });

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 800));
    await win.waitForTimeout(300);
    const wide = await measure();
    expect(wide.mid).toBeGreaterThan(480); // plenty of room — middle is large

    // Narrow below the both-shown threshold: the Explorer collapses to a rail; the
    // sidebar keeps its width (not shrunk) and the workspace stays above its min.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1030, 800));
    await win.waitForTimeout(300);
    const narrow = await measure();

    await expect(win.getByTestId('pane-rail-right')).toBeVisible(); // Explorer collapsed first
    await expect(win.getByTestId('pane-hide-left')).toBeVisible(); // sidebar still expanded
    expect(narrow.mid).toBeGreaterThanOrEqual(470); // workspace minimum preserved
    expect(narrow.side).toBe(wide.side); // sidebar NOT shrunk — same width
  });
});
