import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

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

function readSettings(cfgRoot: string): Record<string, any> | null {
  try {
    return JSON.parse(readFileSync(join(cfgRoot, 'settings.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** The single recovery snapshot on disk, parsed — or null if there is none yet. */
function snapshotOnDisk(userDataDir: string): Record<string, any> | null {
  try {
    const dir = join(userDataDir, 'recovery');
    const [name] = readdirSync(dir);
    if (!name) return null;
    return JSON.parse(readFileSync(join(dir, name), 'utf8'));
  } catch {
    return null;
  }
}

/** Open Preferences on the Settings tab. */
async function openSettings(app: ElectronApplication, win: Page): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId('cog-menu-settings').click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  await expect(prefs.getByTestId('settings-tab')).toBeVisible();
  return prefs;
}

const docText = (win: Page, pid: string): Promise<string> =>
  win.evaluate(
    (id) =>
      [...document.querySelectorAll(`[data-testid="editor-${id}"] .cm-line`)]
        .map((l) => (l.textContent === '​' ? '' : l.textContent))
        .join('\n'),
    pid,
  );

test('undo past a SAVE re-dirties the document, and a revert clears the history', async () => {
  skipIfElevated();
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
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('a crash restores the content AND its undo history — Ctrl+Z still reaches the past', async () => {
  skipIfElevated();
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
        // A pause longer than the 500 ms typing-run window, so the two runs cannot coalesce into a
        // single undo entry — otherwise this test would pass even with no history at all.
        await win.waitForTimeout(700);
        await win.keyboard.type('-SECOND');
        await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();
        await win.waitForTimeout(800); // > the 400 ms recovery debounce
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
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('with persistUndoHistory OFF, the content still recovers — only the history is gone', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-undooff-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-undooff-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-undooff-ud-'));
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-undooff-cfg-'));
  const env = { THRONG_CONFIG_ROOT: cfgRoot };
  try {
    await runApp(
      async (app, win) => {
        // Turn it off through the real Settings editor — the way a user would, which also proves
        // the toggle is actually reachable there (FR-022).
        const prefs = await openSettings(app, win);
        await prefs.getByTestId('control-editor.persistUndoHistory').click();
        await expect
          .poll(() => readSettings(cfgRoot)?.editor?.persistUndoHistory, { timeout: 8000 })
          .toBe(false);
        await prefs.close();

        await createProject(win, 'OffProj', root);
        const pid = await newEditor(win);
        await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
        await win.keyboard.type('KEEP-ME');
        await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();

        // The snapshot on disk ends up holding the CONTENT and no history.
        //
        // Polled, not asserted once, and deliberately so: UI main's cached settings are refreshed by
        // the config watcher, which lands some time AFTER the settings file itself is written — so a
        // snapshot taken in that window can still carry a history. It does not survive: turning the
        // setting off PURGES what is already on disk (FR-027c), which is exactly why the purge
        // exists rather than trusting the next keystroke to overwrite it. This polls the guarantee
        // the requirement actually makes, instead of racing the mechanism that delivers it.
        // Three-valued on purpose. Polling `snapshot?.history` for `undefined` would pass the
        // instant it ran, before any snapshot existed at all — a test that asserts nothing and
        // reports success, which is worse than one that fails.
        await expect
          .poll(
            () => {
              const snap = snapshotOnDisk(userDataDir);
              if (!snap) return 'no-snapshot';
              return 'history' in snap ? 'has-history' : 'no-history';
            },
            { timeout: 10000 },
          )
          .toBe('no-history');
        expect(snapshotOnDisk(userDataDir)?.text).toBe('KEEP-ME');
      },
      { dataDir, userDataDir, env },
    );


    await runApp(
      async (_app, win) => {
        const pid = await reopenProject(win, 'OffProj');
        // FR-027c is explicit: a crash with the toggle off still recovers the DOCUMENT in full.
        // Turning off the history must never turn off recovery.
        await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
          'KEEP-ME',
          { timeout: 10000 },
        );

        // …but there is no past to step back into: Ctrl+Z leaves the recovered text alone.
        await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
        await win.keyboard.press('Control+z');
        await win.waitForTimeout(500);
        expect(await docText(win, pid)).toContain('KEEP-ME');
      },
      { dataDir, userDataDir, env },
    );
  } finally {
    for (const dir of [root, dataDir, userDataDir, cfgRoot]) {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    }
  }
});
