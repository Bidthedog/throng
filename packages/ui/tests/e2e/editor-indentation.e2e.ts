import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  firstPanelId,
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
 * US4 — per-language indentation (016, FR-018/FR-018a/FR-018d · T075).
 *
 * The headline is what the FILE already does, which beats every preference. An editor that pours
 * spaces into a tab-indented file because a setting said so has damaged that file, and nothing in
 * the app will ever tell the user — they find out at review.
 */

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-indent-'));
  // TypeScript's profile is SPACES, and so is the global default. This file disagrees with both.
  writeFileSync(join(root, 'tabs.ts'), 'function a() {\n\tif (x) {\n\t\treturn 1;\n\t}\n}\n');
  // A 4-space Python file. Python's profile is 4, the global default is 2.
  writeFileSync(join(root, 'four.py'), 'def a():\n    if x:\n        return 1\n');
  // A Go file with NOTHING to infer from — so its LANGUAGE decides, and Go means tabs.
  writeFileSync(join(root, 'blank.go'), 'package main\n');
  return root;
}

async function openFile(win: Page, name: string, expectText: string): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await win.getByTestId(`editor-${pid}`).click();
  await win.getByTestId('file-explorer-tree').getByText(name, { exact: true }).click();
  await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(expectText, {
    timeout: 8000,
  });
  return pid;
}

/** The document, with tabs made visible so an assertion can tell them from spaces. */
const docText = (win: Page, pid: string): Promise<string> =>
  win.evaluate(
    (id) =>
      [...document.querySelectorAll(`[data-testid="editor-${id}"] .cm-line`)]
        .map((l) => (l.textContent === '​' ? '' : l.textContent))
        .join('\n'),
    pid,
  );

test('a TAB-indented file keeps taking TABS, though the setting says spaces (FR-018a)', { tag: ['@extended', '@editor'] }, async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Indent', root);
      const pid = await openFile(win, 'tabs.ts', 'function a()');
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');

      // A new line at the very end, then Tab. The file indents with tabs, so this must be a TAB —
      // even though TypeScript's profile and the global default both say spaces.
      await content.click();
      await win.keyboard.press('Control+End');
      await win.keyboard.press('Enter');
      await win.keyboard.press('Tab');
      await win.keyboard.type('x');

      await expect.poll(() => docText(win, pid)).toContain('\tx');
      expect(await docText(win, pid)).not.toContain('  x'); // …not spaces
    });
  } finally {
    cleanupTemp(root);
  }
});

/*
 * MOVED / DELETED (034 FR-045) — two tests.
 *
 * 1. `Tab and Shift+Tab indent and outdent EVERY line a selection touches` → the component layer.
 * The replacements are `packages/ui/tests/component/editor-command-semantics.test.ts` (14 tests).
 * That file drives the REAL commands from `commands.ts` over a REAL `EditorState` — real facets,
 * the real `columnBlockField`, real transactions — behind a two-member stand-in for the view,
 * because every one of these commands touches only `view.state` and `view.dispatch`.
 *
 * WHAT THE APP WAS BUYING, AND WHY IT IS NOT NEEDED: the translation from a keystroke to a command
 * call. That is CodeMirror’s `keymap`, which is not throng’s code to re-test. throng’s own half of
 * it — which chord reaches which command — is `packages/ui/tests/unit/scope.test.ts:149` and `:168`,
 * and the chord→CodeMirror-key spelling is asserted in the replacement itself.
 *
 * ANTI-VACUITY CONTROL: delete `this.state = tr.state;` from the replacement’s `FakeView.dispatch`,
 * so transactions are recorded but never applied. ALL FOURTEEN fail. Nothing in that file can pass
 * over an inert editor.
 *
 *    STRONGER: the replacement also asserts that Tab leaves an EMPTY line ALONE
 *    (`commands.ts:355`) — never covered here, invisible on screen, and loud in a diff — that the
 *    indent is exactly ONE transaction carrying `input.indent`, and that a TAB-indented line is
 *    outdented as a tab while the profile says spaces (FR-018a read off the LINE, not the setting).
 *
 * 2. `a 4-space file takes 4 spaces, though the global default is 2` → DELETED as already covered
 *    by `packages/ui/tests/integration/indent-infer.integration.test.ts:132`:
 *
 *        expect(settings.indent.indentWidth).toBe(2);
 *        const inferred = inferIndent(FOUR_SPACE);
 *        expect(inferred).toEqual({ style: 'spaces', width: 4 });
 *        expect(indentUnitOf(effectiveIndent({ inferred, languageId: 'python', settings }))).toBe('    ');
 *
 *    …and by the component replacement, which asserts that the profile’s unit is what a Tab at a
 *    bare caret actually inserts.
 *
 * WHAT STAYS, AND WHY IT IS NOT AN OVERSIGHT:
 *
 *   - `a TAB-indented file keeps taking TABS` is the WIRING WITNESS. `useEditor` calls
 *     `reinferIndent(state.text)` when a document lands (`use-editor.ts:1153`, `:1036`), and no
 *     layer below E2E exercises that hook — the integration test proves the DECISION, this proves
 *     the decision is actually consulted. Deleting it would be the exact "the lower test proves a
 *     pure function while the E2E proves the wired result" loss FR-046a exists to stop.
 *   - `an unindented Go file takes a TAB` is the second witness, for the other input to the same
 *     decision: it is the only test proving the panel’s DETECTED LANGUAGE reaches
 *     `effectiveIndent` (`use-editor.ts:322`).
 *   - `opening a file NEVER reindents it, and never marks it dirty` keeps its second half: the
 *     integration test asserts `dirty === false` at the AUTHORITY, and nothing below E2E asserts
 *     that the panel’s unsaved dot therefore stays dark.
 */

test('an unindented Go file takes a TAB — its LANGUAGE decides (FR-018)', { tag: ['@extended', '@editor'] }, async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Indent', root);
      const pid = await openFile(win, 'blank.go', 'package main');
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');

      // The file has no indentation to read, so the language's convention applies. Go means tabs.
      await content.click();
      await win.keyboard.press('Control+End');
      await win.keyboard.press('Enter');
      await win.keyboard.press('Tab');
      await win.keyboard.type('z');

      await expect.poll(() => docText(win, pid)).toContain('\tz');
    });
  } finally {
    cleanupTemp(root);
  }
});

test('opening a file NEVER reindents it, and never marks it dirty (FR-018d)', { tag: ['@extended', '@editor'] }, async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Indent', root);
      const pid = await openFile(win, 'tabs.ts', 'function a()');

      // Byte for byte what was on disk — the editor adopted the file's style, it did not impose its
      // own. And the unsaved dot never lights: reading a file's indentation is not an edit to it.
      expect(await docText(win, pid)).toBe(
        'function a() {\n\tif (x) {\n\t\treturn 1;\n\t}\n}\n',
      );
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0);
    });
  } finally {
    cleanupTemp(root);
  }
});
