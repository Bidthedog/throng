import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';

/*
 * ONE app for this file, not one per test.
 *
 * Each test used to launch its own Electron app, daemon and window — roughly two seconds apiece, and
 * 604 such launches across the suite — to run assertions that never needed a pristine app. Only a
 * test that seeds state BEFORE launch genuinely does, and those keep their own app via `runOwnApp`.
 *
 * The shims below exist so the test bodies below are unchanged:
 *   runApp        runs the body against the shared window. It refuses options rather than ignoring
 *                 them: a dropped config root does not fail, it passes for the wrong reason.
 *   createProject appends a counter, because a shared app accumulates projects and duplicate names
 *                 make `.project-item` ambiguous.
 *
 * Serial mode is required — shared window, shared database — and it means a failure skips the rest
 * rather than running them against whatever state the failure left behind.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
test.beforeAll(async () => {
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win'], ctx: { pipeName: string; userDataDir: string }) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win, {
    pipeName: shared.pipeName,
    userDataDir: shared.userDataDir,
  });
};

let projectSeq = 0;
const createProject = (win: OpenApp['win'], name: string, root: string): Promise<void> =>
  newProject(win, `${name}-${(projectSeq += 1)}`, root);

/**
 * 026 — renaming in the tree must leave keyboard focus IN the tree.
 *
 * Committing an inline rename unmounts the text input it was typed into. Nothing then takes focus
 * back, so it falls to `<body>` and the Files & Folders pane goes dead to the keyboard: the arrow
 * keys stop moving the selection, F2 no longer starts another rename, Delete does nothing. The user
 * has to click the tree again to carry on — after an action they performed *in* the tree.
 *
 * The fix is not simply "focus the tree". react-arborist uses ROVING FOCUS: DOM focus lives on the
 * tree container, never on a row (`tree-node.tsx` documents this), and the existing
 * `select(id, { focus: false })` calls are load-bearing — issue #144 added them precisely so the
 * tree could re-highlight a row without yanking the caret out of an editor. So focus must return
 * only when the rename was driven FROM the tree, which is the case this covers.
 *
 * Two assertions, because either alone is weak:
 *
 *   1. DOM focus is inside the tree — direct, but a container can hold focus while the tree's own
 *      key handling has moved on.
 *   2. F2 opens a rename again — behavioural, and the thing the user actually lost. This is the one
 *      that would have caught the bug; the first only says where focus went.
 *
 * RED on master: focus lands on `<body>` and the second F2 does nothing.
 */

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-rnfocus-'));
  mkdirSync(join(root, 'Docs'));
  writeFileSync(join(root, 'Docs', 'note.txt'), 'note\n');
  writeFileSync(join(root, 'a.txt'), 'a\n');
  writeFileSync(join(root, 'b.txt'), 'b\n');
  return root;
}

/** Is DOM focus inside the Files & Folders tree? */
function focusIsInTree(win: Page): Promise<boolean> {
  return win.evaluate(() => {
    const tree = document.querySelector('[data-testid="file-explorer-tree"]');
    const active = document.activeElement;
    return !!tree && !!active && tree.contains(active);
  });
}

/*
 * THE FIRST THREE TESTS MOVED to
 * `packages/ui/tests/component/explorer-tree-interaction.test.ts` (034 FR-045).
 *
 * THEY LAND STRONGER THERE, AND THIS IS THE INTERESTING PART. All three asked only whether DOM
 * focus was somewhere INSIDE the tree — and react-arborist answers that by itself: `submit()` and
 * `reset()` each schedule `setTimeout(() => this.onFocus())` (`tree-api.js:322`/`:329`), which
 * falls back to `firstNode` when the focused id no longer resolves. After a rename the id ALWAYS
 * changes, so the fallback fires and parks focus on the ROOT row. "Inside the tree" is therefore
 * satisfied by the wrong answer, and the E2E could not tell the two apart.
 *
 * The replacements name the focused ROW. That is what `use-explorer-data.ts:716`’s deliberate
 * `api.select(rel)` — the one programmatic select in that file that does NOT pass
 * `{ focus: false }` — actually buys, and the Red proof for it (`red-explorer-b4.mjs --only M1`)
 * reddens two component tests while leaving this file’s own assertion green.
 *
 * The behavioural half survives intact: a second F2 must open another inline editor without a
 * click. That was always the assertion that would have caught the bug, and it is unchanged.
 *
 * WHAT STAYS: the #144 fence below. It needs a real editor panel with a real CodeMirror holding a
 * real caret, which is the whole point of it — a rename-focus fix written as "the tree takes
 * focus" would pass every component test above and still yank the caret out of the text the user
 * is typing in.
 *
 * ANTI-VACUITY CONTROL for the replacements: withhold the `ImmediateResizeObserver` stub and all
 * nine tests in that file fail.
 */

test('an editor keeps the caret when the tree re-highlights (issue #144 must not regress)', { tag: ['@extended', '@explorer', '@reserve:input'] }, async () => {
  // The fence for the fix. #144's `select(id, { focus: false })` exists so the tree can highlight
  // the active file's row WITHOUT stealing the caret out of an editor — a rename-focus fix written
  // as "the tree takes focus" would undo it, and typing would start landing in the wrong place.
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'RenameFocusFence', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      // Open a file into an editor panel, then click into its text.
      const pid = await win
        .locator('.panel-box')
        .first()
        .evaluate((el) => (el as HTMLElement).dataset.panelId ?? '');
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
      await tree.getByText('a.txt', { exact: true }).click();
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');
      await expect(content).toContainText('a', { timeout: 10_000 });
      await content.click();

      // The caret is in the editor and must stay there — no tree interaction has happened since.
      // sleep-justified: react-arborist's submit()/reset() schedule setTimeout(() => onFocus())
      // sleep-justified: (tree-api.js:322/329, see the file banner above) — that internal timer is
      // sleep-justified: exactly the regression risk here, and it exposes nothing to await; only
      // sleep-justified: time lets a late steal show itself before asserting focus never moved.
      await win.waitForTimeout(500);
      expect(
        await focusIsInTree(win),
        'the tree stole focus from the editor — issue #144 has regressed',
      ).toBe(false);
    });
  } finally {
    cleanupTemp(root);
  }
});
