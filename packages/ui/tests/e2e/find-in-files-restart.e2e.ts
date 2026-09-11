/**
 * 043 T106 — a Find in Files panel and its query survive a real restart; its results do not
 * (FR-027a, FR-027b, FR-027c, FR-027d, US5 scenarios 9 and 10).
 *
 * ══ WHY THIS IS IRREDUCIBLE (constitution v5.3.0, `@reserve:runtime`) ══
 *
 * Real application-runtime identity across a restart. `find-in-files-persistence.integration.test.ts`
 * already asserts that the query survives a real `workspace_layout` row and that nothing else
 * reaches the blob — it writes the row itself. What it cannot assert is that the panel a RUNNING
 * application writes is the panel a SECOND running application restores: the debounced layout save,
 * the daemon that owns the store, the panel-type dispatch that decides what to mount, and the
 * restore order at startup are four separate mechanisms, and every one of them lives in a process
 * that has to be started and stopped for the question to mean anything.
 *
 * ══ THE HALF THAT IS AN ABSENCE ══
 *
 * FR-027b and FR-027c are claims about what does NOT come back, and an absence is exactly what a
 * restart can get wrong in a way no lower layer sees. A panel restored showing its previous matches
 * is not merely stale — with replace disclosed it is an uncommitted PREVIEW over files nobody has
 * re-read since the application was last open, and committing it would write at positions FR-054
 * forbids writing at. So the second session asserts the term IS back, the modes ARE back, the
 * replacement IS back, and there is nothing to apply any of it to.
 *
 * Scenario 10's other half — "no file was changed by the restart" — is asserted against the DISK
 * rather than against the panel, because that is where it would be wrong.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, cleanupTemp } from './harness.js';

const PROJECT = 'FifRestartProj';
const ALPHA = 'needle here\nneedle again\n';
const NESTED = 'needle in src\n';

/** A project with a sub-directory, so the SCOPE has somewhere to point that is not the root. */
function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-fif-restart-'));
  writeFileSync(join(root, 'alpha.txt'), ALPHA, 'utf8');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'nested.txt'), NESTED, 'utf8');
  return root;
}

/** Wait until the project's saved layout satisfies `predicate` — the debounced write has landed. */
async function expectLayoutSaved(
  dataDir: string,
  predicate: (layoutJson: string) => boolean,
): Promise<void> {
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
            .get(PROJECT) as { json?: string } | undefined;
          return row?.json !== undefined && predicate(row.json);
        } catch {
          return false; // not written yet, or a transient read of a mid-write database
        } finally {
          db?.close();
        }
      },
      { timeout: 20_000 },
    )
    .toBe(true);
}

/** Open a Find in Files panel through the chord, and return its panel id. */
async function openPanel(win: Page): Promise<string> {
  await win.locator('body').click();
  await win.keyboard.press('Control+Shift+F');
  const panel = win.locator('[data-testid^="fif-panel-"]');
  await expect(panel).toHaveCount(1, { timeout: 10_000 });
  return (await panel.getAttribute('data-testid'))?.replace('fif-panel-', '') ?? '';
}

test('the panel and its whole query come back, with no results and no preview', { tag: ['@extended', '@persistence', '@reserve:runtime'] }, async () => {
  const root = makeProject();
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-fif-restart-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-fif-restart-user-'));
  try {
    /* ── Session 1: a fully specified query, with results and a preview standing over them ───── */
    await runApp(
      async (_app, win) => {
        await createProject(win, PROJECT, root);
        const panelId = await openPanel(win);

        await win.getByTestId(`fif-term-${panelId}`).fill('needle');
        await win.getByTestId(`fif-match-case-${panelId}`).click();
        await win.getByTestId(`fif-whole-word-${panelId}`).click();
        await win.getByTestId(`fif-scope-${panelId}`).fill('src');
        await win.getByTestId(`fif-toggle-replace-${panelId}`).click();
        await win.getByTestId(`fif-replacement-${panelId}`).fill('pin');

        // Run it, so there ARE results and an uncommitted preview to fail to survive. Without this
        // the second session's "no results" assertion is satisfied by there never having been any.
        await win.getByTestId(`fif-term-${panelId}`).press('Enter');
        await expect(win.getByTestId(`fif-status-${panelId}`)).toHaveAttribute(
          'data-state',
          'complete',
          { timeout: 20_000 },
        );
        await expect(win.getByTestId(`fif-total-${panelId}`)).toHaveText('1');
        await expect(win.getByTestId('fif-replacement')).toHaveCount(1);

        // The layout save is debounced; session 2 restores what reached the store, not what was on
        // screen when the window closed.
        await expectLayoutSaved(dataDir, (json) => json.includes('"replacement":"pin"'));
      },
      { dataDir, userDataDir },
    );

    /* ── Session 2, same store: the query is back and nothing else is ─────────────────────────── */
    await runApp(
      async (_app, win) => {
        const projectItem = win.locator('.project-item', { hasText: PROJECT });
        await expect(projectItem).toBeVisible();
        await projectItem.locator('[data-testid^="project-switch-"]').click();

        const panel = win.locator('[data-testid^="fif-panel-"]');
        await expect(panel).toHaveCount(1, { timeout: 20_000 });
        const panelId = (await panel.getAttribute('data-testid'))?.replace('fif-panel-', '') ?? '';

        // FR-027b — every part of the query. The match modes in particular: a case-sensitive
        // whole-word search restored as case-insensitive substring is a different question wearing
        // the same word.
        await expect(win.getByTestId(`fif-term-${panelId}`)).toHaveValue('needle');
        await expect(win.getByTestId(`fif-match-case-${panelId}`)).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        await expect(win.getByTestId(`fif-whole-word-${panelId}`)).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        await expect(win.getByTestId(`fif-scope-${panelId}`)).toHaveValue('src');
        await expect(win.getByTestId(`fif-replace-row-${panelId}`)).toBeVisible();
        await expect(win.getByTestId(`fif-replacement-${panelId}`)).toHaveValue('pin');

        // FR-027b / FR-027c — ready to re-run, showing nothing. "Not run" rather than "no matches":
        // FR-042 keeps those two apart precisely so a restored panel cannot claim it looked.
        await expect(win.getByTestId(`fif-status-${panelId}`)).toHaveAttribute(
          'data-state',
          'notRun',
        );
        await expect(win.getByTestId(`fif-results-${panelId}`).locator('.fif-row')).toHaveCount(0);
        await expect(win.getByTestId('fif-replacement')).toHaveCount(0);

        // And it still works: the restored query runs and finds what it described, which is what
        // "reopens ready to re-run" claims.
        await win.getByTestId(`fif-term-${panelId}`).press('Enter');
        await expect(win.getByTestId(`fif-status-${panelId}`)).toHaveAttribute(
          'data-state',
          'complete',
          { timeout: 20_000 },
        );
        await expect(win.getByTestId(`fif-total-${panelId}`)).toHaveText('1');
      },
      { dataDir, userDataDir },
    );

    // Scenario 10's other half, asserted where it would be wrong: on the disk. A preview that
    // survived and committed itself would show up here and nowhere else.
    expect(readFileSync(join(root, 'src', 'nested.txt'), 'utf8')).toBe(NESTED);
    expect(readFileSync(join(root, 'alpha.txt'), 'utf8')).toBe(ALPHA);
  } finally {
    cleanupTemp(dataDir);
    cleanupTemp(userDataDir);
    cleanupTemp(root);
  }
});
