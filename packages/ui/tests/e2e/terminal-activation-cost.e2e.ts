import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp} from './harness.js';
import { makeCmdTerminal } from './altscreen-fixture.js';

/**
 * 028 T028b (SC-012) — what a tab switch costs the main thread.
 *
 * This feature does work on activation: every panel in the arriving tab is rebuilt, re-attached, and
 * asks its program to redraw. That is the fix for #162, and it is also the risk — a fix that makes
 * switching tabs feel slow has traded one complaint for another, and four terminals in one tab is an
 * ordinary layout, not a stress case.
 *
 * The requirement is that activation never BLOCKS. The repaint request is deliberately
 * fire-and-forget for exactly this reason: awaiting a daemon round-trip would put the network in
 * front of the switch. So what is measured here is the main thread's own time — the gap the user
 * would see as a freeze — not how long the daemon takes to answer.
 *
 * Long-task instrumentation rather than a stopwatch around the click: a wall-clock measurement
 * includes Playwright's own round-trips and the app's async settling, neither of which the user
 * feels. `PerformanceObserver('longtask')` reports only work that actually held the thread.
 */

const FRAME_MS = 16.7;
/**
 * The ceiling. One frame is the target, but a single browser long task is only reported at 50ms
 * granularity and a cold rebuild legitimately does real work — so the assertion is that nothing
 * holds the thread long enough to be FELT as a stall, with the measured figure printed either way so
 * a regression shows up as a number rather than as a pass.
 */
const STALL_MS = 250;

interface LongTask {
  duration: number;
  name: string;
}

/** Start recording main-thread long tasks in the renderer. */
async function watchLongTasks(win: Page): Promise<void> {
  await win.evaluate(() => {
    const g = globalThis as unknown as { __longTasks?: LongTask[] };
    g.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        g.__longTasks!.push({ duration: entry.duration, name: entry.name });
      }
    }).observe({ entryTypes: ['longtask'] });
  });
}

async function longTasks(win: Page): Promise<LongTask[]> {
  return win.evaluate(
    () => (globalThis as unknown as { __longTasks?: LongTask[] }).__longTasks ?? [],
  );
}

/** Add a panel to the current tab and make it a cmd terminal. */
async function addTerminal(win: Page, root: string, existingPanelId: string): Promise<void> {
  await win.getByTestId(`panel-add-${existingPanelId}`).click();
  const formLocator = win.locator('[data-testid^="panel-type-form-"]').first();
  await expect(formLocator).toBeVisible();
  const form = await formLocator.getAttribute('data-testid');
  const pid = form!.replace('panel-type-form-', '');
  await makeCmdTerminal(win, pid, basename(root));
}

test('switching to a tab of four terminals never blocks the main thread', { tag: ['@extended', '@terminal'] }, async () => {
  test.setTimeout(180_000);
  const root = mkdtempSync(join(tmpdir(), 'throng-activation-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Activation', root);
      const first = await firstPanelId(win);
      await makeCmdTerminal(win, first, basename(root));

      // Four terminals in one tab — an ordinary layout, and four rebuilds per activation.
      for (let i = 0; i < 3; i += 1) await addTerminal(win, root, first);
      const count = await win.locator('[data-testid^="terminal-"]:not([data-testid*="status-bar"])').count();
      expect(count, 'the tab should hold four terminals').toBe(4);

      // A second tab to switch away to.
      await win.getByTestId('tab-add').click();
      const tabs = win.getByTestId('tab-strip').locator('.tab-chip');
      await expect(tabs).toHaveCount(2);

      await watchLongTasks(win);

      for (let round = 0; round < 3; round += 1) {
        await tabs.first().click(); // back to the four terminals — the expensive direction
        // sleep-justified: MEASUREMENT WINDOW, not a sync point — the four panels' rebuild, re-attach and redraw requests must run to completion (and any long task be captured by the observer below) before the next switch starts a fresh one.
        await win.waitForTimeout(2500);
        await tabs.last().click();
        // sleep-justified: MEASUREMENT WINDOW — settle on the away tab so each of the 3 rounds is a genuinely cold re-activation, not overlapping the previous round's async work; same SC-012 sampling cadence as the wait above.
        await win.waitForTimeout(1500);
      }

      const tasks = await longTasks(win);
      const worst = tasks.reduce((m, t) => Math.max(m, t.duration), 0);
      console.log(
        `[activation] ${tasks.length} long tasks over 3 switches; worst ${worst.toFixed(0)}ms ` +
          `(one frame is ${FRAME_MS}ms, stall ceiling ${STALL_MS}ms)`,
      );

      expect(
        worst,
        `a ${worst.toFixed(0)}ms task held the main thread — the switch would be felt as a freeze`,
      ).toBeLessThan(STALL_MS);
    });
  } finally {
    cleanupTemp(root);
  }
});
