/**
 * 033 US2 (#219) — Go To Line: the chord, the modal, and the line the GUTTER draws.
 *
 * Covers AS-1 to AS-9 and AS-12 of the spec, G1, G2, G6–G8 and G10 of
 * `contracts/navigation-modals.md §5`, FR-066, and SC-006 and SC-007.
 *
 * ══ THE GUTTER IS THE ASSERTION, NOT THE DOCUMENT OFFSET ══
 *
 * SC-006 is explicit: the line reached is "asserted against the gutter's RENDERED number rather than
 * an internal document offset". Reading `doc.line(n)` back and comparing it with `n` is a tautology —
 * it would pass in a world where the gutter drew something else entirely, which is the exact failure
 * FR-021 names. So {@link caretReadout} measures the caret's rectangle, finds the `.cm-gutterElement`
 * whose box vertically contains it, and returns THAT element's text. Every value the assertions below
 * read is a rendered pixel or a rendered string.
 *
 * It is asserted for a WRAPPED document as well as an unwrapped one, because wrapping is the only
 * case where visual rows and logical lines disagree — an implementation that scrolled by visual row
 * would pass the unwrapped half and fail the other.
 *
 * ══ WHAT IS DELIBERATELY NOT HERE ══
 *
 * **No wall-clock ceiling anywhere.** This spec is registered in the PARALLEL tier (T043), and a
 * timed assertion at several workers measures the machine's contention rather than the feature.
 *
 * **The content-menu item (FR-027, G9) is not here**, and neither is AS-10's Key Bindings row. Both
 * live in `goto-line-keybinding.e2e.ts`: driving a context menu and opening the preferences window
 * each steal focus from other headed windows, so a spec doing either has to run in the SERIAL tier,
 * and keeping this file out of it is what lets nine tests run concurrently. FR-027 also belongs
 * beside the rebind on its own merits — "showing its current chord" is only a claim about anything
 * once the chord has changed.
 *
 * ══ TEST IDS ══
 *
 * `contracts/picker-extensions.md §5`'s prefix convention governs Go To Line's ids too, and
 * `helpers/navigation.ts` already fixes them: `gotoline` for the dialog card, `gotoline-input` for
 * the field, `gotoline-overlay` for the scrim.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  firstPanelId,
  settle,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';
import { GOTO_LINE_CHORD, QUICK_OPEN_CHORD, openGotoLine } from './helpers/navigation.js';

/*
 * ONE app for this file, not one per test — every launch is an Electron process, a daemon and a
 * window, around two seconds apiece. No test here seeds state before launch, so none needs its own.
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
  fn: (app: OpenApp['app'], win: OpenApp['win']) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win);
};

/** A shared app accumulates projects, and duplicate names make `.project-item` ambiguous. */
let projectSeq = 0;
const createProject = (win: Page, name: string, root: string): Promise<void> =>
  newProject(win, `${name}-${(projectSeq += 1)}`, root);

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Fixtures
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

const LINE_COUNT = 400;

/**
 * The LAST line of these files is line 401, and it is empty.
 *
 * Both fixtures end with a newline, as a text file should — and a trailing newline means the
 * document has one more line than it has lines of text. Measured, not assumed: the first version of
 * this file expected `400` from a jump past the end and the gutter drew `401`, which is the editor
 * being right about a file the test was wrong about. Naming it here rather than trimming the newline
 * keeps the fixture a normal file and makes "the last line" mean what it means on disk.
 */
const LAST_LINE = LINE_COUNT + 1;

/** Line `n` reads `line-NNNN`, so the RENDERED text of a line names its own number. */
const marker = (n: number): string => `line-${String(n).padStart(4, '0')}`;

/**
 * A project holding two files, both far longer than a screen.
 *
 * `plain.txt` is short lines throughout — with wrap off, one logical line is one visual row.
 * `wrapped.txt` gives its first twenty lines six hundred trailing characters each, so with wrap ON
 * those twenty logical lines occupy many times twenty visual rows. That is the whole point of the
 * second file: an implementation that counted visual rows would land correctly in `plain.txt` and
 * wrongly here, and only SC-006's second half would catch it.
 */
function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-goto-'));
  const plain: string[] = [];
  const wrapped: string[] = [];
  for (let n = 1; n <= LINE_COUNT; n += 1) {
    plain.push(marker(n));
    wrapped.push(n <= 20 ? `${marker(n)} ${'w'.repeat(600)}` : marker(n));
  }
  writeFileSync(join(root, 'plain.txt'), plain.join('\n') + '\n', 'utf8');
  writeFileSync(join(root, 'wrapped.txt'), wrapped.join('\n') + '\n', 'utf8');
  return root;
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Reading the rendered editor
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

interface CaretReadout {
  /** The text of the `.cm-gutterElement` that vertically contains the caret. SC-006's subject. */
  gutter: string;
  /** The rendered text of the `.cm-line` the caret sits on. */
  lineText: string;
  /** The caret is at the line's left edge — "the first column", measured rather than inferred. */
  atFirstColumn: boolean;
  /** The caret lies inside the scroller's visible box — G1's "scrolls that line into view". */
  inView: boolean;
  /** The caret's rectangle, so a test can assert that NOTHING moved. */
  caret: { x: number; y: number };
}

/**
 * What the editor is actually drawing beside the caret.
 *
 * Everything here comes off the DOM: the caret's own rectangle, the gutter element whose box contains
 * it, and the line element whose box contains it. The CodeMirror state is never consulted, because a
 * state-derived answer cannot tell "went to line 212" from "drew 212 beside some other line" — and
 * the second is precisely what FR-021 exists to forbid.
 *
 * The gutter's SPACER is excluded by its computed visibility: `@codemirror/view` renders one hidden
 * `.cm-gutterElement` carrying the widest line number, and it would otherwise match every caret.
 */
async function caretReadout(win: Page, panelId: string): Promise<CaretReadout> {
  return win.getByTestId(`editor-${panelId}`).evaluate((root) => {
    const caret = root.querySelector('.cm-cursor-primary') as HTMLElement | null;
    if (!caret) throw new Error('no caret is drawn — is the editor focused?');
    const cr = caret.getBoundingClientRect();
    if (cr.height === 0) throw new Error('the caret is drawn with zero height — the view is blurred');
    const mid = cr.top + cr.height / 2;

    const boxed = (
      selector: string,
    ): { text: string; rect: DOMRect; paddingLeft: number } | null => {
      const hits = Array.from(root.querySelectorAll(selector))
        .map((el) => {
          const style = getComputedStyle(el);
          return {
            text: (el.textContent ?? '').trim(),
            rect: el.getBoundingClientRect(),
            paddingLeft: parseFloat(style.paddingLeft) || 0,
            hidden: style.visibility === 'hidden',
          };
        })
        .filter((c) => !c.hidden && c.rect.height > 0 && mid >= c.rect.top && mid <= c.rect.bottom);
      return hits[0] ?? null;
    };

    const gutter = boxed('.cm-gutters .cm-gutterElement');
    const line = boxed('.cm-content .cm-line');
    if (!gutter) throw new Error(`no gutter element beside the caret at y=${mid}`);
    if (!line) throw new Error(`no line element beside the caret at y=${mid}`);

    const scroller = root.querySelector('.cm-scroller') as HTMLElement;
    const sr = scroller.getBoundingClientRect();

    return {
      gutter: gutter.text,
      // CodeMirror renders runs of spaces as non-breaking ones; normalise so the marker compares.
      lineText: line.text.split(String.fromCharCode(160)).join(' ').trim(),
      // The line BOX starts left of its text — CodeMirror's default theme pads `.cm-line` on the
      // left. Comparing the caret against the box would be off by that padding on every line, so
      // the padding is read from the computed style rather than assumed to be zero.
      atFirstColumn: Math.abs(cr.left - (line.rect.left + line.paddingLeft)) <= 2,
      inView: cr.top >= sr.top - 1 && cr.bottom <= sr.bottom + 1,
      caret: { x: Math.round(cr.left), y: Math.round(cr.top) },
    };
  });
}

/** The scroller's current offset — what G4 and G6 require to be unchanged. */
const scrollTop = (win: Page, panelId: string): Promise<number> =>
  win
    .getByTestId(`editor-${panelId}`)
    .locator('.cm-scroller')
    .evaluate((el) => Math.round(el.scrollTop));

/** The drawn selection's rectangles — read from the layer CodeMirror paints, not from its state. */
const selectionBoxes = (win: Page, panelId: string): Promise<string[]> =>
  win.getByTestId(`editor-${panelId}`).evaluate((root) =>
    Array.from(root.querySelectorAll('.cm-selectionBackground')).map((el) => {
      const r = el.getBoundingClientRect();
      return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`;
    }),
  );

/** Turn the tab's first panel into an editor and hand back its id. */
async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

/**
 * Put the keyboard in the editor by CLICKING A VISIBLE LINE.
 *
 * Two traps meet here, and each rules out the obvious answer to the other.
 *
 * The harness's `focusEditor` clicks `.cm-content`, and Playwright scrolls an element's CENTRE into
 * view before clicking. `.cm-content` for a four-hundred-line document is thousands of pixels tall,
 * so that click scrolls the document to its middle and drops the caret wherever it lands — silently
 * invalidating every "nothing moved" and "scrolled into view" assertion in this file.
 *
 * A bare `element.focus()` avoids that and was the first attempt. It is not enough, and the failure
 * is instructive: DOM focus is not the same fact as which PANE the application thinks the keyboard is
 * in. Every test here opens its file from the tree, which leaves the active pane at Files & Folders —
 * so `currentScope` kept answering `explorer`, `navigate.gotoLine` (EDITOR_ONLY) resolved to null,
 * and the chord did nothing. The one test that passed had clicked the word-wrap button on the way
 * past, which set the pane as a side effect. That is the whole diagnosis of a two-test failure that
 * looked like two unrelated bugs.
 *
 * So: a real click, on a RENDERED line, which is small and already in the viewport. It moves the
 * caret to that line — every caller either presses `Control+Home` afterwards or does not care.
 *
 * `lineIndex` exists for one caller. The find bar is drawn OVER the top of the editor, so with one
 * open the click on line 0 is intercepted by the find input and retried until the test times out —
 * a thirty-second failure whose log names a pointer-event interception rather than a find bar. A
 * line below the bar is clicked instead.
 */
async function focusContent(win: Page, panelId: string, lineIndex = 0): Promise<void> {
  const editor = win.getByTestId(`editor-${panelId}`);
  await editor.locator('.cm-content .cm-line').nth(lineIndex).click();
  await expect(editor.locator('.cm-editor.cm-focused')).toBeVisible({ timeout: 10_000 });
}

/** Open `file` from the tree into `pid`'s editor and wait for its first line to render. */
async function openFile(win: Page, pid: string, file: string): Promise<void> {
  await win.getByTestId('file-explorer-tree').getByText(file, { exact: true }).click();
  await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(marker(1), {
    timeout: 8000,
  });
}

/** Word wrap ships ON (`editor.defaultWordWrap`); most tests here need it off, and one needs it on. */
async function setWordWrap(win: Page, pid: string, on: boolean): Promise<void> {
  const button = win.getByTestId(`editor-word-wrap-${pid}`);
  if ((await button.getAttribute('aria-pressed')) !== String(on)) await button.click();
  await expect(button).toHaveAttribute('aria-pressed', String(on));
}

/**
 * How many notices are on screen — the BASELINE against which "no error notice" is asserted.
 *
 * A bare `toHaveCount(0)` would be a claim about the whole application rather than about this
 * feature, and one unrelated notice left over from setting a project up would fail it for a reason
 * that has nothing to do with G3. What FR-022 forbids is a NEW notice, so the count before is what
 * the count after is compared with.
 */
const noticeCount = (win: Page): Promise<number> =>
  win.getByTestId('notices').locator('.notice').count();

const expectNoNewNotice = async (win: Page, baseline: number): Promise<void> => {
  await expect(win.getByTestId('notices').locator('.notice')).toHaveCount(baseline);
};

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * AS-1, AS-2, AS-3 · G1, G2 · SC-006 — the unwrapped document
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

test('the chord opens a modal with the caret in its input, and the line reached is the one the GUTTER draws (AS-1, AS-2, AS-3, G1, G2, SC-006)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'GotoPlain', root);
      const pid = await newEditor(win);
      await openFile(win, pid, 'plain.txt');
      await setWordWrap(win, pid, false);
      await focusContent(win, pid);
      await win.keyboard.press('Control+Home');

      const notices = await noticeCount(win);

      // AS-1 / S3 — the app's shipped modal presentation, and the caret already in the field.
      await win.keyboard.press(GOTO_LINE_CHORD);
      const dialog = win.getByTestId('gotoline');
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute('role', 'dialog');
      await expect(dialog).toHaveAttribute('aria-modal', 'true');
      await expect(win.getByTestId('gotoline-overlay')).toBeVisible();
      const input = win.getByTestId('gotoline-input');
      await expect(input).toBeFocused();
      await expect(input).toHaveValue('');

      // AS-2 — a line that exists, confirmed with Enter.
      await win.keyboard.type('212');
      await win.keyboard.press('Enter');
      await expect(dialog).toHaveCount(0);

      // …focus is back in the EDITOR (FR-024, FR-072, G7), which is also what draws the caret.
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-editor.cm-focused')).toBeVisible();

      // AS-3 / G2 / SC-006 — the GUTTER beside the caret reads what the user typed.
      const at = await caretReadout(win, pid);
      expect(at.gutter, 'the gutter beside the caret does not read the number typed').toBe('212');
      expect(at.lineText).toBe(marker(212));
      // G1 — scrolled into view, caret at the first column.
      expect(at.inView, 'line 212 was not scrolled into view').toBe(true);
      expect(at.atFirstColumn, 'the caret is not at the first column').toBe(true);
      await expectNoNewNotice(win, notices);
    });
  } finally {
    cleanupTemp(root);
  }
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * SC-006, second half — the WRAPPED document, where visual rows and logical lines disagree
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

test('in a WRAPPED document the number typed is still the number the gutter draws (SC-006, G2, FR-021)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'GotoWrapped', root);
      const pid = await newEditor(win);
      await openFile(win, pid, 'wrapped.txt');
      await setWordWrap(win, pid, true);
      await focusContent(win, pid);
      await win.keyboard.press('Control+Home');

      const notices = await noticeCount(win);

      /*
       * PROVE THE DOCUMENT IS ACTUALLY WRAPPING before asserting anything about wrapping.
       *
       * With wrap off this test is a duplicate of the one above and would pass for the wrong reason —
       * the failure it exists to catch (counting visual rows) only appears when a logical line
       * occupies several of them. So the first line's height is measured against ONE ROW.
       *
       * One row is the CARET's height, not the shortest line on screen. Measured: the shortest line
       * on screen is the wrong reference, because the twenty long lines at the top of this fixture
       * are taller than the viewport can hold — every rendered line was a wrapped one, the smallest
       * equalled the first, and the ratio came back as exactly 1 in a document that was wrapping
       * perfectly well. The caret is one row tall wherever it sits.
       */
      const rows = await win.getByTestId(`editor-${pid}`).evaluate((el) => {
        const lines = Array.from(el.querySelectorAll('.cm-content .cm-line')) as HTMLElement[];
        const caret = el.querySelector('.cm-cursor-primary') as HTMLElement | null;
        return {
          first: lines[0]?.getBoundingClientRect().height ?? 0,
          row: caret?.getBoundingClientRect().height ?? 0,
        };
      });
      expect(rows.row, 'no caret was drawn, so one row has no measurement').toBeGreaterThan(0);
      expect(
        rows.first / rows.row,
        'the first line is not wrapping, so this test cannot tell visual rows from logical lines',
      ).toBeGreaterThan(2.5);

      await openGotoLine(win);
      await win.keyboard.type('250');
      await win.keyboard.press('Enter');
      await expect(win.getByTestId('gotoline')).toHaveCount(0);
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-editor.cm-focused')).toBeVisible();

      const at = await caretReadout(win, pid);
      expect(at.gutter, 'wrapped: the gutter beside the caret is not the number typed').toBe('250');
      expect(at.lineText).toBe(marker(250));
      expect(at.inView).toBe(true);
      expect(at.atFirstColumn).toBe(true);
      await expectNoNewNotice(win, notices);
    });
  } finally {
    cleanupTemp(root);
  }
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * AS-4, AS-5 · G3 — clamping is never an error
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

test('a number past the end lands on the LAST line, and 0 or a negative on the FIRST — neither raises a notice (AS-4, AS-5, G3)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'GotoClamp', root);
      const pid = await newEditor(win);
      await openFile(win, pid, 'plain.txt');
      await setWordWrap(win, pid, false);
      await focusContent(win, pid);
      await win.keyboard.press('Control+Home');

      const notices = await noticeCount(win);

      // AS-4 — beyond the document's line count.
      await openGotoLine(win);
      await win.keyboard.type('99999');
      await win.keyboard.press('Enter');
      await expect(win.getByTestId('gotoline')).toHaveCount(0);
      const last = await caretReadout(win, pid);
      expect(last.gutter).toBe(String(LAST_LINE));
      // …and the last line of a file that ends with a newline is the empty one after the text.
      expect(last.lineText).toBe('');
      expect(last.atFirstColumn).toBe(true);
      await expectNoNewNotice(win, notices);

      // AS-5 — zero.
      await openGotoLine(win);
      await win.keyboard.type('0');
      await win.keyboard.press('Enter');
      await expect(win.getByTestId('gotoline')).toHaveCount(0);
      const zero = await caretReadout(win, pid);
      expect(zero.gutter).toBe('1');
      expect(zero.lineText).toBe(marker(1));
      expect(zero.atFirstColumn).toBe(true);
      await expectNoNewNotice(win, notices);

      // …move away again, so the negative below cannot pass merely by leaving the caret where it is.
      await openGotoLine(win);
      await win.keyboard.type('300');
      await win.keyboard.press('Enter');
      await expect.poll(async () => (await caretReadout(win, pid)).gutter).toBe('300');

      // AS-5 — a negative, which must NOT be read as "count back from the end".
      await openGotoLine(win);
      await win.keyboard.type('-5');
      await win.keyboard.press('Enter');
      await expect(win.getByTestId('gotoline')).toHaveCount(0);
      const negative = await caretReadout(win, pid);
      expect(negative.gutter).toBe('1');
      expect(negative.lineText).toBe(marker(1));
      await expectNoNewNotice(win, notices);
    });
  } finally {
    cleanupTemp(root);
  }
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * AS-6, AS-7 · G4, G6 — nothing moves
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

test('Escape, an empty value and a non-numeric one all leave the caret, the selection and the scroll exactly as they were (AS-6, AS-7, G4, G6)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'GotoNoop', root);
      const pid = await newEditor(win);
      await openFile(win, pid, 'plain.txt');
      await setWordWrap(win, pid, false);
      await focusContent(win, pid);

      const notices = await noticeCount(win);

      // Somewhere in the middle, with a real selection and a real scroll offset — so "unchanged" is
      // a claim about something, rather than about the top of an unscrolled document.
      await openGotoLine(win);
      await win.keyboard.type('180');
      await win.keyboard.press('Enter');
      await expect.poll(async () => (await caretReadout(win, pid)).gutter).toBe('180');
      await win.keyboard.press('Shift+End');

      const before = {
        readout: await caretReadout(win, pid),
        scroll: await scrollTop(win, pid),
        selection: await selectionBoxes(win, pid),
      };
      expect(before.selection.length, 'nothing is selected — this test would be vacuous').toBe(1);
      expect(
        before.scroll,
        'the document is not scrolled — this test would be vacuous',
      ).toBeGreaterThan(0);

      const unchanged = async (why: string): Promise<void> => {
        await expect(
          win.getByTestId(`editor-${pid}`).locator('.cm-editor.cm-focused'),
        ).toBeVisible();
        const after = await caretReadout(win, pid);
        expect(after.gutter, why).toBe(before.readout.gutter);
        expect(after.caret, why).toEqual(before.readout.caret);
        expect(await scrollTop(win, pid), why).toBe(before.scroll);
        expect(await selectionBoxes(win, pid), why).toEqual(before.selection);
        await expectNoNewNotice(win, notices);
      };

      // AS-6 — Escape.
      await openGotoLine(win);
      await win.keyboard.press('Escape');
      await expect(win.getByTestId('gotoline')).toHaveCount(0);
      await unchanged('Escape moved something');

      // AS-7 — an empty value confirmed.
      await openGotoLine(win);
      await win.keyboard.press('Enter');
      await expect(win.getByTestId('gotoline')).toHaveCount(0);
      await unchanged('an empty value moved something');

      // AS-7 — and a non-numeric one.
      await openGotoLine(win);
      await win.keyboard.type('abc');
      await win.keyboard.press('Enter');
      await expect(win.getByTestId('gotoline')).toHaveCount(0);
      await unchanged('a non-numeric value moved something');
    });
  } finally {
    cleanupTemp(root);
  }
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * AS-12 · G8 — FR-026: the find bar keeps everything but the focus
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

test('an open find bar keeps its query, its match count and its highlights, and merely loses focus (AS-12, G8, FR-026)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'GotoFind', root);
      const pid = await newEditor(win);
      await openFile(win, pid, 'plain.txt');
      await setWordWrap(win, pid, false);
      await focusContent(win, pid);
      await win.keyboard.press('Control+Home');

      // A find session the user has built: a query, a count, and highlights on screen.
      await win.keyboard.press('Control+f');
      await expect(win.getByTestId(`find-bar-${pid}`)).toBeVisible();
      // `line-001` matches line-0010 to line-0019 and nothing else — ten hits, all near the top of
      // the document, so they are on screen from the start and stay there across the short jump
      // below.
      await win.getByTestId('find-input').fill('line-001');
      await expect(win.getByTestId('find-count')).toHaveText('1 of 10');
      const highlights = win.getByTestId(`editor-${pid}`).locator('.throng-search-match');
      const before = {
        query: await win.getByTestId('find-input').inputValue(),
        count: await win.getByTestId('find-count').textContent(),
        highlights: await highlights.count(),
        scroll: await scrollTop(win, pid),
      };
      // `toBeGreaterThan(0)` rather than a fixed ten: highlights are VIEWPORT decorations, so how
      // many are drawn depends on how tall the panel happens to be. What FR-026 asks is that the
      // number does not CHANGE, and the comparison below is where that is asserted.
      expect(before.highlights, 'no highlights are drawn — this test would be vacuous').toBeGreaterThan(0);

      /*
       * The chord is pressed from the EDITOR, not from inside the find bar.
       *
       * `navigate.gotoLine` is panel-scoped, so a focused transient surface suppresses it — the find
       * bar's own keys win while it holds the caret (FR-017f). What FR-026 governs is what happens to
       * a find bar that is OPEN, which is what this drives.
       */
      // Line index 4, not 0: the find bar is drawn over the top of the editor and would swallow the
      // click. It also puts the caret somewhere OTHER than the line jumped to below, so the jump has
      // somewhere to go.
      await focusContent(win, pid, 4);
      await openGotoLine(win);
      // …the bar is still there while the modal is up, and it is not the thing holding focus.
      await expect(win.getByTestId(`find-bar-${pid}`)).toBeVisible();
      await expect(win.getByTestId('find-input')).not.toBeFocused();

      /*
       * Line 2 — near the top, and therefore certainly already on screen.
       *
       * The target is chosen so the jump does NOT scroll, and that is a requirement of the assertion
       * rather than a convenience: highlights are viewport decorations, so counting them before and
       * after a jump that moved the viewport would be comparing two different windows onto the same
       * matches. The scroll offset is asserted unchanged below, so a target that turned out not to be
       * visible fails loudly instead of quietly weakening the test.
       */
      await win.keyboard.type('2');
      await win.keyboard.press('Enter');
      await expect(win.getByTestId('gotoline')).toHaveCount(0);

      // FR-026a — OPEN and INTACT. Nothing in this feature may close a find bar.
      await expect(win.getByTestId(`find-bar-${pid}`)).toBeVisible();
      expect(await win.getByTestId('find-input').inputValue()).toBe(before.query);
      expect(await win.getByTestId('find-count').textContent()).toBe(before.count);
      expect(await scrollTop(win, pid), 'the jump scrolled — the highlight comparison is unsound').toBe(
        before.scroll,
      );
      expect(await highlights.count()).toBe(before.highlights);

      // …and focus is in the EDITOR, not back in the find bar (FR-072, G7, R10).
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-editor.cm-focused')).toBeVisible();
      await expect(win.getByTestId('find-input')).not.toBeFocused();
      expect((await caretReadout(win, pid)).gutter).toBe('2');
    });
  } finally {
    cleanupTemp(root);
  }
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * AS-8 · A3 · SC-007 — a focused terminal keeps its ^G
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Every chunk this terminal view has put on the wire, as its own diagnostics record them.
 *
 * Reading the SCREEN cannot answer SC-007: `^G` rings a bell and prints nothing, so an unchanged
 * screen is equally consistent with the byte having arrived and with the chord having eaten it. The
 * write log distinguishes them. (Borrowed from `quick-open.e2e.ts`, which needed the same probe for
 * the opposite claim.)
 */
async function inputWrites(win: Page, panelId: string): Promise<string[]> {
  return win.evaluate((id) => {
    const probe = (
      window as unknown as {
        __throngTerminalDiagnostics?: () => Record<string, { writes: string[] }>;
      }
    ).__throngTerminalDiagnostics;
    return probe?.()[id]?.writes ?? [];
  }, panelId);
}

/**
 * `^G` — the BEL control character, as `diagnostics.ts` stores it.
 *
 * `recordWrite` pushes `JSON.stringify(data).slice(1, -1)`, so the log holds the six-character escape
 * rather than the byte. Spelled as an escape here for that reason, and because a raw control byte in
 * a source file makes git classify it as binary and its diffs unreviewable.
 */
const BEL = '\\u0007';

test('with a terminal focused the chord opens nothing and the shell receives ^G (AS-8, A3, SC-007)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'GotoTerm', root);

      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      const term = win.getByTestId(`terminal-${pid}`);
      await expect(term).toContainText(basename(root), { timeout: 20_000 });

      const textarea = term.locator('.xterm-helper-textarea');
      await term.click();
      await expect(textarea).toBeFocused();

      // PROVE THE PROBE CAN MOVE before asking it to record something specific (FR-053b's standard).
      const beforeTyping = await inputWrites(win, pid);
      await win.keyboard.type('x');
      await expect
        .poll(async () => (await inputWrites(win, pid)).length)
        .toBeGreaterThan(beforeTyping.length);
      expect(
        await inputWrites(win, pid),
        'the terminal never recorded the proving keystroke',
      ).toContain('x');

      const beforeChord = await inputWrites(win, pid);
      await win.keyboard.press(GOTO_LINE_CHORD);

      // SC-007's first half — no modal. The defence is SCOPE, not absence: `Ctrl+G` is simply never
      // live in a terminal, so nothing claims it and nothing is preventDefaulted.
      await expect(win.getByTestId('gotoline')).toHaveCount(0);

      // SC-007's second half — and the shell got the control character, exactly as it would with
      // this feature absent. That is the property that keeps readline's `abort` working.
      await expect
        .poll(async () => (await inputWrites(win, pid)).slice(beforeChord.length))
        .toContain(BEL);
    });
  } finally {
    cleanupTemp(root);
  }
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * AS-9 · A4 — no active panel
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

test('with no editor active the chord does nothing — and the same chord opens the modal once one is (AS-9, A4)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'GotoNoPanel', root);

      /*
       * A tab whose only panel is an untyped placeholder: there is no active EDITOR.
       *
       * The panel box is clicked first so the WORKSPACE is the active pane. Without that the tree
       * would still hold it and the chord would be dead for a second reason — which is true, and is
       * not what AS-9 is about. Clicking here narrows the negative to the one fact under test: the
       * active panel is not an editor.
       */
      const pid = await firstPanelId(win);
      await expect(win.getByTestId(`panel-type-select-${pid}`)).toBeVisible();
      await win.locator(`.panel-box[data-panel-id="${pid}"]`).click({ position: { x: 5, y: 5 } });
      await win.keyboard.press(GOTO_LINE_CHORD);
      await expect(win.getByTestId('gotoline')).toHaveCount(0);

      /*
       * …and the negative above is not vacuous. The SAME chord, in the SAME window, once the panel is
       * an editor, opens the modal — so "nothing happened" was the scope gate doing its job rather
       * than a chord that was dead all along (#244's shape).
       */
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
      await openFile(win, pid, 'plain.txt');
      await focusContent(win, pid);
      await win.keyboard.press(GOTO_LINE_CHORD);
      await expect(win.getByTestId('gotoline')).toBeVisible();
      await win.keyboard.press('Escape');
      await expect(win.getByTestId('gotoline')).toHaveCount(0);
    });
  } finally {
    cleanupTemp(root);
  }
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * FR-066 · S1 — one slot, one modal
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

test('opening Quick Open while Go To Line is open leaves exactly one modal on screen (FR-066, S1)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'GotoOneModal', root);
      const pid = await newEditor(win);
      await openFile(win, pid, 'plain.txt');
      await focusContent(win, pid);

      await openGotoLine(win);
      await win.keyboard.press(QUICK_OPEN_CHORD);

      await expect(win.getByTestId('quickopen')).toBeVisible();
      await expect(win.getByTestId('gotoline')).toHaveCount(0);
      // …and ONE scrim, not two stacked on each other.
      await expect(win.locator('.modal-overlay')).toHaveCount(1);

      await win.keyboard.press('Escape');
      await expect(win.getByTestId('quickopen')).toHaveCount(0);
    });
  } finally {
    cleanupTemp(root);
  }
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * G10 · FR-028 — throng's modal on throng's binding, and no second surface
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

test('CodeMirror’s own go-to-line panel is not reachable — Ctrl+Alt+G opens nothing (G10, FR-028)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'GotoNoSecond', root);
      const pid = await newEditor(win);
      await openFile(win, pid, 'plain.txt');
      await focusContent(win, pid);

      /*
       * `@codemirror/search` ships `gotoLine` on `Mod-Alt-g` through `searchKeymap`, and its panel
       * would be a SECOND go-to-line surface with controls that cannot be theme-token driven. throng
       * installs neither `search()` nor `searchKeymap` — only the `SearchQuery` TYPE, in
       * `search/search-model.ts` — so the chord is unbound and no `.cm-panels` container is ever
       * created. Asserted rather than argued: "we did not import it" is a fact about today's source,
       * and FR-028 is a requirement about the shipped app.
       */
      await win.keyboard.press('Control+Alt+G');
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-panels')).toHaveCount(0);
      await expect(win.getByTestId('gotoline')).toHaveCount(0);

      // …while throng's OWN binding does open throng's own modal, so the absence above is a
      // statement about the second surface rather than about a dead editor.
      await win.keyboard.press(GOTO_LINE_CHORD);
      await expect(win.getByTestId('gotoline')).toBeVisible();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-panels')).toHaveCount(0);
      await win.keyboard.press('Escape');
      await expect(win.getByTestId('gotoline')).toHaveCount(0);
    });
  } finally {
    cleanupTemp(root);
  }
});
