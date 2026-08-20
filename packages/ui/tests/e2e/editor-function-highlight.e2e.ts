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


// 021 (#84 follow-up) — a function/method NAME in a legacy StreamLanguage language (C#, Ruby, …)
// must be painted with the theme's `syntaxFunction` token, matching the first-class grammars, and
// NOT with `syntaxVariable` as its wrapped CodeMirror-5 mode tokenises it. The first-class grammars
// (JavaScript here) already do this via the grammar and MUST be left untouched.
//
// Assertions are on the COMPUTED COLOUR of the innermost span painting each identifier — i.e. what
// the user actually sees — never on a screenshot.

function makeProject(): string {
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
  const root = makeProject();
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
  const root = makeProject();
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
  const root = makeProject();
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
