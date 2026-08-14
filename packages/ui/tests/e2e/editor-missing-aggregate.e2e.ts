import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp} from './harness.js';

/*
 * Session 2026-07-06f: the "cannot open file" report lists ALL missing files discovered when a tab
 * is (re-)opened, fires only on tab open/re-select — never on a panel drag/remount (FR-105) — and
 * can be disabled via `editor.warnOnMissingFile`.
 *
 * ══ REPOINTED BY 030 US3 / T052 ══
 *
 * Two of the three facts above are untouched: the SCAN still happens once per tab activation, and
 * `warnOnMissingFile` still turns it off. What changed is the third — WHERE the result is reported.
 *
 * 006's answer was one modal dialog per tab, and this file asserted it structurally
 * (`editor-notice-dialog`, `editor-notice-files`, two `.editor-notice__file` rows) rather than by
 * its literal "Cannot open 2 files" string. FR-035 removes per-tab batching OUTRIGHT, because the
 * tab is not the unit a user thinks in: one absent project root defeats editors in four tabs and
 * terminals in two, and a per-tab dialog reports that four times while mentioning no terminal at
 * all. The casualties are now rows of ONE consolidated notice per cause per project, grouped by tab
 * — the tab survives as a heading inside the list rather than as a boundary between notices.
 *
 * So the structure each test asserts moves from the dialog to the notice, one for one. The FR-105
 * and `warnOnMissingFile` tests keep their subject exactly; only their locator changes.
 */

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-agg-'));
  writeFileSync(join(root, 'alpha.txt'), 'AAA\n');
  writeFileSync(join(root, 'beta.txt'), 'BBB\n');
  return root;
}

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

async function reselectFirstTab(win: Page): Promise<void> {
  await win.getByTestId('tab-add').click(); // new active tab
  await win.locator('.tab-chip').first().click(); // back to the editors' tab
}

test('lists ALL missing files on a tab in one notice (FR-100 · 030 FR-029/FR-035)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Agg', root);
      const pid = await newEditor(win);
      await win.getByTestId(`editor-${pid}`).click();
      const tree = win.getByTestId('file-explorer-tree');

      // Editor 1 ← alpha.txt (single click); Editor 2 ← beta.txt (Open In → New Editor).
      await tree.getByText('alpha.txt', { exact: true }).click();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('AAA', {
        timeout: 8000,
      });
      await tree.getByText('beta.txt', { exact: true }).click({ button: 'right' });
      await win.getByTestId('menu-item-Open In').click();
      await win.getByTestId('menu-item-New Editor').click();
      await expect(win.locator('.editor-panel')).toHaveCount(2, { timeout: 8000 });

      // Delete BOTH files.
      await tree.getByText('alpha.txt', { exact: true }).click();
      await tree.getByText('beta.txt', { exact: true }).click({ modifiers: ['Control'] });
      await tree.getByText('beta.txt', { exact: true }).click({ button: 'right', modifiers: ['Control'] });
      await win.getByTestId('menu-item-Delete').click();
      await win.getByTestId('confirm-accept').click();
      const wry = win.getByTestId('confirm-accept');
      if (await wry.isVisible().catch(() => false)) await wry.click();

      /*
       * BOTH editors must have LEARNED their file is gone before the tab is re-selected.
       *
       * The delete is asynchronous — it goes out to the shell's recycle bin and comes back through
       * the watcher — while the scan this test is about runs exactly once, on tab activation, and
       * reads `fileMissing` as it finds it (FR-105 is what makes it one-shot). Re-selecting the tab
       * on the tick after `confirm-accept` therefore raced the deletion: measured, the files were
       * still on disk at that point, so the scan saw two healthy editors and reported nothing, and
       * the banners appeared a beat later with no scan left to run. Under load it landed halfway —
       * one editor known-missing, one not — which is the "1 row where 2 were expected" this file
       * reported before the wait existed.
       *
       * `panel-unsaved-*` is the same signal the two tests below already wait on: the editor is
       * dirty precisely because the file went away under it, and `markDeleted` sets that in the same
       * pass as `fileMissing`, which is what the scan reads.
       */
      await expect(win.locator('[data-testid^="panel-unsaved-"]')).toHaveCount(2, {
        timeout: 15_000,
      });

      // Re-select the tab → ONE notice, listing both defeated panels.
      await reselectFirstTab(win);
      const notice = win.getByTestId('panel-failure-notice');
      await expect(notice).toBeVisible({ timeout: 15_000 });
      await expect(notice, 'two missing files raised two notices').toHaveCount(1);

      // Both panels listed, each as its own row, under the heading for the tab they share.
      const rows = notice.getByTestId('notice-affected-row');
      await expect(rows).toHaveCount(2);
      await expect(notice.getByTestId('notice-affected-tab')).toHaveCount(1);

      /*
       * The rows name the PANELS, not the files — and that is the change, not an omission.
       *
       * The old dialog listed paths, split into a dim directory and a bold name. FR-034 forbids a
       * notice from rendering the raw system error and 030 keeps absolute paths out with it; the
       * unit the notice speaks in is the panel, whose banner shows its own path in place (FR-040a).
       * Each file's path still reaches the user, through Copy and the log (FR-048a).
       */
      const rowText = (await rows.allInnerTexts()).join('\n');
      expect(rowText).not.toMatch(/[A-Za-z]:\\/);
      // The old dialog is gone from this path entirely, not merely unused (FR-035).
      await expect(win.getByTestId('editor-notice-dialog')).toHaveCount(0);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('does NOT raise the notice on delete / remount while the tab stays active (FR-105)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Agg', root);
      const pid = await newEditor(win);
      await win.getByTestId(`editor-${pid}`).click();
      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('alpha.txt', { exact: true }).click();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('AAA', {
        timeout: 8000,
      });

      // Delete the open file → the editor goes dirty, but NO popup (tab unchanged).
      await tree.getByText('alpha.txt', { exact: true }).click({ button: 'right' });
      await win.getByTestId('menu-item-Delete').click();
      await win.getByTestId('confirm-accept').click();
      const wry = win.getByTestId('confirm-accept');
      if (await wry.isVisible().catch(() => false)) await wry.click();
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible({ timeout: 8000 });

      // Give the tab-open watcher's window (300ms) time to pass — still no notice,
      // because the active tab never changed (this is what a panel drag also does).
      await win.waitForTimeout(700);
      await expect(win.getByTestId('panel-failure-notice')).toHaveCount(0);

      // Only a tab re-selection surfaces it.
      await reselectFirstTab(win);
      await expect(win.getByTestId('panel-failure-notice')).toBeVisible({ timeout: 15_000 });
    });
  } finally {
    cleanupTemp(root);
  }
});

test('editor.warnOnMissingFile=false suppresses the report entirely', async () => {
  const root = makeProject();
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-agg-cfg-'));
  writeFileSync(
    join(cfgRoot, 'settings.json'),
    JSON.stringify({ version: 1, editor: { warnOnMissingFile: false } }),
  );
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'Agg', root);
        const pid = await newEditor(win);
        await win.getByTestId(`editor-${pid}`).click();
        const tree = win.getByTestId('file-explorer-tree');
        await tree.getByText('alpha.txt', { exact: true }).click();
        await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('AAA', {
          timeout: 8000,
        });

        await tree.getByText('alpha.txt', { exact: true }).click({ button: 'right' });
        await win.getByTestId('menu-item-Delete').click();
        await win.getByTestId('confirm-accept').click();
        const wry = win.getByTestId('confirm-accept');
        if (await wry.isVisible().catch(() => false)) await wry.click();
        await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible({ timeout: 8000 });

        // Re-select the tab — with the setting off, NO notice appears.
        await reselectFirstTab(win);
        await win.waitForTimeout(700);
        await expect(win.getByTestId('panel-failure-notice')).toHaveCount(0);
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    cleanupTemp(root);
    cleanupTemp(cfgRoot);
  }
});
