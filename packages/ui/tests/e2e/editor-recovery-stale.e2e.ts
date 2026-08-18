import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp} from './harness.js';

// Repro: reusing an editor for a different file (edit A, discard & open B) must not
// leave A's recovery temp behind — otherwise a later restart restores A's content
// over B (the user saw editors "open CLAUDE.md" instead of the file they chose).

/**
 * The dirty-buffer recovery snapshot's persisted text for a panel, or null while it has not (yet)
 * been written (or has been dropped) — `EditorRecovery.write`/`.remove`
 * (packages/ui/src/main/editor-recovery.ts), to `<userDataDir>/recovery/<encoded panelId>`. Same
 * idiom as `editor-cross-project-restore.e2e.ts`'s `recoveredText`.
 */
function recoveredText(userDataDir: string, panelId: string): string | null {
  try {
    const raw = readFileSync(join(userDataDir, 'recovery', encodeURIComponent(panelId)), 'utf8');
    const parsed = JSON.parse(raw) as { text?: string };
    return typeof parsed.text === 'string' ? parsed.text : null;
  } catch {
    return null; // not written yet, dropped, or a transient read of a mid-write file
  }
}

/** Wait until PROJECT's layout in the daemon's SQLite store satisfies `predicate`. */
async function expectLayoutSaved(
  dataDir: string,
  projectName: string,
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
            .get(projectName) as { json?: string } | undefined;
          return row?.json !== undefined && predicate(row.json);
        } catch {
          return false; // not written yet, or a transient read of a mid-write DB
        } finally {
          db?.close();
        }
      },
      { timeout: 15_000, message: `the layout for "${projectName}" was never persisted` },
    )
    .toBe(true);
}

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

test('reusing an editor for another file clears the old file recovery temp (no stale restore)', { tag: ['@extended', '@editor'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-stale-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-stale-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-stale-ud-'));
  writeFileSync(join(root, 'CLAUDE.md'), 'CLAUDE-DOC-BODY\n');
  writeFileSync(join(root, 'target.txt'), 'TARGET-BODY-42\n');
  try {
    // Session 1: open CLAUDE.md, edit it (writes a recovery temp), then DISCARD &
    // open target.txt into the same editor. Let recovery settle, then close.
    await runApp(
      async (_app, win) => {
        await createProject(win, 'Stale', root);
        const pid = await newEditor(win);
        await win.getByTestId(`editor-${pid}`).click();
        const tree = win.getByTestId('file-explorer-tree');

        await tree.getByText('CLAUDE.md', { exact: true }).click();
        await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
          'CLAUDE-DOC-BODY',
          { timeout: 8000 },
        );
        await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
        await win.keyboard.type('EDIT');
        await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();
        await expect
          .poll(() => (recoveredText(userDataDir, pid) ?? '').includes('EDIT'), {
            timeout: 15_000,
            message: `the recovery snapshot for panel "${pid}" was never written for CLAUDE.md`,
          })
          .toBe(true);

        // Reuse the editor for target.txt via discard & open.
        await tree.getByText('target.txt', { exact: true }).click();
        await expect(win.getByTestId('unsaved-open-dialog')).toBeVisible({ timeout: 8000 });
        await win.getByTestId('unsaved-open-discard').click();
        await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
          'TARGET-BODY-42',
          { timeout: 8000 },
        );
        // The re-point's recovery-temp actually dropped (the stale CLAUDE snapshot this test is
        // named for), and the layout persisted the panel's new file — both settled before close.
        await expect
          .poll(() => recoveredText(userDataDir, pid), {
            timeout: 15_000,
            message: `the stale recovery temp for panel "${pid}" was never dropped after the re-point`,
          })
          .toBe(null);
        await expectLayoutSaved(dataDir, 'Stale', (json) => json.includes('target.txt'));
      },
      { dataDir, userDataDir },
    );

    // Session 2: restart → the editor must show target.txt, NOT the stale CLAUDE edit.
    await runApp(
      async (_app, win) => {
        const projectItem = win.locator('.project-item', { hasText: 'Stale' });
        await expect(projectItem).toBeVisible();
        await projectItem.locator('[data-testid^="project-switch-"]').click();

        const editor = win.locator('.editor-panel').first();
        await expect(editor).toBeVisible({ timeout: 10000 });
        await expect(editor.locator('.cm-content')).toContainText('TARGET-BODY-42', { timeout: 10000 });
        await expect(win.locator('.cm-content', { hasText: 'CLAUDE-DOC-BODY' })).toHaveCount(0);
      },
      { dataDir, userDataDir },
    );
  } finally {
    cleanupTemp(root);
    cleanupTemp(dataDir);
    cleanupTemp(userDataDir);
  }
});
