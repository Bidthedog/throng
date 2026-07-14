import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

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

test('a TAB-indented file keeps taking TABS, though the setting says spaces (FR-018a)', async () => {
  skipIfElevated();
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
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('a 4-space file takes 4 spaces, though the global default is 2 (FR-018a)', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Indent', root);
      const pid = await openFile(win, 'four.py', 'def a()');
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');

      await content.click();
      await win.keyboard.press('Control+End');
      await win.keyboard.press('Enter');
      await win.keyboard.press('Tab');
      await win.keyboard.type('y');

      await expect.poll(() => docText(win, pid)).toContain('    y'); // …four, not two
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('an unindented Go file takes a TAB — its LANGUAGE decides (FR-018)', async () => {
  skipIfElevated();
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
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('Tab and Shift+Tab indent and outdent EVERY line a selection touches — one undo', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Indent', root);
      const pid = await openFile(win, 'four.py', 'def a()');
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');

      // Select the whole document and indent it.
      await content.click();
      await win.keyboard.press('Control+a');
      await win.keyboard.press('Tab');

      await expect.poll(() => docText(win, pid)).toBe(
        '    def a():\n        if x:\n            return 1\n',
      );

      // ONE undo takes the whole indent back, however many lines it moved (FR-026).
      await win.keyboard.press('Control+z');
      await expect.poll(() => docText(win, pid)).toBe('def a():\n    if x:\n        return 1\n');

      // …and Shift+Tab outdents every line it touches, leaving an unindented line alone rather than
      // eating its first character.
      await win.keyboard.press('Control+a');
      await win.keyboard.press('Shift+Tab');
      await expect.poll(() => docText(win, pid)).toBe('def a():\nif x:\n    return 1\n');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('opening a file NEVER reindents it, and never marks it dirty (FR-018d)', async () => {
  skipIfElevated();
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
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
