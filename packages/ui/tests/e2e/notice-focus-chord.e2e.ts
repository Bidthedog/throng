/**
 * 041 FR-020a (#314) — `focus.notice` resolves while a REAL SHELL holds the keyboard.
 *
 * ══ WHY THIS ONE IS AN E2E AND THE REST OF #314 IS NOT ══
 *
 * Every other claim about `focus.notice` — that it is idempotent (FR-020d), that an arriving notice
 * does not steal focus (FR-020e), that Escape returns to the origin (FR-022/FR-022a), that the list
 * carries its affordance in the markup (FR-021, FR-025a) — is focus movement inside one surface, and
 * `packages/ui/tests/component/notice-focus.test.ts` asserts all of it in jsdom in milliseconds.
 *
 * What no cheaper layer can observe is that a TERMINAL did not swallow the chord. A terminal panel
 * forwards nearly everything to its shell on purpose, so a binding in the wrong scope is eaten and
 * the notice is unreachable in exactly the place FR-020a says it is most likely to appear. Only a
 * real ConPTY with a real keyboard can answer that: xterm's hidden textarea holds the keystroke, and
 * whether the application ever sees it is decided by the shipped `Everywhere` scope in the app the
 * installer produces, not by the constant `keybindings-focus-notice.test.ts` reads out of source.
 *
 * That distinction is not theoretical here. `packages/core` is consumed as SOURCE by vitest and as
 * `dist` by Electron, and this feature has already had a run where every unit test agreed the scope
 * was `Everywhere` while the app booted from a stale `dist` that said `EDITOR_ONLY`. The unit test
 * guards the decision; this guards the artifact.
 *
 * ══ WHAT THIS REPLACES, AND WHY IT HAD TO BE REPLACED (T062) ══
 *
 * This test began life inside `window-chord-resolution.e2e.ts`, where it focused an EDITOR, pressed
 * the chord with NO notice on screen, and asserted the editor still had focus. Read against
 * FR-029 — assert the observable outcome, not the shape of the code — that is vacuous: an inert
 * binding, a binding deleted outright, and a correctly-scoped one all leave the editor focused and
 * the notice stack empty. It could not fail for the reason it claimed, and its own comment claimed a
 * focused terminal it never created.
 *
 * So the shell is real here, the notice is real, and the assertion is that focus MOVED — which is
 * false in every world where the chord does not resolve.
 *
 * ══ WHY IT IS ITS OWN FILE ══
 *
 * `035 FR-016b` gives a test ONE reserve entry, and the two files that already hold this state hold
 * it under a different one: `notice-consolidation.e2e.ts` is `@reserve:window` and
 * `project-missing-root-wedge.e2e.ts` is `@reserve:runtime`. Bundling a keyboard assertion into
 * either would make it assert two things. `editor-command-scope.e2e.ts` — the negative half of this
 * same story, where EDITOR-scoped commands correctly do NOT fire over a terminal — shares an app
 * across its tests, and the tab dance below would leave that app changed underneath them.
 *
 * The chord's manifest coverage therefore names this file, in `window-chords.ts`'s
 * `COVERED_ELSEWHERE`, which `window-chord-manifest.test.ts` checks by reading the press out of the
 * code with comments stripped. `Control+Alt+M` is written as a literal for that guard's benefit: a
 * changed default (FR-020b) makes this test press the wrong key and fail loudly, which is the same
 * answer the derived spelling would have given.
 *
 * ══ TIER: SERIAL ══
 *
 * `parallel-plan.json` lists it as CPU. A real `cmd` starves at high worker counts, which is the
 * same reason `notice-consolidation.e2e.ts` and `notice-subjects.e2e.ts` are serial.
 *
 * ══ THE DECLARATION IS ONE LINE, AND IT HAS TO BE ══
 *
 * `e2e-budget.test.ts` counts categories with a PER-LINE regex that wants the name and the `{ tag: […] }`
 * on the same line as `test(`. Wrapped across four lines — which is what a formatter does to a
 * declaration this long — the test is still counted in the total but its tags are invisible, so it
 * belongs to no category at all. Measured: `@window` read 191 against a budget of 192 while the total
 * was correct, which is a confusing failure to arrive at from the other direction.
 */
import { mkdtempSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, panelIds, addPanels, cleanupTemp } from './harness.js';

/** Which element the keyboard is actually in, as a test-id — `''` when it is nowhere useful. */
const focusedTestId = (win: Page): Promise<string> =>
  win.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');

test('the notice chord reaches the app while a real shell has the keyboard', { tag: ['@extended', '@window', '@reserve:input'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-noticechord-'));
  writeFileSync(join(root, 'doc.txt'), 'alpha\n');

  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'ChordNotice', root);
      await addPanels(win, 1);
      const [editorPanel, terminalPanel] = await panelIds(win);

      // ── An editor holding a real file, and a REAL cmd beside it in the same tab. ───────────
      await win.getByTestId(`panel-type-select-${editorPanel}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${editorPanel}`).click();
      await win.getByTestId('file-explorer-tree').getByText('doc.txt', { exact: true }).click();
      await expect(win.getByTestId(`editor-${editorPanel}`).locator('.cm-content')).toContainText(
        'alpha',
        { timeout: 8000 },
      );

      await win.getByTestId(`panel-type-select-${terminalPanel}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${terminalPanel}`).click();
      await expect(win.getByTestId(`terminal-${terminalPanel}`)).toContainText(basename(root), {
        timeout: 30_000,
      });

      /*
       * ── A NOTICE WORTH REACHING ──
       *
       * The file goes away underneath the open editor. It must be a notice that CARRIES A CASUALTY
       * LIST: `focusMostRecentNotice` targets `[data-testid="notice-affected"]`, so a plain
       * sentence-and-Dismiss notice — a rename collision, say — offers the chord nothing to land
       * on and would make this test pass or fail for a reason that is not the scope.
       *
       * The editor must have LEARNED the file is gone before the tab is re-selected: the scan that
       * raises the notice runs once, on tab activation, and reads `fileMissing` as it finds it.
       * `panel-unsaved-` is that signal — the editor is dirty precisely because the file went away
       * under it, and `markDeleted` sets both in the same pass. Waiting on it is what stops this
       * racing the watcher, which is the trap `editor-missing-aggregate.e2e.ts` measured.
       */
      unlinkSync(join(root, 'doc.txt'));
      await expect(win.getByTestId(`panel-unsaved-${editorPanel}`)).toBeVisible({
        timeout: 15_000,
      });

      await win.getByTestId('tab-add').click();
      await win.locator('.tab-chip').first().click();
      const list = win.getByTestId('notice-affected');
      await expect(list).toHaveCount(1, { timeout: 15_000 });

      // ── Put the keyboard in the SHELL, and prove that is where it is. ─────────────────────
      await win.getByTestId(`terminal-${terminalPanel}`).click();
      expect(
        await focusedTestId(win),
        'the keyboard never reached the terminal — the press below would prove nothing',
      ).not.toBe('notice-affected');

      /*
       * ── The whole claim: the chord resolves THROUGH a focused terminal. ──────────────────
       *
       * FR-020b's shipped default, written INLINE as a literal rather than through a named
       * constant. `window-chord-manifest.test.ts` reads this file with its comments stripped and
       * looks for `keyboard.press('Control+Alt+M')`, because the exemption it is checking exists
       * to point at a keystroke — measured: a `press(CHORD)` indirection failed that guard, which
       * is the guard being right rather than fussy.
       *
       * A changed default therefore makes this press the wrong key and fail loudly, which is the
       * same answer deriving it from the shipped bindings would have given.
       */
      await win.keyboard.press('Control+Alt+M');
      await expect(
        list,
        'the shell swallowed the chord, or it resolved to nothing — focus never reached the notice',
      ).toBeFocused({ timeout: 10_000 });
    });
  } finally {
    cleanupTemp(root);
  }
});
