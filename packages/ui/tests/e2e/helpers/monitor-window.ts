import { expect, type ElectronApplication, type Page } from '@playwright/test';

/**
 * 055 R14 (FR-081) — the Resource Monitor is its own window, so a spec finds it the way the
 * Preferences specs find theirs: the `window` event a `trigger` fires, then the page's own root.
 *
 * `trigger` is whatever opens it from the main window (the chord, the status-bar item, the cog). Throng
 * has exactly ONE monitor window: asking again while it is open brings it forward and fires NO `window`
 * event, so a spec that opens it twice closes it in between (`closeMonitorWindow`), or this waits out
 * its whole budget.
 *
 * Waits for the first reading (`data-state="ready"`) unless told not to — nearly every claim is about
 * what the monitor shows.
 */
export async function openMonitorWindow(
  app: ElectronApplication,
  trigger: () => Promise<unknown>,
  opts: { ready?: boolean } = {},
): Promise<Page> {
  const [monitor] = await Promise.all([app.waitForEvent('window'), trigger()]);
  await monitor.waitForLoadState('domcontentloaded');
  const root = monitor.getByTestId('monitor-window');
  await expect(root).toBeVisible();
  if (opts.ready !== false) await expect(root).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
  return monitor;
}

/** The monitor window if one is open right now, else `null`. */
export async function monitorWindowPage(app: ElectronApplication): Promise<Page | null> {
  for (const page of app.windows()) {
    if (page.isClosed()) continue;
    const isMonitor = await page
      .getByTestId('monitor-window')
      .count()
      .catch(() => 0);
    if (isMonitor > 0) return page;
  }
  return null;
}

/** Close the monitor window (if open) and do not return until it is gone. */
export async function closeMonitorWindow(app: ElectronApplication): Promise<void> {
  const open = await monitorWindowPage(app);
  if (open !== null) await open.close().catch(() => {});
  await expect.poll(() => monitorWindowPage(app), { timeout: 15_000, message: 'the monitor window would not close' }).toBeNull();
}
