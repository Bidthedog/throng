import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { runApp, createProject } from './harness.js';

// FR-040: the OS window title shows the active project name + the active Tab · Panel
// context (the same `activeContextLabel` the status bar uses), NO path and NO
// project/tab/panel totals, plus a trailing `[ADMIN]` marker when elevated (FR-025e).
// #5: the bottom status bar still shows the active project's path in brackets.

const title = (app: ElectronApplication): Promise<string> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());

test('window title shows active project · Tab · Panel (no path, no totals); status bar keeps the path', async () => {
  await runApp(async (app, win) => {
    await createProject(win, 'Titler', 'C:/code/titler');

    // Title bar: "throng — Titler · Tab 1 · Panel 1" — no path, no totals, no admin.
    await expect.poll(() => title(app), { timeout: 5000 }).toBe('throng — Titler · Tab 1 · Panel 1');
    const t = await title(app);
    expect(t).not.toContain('(C:/code/titler)'); // path removed
    expect(t).not.toMatch(/\d+ (projects|tabs|panels)/); // totals removed
    expect(t).not.toContain('[ADMIN]'); // not elevated here

    // Status bar still shows the project path in brackets (unchanged).
    await expect(win.getByTestId('status-project-path')).toHaveText('(C:/code/titler)');
    await expect(win.getByTestId('status-project')).toContainText('Titler');
  });
});

test('window title gains a [ADMIN] marker when elevated', async () => {
  await runApp(
    async (app) => {
      await expect.poll(() => title(app), { timeout: 5000 }).toContain('[ADMIN]');
      expect(await title(app)).toContain('throng — No project');
    },
    { env: { THRONG_FAKE_ELEVATED: '1' } },
  );
});
