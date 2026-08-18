import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { openApp, runApp as runOwnApp, createProject as newProject, firstPanelId, cleanupTemp, type AppOptions, type OpenApp, focusEditor } from './harness.js';

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
const currentMatch = (win: Page, pid: string) =>
  win.getByTestId(`editor-${pid}`).locator('.throng-search-match--current');

test('finds as you type: highlights every match, marks the current one, counts them', { tag: ['@extended', '@editor'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-find-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'FindProj', root);
      const pid = await newEditor(win);
      await typeInto(win, pid, 'alpha beta\nalpha gamma\nALPHA delta\n');

      await win.keyboard.press('Control+f');
      await expect(win.getByTestId(`find-bar-${pid}`)).toBeVisible();

      await win.getByTestId('find-input').fill('alpha');

      // Case-insensitive by default ⇒ all three, highlighted incrementally.
      await expect(matches(win, pid)).toHaveCount(3);
      await expect(currentMatch(win, pid)).toHaveCount(1);
      await expect(win.getByTestId('find-count')).toHaveText('1 of 3');

      // Searching never edits the file (SC-001).
      expect(await docText(win, pid)).toContain('alpha beta');
    });
  } finally {
    cleanupTemp(root);
  }
});

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

test('match-case and whole-word toggles narrow the matches live (FR-007)', { tag: ['@extended', '@editor'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-find-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'ModesProj', root);
      const pid = await newEditor(win);
      await typeInto(win, pid, 'foo Foo food\n');

      await win.keyboard.press('Control+f');
      await win.getByTestId('find-input').fill('foo');
      // foo, Foo, foo(d) — case-insensitive substring.
      await expect(win.getByTestId('find-count')).toHaveText('1 of 3');

      await win.getByTestId('find-match-case').click();
      // foo, foo(d) — 'Foo' drops out.
      await expect(win.getByTestId('find-count')).toHaveText('1 of 2');

      await win.getByTestId('find-whole-word').click();
      // only the standalone 'foo' survives.
      await expect(win.getByTestId('find-count')).toHaveText('1 of 1');
      await expect(matches(win, pid)).toHaveCount(1);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('seeds the term from the selection, and shows a no-results state for a miss', { tag: ['@extended', '@editor'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-find-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'SeedProj', root);
      const pid = await newEditor(win);
      await typeInto(win, pid, 'needle in haystack\nneedle again\n');

      // Select the word under the caret (double-click), then open find.
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').getByText('haystack').dblclick();
      await win.keyboard.press('Control+f');

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

test('closing find clears the highlights and returns focus to the editor', { tag: ['@extended', '@editor'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-find-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'CloseProj', root);
      const pid = await newEditor(win);
      await typeInto(win, pid, 'close me\n');

      await win.keyboard.press('Control+f');
      await win.getByTestId('find-input').fill('close');
      await expect(matches(win, pid)).toHaveCount(1);

      await win.keyboard.press('Escape');
      await expect(win.getByTestId(`find-bar-${pid}`)).toHaveCount(0);
      await expect(matches(win, pid)).toHaveCount(0);

      // Focus is back in the content: typing goes into the document.
      await win.keyboard.type('!');
      expect(await docText(win, pid)).toContain('!');
    });
  } finally {
    cleanupTemp(root);
  }
});

test('renders results within the 1000 ms budget on a ~10k-line file (SC-007)', { tag: ['@extended', '@editor'] }, async () => {
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
      await win.keyboard.press('Control+f');
      const started = Date.now();
      await win.getByTestId('find-input').fill('needle');
      // All 20 matches must resolve. WHICH one is current depends on where the caret
      // sits (find starts from the caret), so only the total is pinned here.
      await expect(win.getByTestId('find-count')).toHaveText(/^\d+ of 20$/, { timeout: 5000 });
      const elapsed = Date.now() - started;

      // The debounce plus the search itself must land inside the SC-007 budget.
      expect(elapsed, `find took ${elapsed}ms on a 10k-line file`).toBeLessThan(1000);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('every find-bar action control is the same size, and match-case reads "Aa"', { tag: ['@extended', '@editor'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-find-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'ChromeProj', root);
      const pid = await newEditor(win);
      await typeInto(win, pid, 'sizing\n');

      await win.keyboard.press('Control+h'); // find WITH replace, so every control is up
      await expect(win.getByTestId(`find-bar-${pid}`)).toBeVisible();
      await expect(win.getByTestId('find-replace-row')).toBeVisible();

      // The toggles say what they match on.
      await expect(win.getByTestId('find-match-case')).toHaveText('Aa');
      await expect(win.getByTestId('find-whole-word')).toHaveText('ab');

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

test('find is a no-op when no panel is active (spec Edge Cases)', { tag: ['@extended', '@editor'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-find-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'NoPanelProj', root);
      const pid = await firstPanelId(win);
      // An unconfigured panel has no type — nothing to search.
      await win.keyboard.press('Control+f');
      await expect(win.getByTestId(`find-bar-${pid}`)).toHaveCount(0);
    });
  } finally {
    cleanupTemp(root);
  }
});

/**
 * 016 FR-025i · T082 — seed-from-selection meets the new selection kinds.
 *
 * The failure these guard against is a silent one: seeding from `selection.main` pre-fills the find
 * input with SOMETHING that plainly came from the selection, so it looks like it worked — while
 * actually searching for one arbitrary row of the user's block.
 */

test('a ONE-ROW block seeds the find input; a MULTI-ROW block seeds nothing (FR-025i)', { tag: ['@extended', '@editor'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-find-'));
  try {
    /*
     * Its OWN app, not the file's shared one.
     *
     * 013 deliberately keeps the find term across a re-open on the same panel, so this test's
     * subject IS persistent find state — and a shared app carries the previous tests' term and
     * selection into it. It passes alone and fails in file order, which is the signature of leaked
     * state rather than a broken feature.
     */
    await runOwnApp(async (_app, win) => {
      await createProject(win, 'SeedProj', root);
      const pid = await newEditor(win);
      await typeInto(win, pid, 'alpha\nbeta\ngamma\n');

      // Establish a term, so "seeds nothing" is distinguishable from "seeds empty". The bar stays
      // OPEN throughout: 013 keeps the term across a re-open on the same panel, and clears it on a
      // close — so a close here would destroy the very thing this asserts is preserved.
      await win.keyboard.press('Control+f');
      await win.getByTestId('find-input').fill('gamma');
      /*
       * Wait for the term to reach the STORE, not just the input.
       *
       * `find-bar.tsx` commits the typed value with a debounce — `setTimeout(() => setTerm(input),
       * debounceMs)` — and the effect's cleanup CANCELS that timer. The bar also unmounts when it
       * closes (`if (!open) return null`). So a bar that closes inside the debounce window never
       * commits the term at all: the input showed "gamma" the whole time, the store still holds "",
       * and the re-open below reads back "".
       *
       * That is what CI failed on (runs 31029008160 and 31030655886, shard 2): `Expected "gamma",
       * Received ""` at the re-open. Asserting the INPUT's value here proves nothing — it is local
       * component state, and it is the state that is about to be thrown away. `find-count` is
       * rendered from `state.term`, so it only reads "1 of 1" once `setTerm` has actually run, which
       * is the precondition this test's subject depends on.
       */
      await expect(win.getByTestId('find-count')).toHaveText('1 of 1');

      // A MULTI-ROW block seeds NOTHING — find keeps the term it had, exactly as 013 already does
      // for a multi-line selection. It must never pick one row of the block.
      await focusEditor(win, pid);
      await win.keyboard.press('Control+Home');
      await win.keyboard.press('Shift+Alt+ArrowDown');
      await win.keyboard.press('Shift+Alt+ArrowDown');
      await win.keyboard.press('Shift+Alt+ArrowRight');
      await win.keyboard.press('Shift+Alt+ArrowRight');
      await win.keyboard.press('Control+f');
      await expect(win.getByTestId('find-input')).toHaveValue('gamma');

      // A ONE-ROW block — indistinguishable from an ordinary selection, so it DOES seed.
      await focusEditor(win, pid);
      await win.keyboard.press('Control+Home');
      await win.keyboard.press('Shift+Alt+ArrowRight');
      await win.keyboard.press('Shift+Alt+ArrowRight');
      await win.keyboard.press('Control+f');
      await expect(win.getByTestId('find-input')).toHaveValue('al');

      // …and the document is untouched by any of it (013 FR-003).
      expect(await docText(win, pid)).toContain('alpha');
    });
  } finally {
    cleanupTemp(root);
  }
});
