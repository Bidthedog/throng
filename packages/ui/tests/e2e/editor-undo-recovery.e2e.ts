import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp} from './harness.js';

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

/**
 * The undo history, end to end (016, FR-026/FR-027a/FR-027c · T092).
 *
 * Two claims here are the ones that would embarrass us in the field:
 *
 *   • **one command is one Undo.** A ten-row column paste that takes ten Ctrl+Z presses to remove is
 *     not an editor, it is a punishment.
 *   • **the history survives a crash.** Recovering a document's content while silently discarding
 *     its past leaves the user with the right text and no way back out of it — and they will not
 *     discover that until the moment they need it most.
 */

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

/**
 * Reopen a project after a restart and return its restored editor panel.
 *
 * The layout is restored by SWITCHING to the project — the workspace renders no panels until it
 * has one — so a session-2 test that goes straight for the panel finds nothing at all.
 */
async function reopenProject(win: Page, name: string): Promise<string> {
  const projectItem = win.locator('.project-item', { hasText: name });
  await expect(projectItem).toBeVisible();
  await projectItem.locator('[data-testid^="project-switch-"]').click();
  await expect(win.locator('.editor-panel').first()).toBeVisible({ timeout: 10000 });
  return firstPanelId(win);
}

const docText = (win: Page, pid: string): Promise<string> =>
  win.evaluate(
    (id) =>
      [...document.querySelectorAll(`[data-testid="editor-${id}"] .cm-line`)]
        .map((l) => (l.textContent === '​' ? '' : l.textContent))
        .join('\n'),
    pid,
  );

test('undo past a SAVE re-dirties the document, and a revert clears the history', { tag: ['@extended', '@editor'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-undo-'));
  writeFileSync(join(root, 'doc.txt'), 'original\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'UndoProj', root);
      const pid = await newEditor(win);
      await win.getByTestId(`editor-${pid}`).click();
      await win.getByTestId('file-explorer-tree').getByText('doc.txt', { exact: true }).click();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
        'original',
        { timeout: 8000 },
      );

      // Type, save, then undo BACK PAST the save. The document is now unsaved again — its content
      // no longer matches the file on disk, whatever the version counter says. (Deriving `dirty`
      // from the version instead of the content got this exactly backwards: undo is the inverse
      // applied FORWARD, so it ADVANCES the version, and a document undone back to its saved text
      // would have reported itself dirty while being byte-identical to the file.)
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.press('Control+End');
      await win.keyboard.type('EDIT');
      await win.keyboard.press('Control+s');
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0, { timeout: 8000 });

      await win.keyboard.press('Control+z');
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible({ timeout: 8000 });

      // …and Redo back to the saved content makes it CLEAN again, byte-identical to the file.
      await win.keyboard.press('Control+y');
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0, { timeout: 8000 });
    });
  } finally {
    cleanupTemp(root);
  }
});

test('a crash restores the content AND its undo history — Ctrl+Z still reaches the past', { tag: ['@extended', '@editor'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-undorec-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-undorec-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-undorec-ud-'));
  try {
    // Session 1: two distinct edits, then die without saving. The harness destroys the windows —
    // there is no clean shutdown, which is exactly the case recovery exists for.
    await runApp(
      async (_app, win) => {
        await createProject(win, 'CrashProj', root);
        const pid = await newEditor(win);
        await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
        await win.keyboard.type('FIRST');
        // sleep-justified: CodeMirror's own history groups changes within a 500ms window into one
        // sleep-justified: undo entry (newGroupDelay); that grouping is internal to CM and has no
        // sleep-justified: externally observable effect until the SECOND typing run happens, so
        // sleep-justified: there is nothing to poll — only exceeding the window itself proves it.
        await win.waitForTimeout(700);
        await win.keyboard.type('-SECOND');
        await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();
        await expect
          .poll(() => (recoveredText(userDataDir, pid) ?? '').includes('FIRST-SECOND'), {
            timeout: 15_000,
            message: `the recovery snapshot for panel "${pid}" was never written to disk`,
          })
          .toBe(true);
      },
      { dataDir, userDataDir },
    );

    // Session 2: the document comes back — and so does its past.
    await runApp(
      async (_app, win) => {
        const pid = await reopenProject(win, 'CrashProj');
        await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
          'FIRST-SECOND',
          { timeout: 10000 },
        );

        // The content survived. Now the part that is easy to lose and hard to notice: ONE Ctrl+Z
        // must take back the second typing run, leaving the first — which is only possible if the
        // undo stack itself crossed the crash.
        await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
        await win.keyboard.press('Control+z');
        await expect.poll(() => docText(win, pid), { timeout: 8000 }).toBe('FIRST');
      },
      { dataDir, userDataDir },
    );
  } finally {
    cleanupTemp(root);
    cleanupTemp(dataDir);
    cleanupTemp(userDataDir);
  }
});

/*
 * DELETED (034 FR-045/FR-046a) — `test('with persistUndoHistory OFF, the content still recovers —
 * only the history is gone')`. TWO Electron launches, a preferences window, a `skipIfElevated()`
 * that made it behave differently on CI, and a documented three-second settle for a config-cache
 * race. Every claim it made is proved below E2E, and named here so the deletion can be checked
 * rather than believed:
 *
 *   the snapshot carries the CONTENT and no history
 *     → `packages/ui/tests/integration/recovery-history.integration.test.ts:166`
 *       "with the toggle OFF, the content still recovers in full — only the history is absent"
 *       expect(parsed.text).toBe('work in progress'); expect(parsed.history).toBeUndefined();
 *
 *   a history already on disk is PURGED the moment the toggle goes off (FR-027c)
 *     → `recovery-history.integration.test.ts:181`
 *       expect(parsed.history).toBeUndefined(); expect(parsed.text).toBe('SECRET-KEY');
 *     (the E2E never asserted the purge at all — it only polled for its effect)
 *
 *   a snapshot is written and restored across a relaunch
 *     → `editor-recovery.integration.test.ts:56`
 *       "writes in-progress content to a recovery temp and restores it after relaunch"
 *
 *   the toggle is REACHABLE in the Settings editor (FR-022)
 *     → `packages/core/tests/unit/settings-metadata.test.ts:22`
 *       "describes every configurable settings leaf and no unknown keys" — universally quantified
 *       over AppSettings, and `editor.persistUndoHistory` is a leaf (`app-settings.ts:188`,
 *       descriptor at `settings-metadata.ts:671`) — with `:121` "groups every descriptor into a
 *       labelled section". The preferences editor renders from that registry; there is no path by
 *       which this key has a descriptor and no control.
 *
 * WHAT IS HONESTLY LOST: nothing proves, in one test, that a REAL restart with the toggle off
 * shows the recovered text in a real CodeMirror view while Ctrl+Z leaves it alone. That residue is
 * the NEGATIVE of the claim the surviving crash test above makes end to end, over the same
 * snapshot file and the same restart — so what is unproven is that the absence of a history in the
 * snapshot reaches the view, given that its presence demonstrably does.
 */
