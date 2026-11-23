import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { openApp, createProject as newProject, firstPanelId, cleanupTemp, type AppOptions, type OpenApp, focusEditor, pressAction } from './harness.js';
import { expectWithinSla } from './helpers/sla.js';

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

// 013 US1 — find in the active editor: seed from selection, incremental as-you-type
// highlighting, the current/total count, wrap, the match-mode toggles, the no-results
// state, and close. Throughout: the file's content is never altered by searching.

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

async function typeInto(win: Page, pid: string, text: string): Promise<void> {
  await focusEditor(win, pid);
  await win.keyboard.type(text);
}

/** The editor's current text. CodeMirror renders spaces as non-breaking ones, so they
 *  are normalised back before asserting on the document's content. */
async function docText(win: Page, pid: string): Promise<string> {
  return win
    .getByTestId(`editor-${pid}`)
    .locator('.cm-content')
    .evaluate((el) =>
      (el as HTMLElement).innerText.split(String.fromCharCode(160)).join(' '),
    );
}

const matches = (win: Page, pid: string) =>
  win.getByTestId(`editor-${pid}`).locator('.throng-search-match');

/*
 * ── THE CONTROLLER MOVED (035 T055) ──
 *
 * `packages/ui/tests/unit/editor-search-controller.test.ts` now owns
 * `createEditorSearchController` — the join between the matching model and the document, which had
 * no test at any layer. `search-model.test.ts` proved the MATCHING and `search-store.test.ts`
 * proved the BAR; the thing between them was proven only from here.
 *
 * ONE TEST REMOVED: `:131` "match-case and whole-word toggles narrow the matches live (FR-007)".
 *
 * ── 034 DECLINED THIS MIGRATION, AND THE REASON WAS HALF RIGHT ──
 *
 * The note below records why four of five stayed: they assert on `.throng-search-match`
 * decorations, and *"the store test can say the controller was TOLD to clear; only the editor shows
 * that the document stopped drawing them."*
 *
 * Right about the store, wrong about the layer. The decorations are a `StateField`
 * (`editor-search.ts:45`) that provides `EditorView.decorations`, so a decoration set — its ranges
 * AND its classes — exists in the STATE before anything is painted and without a view at all. The
 * component test reads `state.facet(EditorView.decorations)`, which is the value the renderer draws
 * from, and asserts on the offsets as well as the count: three decorations over the wrong text
 * would satisfy the E2E and not it.
 *
 * ── WHAT STAYS, AND WHY EACH ──
 *
 *   :85  the wiring witness — that the decoration set is actually PAINTED as `.throng-search-match`
 *        spans in a rendered document, and that the bar's count agrees with them. jsdom draws
 *        nothing, so no lower layer can see it.
 *   :184 retagged `@reserve:focus`. Its highlight half has moved; what remains is that Escape moves
 *        focus from a DOM input back into a contenteditable such that the next keystroke lands in
 *        the document. The component test can only say `view.focus()` was called.
 *   :158, :209, :248, :334, :357 — selection-seeded input, the SC-007 budget on 10k lines, control
 *        geometry, and block selection. All already reserve-tagged.
 */
/*
 * DELETED (suite audit): "finds as you type, and is a no-op on an untyped panel" and "a ONE-ROW block
 * seeds the find input; a MULTI-ROW block seeds nothing (FR-025i)". Typing/counting/case-insensitivity
 * and the seed rules are `unit/editor-search-controller.test.ts` ("finds every case-insensitive match",
 * "reads EVERY range of a rectangular block", "seeds from a single range even when ... empty ones
 * beside it", "refuses a multi-line fragment"). The painted-span witness stays in "closing find clears
 * the highlights" (count 1 before Escape). The untyped-panel half asserted only the render tree's
 * shape (no FindBar is ever rendered for an untyped panel) and could not fail.
 */
/*
 * DELETED (034 FR-045): "find next / previous step through matches and wrap at both ends".
 *
 * The only test in this file that reads NOTHING but the `find-count` text — no decorations, no
 * measurement. Stepping and wrapping are `packages/ui/tests/unit/search-model.test.ts` ("advances
 * and wraps at the end", "retreats and wraps at the start", "reports a 1-based current index"), and
 * that the bar follows the engine is `search-store.test.ts` ("advances the current match and records
 * the new count").
 *
 * WHY ONLY THIS ONE, when an analysis pass proposed five. The other four all assert on
 * `.throng-search-match` / `.throng-search-match--current` — real CodeMirror decorations in the
 * document, which no unit test touches:
 *   - "finds as you type" counts three highlights and one current mark
 *   - "match-case and whole-word toggles" ends on a decoration count of 1
 *   - "seeds the term from the selection" ends on a decoration count of 0
 *   - "closing find clears the highlights" IS a decoration count going to 0
 * The store test can say the controller was TOLD to clear; only the editor shows that the document
 * stopped drawing them. That distinction is why four of the five stayed.
 */

test('seeds the term from the selection, and shows a no-results state for a miss', { tag: ['@extended', '@editor', '@reserve:input'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-find-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'SeedProj', root);
      const pid = await newEditor(win);
      await typeInto(win, pid, 'needle in haystack\nneedle again\n');

      // Select the word under the caret (double-click), then open find.
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').getByText('haystack').dblclick();
      await pressAction(win, 'search.find');

      await expect(win.getByTestId('find-input')).toHaveValue('haystack');
      await expect(win.getByTestId('find-count')).toHaveText('1 of 1');

      // A term that misses reports no results and changes nothing.
      await win.getByTestId('find-input').fill('zzz-not-here');
      await expect(win.getByTestId('find-count')).toHaveText('No results');
      await expect(matches(win, pid)).toHaveCount(0);
      expect(await docText(win, pid)).toContain('needle in haystack');
    });
  } finally {
    cleanupTemp(root);
  }
});

test('closing find clears the highlights and returns focus to the editor', { tag: ['@extended', '@editor', '@reserve:focus'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-find-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'CloseProj', root);
      const pid = await newEditor(win);
      await typeInto(win, pid, 'close me\n');

      await pressAction(win, 'search.find');
      await win.getByTestId('find-input').fill('close');
      await expect(matches(win, pid), 'the term is highlighted before closing').toHaveCount(1);

      await win.keyboard.press('Escape');
      await expect(win.getByTestId(`find-bar-${pid}`), 'Escape closes the find bar').toHaveCount(0);
      await expect(matches(win, pid), 'closing find clears the highlights').toHaveCount(0);

      // Focus is back in the content: typing goes into the document.
      await win.keyboard.type('!');
      expect(await docText(win, pid), 'focus is back in the editor after Escape').toContain('!');
    });
  } finally {
    cleanupTemp(root);
  }
});

test('renders results within the 1000 ms budget on a ~10k-line file (SC-007)', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-find-'));
  try {
    // The SC-007 representative fixture: ~10k lines, 20 of them matching.
    const lines: string[] = [];
    for (let i = 0; i < 10000; i++) lines.push(i % 500 === 0 ? `needle line ${i}` : `line ${i}`);
    writeFileSync(join(root, 'big.txt'), lines.join('\n'), 'utf8');

    await runApp(async (_app, win) => {
      await createProject(win, 'PerfProj', root);
      const pid = await newEditor(win);
      await win.getByTestId(`editor-${pid}`).click();

      // Open it the way a user would, so the measurement is of the real editor.
      await win.getByTestId('file-explorer-tree').getByText('big.txt', { exact: true }).click();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
        'needle line 0',
        { timeout: 15000 },
      );

      // Clicking the tree made the Files pane active, and find is a PANEL command —
      // so put the workspace back in focus first (the same gate as Ctrl+S).
      await focusEditor(win, pid);
      await pressAction(win, 'search.find');
      const started = Date.now();
      await win.getByTestId('find-input').fill('needle');
      // All 20 matches must resolve. WHICH one is current depends on where the caret
      // sits (find starts from the caret), so only the total is pinned here.
      await expect(win.getByTestId('find-count')).toHaveText(/^\d+ of 20$/, { timeout: 5000 });
      const elapsed = Date.now() - started;

      // The debounce plus the search itself must land inside the SC-007 budget.
      expectWithinSla(test.info(), {
        what: 'find resolves all matches on a 10k-line file',
        requirement: 'SC-007',
        elapsedMs: elapsed,
        budgetMs: 1000,
      });
    });
  } finally {
    cleanupTemp(root);
  }
});

test('every find-bar action control is the same size, and the match toggles draw their icons', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-find-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'ChromeProj', root);
      const pid = await newEditor(win);
      await typeInto(win, pid, 'sizing\n');

      await pressAction(win, 'search.replace'); // find WITH replace, so every control is up
      await expect(win.getByTestId(`find-bar-${pid}`)).toBeVisible();
      await expect(win.getByTestId('find-replace-row')).toBeVisible();

      // The toggles draw what they match on: the icon set's matchCase and wholeWord art (069), no text beside it.
      for (const id of ['find-match-case', 'find-whole-word']) {
        await expect(win.getByTestId(id).locator('.icon svg')).toHaveCount(1);
        await expect(win.getByTestId(id)).toHaveText(/^\s*$/);
      }

      // The glyphs vary wildly in width (an emoji, arrows, two letters), so the BUTTONS
      // must be a fixed box — otherwise the bar's controls come out ragged.
      const ids = [
        'find-match-case',
        'find-whole-word',
        'find-previous',
        'find-next',
        'find-close',
        'replace-current',
        'replace-all',
      ];
      const boxes = await Promise.all(
        ids.map(async (id) => {
          const box = await win.getByTestId(id).boundingBox();
          return { id, w: Math.round(box?.width ?? -1), h: Math.round(box?.height ?? -1) };
        }),
      );
      const first = boxes[0]!;
      expect(first.w).toBeGreaterThan(0);
      for (const b of boxes) {
        expect(b, `${b.id} is not the same size as ${first.id}`).toEqual({
          id: b.id,
          w: first.w,
          h: first.h,
        });
      }
    });
  } finally {
    cleanupTemp(root);
  }
});
