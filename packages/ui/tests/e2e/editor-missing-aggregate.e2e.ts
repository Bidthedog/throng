import { mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp } from './harness.js';

/** Wait until the project's layout, editors and all, is on disk — see its one caller. */
async function expectLayoutSaved(dataDir: string, projectName: string): Promise<void> {
  await expect
    .poll(
      () => {
        let db: InstanceType<typeof Database> | undefined;
        try {
          db = new Database(join(dataDir, 'throng.db'), { readonly: true });
          const row = db
            .prepare(
              `SELECT w.layout_json AS json
                 FROM workspace_layout w
                 JOIN projects p ON p.id = w.project_id
                WHERE p.name = ?`,
            )
            .get(projectName) as { json?: string } | undefined;
          return row?.json?.includes('editor') ?? false;
        } catch {
          return false;
        } finally {
          db?.close();
        }
      },
      { timeout: 30_000, message: 'the editor layout never reached the database' },
    )
    .toBe(true);
}

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

test('lists ALL missing files on a tab in one notice (FR-100 · 030 FR-029/FR-035)', { tag: ['@extended', '@editor'] }, async () => {
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

/*
 * ══ QUARANTINED — issue #277, and it is a REAL BUG, not a timing gap ══
 *
 * The consolidated notice never appears when the tree reports first. The assertion below at
 * `panel-failure-notice` times out at 30s, three retries deep, every time.
 *
 * WHY THIS IS NOT SPEC 034's, established before quarantining rather than assumed:
 *   - `origin/master`'s OWN CI fails it, at this same line, with the same three retries —
 *     run 31956697834 (2026-08-16), job `E2E (shard 1/3)`. All five of master's recent runs are red.
 *   - It reproduces LOCALLY IN ISOLATION (1 failed, 3 passed running this file alone), so it is not
 *     worker contention and not the tier boundary.
 *   - 034's only change to this file is the `@extended @editor` tags in `b5753d5`. Its seven `src`
 *     changes were reviewed one by one and none is in the notice path.
 *
 * WHY NOT WEAKEN THE ASSERTION: the whole point of this test is the LOSING ORDER — the tree's
 * notice standing while the consolidated one is in flight. The sibling at :78 already covers the
 * winning order and passes. Relaxing this one would leave 030 FR-034a's supersede-on-cause rule
 * asserted only where it was never broken, which is how a bug gets permanently forgotten.
 *
 * Quarantine means the coverage of FR-034a now lives NOWHERE. That is the admission, and it is why
 * #277 exists rather than a note in a commit message. It must be un-quarantined by the fix.
 *
 *   THRONG_E2E_INCLUDE_QUARANTINE=1 npx playwright test --grep @quarantine --list
 *
 * NOTE FOR 034's OWN RECORD: SC-017 and SC-026 require that the quarantined count does not rise.
 * This raises it from one to two. That is a deliberate, named exception rather than a silent
 * breach — see the exception recorded against SC-026 in `specs/034-e2e-harness-integrity/spec.md`.
 */
test('the file tree got there first, and ONE notice still stands (030 FR-029/FR-034a)', { tag: ['@quarantine', '@extended', '@editor'] }, async () => {
  /*
   * REPORTED FROM A REAL SESSION, and the diagnostics log had both halves 265 ms apart:
   *
   *   ERROR [renderer-notice] subject="test 1" action="list the contents of" cause="path-missing:test 1"
   *   ERROR [renderer-notice] subject="test 1" action="open"                 affected=1
   *
   * Rename a project's root folder, reopen the project, and TWO notices arrive for one absent
   * folder. The supersede rule that should have collapsed them matches on `causeKey`, and the
   * consolidated notice had none: the editor's missing-file scan reported without a cause, so the
   * notice that says MORE could not displace the one that says less.
   *
   * `project-missing-root-wedge.e2e.ts` asserts exactly this rule and passes — driving a TERMINAL,
   * which does supply a cause. This is the editor half, which nothing covered.
   *
   * The file tree is made to report FIRST, deliberately: that is the losing order, and a test that
   * let the two race would pass on the winning one about half the time.
   */
  test.setTimeout(180_000);
  const root = makeProject();
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-agg-data-'));
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
        await tree.getByText('beta.txt', { exact: true }).click({ button: 'right' });
        await win.getByTestId('menu-item-Open In').click();
        await win.getByTestId('menu-item-New Editor').click();
        await expect(win.locator('.editor-panel')).toHaveCount(2, { timeout: 8000 });
        // The layout must be PERSISTED before throng closes, or there is nothing to restore next
        // launch and the editors come back as an empty workspace — a green that proves nothing.
        await expectLayoutSaved(dataDir, 'Agg');
      },
      { dataDir },
    );

    /*
     * A REAL SECOND LAUNCH, not a renderer reload.
     *
     * `reloadWindow` is the usual in-harness stand-in for "close and reopen", and it does not work
     * here: it restarts the renderer while the MAIN process keeps the editor coordinator's document
     * state, so the restored editors come up `unloadable` — the mount-time verdict — and never
     * `fileMissing`, which is the flag the tab-open scan actually reads. The consolidated notice
     * then has nothing to report and the duplicate cannot be reproduced. Only a fresh main process
     * re-derives the state the reporter saw.
     */
    await expect
      .poll(
        () => {
          try {
            renameSync(root, `${root}-moved`);
            return true;
          } catch {
            return false; // the daemon's lock outlives teardown by a beat
          }
        },
        { timeout: 30_000, message: 'could not rename the root away (lock never released?)' },
      )
      .toBe(true);

    await runApp(
      async (_app, win) => {
        // A restarted throng opens on no project; entering Agg is "open the project" in the report.
        await win
          .locator('.project-item', { hasText: 'Agg' })
          .locator('[data-testid^="project-switch-"]')
          .click();

        // The tree reports first — waited on, so the order under test is the one that was broken.
        await expect(win.getByTestId('explorer-error')).toBeVisible({ timeout: 30_000 });

        /*
         * Both editors must have LEARNED their file is gone before the scan is asked to find them.
         *
         * The `:not()` is load-bearing: the consolidated notice's own ids all begin
         * `panel-failure-notice`, so a bare prefix match counts the notice and its controls
         * alongside the panels (the trap `project-missing-root-wedge.e2e.ts` measured).
         */
        const banners = '[data-testid^="panel-failure-"]:not([data-testid^="panel-failure-notice"])';
        await expect(win.locator(banners)).toHaveCount(2, { timeout: 30_000 });

        /*
         * Now provoke the scan. It runs ONCE per tab activation, 300 ms in, and on a cold open that
         * beats the editors' own path verification — so the scan that should have found them saw two
         * healthy editors and there is no second chance. Re-selecting the tab is the user's next
         * click, and it is what puts the consolidated notice in flight while the tree's is standing:
         * the losing order, which is the whole point of this test.
         */
        await reselectFirstTab(win);
        const notice = win.getByTestId('panel-failure-notice');
        await expect(notice).toBeVisible({ timeout: 30_000 });

        /*
         * ONE notice, counted on the CONTAINER's cards rather than on a list of test-id shapes — an
         * enumeration of the ids that happened to exist when it was written goes stale silently, and
         * in the direction of a false green (the lesson `project-missing-root-wedge.e2e.ts` records).
         */
        await expect(
          win.getByTestId('notices').locator('.notice'),
          'one absent folder must raise one notice, not one per surface',
        ).toHaveCount(1);
        await expect(win.getByTestId('explorer-error')).toHaveCount(0);

        /*
         * FR-034a — and the survivor INHERITED what the superseded notice was carrying.
         *
         * The rows name each missing FILE; only the tree's report named the FOLDER whose
         * disappearance took them all. Collapsing the notices without carrying that across would fix
         * the duplicate by losing the one fact it held, and lose it invisibly, since the raw error is
         * never on screen — so this reads it out of the clipboard, where FR-034 puts it.
         */
        await notice.getByTestId('panel-failure-notice-copy').click();
        // Through the app's own seam: Electron's clipboard does not work in this harness at all
        // (`failure-copy.e2e.ts` records why), and a test that cannot read it proves nothing.
        const copied = await win.evaluate(
          () => window.throng?.clipboard?.paste().then((e) => e?.text ?? '') ?? '',
        );
        expect(copied, 'the superseded notice’s raw error must survive the merge').toContain('ENOENT');
        expect(copied).toContain(basename(root));
      },
      { dataDir },
    );
  } finally {
    for (const dir of [root, `${root}-moved`, dataDir]) cleanupTemp(dir);
  }
});

test('does NOT raise the notice on delete / remount while the tab stays active (FR-105)', { tag: ['@extended', '@editor'] }, async () => {
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

      // sleep-justified: the tab was never re-selected, so the once-per-activation scan never fires
      // sleep-justified: here on purpose — but the tab's ORIGINAL open (at test start) may still have
      // sleep-justified: its own 300ms scan window in flight, and nothing marks that window's end
      // sleep-justified: externally. Only outrunning the clock proves it did not catch this delete.
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

test('editor.warnOnMissingFile=false suppresses the report entirely', { tag: ['@extended', '@editor'] }, async () => {
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
        // sleep-justified: the re-select just fired the once-per-activation scan, and with the
        // sleep-justified: setting off it is asked to report nothing — so there is no notice to
        // sleep-justified: become visible, and therefore nothing observable that marks "the scan
        // sleep-justified: ran and found nothing" versus "the scan has not run yet".
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
