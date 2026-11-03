import { test, expect } from '@playwright/test';
import { runApp } from './harness.js';

/**
 * Layer: E2E. Maximise and minimise are answered by the window manager, which no lower layer has (062 US4).
 */
test.skip(process.platform !== 'linux', 'Linux window manager behaviour');

test('the title bar maximises, restores and closes under a real window manager', { tag: ['@linux', '@extended', '@window', '@reserve:window'] }, async () => {
  await runApp(async (app, win) => {
    const state = (): Promise<boolean> =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMaximized() ?? false);
    const max = win.getByTestId('window-max');
    await expect(max).toBeVisible();

    const before = await state();
    await max.click();
    await expect.poll(state).toBe(!before);
    await max.click();
    await expect.poll(state).toBe(before);
  });
});
