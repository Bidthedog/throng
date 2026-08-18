/**
 * #188 — "Automatically select the active editor's file in Files & Folders".
 *
 * The tree used to keep whatever selection it had, so after moving between editor panels or tabs the
 * user had to find the current file by hand before they could act on it. The new
 * `explorer.autoRevealActiveFile` preference (default ON) makes the tree follow the active editor,
 * reusing the same `revealInTree` the manual "Reveal File" action drives (#137).
 *
 * The dangerous half is FOCUS. #144 closed three focus-steal bugs, one of them react-arborist's
 * `select()` grabbing the caret; an auto-reveal that fires on every panel/tab switch is exactly the
 * thing that would reintroduce it. So one test here barely checks the selection — it checks that a
 * keystroke typed after the reveal still lands where the caret was.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  runApp as runOwnApp,
  createProject,
  firstPanelId,
  panelIds,
  focusEditor,
  commitPanelRename,
  commitTabRename,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';

/**
 * A project with a root-level file and one buried two folders deep, so "expands every ancestor" is a
 * real claim rather than one the tree satisfied by accident.
 */
function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-i188-'));
  writeFileSync(join(root, 'alpha.txt'), 'AAAA\nBBBB\nCCCC\nDDDD\n');
  mkdirSync(join(root, 'src', 'nested'), { recursive: true });
  writeFileSync(join(root, 'src', 'nested', 'deep.txt'), 'DEEP_BODY\n');
  return root;
}

async function newEditor(win: Page, pid: string): Promise<void> {
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
}

/**
 * Add a sibling panel to `pid` and return the new panel's id.
 *
 * The rename the new panel opens in is committed through the harness helper, which waits for the
 * input rather than pressing Enter and hoping: a blind Enter that misses the input lands in whatever
 * is focused — here, the editor — and silently inserts a NEWLINE, which is exactly how the caret
 * assertions below came to read one line off.
 */
async function addPanel(win: Page, pid: string): Promise<string> {
  const before = await panelIds(win);
  await win.getByTestId(`panel-add-${pid}`).click();
  await expect(win.locator('.panel-box')).toHaveCount(before.length + 1);
  await commitPanelRename(win);
  return (await panelIds(win)).find((id) => !before.includes(id))!;
}

/** Expand `src/nested` by clicking the twisties, so `deep.txt` is reachable in the tree. */
async function expandToDeep(win: Page): Promise<void> {
  const tree = win.getByTestId('file-explorer-tree');
  await tree.getByTestId('tree-twisty-src').click();
  await tree.getByTestId('tree-twisty-src/nested').click();
  await expect(tree.getByText('deep.txt', { exact: true })).toBeVisible();
}

/** The editor's lines as plain text (zero-width placeholder → empty line). */
const docLines = (win: Page, pid: string): Promise<string[]> =>
  win.evaluate(
    (id) =>
      [...document.querySelectorAll(`[data-testid="editor-${id}"] .cm-line`)].map((l) =>
        l.textContent === '​' ? '' : (l.textContent ?? ''),
      ),
    pid,
  );

/**
 * Two editor panels in one tab: the first showing `alpha.txt`, the second `src/nested/deep.txt`.
 * Returns their panel ids, with `src` left COLLAPSED — so a reveal of deep.txt has real ancestors to
 * open, and the selected row (deep.txt) is not rendered at all until something reveals it.
 */
async function twoEditors(win: Page, name: string, root: string): Promise<[string, string]> {
  await createProject(win, name, root);
  const tree = win.getByTestId('file-explorer-tree');

  const pidA = await firstPanelId(win);
  await newEditor(win, pidA);
  await focusEditor(win, pidA);
  await tree.getByText('alpha.txt', { exact: true }).click();
  await expect(win.getByTestId(`editor-${pidA}`).locator('.cm-content')).toContainText('CCCC', {
    timeout: 8000,
  });

  const pidB = await addPanel(win, pidA);
  await newEditor(win, pidB);
  await focusEditor(win, pidB);
  await expandToDeep(win);
  await tree.getByText('deep.txt', { exact: true }).click();
  await expect(win.getByTestId(`editor-${pidB}`).locator('.cm-content')).toContainText('DEEP_BODY', {
    timeout: 8000,
  });

  await tree.getByTestId('tree-twisty-src').click();
  await expect(tree.getByText('deep.txt', { exact: true })).toHaveCount(0);
  return [pidA, pidB];
}

/*
 * ONE app for the first four tests (034 FR-045, SC-027) — 5 launches -> 2.
 *
 * Test 5 keeps `runOwnApp` and has to: it writes `explorer.autoRevealActiveFile = false` into
 * settings.json BEFORE the app starts and its whole first half is what the tree does with the
 * preference OFF from boot. It then turns it back on by hand-editing that file, which is a
 * hot-reload through the running app — but the OFF state has to be there at startup.
 *
 * ══ WHY THE REAL POWERSHELL IN TEST 4 IS NOT A BLOCKER ══
 *
 * It was read as one: a shell with no teardown outlives the test that started it and holds the
 * project root. Both halves are true, and neither reaches anything. Test 4 is the LAST test in
 * the shared app — test 5 launches its own — so there is no later test for the shell to disturb;
 * it dies when `afterAll` closes the app. What DID have to change is the root it is sitting in:
 * every root now goes in `afterAll`, after the close, instead of being deleted from under a
 * live shell and a live watcher.
 *
 * The four projects already had four distinct names (FollowOn, FollowMarked, FollowFocus,
 * FollowTerminal) on four distinct roots, and every locator here is scoped to the tree or to a
 * panel id the test itself made — an inactive project's workspace is not rendered at all.
 * Test 3 leaves a second TAB open; that belongs to its own project's workspace, which nothing
 * after it looks at.
 */
test.describe.configure({ mode: 'serial' });

const ownedRoots: string[] = [];
/** Register a project root for removal in `afterAll`, once the shared app has closed. */
function own(dir: string): string {
  ownedRoots.push(dir);
  return dir;
}

let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp();
});

test.afterAll(async () => {
  await shared?.close();
  for (const dir of ownedRoots.splice(0)) cleanupTemp(dir);
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win']) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win);
};

test('on by default: making an editor active selects its file and expands its ancestors (#188)', { tag: ['@extended', '@explorer'] }, async () => {
  const root = own(makeProject());
  try {
    await runApp(async (_app, win) => {
      const [pidA, pidB] = await twoEditors(win, 'FollowOn', root);
      const tree = win.getByTestId('file-explorer-tree');

      // Switching to the editor showing the ROOT-level file selects that file…
      await focusEditor(win, pidA);
      await expect(tree.locator('.tree-row--selected')).toContainText('alpha.txt');

      // …and switching back to the deep one re-expands src/nested and selects it.
      await focusEditor(win, pidB);
      await expect(tree.getByText('deep.txt', { exact: true })).toBeVisible();
      await expect(tree.locator('.tree-row--selected')).toContainText('deep.txt');
    });
  } finally {
    // The root is deleted in `afterAll`, once the shared app has CLOSED. Deleting it here would
    // remove a folder the explorer is still watching.
  }
});

test('the active editor’s file stays visibly marked while the EDITOR holds focus (#188)', { tag: ['@extended', '@explorer'] }, async () => {
  // The selection highlight is scoped to the active pane (explorer.css), which is right for "what
  // the next keystroke acts on" — but it means that while the user types in the editor, the tree
  // that has just followed along shows nothing at all. The active file therefore carries its own
  // mark, and this asserts it is genuinely PAINTED, not merely a class nobody styled.
  const root = own(makeProject());
  try {
    await runApp(async (_app, win) => {
      const [pidA, pidB] = await twoEditors(win, 'FollowMarked', root);
      const tree = win.getByTestId('file-explorer-tree');
      const rowFor = (rel: string) => tree.locator(`.tree-row[data-rel-path="${rel}"]`);

      await focusEditor(win, pidA);
      // The keyboard is in the editor, so the pane is NOT active — the condition that blanks the
      // selection highlight, and exactly when the mark has to speak.
      await expect(win.getByTestId('files-pane')).toHaveAttribute('data-active-pane', 'false');
      await expect(rowFor('alpha.txt')).toHaveClass(/tree-row--active-file/);
      expect(await rowFor('alpha.txt').evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
      expect(await rowFor('alpha.txt').evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
        'rgba(0, 0, 0, 0)',
      );

      // It marks ONE file — it moves with the active editor rather than accumulating.
      await focusEditor(win, pidB);
      await expect(rowFor('src/nested/deep.txt')).toHaveClass(/tree-row--active-file/);
      await expect(tree.locator('.tree-row--active-file')).toHaveCount(1);
    });
  } finally {
    // The root is deleted in `afterAll`, once the shared app has CLOSED. Deleting it here would
    // remove a folder the explorer is still watching.
  }
});

test('the auto-reveal never moves keyboard focus or the caret (#188, guards #144)', { tag: ['@extended', '@explorer'] }, async () => {
  const root = own(makeProject());
  try {
    await runApp(async (_app, win) => {
      const [pidA] = await twoEditors(win, 'FollowFocus', root);
      const tree = win.getByTestId('file-explorer-tree');
      const contentA = win.getByTestId(`editor-${pidA}`).locator('.cm-content');

      // Park the caret at the end of a known line in editor A.
      await focusEditor(win, pidA);
      await expect(tree.locator('.tree-row--selected')).toContainText('alpha.txt');
      await contentA.locator('.cm-line', { hasText: 'CCCC' }).click();
      await win.keyboard.press('End');

      // Move the tree's selection elsewhere BY HAND (a single click on a folder selects it and
      // nothing else, #140/#121), so the reveal below has something visible to undo.
      await tree.getByText('src', { exact: true }).click();
      await expect(tree.locator('.tree-row--selected')).toContainText('src');

      // Switch tabs away and back. The editor remounts, restores its caret and takes focus — and
      // the auto-reveal fires right alongside it, which is the collision #144 is about.
      await win.getByTestId('tab-add').click();
      await commitTabRename(win);
      await expect(win.locator('.tab-chip')).toHaveCount(2);
      await win.locator('.tab-chip').nth(0).click();
      await expect(contentA).toContainText('CCCC', { timeout: 8000 });
      await expect(tree.locator('.tree-row--selected')).toContainText('alpha.txt');

      // The reveal has happened; the editor — not the tree — still owns the keyboard.
      await expect(win.getByTestId(`editor-${pidA}`).locator('.cm-editor')).toHaveClass(
        /cm-focused/,
        { timeout: 4000 },
      );
      expect(
        await win.evaluate(
          () => document.activeElement?.closest('[data-testid="file-explorer-tree"]') != null,
        ),
      ).toBe(false);

      // …and the caret is where it was left, so a typed marker appends to that line.
      await win.keyboard.type('Z');
      const lines = await docLines(win, pidA);
      expect(lines[2]).toBe('CCCCZ');
      expect(lines[0]).toBe('AAAA'); // would read "ZAAAA" had the caret been reset
    });
  } finally {
    // The root is deleted in `afterAll`, once the shared app has CLOSED. Deleting it here would
    // remove a folder the explorer is still watching.
  }
});

test('a terminal or unsaved editor becoming active does not move the tree selection (#188)', { tag: ['@extended', '@explorer'] }, async () => {
  const root = own(makeProject());
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'FollowTerminal', root);
      const tree = win.getByTestId('file-explorer-tree');

      const pidEditor = await firstPanelId(win);
      await newEditor(win, pidEditor);
      await focusEditor(win, pidEditor);
      await expandToDeep(win);
      await tree.getByText('deep.txt', { exact: true }).click();
      await expect(tree.locator('.tree-row--selected')).toContainText('deep.txt');

      // A real shell alongside it, then make the TERMINAL the active panel.
      const pidTerm = await addPanel(win, pidEditor);
      await win.getByTestId(`panel-type-select-${pidTerm}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('windows-powershell');
      await win.getByTestId(`panel-type-confirm-${pidTerm}`).click();
      await expect(win.getByTestId(`terminal-${pidTerm}`)).toContainText(basename(root), {
        timeout: 20000,
      });
      await win.getByTestId(`terminal-${pidTerm}`).click();
      await expect(win.getByTestId(`panel-${pidTerm}`)).toHaveAttribute('data-active', 'true');

      // Nothing to reveal for a terminal: the selection neither moves nor blanks. Given a beat, so
      // a reveal that fires late fails this rather than passing by being slow.
      // sleep-justified: the auto-reveal effect (file-tree.tsx's `!activeFileRel` guard) either
      // sleep-justified: calls revealInTree or does not, inside a plain useEffect with no debounce
      // sleep-justified: and no exposed completion signal — there is nothing to wait ON for "it did
      // sleep-justified: not fire late", only time for it to have had the chance to.
      await win.waitForTimeout(500);
      await expect(tree.locator('.tree-row--selected')).toHaveCount(1);
      await expect(tree.locator('.tree-row--selected')).toContainText('deep.txt');

      // An UNSAVED editor has no file to reveal either — the same "nothing to do" path a file from
      // outside the project root takes — and must leave the selection alone, with no error notice.
      const pidBlank = await addPanel(win, pidEditor);
      await newEditor(win, pidBlank);
      await focusEditor(win, pidBlank);
      // sleep-justified: same as above — the auto-reveal effect's guard fires or does not with no
      // sleep-justified: exposed completion signal, so there is nothing to wait ON for "it stayed
      // sleep-justified: quiet", only time for a late fire to have shown itself.
      await win.waitForTimeout(500);
      await expect(tree.locator('.tree-row--selected')).toContainText('deep.txt');
      await expect(win.getByTestId('explorer-error')).toHaveCount(0);
    });
  } finally {
    // The root is deleted in `afterAll`, once the shared app has CLOSED. Deleting it here would
    // remove a folder the explorer is still watching.
  }
});

test('off: the tree never moves on its own, and the setting re-applies with no restart (#188)', { tag: ['@extended', '@explorer'] }, async () => {
  const root = makeProject();
  const cfg = mkdtempSync(join(tmpdir(), 'throng-i188-cfg-'));
  const settings = join(cfg, 'settings.json');
  writeFileSync(settings, JSON.stringify({ explorer: { autoRevealActiveFile: false } }, null, 2));
  try {
    await runOwnApp(
      async (_app, win) => {
        const [pidA, pidB] = await twoEditors(win, 'FollowOff', root);
        const tree = win.getByTestId('file-explorer-tree');

        // The selection sits on deep.txt, which `src` being collapsed hides entirely. Switching to
        // the other editor moves neither: no row is selected, and src stays shut.
        await focusEditor(win, pidA);
        // sleep-justified: same as the terminal/unsaved-editor cases in the other test above — the
        // sleep-justified: auto-reveal effect's guard fires or does not with no exposed completion
        // sleep-justified: signal, so there is nothing to wait ON for "it stayed quiet" here either.
        await win.waitForTimeout(500);
        await expect(tree.getByText('deep.txt', { exact: true })).toHaveCount(0);
        await expect(tree.locator('.tree-row--selected')).toHaveCount(0);

        // Turning the follow OFF asks the tree not to MOVE on its own — not to stop saying what is
        // open. A row already on screen is still marked as the active editor's file.
        await expect(tree.locator('.tree-row[data-rel-path="alpha.txt"]')).toHaveClass(
          /tree-row--active-file/,
        );

        // The manual route still works while the preference is off (#137).
        await win.getByTestId(`panel-handle-${pidB}`).click({ button: 'right' });
        await win.getByTestId('menu-item-Reveal File in Files & Folders').click();
        await expect(tree.getByText('deep.txt', { exact: true })).toBeVisible();
        await expect(tree.locator('.tree-row--selected')).toContainText('deep.txt');

        // Turn it on by hand-editing settings.json: hot-reload, no restart (#108).
        writeFileSync(settings, JSON.stringify({ explorer: { autoRevealActiveFile: true } }, null, 2));
        await focusEditor(win, pidA);
        await expect(tree.locator('.tree-row--selected')).toContainText('alpha.txt', {
          timeout: 8000,
        });
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    cleanupTemp(root);
    cleanupTemp(cfg);
  }
});
