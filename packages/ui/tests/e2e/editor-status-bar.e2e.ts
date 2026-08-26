/**
 * The editor status bar's readouts, in a real window (040 US1 — FR-001, FR-014, FR-020; AS2a,
 * SC-002).
 *
 * ══ WHY EXACTLY TWO TESTS, AND WHY THESE TWO ══
 *
 * Almost everything about the readouts is proved cheaper. The counting rules are pure and are
 * `core/tests/unit/document-metrics.test.ts`. The two stores' key scopes and the 200 ms debounce are
 * `ui/tests/unit/caret-store.test.ts` and `document-metrics-store.test.ts`. That a caret move does
 * not report a phantom edit to the document authority is `component/editor-update-listener.test.ts`,
 * against a real CodeMirror view in jsdom. What each readout SAYS, and which alignment group it
 * belongs to, is `component/status-strip-readouts.test.ts`.
 *
 * Two things are left, and neither has a cheaper home:
 *
 *   1. **Real input.** jsdom has no hit-testing, so a click at a point in the text resolves to no
 *      document position; `EditorSelection.cursor(11)` in a component test is the ANSWER asserted,
 *      not the gesture. FR-001 names a pointer click, an arrow key and an undo specifically, and an
 *      undo here is a round trip through the document authority in UI main.
 *   2. **Real layout.** jsdom reports every rect as 0×0. "One line high", "the text area's height
 *      does not move" and "the two groups do not overlap" are measurements, and a component test
 *      that asserted them would be asserting zeros.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp, geom } from './harness.js';

/**
 * Three lines, and every figure it produces is distinctive.
 *
 * 23 characters — 20 on the lines plus the three line breaks, each one character (FR-003a, as
 * reversed on 2026-08-25; this read 20 before) — and 4 words. Neither is a number the bar could
 * arrive at by accident, and both differ from the line and column figures beside them.
 */
const DOC = 'alpha\nbeta gamma\ndelta\n';

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-statusbar-'));
  writeFileSync(join(root, 'note.txt'), DOC);
  return root;
}

/** An editor panel with `note.txt` open in it. */
async function openNote(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  await win.getByTestId(`editor-${pid}`).click();
  await win.getByTestId('file-explorer-tree').getByText('note.txt', { exact: true }).click();
  await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('gamma', {
    timeout: 8000,
  });
  return pid;
}

const readout = (win: Page, id: string, pid: string) =>
  win.getByTestId(`editor-status-${id}-${pid}`);

/**
 * How far an element's CONTENT reaches past its own box, in px — `0` when nothing is clipped.
 *
 * The reading `getBoundingClientRect()` cannot give. Both groups on the bar declare `min-width: 0`,
 * so a group that is asked for more than it is given simply shrinks: its box measures as fitting
 * whatever it is overflowing with, and every geometric assertion about that box passes while the
 * language indicator is ellipsised under readouts painting over it.
 */
function contentOverflow(win: Page, testId: string): Promise<number> {
  return win.evaluate((id) => {
    const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    return el ? el.scrollWidth - el.clientWidth : -1;
  }, testId);
}

/** Resize the real OS window and let the renderer settle. */
async function setWindowWidth(app: ElectronApplication, width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, w) => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    // A maximized window ignores `setContentSize`, and the test would then measure one width twice
    // and pass without ever having resized anything.
    if (win.isMaximized()) win.unmaximize();
    const [, height] = win.getContentSize();
    win.setContentSize(w, height);
  }, width);
}

/* ────────────────────────────────────────────────────────────────────────── *
 * (1) The readouts follow real input
 * ────────────────────────────────────────────────────────────────────────── */

test('the readouts follow a real click, real arrow keys and a real undo, and survive a language change', { tag: ['@core', '@editor', '@reserve:input'] }, async () => {
  const root = makeProject();
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'StatusProj', root);
      /*
       * WIDEN FIRST. Every assertion below names an exact FULL label form — `23 chars`, `4 words`,
       * `Ln 2`, `2 selected` — and US2's whole subject is that those forms give way as the bar
       * narrows. At whatever width the app happens to open at, both side panes clamp and the panel
       * gets roughly 400px of bar, so this test was passing on the luck of the hide order rather
       * than by construction: a change to a label, a font, or the pane clamps could shorten `chars`
       * to `ch` and fail a test that is about none of those things.
       *
       * 1400 is the width the layout declaration below already uses for "entirely uncrowded".
       */
      await setWindowWidth(app, 1400);
      const pid = await openNote(win);

      // The document's own figures, once the debounced count has settled (FR-008b).
      await expect(readout(win, 'chars', pid)).toHaveText('23 chars');
      await expect(readout(win, 'words', pid)).toHaveText('4 words');
      await expect(
        readout(win, 'chars', pid),
        'and at their FULL label form, which is what every literal above assumes',
      ).toHaveAttribute('data-label', 'full');

      /*
       * A POINTER CLICK. CodeMirror resolves the click point to a document position through real
       * hit-testing over rendered text — there is no jsdom equivalent, which is the whole of this
       * test's `@reserve:input` claim. Clicking the second rendered line must put the caret on
       * line 2, and the readout must say so.
       */
      await win.getByTestId(`editor-${pid}`).locator('.cm-line').nth(1).click();
      await expect(readout(win, 'line', pid)).toHaveText('Ln 2');

      // ARROW KEYS. A caret move changes no document, so this is exactly the update that the
      // listener used to early-return on (research.md D1).
      await win.keyboard.press('Home');
      await expect(readout(win, 'column', pid)).toHaveText('Col 1');
      await win.keyboard.press('ArrowRight');
      await win.keyboard.press('ArrowRight');
      await expect(readout(win, 'column', pid)).toHaveText('Col 3');
      await win.keyboard.press('ArrowUp');
      await expect(readout(win, 'line', pid)).toHaveText('Ln 1');

      // A SELECTION appears, and only while there is one (FR-005).
      await expect(readout(win, 'selected', pid)).toHaveCount(0);
      await win.keyboard.press('Shift+ArrowRight');
      await win.keyboard.press('Shift+ArrowRight');
      await expect(readout(win, 'selected', pid)).toHaveText('2 selected');
      await win.keyboard.press('ArrowRight');
      await expect(readout(win, 'selected', pid), 'a bare caret shows nothing, never 0').toHaveCount(
        0,
      );

      // A REAL EDIT moves the counts… (one character, so the undo below is unambiguously one
      // entry rather than depending on how a typing run happened to coalesce.)
      await win.keyboard.type('Z');
      await expect(readout(win, 'chars', pid)).toHaveText('24 chars');

      /*
       * …and a REAL UNDO puts them back. Undo is not CodeMirror's here: `history()` is gone and the
       * chord asks the document AUTHORITY in UI main to revert, which broadcasts the canonical
       * change back to this view (016 FR-026c). Nothing below E2E has that round trip.
       */
      await win.keyboard.press('Control+z');
      await expect(readout(win, 'chars', pid)).toHaveText('23 chars');

      /*
       * AS2a — a language change does not move the caret, so the readouts must simply survive it.
       * The picker re-highlights the whole document, which is the moment a naive implementation
       * resets the position to line 1.
       */
      const before = {
        line: await readout(win, 'line', pid).textContent(),
        column: await readout(win, 'column', pid).textContent(),
      };
      await win.getByTestId(`editor-language-${pid}`).click();
      await win.getByTestId('language-option-sql').click();
      await expect(win.getByTestId(`editor-language-${pid}`)).toHaveText('SQL');

      expect(await readout(win, 'line', pid).textContent()).toBe(before.line);
      expect(await readout(win, 'column', pid).textContent()).toBe(before.column);
    });
  } finally {
    cleanupTemp(root);
  }
});

/* ────────────────────────────────────────────────────────────────────────── *
 * (2) The measurements jsdom cannot make
 * ────────────────────────────────────────────────────────────────────────── */

test('the bar stays one line high and the two groups never overlap across a resize', { tag: ['@core', '@editor', '@reserve:layout'] }, async () => {
  const root = makeProject();
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'StatusProj', root);
      const pid = await openNote(win);
      await expect(readout(win, 'chars', pid)).toHaveText('23 chars');

      const strip = win.getByTestId(`editor-status-strip-${pid}`);
      const text = win.getByTestId(`editor-${pid}`);
      const leading = win.getByTestId(`editor-status-readouts-${pid}`);
      const trailing = win.getByTestId(`editor-status-controls-${pid}`);

      /**
       * One line of 11px text inside a strip whose rule declares `min-height: 20px`. A bar that
       * WRAPPED would be at least twice this, so the bound distinguishes the two outcomes with
       * room to spare — it is not a pixel-perfect assertion about the current typography.
       */
      const ONE_LINE_MAX = 28;

      /**
       * Height of the bar, height of the text area, the gap between the two groups — and how far
       * each group's CONTENT reaches past its own box.
       *
       * The last two are what turn a box measurement into a claim about what the user sees. `gap`
       * alone cannot fail the way FR-014 fails: both groups shrink, so a bar whose content does not
       * fit reports two boxes that sit neatly side by side, and the overflow is entirely invisible
       * to `getBoundingClientRect`.
       */
      const measure = async () => {
        const [bar, area, left, right, leadOver, trailOver] = await Promise.all([
          geom(strip),
          geom(text),
          geom(leading),
          geom(trailing),
          contentOverflow(win, `editor-status-readouts-${pid}`),
          contentOverflow(win, `editor-status-controls-${pid}`),
        ]);
        return {
          bar: bar.h,
          area: area.h,
          gap: right.x - (left.x + left.w),
          leadOver,
          trailOver,
        };
      };

      // Wide. The window opens well above the 600px minimum; 1400 leaves the bar entirely
      // uncrowded, which is the baseline the narrow measurement is compared against.
      await setWindowWidth(app, 1400);
      const wide = await measure();
      expect(wide.bar, 'the bar must be one line high').toBeLessThanOrEqual(ONE_LINE_MAX);
      expect(wide.gap, 'the readouts must not overlap the language and wrap controls (FR-014)').toBeGreaterThanOrEqual(0);
      expect(
        wide.trailOver,
        'the language and wrap controls must not be clipped by readouts that claimed their space (FR-014)',
      ).toBeLessThanOrEqual(1);
      expect(wide.leadOver, 'nor may the readouts overflow their own group').toBeLessThanOrEqual(1);

      /*
       * Narrow. 900 rather than the 600px window minimum: what happens once the content genuinely
       * cannot fit is US2's hide order, with its own tests. What THIS asserts is FR-020 and SC-002 —
       * that a horizontal drag never changes the height of the bar or of the text area, which is
       * the thing a horizontal drag has no business touching.
       */
      await setWindowWidth(app, 900);
      const narrow = await measure();
      expect(narrow.bar, 'the bar must not wrap onto a second line').toBe(wide.bar);
      expect(narrow.area, 'the text area height must not move (SC-002)').toBe(wide.area);
      expect(narrow.gap, 'the groups must not overlap at a narrower width either').toBeGreaterThanOrEqual(0);
      expect(
        narrow.trailOver,
        'and the controls must still not be clipped once the bar is under pressure (FR-014)',
      ).toBeLessThanOrEqual(1);
      expect(narrow.leadOver).toBeLessThanOrEqual(1);

      // …and back. A height that returned to something else would mean the first two measurements
      // agreed by accident.
      await setWindowWidth(app, 1400);
      const again = await measure();
      expect(again.bar).toBe(wide.bar);
      expect(again.area).toBe(wide.area);
      expect(again.gap).toBeGreaterThanOrEqual(0);
    });
  } finally {
    cleanupTemp(root);
  }
});
