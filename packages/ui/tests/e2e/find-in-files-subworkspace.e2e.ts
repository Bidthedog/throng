/**
 * 043 T105 — a Find in Files panel synced into a sub-workspace (FR-025, FR-025b, FR-026, FR-027,
 * US5 scenarios 7 and 8).
 *
 * ══ WHY THIS IS IRREDUCIBLE (constitution v5.3.0, `@reserve:window`) ══
 *
 * Real multi-window lifecycle. Every claim here is about TWO Electron windows and the relationship
 * between them: a second `BrowserWindow` created by a sync, a panel that exists in both under one
 * shared id, a destroy in the first that has to reach the second, and a close of the second that
 * must not reach the first. There is no window to open below this layer — `subworkspace-sync.test.ts`
 * can assert what the store does when a message arrives, and cannot make a window arrive.
 *
 * ══ SCENARIO 6, AND WHAT IT COST TO GET HERE (043 T132, FR-078, #380) ══
 *
 * US5 scenario 6 says a synced view shows the parent's RESULTS and follows them as they change. It
 * shipped unmet, and this header used to say so: `FileSearchService` delivered every update to
 * exactly ONE `webContents`, deliberately, for FR-018 — so a second window holding the same panel
 * received nothing and showed an empty list, indistinguishable from a search that found nothing. The
 * user retyped a search that was already correct.
 *
 * The gap was that "one panel, two windows" was never distinguished from "two panels". R23 makes the
 * run's key the `panelId` and moves the window identity into a set of VIEWERS: every update goes to
 * every window displaying the panel and to no other, still without a broadcast, and a window that
 * attaches after the scan finished is sent one snapshot of what the run retained (FR-078a). The
 * second test below is that requirement, and it is the only part of it that needs two real windows —
 * the run's lifetime under several viewers is
 * `packages/ui/tests/integration/file-search-viewers.integration.test.ts`, and the snapshot/delta
 * fold is `packages/ui/tests/component/find-in-files-snapshot.test.ts`.
 *
 * What was already asserted about syncing is FR-025b — a find session travels with its panel —
 * which rides `Panel.config` (T104, research R11) rather than the scan channel, and is what the
 * child's QUERY coming back with it proves.
 *
 * ══ WHY THE THREE CLAIMS ARE ONE TEST ══
 *
 * They are one lifecycle, and the interesting failures are transitions rather than states: a close
 * of the view that takes the parent with it, a destroy of the parent that leaves an orphan window
 * showing a panel nothing owns. Asserted as three tests they would each need the sync built again —
 * three Electron windows to assert what one sequence asserts in order.
 *
 * ══ WHY THE SECOND SYNC ══
 *
 * FR-027 (closing the view leaves the parent alone) and FR-026 (destroying the parent closes the
 * view) cannot be asserted against the same child window: the first consumes it. The second sync is
 * the setup for the second claim, and it is worth something on its own — it proves a panel whose
 * view has been closed is still syncable, which is what "the parent Tab owns the panel outright"
 * means in practice.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { openApp, createProject, cleanupTemp, NEW_WINDOW_TIMEOUT_MS, type OpenApp } from './harness.js';

test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
let root = '';

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'throng-fif-sub-'));
  writeFileSync(join(root, 'alpha.txt'), 'needle here\nneedle again\n', 'utf8');
  writeFileSync(join(root, 'beta.txt'), 'haystack only\n', 'utf8');

  shared = await openApp();
  await createProject(shared.win, 'FifSubProj', root);
});

test.afterAll(async () => {
  await shared?.close();
  if (root) cleanupTemp(root);
});

/** Open a Find in Files panel through the chord, and return its panel id. */
async function openPanel(win: Page): Promise<string> {
  await win.locator('body').click();
  await win.keyboard.press('Control+Shift+F');
  const panel = win.locator('[data-testid^="fif-panel-"]');
  await expect(panel).toHaveCount(1, { timeout: 10_000 });
  return (await panel.getAttribute('data-testid'))?.replace('fif-panel-', '') ?? '';
}

/** Type a term and run it, waiting for the scan to finish. */
async function search(win: Page, panelId: string, term: string, matches: number): Promise<void> {
  const input = win.getByTestId(`fif-term-${panelId}`);
  await input.fill(term);
  await input.press('Enter');
  await expect(win.getByTestId(`fif-status-${panelId}`)).toHaveAttribute('data-state', 'complete', {
    timeout: 20_000,
  });
  await expect(win.getByTestId(`fif-total-${panelId}`)).toHaveText(String(matches));
}

/**
 * Close a child window, tolerating one the application closed underneath us.
 *
 * The second half of this test destroys a panel whose sub-workspace then closes itself (FR-026b),
 * so by the time the `finally` runs the window may be mid-close. A throw there would fail the test
 * during CLEANUP, blaming the assertion that had already passed.
 */
async function closeIfOpen(page: Page): Promise<void> {
  if (page.isClosed()) return;
  try {
    await page.close();
  } catch {
    /* already gone — which is the state this wanted */
  }
}

/** Sync `panelId` into a NEW sub-workspace, returning the window it opened. */
async function syncToNewSubWorkspace(win: Page, panelId: string): Promise<Page> {
  await win.getByTestId(`panel-handle-${panelId}`).click({ button: 'right' });
  await win.getByTestId('menu-item-Sync to').click();
  const [child] = await Promise.all([
    shared.app.waitForEvent('window', { timeout: NEW_WINDOW_TIMEOUT_MS }),
    win.getByTestId('menu-item-New Sub-workspace').click(),
  ]);
  await child.waitForLoadState('domcontentloaded');
  return child;
}

test('a synced Find in Files panel carries its query, survives its view closing, and dies with the parent', { tag: ['@extended', '@explorer', '@reserve:window'] }, async () => {
  const win = shared.win;
  const panelId = await openPanel(win);
  await search(win, panelId, 'needle', 2);

  /* ── FR-025 / FR-025b — the view exists in the second window, holding the same query ───────── */
  let child = await syncToNewSubWorkspace(win, panelId);
  try {
    await expect(child.getByTestId(`fif-panel-${panelId}`)).toBeVisible({ timeout: 20_000 });
    // The find session travelled with the panel (FR-025b): same id, same term, in a window that was
    // not running when the term was typed. The RESULTS are the next test's claim (FR-078).
    await expect(child.getByTestId(`fif-term-${panelId}`)).toHaveValue('needle', { timeout: 20_000 });
  } finally {
    await closeIfOpen(child);
  }

  /* ── FR-027 / scenario 8 — closing the VIEW leaves the parent entirely alone ───────────────── */
  await expect(win.getByTestId(`fif-panel-${panelId}`)).toBeVisible();
  await expect(win.getByTestId(`fif-term-${panelId}`)).toHaveValue('needle');
  // Its results too: the parent's search is not disturbed by a window it was never in.
  await expect(win.getByTestId(`fif-total-${panelId}`)).toHaveText('2');

  /* ── FR-026 / scenario 7 — destroying the PARENT closes the sub-workspace view ─────────────── */
  child = await syncToNewSubWorkspace(win, panelId);
  try {
    await expect(child.getByTestId(`fif-panel-${panelId}`)).toBeVisible({ timeout: 20_000 });

    await win.getByTestId(`panel-close-${panelId}`).click();
    /*
     * Destroying a MIRRORED panel is announced before it happens, and the announcement is FR-026
     * said to the user: the cascade is one-directional and irreversible, so the warning names the
     * sub-workspaces the panel will vanish from. Asserted rather than clicked past — a destroy that
     * stopped warning would still pass everything below it.
     */
    await expect(win.getByTestId('confirm-warning')).toContainText(/sub-workspace/i);
    await win.getByTestId('confirm-accept').click();
    await expect(win.locator('[data-testid^="fif-panel-"]')).toHaveCount(0);

    /*
     * The view goes with it — either because the window closed (FR-026b: a sub-workspace left empty
     * is closed) or because the panel was taken out of a window still holding something else. Both
     * are the requirement being met, and which happens depends on what else the sub-workspace was
     * carrying, so the assertion is on the PANEL rather than on the window.
     *
     * ══ WHY THE `catch`, WHICH IS NOT DEFENSIVENESS ══
     *
     * `isClosed()` followed by a query is check-then-act across a process boundary, and the window
     * is being closed by the very destroy under test. Measured: this read as `child.isClosed() ?
     * 0 : await …count()` and failed three times out of three at `--repeat-each=3` with
     * "Target page, context or browser has been closed" — while passing on a single run, which is
     * the shape a flake takes when it is a race in the TEST. A page that closes between the check
     * and the query is the strongest possible evidence that the view went away, so it answers the
     * question rather than interrupting it.
     */
    const viewGone = async (): Promise<boolean> => {
      if (child.isClosed()) return true;
      try {
        return (await child.getByTestId(`fif-panel-${panelId}`).count()) === 0;
      } catch {
        return true;
      }
    };
    await expect.poll(viewGone, { timeout: 20_000 }).toBe(true);
  } finally {
    await closeIfOpen(child);
  }
});

test('a synced Find in Files panel shows the parent’s results and follows them', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  /*
   * ── US5 scenario 6, FR-078, #380 ───────────────────────────────────────────────────────────────
   *
   * Two real windows is the whole of why this is here. A panel synced into a sub-workspace is the
   * SAME panel in a second `BrowserWindow` with its own renderer process, its own store and its own
   * subscription to the scan channel — and the defect was precisely that nothing crossed between
   * them. Below this layer there is no second window to hold the second copy: the component test
   * pins what a panel does with a snapshot when one arrives, and the integration test pins that main
   * sends one to every viewer, but neither can make a second renderer exist and then ask what it is
   * showing.
   *
   * Both halves are asserted, because they fail differently. The FIRST is the retention half
   * (FR-078a) — the scan is over before the sync happens, so anything the child shows must have been
   * kept rather than streamed. The SECOND is the live half — a re-run in the parent has to reach a
   * window that never asked for it.
   */
  const win = shared.win;
  const panelId = await openPanel(win);
  await search(win, panelId, 'needle', 2);

  const child = await syncToNewSubWorkspace(win, panelId);
  try {
    await expect(child.getByTestId(`fif-panel-${panelId}`)).toBeVisible({ timeout: 20_000 });

    /* ── The scan had already FINISHED when the window arrived (FR-078a) ─────────────────────── */
    await expect(child.getByTestId(`fif-status-${panelId}`)).toHaveAttribute('data-state', 'complete', {
      timeout: 20_000,
    });
    await expect(child.getByTestId(`fif-total-${panelId}`)).toHaveText('2', { timeout: 20_000 });
    // The rows themselves, not just the count: an empty list under a total of 2 is the failure this
    // is about, dressed differently.
    await expect(child.locator('.fif-row')).toHaveCount(2, { timeout: 20_000 });

    /* ── And it FOLLOWS the parent's next search (FR-078's second clause) ────────────────────── */
    await search(win, panelId, 'haystack', 1);
    await expect(child.getByTestId(`fif-total-${panelId}`)).toHaveText('1', { timeout: 20_000 });
    await expect(child.locator('.fif-row')).toHaveCount(1, { timeout: 20_000 });
  } finally {
    await closeIfOpen(child);
  }
});
