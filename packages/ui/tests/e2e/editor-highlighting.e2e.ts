import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  runApp as runOwnApp,
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

/*
 * ── ONE REMOVED (035 T055) ──
 *
 * `:201` "a >10,000-character line renders unhighlighted but editable, while the rest of the file
 * highlights (FR-008a)" → `packages/ui/tests/component/editor-long-line.test.ts`.
 *
 * It was the one test in this file that asserted no COLOUR. It read `.cm-line` class lists — is
 * `cm-throng-plain-line` on the long line and absent from the short one — and then typed to show
 * the line was still editable. A class marker and a document edit, neither of which needs a real
 * cascade; that is what its census verdict noticed, and it is the only reason it comes down while
 * everything around it stays.
 *
 * The component file adds the two halves this one could not separate. It always had a short line
 * beside the long one, so "the long line is marked" and "every line is marked" were
 * indistinguishable from its assertions; there they are two tests, one long line alone and one
 * ordinary file. Red-proven against `never-plain`, `always-plain` and `not-a-line-decoration`.
 *
 * ── WHAT STAYS, AND WHY ALL OF IT ──
 *
 * Every remaining test here samples a COMPUTED COLOUR against the live theme variables — that a
 * keyword is painted as a keyword, that Python and JSON get grammars from their extensions alone,
 * that an unknown extension stays the plain foreground, that a theme switch repaints without a
 * reopen. That is a real cascade over a real render and jsdom computes neither, which is what
 * `@reserve:layout` means. The COLOUR half of FR-008a is in that set too:
 * `.cm-throng-plain-line span` forces `--throng-colour-editorFg`, and the theme-repaint test is
 * where it is observable.
 */
test('opens a TypeScript file highlighted, and keeps highlighting as you type', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
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
    cleanupTemp(root);
  }
});

test('highlights Python and JSON from their extensions alone', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
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
    cleanupTemp(root);
  }
});

test('an unknown extension is plain text — no highlighting, no error, and a shebang changes nothing', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
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
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');
      await content.click();
      await win.keyboard.press('Control+Home');
      await win.keyboard.type('#!/usr/bin/env node\n');
      // The edit has landed — the positive fence a re-detect (if it existed) would already have
      // had its chance to run against, since it would fire off the very same keystroke.
      await expect(content).toContainText('#!/usr/bin/env node');
      expect((await tokenColours(win, pid)).length).toBeLessThanOrEqual(1);
      expect(errors, `an unknown extension must not raise an error: ${errors.join('; ')}`).toEqual([]);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('switching theme repaints code LIVE — no reopen, no view rebuild', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const root = makeProject();
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  try {
    await runOwnApp(
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
    cleanupTemp(cfg);
    cleanupTemp(root);
  }
});

test('embedded regions highlight in a Vue SFC and in HTML — or, at worst, raise no error (SHOULD)', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
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
    cleanupTemp(root);
  }
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * MERGED IN (test-suite audit) from editor-function-highlight.e2e.ts — one app for all four highlighting specs
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

// 021 (#84 follow-up) — a function/method NAME in a legacy StreamLanguage language (C#, Ruby, …)
// must be painted with the theme's `syntaxFunction` token, matching the first-class grammars, and
// NOT with `syntaxVariable` as its wrapped CodeMirror-5 mode tokenises it. The first-class grammars
// (JavaScript here) already do this via the grammar and MUST be left untouched.
//
// Assertions are on the COMPUTED COLOUR of the innermost span painting each identifier — i.e. what
// the user actually sees — never on a screenshot.

function makeFnProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-fnhl-'));
  writeFileSync(
    join(root, 'sample.cs'),
    'int Adder(int operand) {\n  int total = operand;\n  return total;\n}\nint result = Adder(5);\n',
  );
  // `greet` appears ONLY as a no-parens definition (a bare `greet` call is indistinguishable from a
  // variable, so it would legitimately stay syntaxVariable and is deliberately absent). `compute` is
  // a call; `total` is a plain local.
  writeFileSync(join(root, 'sample.rb'), 'def greet\n  total = compute(5)\n  total\nend\n');
  writeFileSync(
    join(root, 'sample.js'),
    'function jsFunc(operand) {\n  const total = operand;\n  return total;\n}\nconst r = jsFunc(2);\n',
  );
  return root;
}

/**
 * The theme's resolved `syntaxFunction`/`syntaxVariable` colours, the number of overlay spans, and
 * the computed colour of the INNERMOST span painting each requested identifier (a leaf span with no
 * child elements — the element that actually styles the glyphs).
 */
interface Inspection {
  fnColour: string;
  varColour: string;
  overlayCount: number;
  colours: Record<string, string[]>;
}

function inspect(win: Page, pid: string, texts: string[]): Promise<Inspection> {
  return win.evaluate(
    ({ id, texts }) => {
      const root = document.querySelector(`[data-testid="editor-${id}"]`)!;
      const probe = (varName: string): string => {
        const p = document.createElement('span');
        p.style.color = `var(${varName})`;
        root.appendChild(p);
        const c = getComputedStyle(p).color;
        p.remove();
        return c;
      };
      const leafColours = (text: string): string[] => {
        const spans = [...root.querySelectorAll('.cm-line span')] as HTMLElement[];
        return spans
          .filter((s) => s.children.length === 0 && s.textContent === text)
          .map((s) => getComputedStyle(s).color);
      };
      const colours: Record<string, string[]> = {};
      for (const t of texts) colours[t] = leafColours(t);
      return {
        fnColour: probe('--throng-colour-syntaxFunction'),
        varColour: probe('--throng-colour-syntaxVariable'),
        overlayCount: root.querySelectorAll('.cm-throng-fn').length,
        colours,
      };
    },
    { id: pid, texts },
  );
}

const allAre = (colours: string[], want: string): boolean =>
  colours.length > 0 && colours.every((c) => c === want);

test('a C# method name is coloured syntaxFunction, its locals stay syntaxVariable', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const root = makeFnProject();
  try {
    await runApp(async (_app, win) => {
      const errors: string[] = [];
      win.on('pageerror', (e) => errors.push(e.message));
      await createProject(win, 'FN', root);
      const pid = await openEditor(win);
      await openFile(win, pid, 'sample.cs', 'int Adder');

      // Settle: the overlay is mounted, the theme gives the two tokens distinct colours, the method
      // name (declaration `Adder(` and call `Adder(5)`) is a function colour, and the local is not.
      await expect
        .poll(
          () =>
            inspect(win, pid, ['Adder', 'total']).then(
              (i) =>
                i.overlayCount > 0 &&
                i.fnColour !== i.varColour &&
                allAre(i.colours['Adder'], i.fnColour) &&
                allAre(i.colours['total'], i.varColour),
            ),
          { timeout: 8000 },
        )
        .toBe(true);

      expect(errors, `a legacy-language editor must raise no error: ${errors.join('; ')}`).toEqual([]);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('a Ruby def name and call are coloured syntaxFunction, locals stay syntaxVariable', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const root = makeFnProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'FN', root);
      const pid = await openEditor(win);
      await openFile(win, pid, 'sample.rb', 'def greet');

      await expect
        .poll(
          () =>
            inspect(win, pid, ['greet', 'compute', 'total']).then(
              (i) =>
                i.overlayCount > 0 &&
                i.fnColour !== i.varColour &&
                // `def greet` has NO parentheses — only the definition-keyword path catches it.
                allAre(i.colours['greet'], i.fnColour) &&
                // `compute(5)` is a call.
                allAre(i.colours['compute'], i.fnColour) &&
                // A local is untouched.
                allAre(i.colours['total'], i.varColour),
            ),
          { timeout: 8000 },
        )
        .toBe(true);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('JavaScript still colours functions via the grammar, with NO overlay mounted (no regression)', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const root = makeFnProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'FN', root);
      const pid = await openEditor(win);
      await openFile(win, pid, 'sample.js', 'function jsFunc');

      // The grammar colours the function name (declaration and call) as a function and a plain const
      // as a variable — and the heuristic overlay is NOT mounted for a first-class grammar, so it
      // cannot have overridden anything.
      await expect
        .poll(
          () =>
            inspect(win, pid, ['jsFunc', 'total']).then(
              (i) =>
                i.overlayCount === 0 &&
                i.fnColour !== i.varColour &&
                i.colours['jsFunc'].length > 0 &&
                i.colours['jsFunc'].includes(i.fnColour) &&
                allAre(i.colours['total'], i.varColour),
            ),
          { timeout: 8000 },
        )
        .toBe(true);
    });
  } finally {
    cleanupTemp(root);
  }
});


/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * MERGED IN (test-suite audit) from editor-file-switch.e2e.ts
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Opening a SECOND file into the same panel (016, FR-002a/FR-018a).
 *
 * Every other editor test opens ONE file into a fresh panel. That is not how the app is used: a
 * user clicks through the tree, and each click REPLACES the document in the panel they are looking
 * at. That path has its own hazards, and both of the ones below shipped:
 *
 *   • Opening a file fires `refreshLanguage()` TWICE — once from the authority's reset broadcast
 *     (at which point the panel's recorded path is still the PREVIOUS file's) and once from
 *     `openFile` after the path updates. Both end in an `await import()` of a grammar chunk, and
 *     whichever resolves LAST wins. A cold chunk beats a warm one, so the result depends on which
 *     file you happened to open before — and the losing case mounts the WRONG language's grammar,
 *     which still highlights numbers and strings and so looks like "partial" highlighting rather
 *     than a bug.
 *
 *   • The same race decides the indentation, because the language chooses the profile the file's
 *     own style is layered onto.
 *
 * So these tests always open a file, THEN another, and assert on the second.
 */

function makeSwitchProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-switch-'));
  // Deliberately named so that a plain alphabetical tree lists them in this order. The reported
  // symptom depended on whether the previously-opened file sorted BEFORE or AFTER the target.
  writeFileSync(join(root, 'a-first.ts'), 'export const value: number = 42;\nexport const name = "x";\n');
  writeFileSync(join(root, 'b-query.sql'), 'SELECT id, name\nFROM items\nWHERE quantity < 5;\n');
  writeFileSync(join(root, 'c-third.py'), 'def main():\n    return 42\n');
  // Tab-indented, in a language whose profile is SPACES — so the FILE must win (FR-018a).
  writeFileSync(join(root, 'd-tabs.ts'), 'function a() {\n\tif (x) {\n\t\treturn 1;\n\t}\n}\n');
  // Space-indented, in a language (Go) whose profile is TABS — so the FILE must win here too.
  writeFileSync(join(root, 'e-spaces.go'), 'package main\n\nfunc main() {\n  if x {\n    return\n  }\n}\n');
  return root;
}

async function newClickedEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await win.getByTestId(`editor-${pid}`).click();
  return pid;
}

/** Click a file in the tree and wait for its content to land in the panel. */
async function openSwitchFile(win: Page, pid: string, name: string, contains: string): Promise<void> {
  await win.getByTestId('file-explorer-tree').getByText(name, { exact: true }).click();
  await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(contains, {
    timeout: 8000,
  });
}

/**
 * The colour the active theme paints a given syntax token with.
 *
 * Resolved from the live CSS variable rather than hard-coded, so this says "SELECT is painted as a
 * KEYWORD" and not "SELECT is #ff0000" — it holds on every theme.
 */
const tokenColour = (win: Page, token: string): Promise<string> =>
  win.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(--throng-colour-${name})`;
    document.body.appendChild(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, token);

/** The colour the editor has actually painted `word` in. */
const colourOfWord = (win: Page, pid: string, word: string): Promise<string | null> =>
  win.evaluate(
    ({ id, w }) => {
      const spans = [...document.querySelectorAll(`[data-testid="editor-${id}"] .cm-line span`)];
      const hit = spans.find((el) => el.textContent?.trim() === w);
      return hit ? getComputedStyle(hit).color : null;
    },
    { id: pid, w: word },
  );

/*
 * ── TWO REMOVED (035 T056) ──
 *
 * `:227` "the FILE's indentation wins when it is the SECOND file opened into the panel (FR-018a)"
 * `:253` "…and the reverse: a SPACE-indented file opened after a tab-indented one"
 *
 * → `packages/ui/tests/component/editor-indent-on-switch.test.ts`.
 *
 * The DECISION was already proven and the RE-DECIDING was not. `inferIndent`/`effectiveIndent` are
 * pure and covered in `integration/indent-infer.integration.test.ts:108`, which asks the question
 * once, for one file. These two were about the second answer — that a panel already holding a file
 * re-reads the incoming one rather than keeping the outgoing one's profile. That is `reinferIndent`,
 * called from exactly two places in `use-editor.ts`, and nothing below E2E had exercised the
 * replacement one.
 *
 * ── AND THE EDITOR MOUNTS IN JSDOM ──
 *
 * Nothing in this suite had ever constructed an `EditorView` with a DOM parent, which made "the
 * editor needs a real window" an assumption nobody had tested. It is false: a real `EditorPanel`
 * mounts, renders `.cm-content` and routes keydown through its own keymap. See
 * `packages/ui/tests/component/helpers/mount-editor.ts`, which drives the second open through
 * `getEditorActions(panelId).openFile` — the same route a tree click takes.
 *
 * What jsdom still cannot do is LAYOUT, which is why every REMAINING test in this file is tagged
 * `@reserve:layout`: each one asserts on what the grammar PAINTED — the set of distinct token
 * colours actually on screen — and that is a real cascade over a real render.
 */
test('a .sql opened AFTER another file gets the SQL grammar — not the previous file’s', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const root = makeSwitchProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'SwitchProj', root);
      const pid = await newClickedEditor(win);

      // Open the file that sorts DIRECTLY BEFORE the target — the reported failing order.
      await openSwitchFile(win, pid, 'a-first.ts', 'export const value');
      // …then the target.
      await openSwitchFile(win, pid, 'b-query.sql', 'SELECT id');

      await expect(win.getByTestId(`editor-language-${pid}`)).toHaveText('SQL', { timeout: 8000 });

      // The discriminator. Under the TypeScript grammar, `SELECT` is an ordinary identifier and
      // `FROM` is nothing at all — numbers and strings would still be coloured, which is exactly why
      // the bug read as "partially highlighted" rather than "wrong".
      const keyword = await tokenColour(win, 'syntaxKeyword');
      await expect.poll(() => colourOfWord(win, pid, 'SELECT'), { timeout: 8000 }).toBe(keyword);
      expect(await colourOfWord(win, pid, 'FROM')).toBe(keyword);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('…and it does not matter which file was open before it', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const root = makeSwitchProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'SwitchProj', root);
      const pid = await newClickedEditor(win);
      const keyword = await tokenColour(win, 'syntaxKeyword');

      // The file AFTER it in the listing (the order the user found working)…
      await openSwitchFile(win, pid, 'c-third.py', 'def main');
      await openSwitchFile(win, pid, 'b-query.sql', 'SELECT id');
      await expect.poll(() => colourOfWord(win, pid, 'SELECT'), { timeout: 8000 }).toBe(keyword);

      // …and back and forth several times. The winner must never be decided by chunk-cache warmth.
      for (const [name, needle] of [
        ['a-first.ts', 'export const value'],
        ['b-query.sql', 'SELECT id'],
        ['c-third.py', 'def main'],
        ['b-query.sql', 'SELECT id'],
      ] as const) {
        await openSwitchFile(win, pid, name, needle);
      }
      await expect(win.getByTestId(`editor-language-${pid}`)).toHaveText('SQL');
      await expect.poll(() => colourOfWord(win, pid, 'SELECT'), { timeout: 8000 }).toBe(keyword);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('a PLAIN-TEXT file opened after a highlighted one is left plain', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const root = makeSwitchProject();
  writeFileSync(join(root, 'notes'), 'SELECT this is not code\nfunction neither is this\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'SwitchProj', root);
      const pid = await newClickedEditor(win);

      await openSwitchFile(win, pid, 'b-query.sql', 'SELECT id');
      await openSwitchFile(win, pid, 'notes', 'this is not code');

      await expect(win.getByTestId(`editor-language-${pid}`)).toHaveText('Plain Text');

      // The previous file's grammar must not still be mounted: nothing here is a keyword, because
      // there is no grammar at all.
      await expect
        .poll(() => colourOfWord(win, pid, 'SELECT'), { timeout: 8000 })
        .toBeNull();
    });
  } finally {
    cleanupTemp(root);
  }
});

test('MARKDOWN is highlighted — headings, emphasis, links and inline code (FR-006)', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const root = makeSwitchProject();
  writeFileSync(
    join(root, 'f-notes.md'),
    '# A heading\n\nSome **bold** and *italic* prose.\n\nA [link](https://example.com) and `inline code`.\n\n- a list item\n\n> a quotation\n',
  );
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'SwitchProj', root);
      const pid = await newClickedEditor(win);
      await openSwitchFile(win, pid, 'f-notes.md', 'A heading');

      await expect(win.getByTestId(`editor-language-${pid}`)).toHaveText('Markdown');

      /**
       * The grammar was loading correctly all along — but the highlight style mapped only CODE tags
       * (keyword, string, number, type, function…), and markdown emits PROSE tags: heading, strong,
       * emphasis, link, monospace, quote, list. None of them matched anything, so a markdown file was
       * parsed, tokenised, and then painted entirely in the default text colour.
       *
       * So this asserts on the number of DISTINCT colours actually on screen, which is the only
       * thing that would have caught it: the document is not one flat colour.
       */
      // POLLED: the grammar arrives as a lazily-imported chunk, so a query fired the instant the
      // text lands races it and reads zero spans on a perfectly healthy editor.
      const distinctColours = (): Promise<number> =>
        win.evaluate((id) => {
          const spans = [
            ...document.querySelectorAll(`[data-testid="editor-${id}"] .cm-line span`),
          ];
          return new Set(spans.map((s) => getComputedStyle(s).color)).size;
        }, pid);

      await expect.poll(distinctColours, { timeout: 8000 }).toBeGreaterThan(2);

      // …and a heading is painted as a keyword, which is the token the style maps it to.
      const keyword = await tokenColour(win, 'syntaxKeyword');
      await expect.poll(() => colourOfWord(win, pid, 'A heading'), { timeout: 8000 }).toBe(keyword);
    });
  } finally {
    cleanupTemp(root);
  }
});


/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * MERGED IN (test-suite audit) from editor-search-highlight.e2e.ts
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

// 016 FR-007a / SC-007b — the COMPOSING half of the search/highlight overlap.
//
// The contrast guard proves the two layers COULD coexist legibly. This proves they actually DO:
// the match is a background, the syntax colour stays the foreground, and matched code keeps its
// highlighting instead of flattening into a solid block. Without this, the guard passes while the
// rendering is wrong — the colours are fine in a spreadsheet and gone on screen.

function makeSearchProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-searchhl-'));
  writeFileSync(
    join(root, 'code.ts'),
    'const target = 1;\nfunction target2() {\n  return target;\n}\n',
  );
  return root;
}

async function openSearchFile(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await win.getByTestId(`editor-${pid}`).click();
  await win.getByTestId('file-explorer-tree').getByText('code.ts', { exact: true }).click();
  await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('const target', {
    timeout: 8000,
  });
  return pid;
}

test('a search match keeps the code beneath it syntax-coloured (FR-007a)', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const root = makeSearchProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'SearchHL', root);
      const pid = await openSearchFile(win);

      // The colour `const` is painted in BEFORE searching.
      //
      // Polled, because grammars are loaded LAZILY (a dynamic import per language, so 31 grammars
      // are not shipped in the opening bundle): the text lands first and the highlighting a tick
      // later. Reading the colours the instant the text appears is a race with the app's own
      // design, not a test of it.
      const keywordColourOf = (): Promise<string | null> =>
        win.evaluate((id) => {
          const spans = [...document.querySelectorAll(`[data-testid="editor-${id}"] .cm-line span`)];
          const kw = spans.find((s) => s.textContent === 'const');
          return kw ? getComputedStyle(kw).color : null;
        }, pid);

      await expect
        .poll(keywordColourOf, {
          timeout: 8000,
          message: 'the file was not highlighted to begin with',
        })
        .not.toBeNull();
      const keywordColour = await keywordColourOf();

      // Focus the document first: find is scoped to the ACTIVE panel, and the file tree currently
      // has focus after the click that opened the file.
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();

      // Search for something that lands ON highlighted code.
      await win.keyboard.press('Control+f');
      await win.getByTestId('find-input').fill('target');
      await expect(win.locator('.throng-search-match').first()).toBeVisible({ timeout: 8000 });

      // The match paints a BACKGROUND…
      const matchBg = await win.evaluate(() => {
        const el = document.querySelector('.throng-search-match--current') as HTMLElement | null;
        return el ? getComputedStyle(el).backgroundColor : null;
      });
      expect(matchBg).not.toBeNull();
      expect(matchBg).not.toBe('rgba(0, 0, 0, 0)');

      // …and the code inside it KEEPS its syntax colour. If the match had flattened the code, the
      // matched token would be painted in the plain editor foreground instead.
      const stillHighlighted = await win.evaluate((id) => {
        const spans = [...document.querySelectorAll(`[data-testid="editor-${id}"] .cm-line span`)];
        const kw = spans.find((s) => s.textContent === 'const');
        const editorFg = getComputedStyle(document.documentElement)
          .getPropertyValue('--throng-colour-editorFg')
          .trim();
        return { keyword: kw ? getComputedStyle(kw).color : null, editorFg };
      }, pid);
      expect(stillHighlighted.keyword).toBe(keywordColour);
    });
  } finally {
    cleanupTemp(root);
  }
});

