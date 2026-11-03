import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { runApp } from './harness.js';

/**
 * Layer: E2E. Only a real Electron process on a real display shows that the window opens with its sandbox on (062 US1).
 * Linux's own lane: `@linux` runs here and nowhere else.
 */
test.skip(process.platform !== 'linux', 'Linux startup, sandbox and display backend');

test('the window opens with the sandbox on, through XWayland, and stays open', { tag: ['@linux', '@extended', '@boot', '@reserve:window'] }, async () => {
  await runApp(async (app, win) => {
    await expect(win.getByTestId('project-new')).toBeVisible();
    const switches = await app.evaluate(({ app: electronApp }) => ({
      noSandbox: electronApp.commandLine.hasSwitch('no-sandbox'),
      ozone: electronApp.commandLine.getSwitchValue('ozone-platform'),
    }));
    expect(switches).toEqual({ noSandbox: false, ozone: 'x11' });
    expect(await win.evaluate(() => (window as unknown as { throng?: { osName?: string } }).throng?.osName)).toBe('linux');

    // The kernel's word for it, not a switch's: a renderer in Chromium's sandbox runs under a seccomp-bpf filter (mode 2).
    const renderer = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics().find((m) => m.type === 'Tab')?.pid);
    expect(renderer).toBeDefined();
    expect(readFileSync(`/proc/${renderer}/status`, 'utf8')).toMatch(/^Seccomp:\s+2$/m);
  });
});
