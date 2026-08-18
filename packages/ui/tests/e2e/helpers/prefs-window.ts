import { expect, type ElectronApplication, type Page } from '@playwright/test';

/**
 * 034 (FR-045, SC-010) — close the preferences window and do not return until it is GONE.
 *
 * The companion to `helpers/config-snapshot.ts`. A `@prefs` spec that shares one app across its file
 * must leave no preferences window standing between tests, for three separate reasons:
 *
 *   - **The config restore needs it closed.** A dirty JSON buffer raises `json-external-change` when
 *     the file changes underneath it, so restoring against an open window hands the next test a
 *     notice it never asked for.
 *   - **The on-entry snapshot is captured per OPEN.** `preferences-app.tsx` photographs the config
 *     the first time it loads, and Revert / Revert All compare against that photograph. Carrying one
 *     window across tests would carry the FIRST test's baseline into the last one.
 *   - **throng has exactly ONE preferences window.** Clicking the cog again while it is open REUSES
 *     it and fires no `window` event, so the next test's `app.waitForEvent('window')` waits out its
 *     whole budget and fails at the timeout with nothing useful to say. That is an ordering
 *     dependency rather than a defect, and it is why this is an `afterEach` and not a nicety.
 *
 * Idempotent and best-effort about HOW it closes: `page.close()` goes through the main process's
 * close gate (`wireCloseGate`), which asks the renderer for permission and fails open. The wait is
 * on the window actually being gone, not on the request being sent.
 */
export async function closePrefsWindow(app: ElectronApplication): Promise<void> {
  for (const page of app.windows()) {
    if (page.isClosed()) continue;
    // Cheap, bounded probe: the main and sub-workspace windows answer 0 immediately.
    const isPrefs = await page
      .getByTestId('preferences-window')
      .count()
      .catch(() => 0);
    if (isPrefs === 0) continue;
    await page.close().catch(() => {});
  }

  await expect
    .poll(
      async () => {
        for (const page of app.windows()) {
          if (page.isClosed()) continue;
          const still = await page
            .getByTestId('preferences-window')
            .count()
            .catch(() => 0);
          if (still > 0) return false;
        }
        return true;
      },
      { timeout: 15_000, message: 'the preferences window would not close' },
    )
    .toBe(true);
}

/**
 * Is a preferences window open right now? For a spec that wants to assert on the fact rather than
 * act on it.
 */
export async function prefsWindowPage(app: ElectronApplication): Promise<Page | null> {
  for (const page of app.windows()) {
    if (page.isClosed()) continue;
    const isPrefs = await page
      .getByTestId('preferences-window')
      .count()
      .catch(() => 0);
    if (isPrefs > 0) return page;
  }
  return null;
}
