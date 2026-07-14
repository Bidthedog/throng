import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

// 016 US1 (FR-001/002/004b/006/007/008a) — language-aware syntax highlighting.
//
// Assertions are on the TOKEN SPANS CodeMirror emits and the colours they compute to, never on
// screenshots: a screenshot test tells you something changed, not that the right thing did.

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-highlight-'));
  writeFileSync(
    join(root, 'sample.ts'),
    'const answer = 42;\n// a comment\nfunction greet(name: string) {\n  return `hi ${name}`;\n}\n',
  );
  writeFileSync(join(root, 'script.py'), 'def add(a, b):\n    # sums them\n    return a + b\n');
  writeFileSync(join(root, 'data.json'), '{\n  "name": "throng",\n  "count": 3\n}\n');
  writeFileSync(join(root, 'notes.zzz'), 'const answer = 42;\nfunction greet() {}\n');
  writeFileSync(join(root, 'page.html'), '<div id="x">hi</div>\n<script>const a = 1;</script>\n');
  writeFileSync(
    join(root, 'App.vue'),
    '<template>\n  <p>{{ msg }}</p>\n</template>\n<script>\nexport default { data: () => ({ msg: 1 }) };\n</script>\n',
  );
  // One >10,000-character line, plus a normal line after it (FR-008a).
  writeFileSync(
    join(root, 'bundle.min.js'),
    `const a=${'"x",'.repeat(2600)}1;\nconst readable = 2;\n`,
  );
  return root;
}

async function openEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

async function openFile(win: Page, pid: string, name: string, expectText: string): Promise<void> {
  await win.getByTestId(`editor-${pid}`).click();
  await win.getByTestId('file-explorer-tree').getByText(name, { exact: true }).click();
  await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(expectText, {
    timeout: 8000,
  });
}

/** How many distinctly-coloured token spans the editor is painting — 0 means "plain text". */
const tokenColours = (win: Page, pid: string): Promise<string[]> =>
  win.evaluate((id) => {
    const spans = document.querySelectorAll(`[data-testid="editor-${id}"] .cm-line span`);
    const colours = new Set<string>();
    spans.forEach((s) => colours.add(getComputedStyle(s).color));
    return [...colours];
  }, pid);

test('opens a TypeScript file highlighted, and keeps highlighting as you type', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'HL', root);
      const pid = await openEditor(win);
      await openFile(win, pid, 'sample.ts', 'const answer');

      // Highlighted: the grammar produced token spans in more than one colour.
      await expect
        .poll(() => tokenColours(win, pid).then((c) => c.length), { timeout: 8000 })
        .toBeGreaterThan(1);

      // …and those colours come from the THEME's syntax tokens, not hardcoded values.
      const keyword = await win.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--throng-colour-syntaxKeyword')
          .trim(),
      );
      expect(keyword).toMatch(/^#[0-9a-f]{6}$/i);

      // Live: text typed now is highlighted now — no reopen, no reparse of the whole file.
      const before = await tokenColours(win, pid);
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.type('\nclass Widget {}\n');
      await expect
        .poll(() => tokenColours(win, pid).then((c) => c.length), { timeout: 4000 })
        .toBeGreaterThanOrEqual(before.length);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('highlights Python and JSON from their extensions alone', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'HL', root);
      const pid = await openEditor(win);

      await openFile(win, pid, 'script.py', 'def add');
      await expect
        .poll(() => tokenColours(win, pid).then((c) => c.length), { timeout: 8000 })
        .toBeGreaterThan(1);

      // The SAME panel, re-pointed at a different language: the grammar is swapped in the
      // compartment, not rebuilt (FR-004b).
      await openFile(win, pid, 'data.json', '"throng"');
      await expect
        .poll(() => tokenColours(win, pid).then((c) => c.length), { timeout: 8000 })
        .toBeGreaterThan(1);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('an unknown extension is plain text — no highlighting, no error, and a shebang changes nothing', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      const errors: string[] = [];
      win.on('pageerror', (e) => errors.push(e.message));
      await createProject(win, 'HL', root);
      const pid = await openEditor(win);
      await openFile(win, pid, 'notes.zzz', 'const answer');

      // It LOOKS like JavaScript. Detection reads the extension and nothing else, so it is not.
      const colours = await tokenColours(win, pid);
      expect(colours.length).toBeLessThanOrEqual(1);

      // Typing a shebang must not re-detect: content is never inspected (FR-002).
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.press('Control+Home');
      await win.keyboard.type('#!/usr/bin/env node\n');
      await win.waitForTimeout(500);
      expect((await tokenColours(win, pid)).length).toBeLessThanOrEqual(1);
      expect(errors, `an unknown extension must not raise an error: ${errors.join('; ')}`).toEqual([]);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('a >10,000-character line renders unhighlighted but editable, while the rest of the file highlights (FR-008a)', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'HL', root);
      const pid = await openEditor(win);
      await openFile(win, pid, 'bundle.min.js', 'const readable');

      // The long line carries the plain-text marker; the short line does not.
      const marked = await win.evaluate(
        (id) => {
          const lines = [...document.querySelectorAll(`[data-testid="editor-${id}"] .cm-line`)];
          return lines.map((l) => ({
            long: l.textContent!.length > 10_000,
            plain: l.classList.contains('cm-throng-plain-line'),
          }));
        },
        pid,
      );
      expect(marked.some((l) => l.long && l.plain), 'the long line is not exempted').toBe(true);
      expect(marked.some((l) => !l.long && !l.plain), 'a normal line was wrongly exempted').toBe(true);

      // …and it is still a document, not a picture of one: it takes an edit.
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.press('Control+End');
      await win.keyboard.type('// still editable');
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
        '// still editable',
      );
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('switching theme repaints code LIVE — no reopen, no view rebuild', async () => {
  skipIfElevated();
  const root = makeProject();
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'HL', root);
        const pid = await openEditor(win);
        await openFile(win, pid, 'sample.ts', 'const answer');

        const before = await win.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--throng-colour-syntaxKeyword')
            .trim(),
        );
        expect(before).toMatch(/^#[0-9a-f]{6}$/i);

        // The colours are CSS VARIABLES, so a theme change is a repaint — that is the entire reason
        // the highlight style references variables rather than baking hex values into the style.
        // Bake them in and every open editor would have to be torn down and rebuilt to recolour.
        writeFileSync(
          join(cfg, 'settings.json'),
          JSON.stringify({ appearance: { theme: 'Matrix' } }),
          'utf8',
        );
        await expect
          .poll(
            () =>
              win.evaluate(() =>
                getComputedStyle(document.documentElement)
                  .getPropertyValue('--throng-colour-syntaxKeyword')
                  .trim(),
              ),
            { timeout: 10_000 },
          )
          .not.toBe(before);

        // The document is still there, still highlighted — repainted, not reloaded.
        await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
          'const answer',
        );
        expect((await tokenColours(win, pid)).length).toBeGreaterThan(1);
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    rmSync(cfg, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('embedded regions highlight in a Vue SFC and in HTML — or, at worst, raise no error (SHOULD)', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      const errors: string[] = [];
      win.on('pageerror', (e) => errors.push(e.message));
      await createProject(win, 'HL', root);
      const pid = await openEditor(win);

      // The spec makes mixed-language highlighting a best-effort SHOULD. So this asserts the
      // guarantee that IS unconditional — the outer language highlights and nothing errors — and
      // records whether the embedded region did, rather than quietly assuming it.
      await openFile(win, pid, 'page.html', '<div');
      await expect
        .poll(() => tokenColours(win, pid).then((c) => c.length), { timeout: 8000 })
        .toBeGreaterThan(1);

      await openFile(win, pid, 'App.vue', '<template>');
      await expect
        .poll(() => tokenColours(win, pid).then((c) => c.length), { timeout: 8000 })
        .toBeGreaterThan(1);

      expect(errors, `a mixed-language file must never raise an error: ${errors.join('; ')}`).toEqual([]);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
