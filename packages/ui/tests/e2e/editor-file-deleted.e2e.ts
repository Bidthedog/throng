import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp } from './harness.js';

/**
 * Clear whichever notice a restore may have raised about the file that is not there.
 *
 * Both are checked because both are real: `editor-notice-ok` is the editor notice store's dialog
 * (still very much alive — the file-changed and refused-save notices route through it), and
 * `panel-failure-notice-dismiss` is the consolidated notice 030 US3 introduced, which is what the
 * missing-file path raises now (FR-035).
 */
/**
 * The dirty-buffer recovery snapshot's persisted text for a panel, or null while it has not (yet)
 * been written — `EditorRecovery.write` (packages/ui/src/main/editor-recovery.ts), on a 400ms
 * debounce, to `<userDataDir>/recovery/<encoded panelId>`. Same idiom as
 * `editor-cross-project-restore.e2e.ts`'s `recoveredText`.
 */
function recoveredText(userDataDir: string, panelId: string): string | null {
  try {
    const raw = readFileSync(join(userDataDir, 'recovery', encodeURIComponent(panelId)), 'utf8');
    const parsed = JSON.parse(raw) as { text?: string };
    return typeof parsed.text === 'string' ? parsed.text : null;
  } catch {
    return null; // not written yet, or a transient read of a mid-write file
  }
}

async function dismissNoticeIfPresent(win: Page): Promise<void> {
  for (const testId of ['editor-notice-ok', 'panel-failure-notice-dismiss']) {
    const control = win.getByTestId(testId);
    if (await control.isVisible().catch(() => false)) await control.click();
  }
}

// Session 2026-07-06d: "Last Active Editor (<Panel>)" label (FR-098); deleting a file
// open in an editor marks it dirty + save re-creates it (FR-099); the "Cannot open
// file" dialog carries file/panel detail and re-appears on tab selection (FR-100).

/*
 * MOVED to `packages/ui/tests/component/explorer-open-in-target.test.ts` (034 FR-045) — one test,
 * one Electron launch, one daemon and one real temp project spent on reading ONE STRING off a menu
 * item. That string is `file-tree.tsx:399`:
 *
 *     label: targetPanel ? `Last Active Editor (${targetPanel.title})` : 'Last Active Editor'
 *
 * composed from the workspace store’s layout and the `last-active-editor` module store. Not a
 * filesystem fact, not a watcher fact, not a rendering fact — so none of the apparatus that carried
 * it was buying anything.
 *
 * THE REPLACEMENT IS STRICTLY STRONGER, and this is the part worth reading. The E2E’s tab held ONE
 * panel, so "Last Active Editor (Scratch)" would have been drawn identically by an implementation
 * that named the tab’s ACTIVE panel, or its FIRST panel, or the only panel it could find. Three
 * component tests close that:
 *   - the migrated claim itself, verbatim;
 *   - the FALLBACK — nothing registered for the tab draws the bare `Last Active Editor`, which
 *     proves the parenthetical is composed and not a constant;
 *   - the DISAMBIGUATION — two panels in one tab with `activePanelId` deliberately pointing at the
 *     panel the store does NOT name, so "use the tab’s active panel" now reddens.
 * Mutation M2 in `red-editor-recovery.mjs` makes exactly that substitution and reddens exactly the
 * third test. The E2E could not have failed on it.
 *
 * ANTI-VACUITY CONTROL: withhold the `ResizeObserver` stub and all THREE component tests fail at
 * "Unable to find role=tree" — `FileTree` gates `<Tree>` behind `useSize` and jsdom implements no
 * `ResizeObserver` at all, so nothing here can pass on an empty DOM.
 *
 * WHAT DID NOT MOVE, AND WHY THIS FILE STILL HAS TWO TESTS AND THREE LAUNCHES:
 *
 *   - the deletion test needs a REAL filesystem watcher delivering a real unlink into a live
 *     renderer. Its MODEL half is already proved without an app —
 *     `editor-file-deleted.integration.test.ts:56` (dirty + fileMissing + mirrored) and `:77` (a
 *     save re-creates the file and clears file-missing) — but the rendered unsaved dot and the
 *     consolidated notice on tab remount exist only through that chain.
 *   - the FR-102 restart test needs a real abnormal exit and a real relaunch. Integration proves
 *     the snapshot round-trip (`editor-file-deleted.integration.test.ts:98`,
 *     `editor-recovery.integration.test.ts:56`); nothing below E2E proves the reopened PANEL shows
 *     the recovered text.
 *
 * NO SHARED APP HERE. The two survivors cannot share one: the restart test seeds `dataDir` and
 * `userDataDir` across two sessions, which is genuine pre-launch state, and the deletion test
 * leaves a filesystem watcher and an editor panel open over a path it then deletes — the exact
 * shape that made the `editor-basics` / `destroy-cascade` / `workspace-docking` conversions flake
 * and be reverted in dcdcb46.
 */

/*
 * ── ONE REMOVED (035 T056), AND A WHOLE FILE WITH IT ──
 *
 * `:102` "deleting an open file marks the editor dirty; save re-creates it; re-select shows the
 * error", and the entirety of `notice-stacking.e2e.ts` (one declaration, now deleted).
 *
 * ── EVERY PART OF `:102` WAS COVERED EXCEPT THE JOIN ──
 *
 *   the delete reaches the filesystem over a mixed selection
 *     → `integration/files-delete-mixed.integration.test.ts:39-57`
 *   Delete is addressed to the SELECTION, not the clicked row
 *     → `unit/explorer-subtree-menu.test.ts`
 *   an editor whose file has gone is force-dirtied, keeps its buffer, and a save re-creates it
 *     → `integration/editor-file-deleted.integration.test.ts:56-98`, five cases
 *
 * The join is `main.ts:1273` — `filesService.setOnDeleted(paths => editorCoordinator.markDeleted(paths))`
 * — and `setOnDeleted` had no test at any layer. Without the announcement every one of those five
 * coordinator cases is unreachable in the running application: the file goes and the editor holding
 * it never hears, so it keeps presenting remembered text as the file and a save writes it back to a
 * path the user deliberately emptied. It is now four cases in `files-delete-mixed.integration`,
 * including the one the E2E could not make — a delete where PART of the selection was already gone
 * must announce what actually went, not what was asked for.
 *
 * ── AND `notice-stacking.e2e.ts:101` WAS A STRICT DUPLICATE ──
 *
 * Three claims, all of them `unit/notice-suppression.test.ts`:
 *
 *   two DIFFERENT failures show as two notices    → `:55`, `:59`, `:63`
 *   the SAME failure again is not a third         → `:27`, `:47`
 *   each names what was ATTEMPTED                 → `component/notice-subject-rendering.test.ts`
 *
 * Red-proven before deletion: `never-suppresses` (4 red), `suppresses-everything` (5) —
 * the two directions of the rule, each reddening what the other does not.
 *
 * ── WHAT STAYS ──
 *
 * `:169`, tagged `@reserve:window`: it RESTARTS and asserts the editor comes back holding its
 * recovered content rather than blank. That is a claim about what survives a process, and there is
 * nothing below this layer that has one.
 */
test('after a restart, a deleted-file editor restores its content (not blank) from recovery (FR-102)', { tag: ['@extended', '@editor', '@reserve:window'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-del2-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-del2-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-del2-ud-'));
  writeFileSync(join(root, 'keep.txt'), 'KEEP-BODY-77\n');
  try {
    // Session 1: open the file, delete it (→ dirty + recovery temp written), close.
    await runApp(
      async (_app, win) => {
        await createProject(win, 'Del2', root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
        await win.getByTestId(`panel-type-confirm-${pid}`).click();
        await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
        await win.getByTestId(`editor-${pid}`).click();

        const tree = win.getByTestId('file-explorer-tree');
        await tree.getByText('keep.txt', { exact: true }).click();
        await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
          'KEEP-BODY-77',
          { timeout: 8000 },
        );
        await tree.getByText('keep.txt', { exact: true }).click({ button: 'right' });
        await win.getByTestId('menu-item-Delete').click();
        await win.getByTestId('confirm-accept').click();
        const again = win.getByTestId('confirm-accept');
        if (await again.isVisible().catch(() => false)) await again.click();
        await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible({ timeout: 8000 });
        await expect
          .poll(() => (recoveredText(userDataDir, pid) ?? '').includes('KEEP-BODY-77'), {
            timeout: 15_000,
            message: `the recovery snapshot for panel "${pid}" was never written to disk`,
          })
          .toBe(true);
      },
      { dataDir, userDataDir },
    );

    // Session 2: reopen → the file is gone, but the editor shows the recovered
    // content (dirty), NOT a blank editor.
    await runApp(
      async (_app, win) => {
        const projectItem = win.locator('.project-item', { hasText: 'Del2' });
        await expect(projectItem).toBeVisible();
        await projectItem.locator('[data-testid^="project-switch-"]').click();

        await dismissNoticeIfPresent(win); // the "Cannot open file" dialog
        const editor = win.locator('.editor-panel').first();
        await expect(editor).toBeVisible({ timeout: 10000 });
        await expect(editor.locator('.cm-content')).toContainText('KEEP-BODY-77', { timeout: 10000 });
        await expect(win.locator('.throng-unsaved-dot').first()).toBeVisible();
      },
      { dataDir, userDataDir },
    );
  } finally {
    cleanupTemp(root);
    cleanupTemp(dataDir);
    cleanupTemp(userDataDir);
  }
});
