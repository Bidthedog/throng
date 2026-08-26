import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp } from './harness.js';

/**
 * `editor.showGutter` hides and restores the line-number gutter, live, in both editor surfaces
 * (040 US4 — FR-041, FR-042, FR-043, FR-044; #254).
 *
 * ══ WHY A NEW FILE AND NOT `editor-gutter.e2e.ts` ══
 *
 * That file already exists and belongs to spec **009**: two shipped declarations about the gutter's
 * theme tokens. Appending here would also have dragged them into the serial tier, because this file
 * opens a preferences window and theirs does not — a cost with nothing to do with them.
 *
 * ══ WHAT ONLY A REAL WINDOW CAN SETTLE ══
 *
 * `component/gutter-compartment.test.ts` already proves the compartment's content follows the
 * setting on a live view without a remount. jsdom has no layout, so it cannot say whether the
 * reclaimed width actually reaches the TEXT — which is precisely what research.md D3 rejects the CSS
 * approach for, and precisely what a user would notice. Every geometric claim below is here for that
 * reason, under `@reserve:layout`; the cross-window one is `@reserve:window`.
 *
 * ══ THE SCROLL CLAIM IS A DOCUMENT ANCHOR, NEVER A PIXEL OFFSET ══
 *
 * `.cm-content` is `flexGrow: 2` inside a flex `.cm-scroller`, so removing the gutter WIDENS the
 * text column — which re-wraps every long line in a wrapped document and changes its rendered
 * height. The pixel scroll offset therefore cannot be preserved, and an assertion on
 * `scrollDOM.scrollTop` would be asserting something the implementation is not allowed to promise.
 * What must not move is the line the reader was looking at, so that is what is asserted.
 *
 * FR-044 records that this is an ASSUMPTION rather than an established property: nothing in this
 * repository asserts that a compartment reconfigure preserves scroll, and two comments in
 * `use-editor.ts` record issue #144 — a reconfigure dropping the viewport a frame late. This
 * declaration is the only thing that will ever check it.
 *
 * ══ FR-042 CANNOT BE SHOWN BY TOGGLING INSIDE THE PREFERENCES WINDOW ══
 *
 * `preferences-app.tsx` holds ONE window-wide `mode`. The standalone editor exists only in JSON
 * mode; the `editor.showGutter` row exists only in UI mode. They are mutually exclusive in one
 * window, so flipping the toggle there would unmount the very editor being measured and "already
 * open, no reopen" could not be shown at all. The toggle therefore comes from the MAIN window —
 * which is also the more honest cross-realm proof, since it puts a process boundary between the
 * change and the editor that has to notice it.
 *
 * ══ EVERY TEST OWNS ITS CONFIG ROOT ══
 *
 * Not tidiness. Six assertions across `goto-line.e2e.ts` and `goto-line-keybinding.e2e.ts` read the
 * RENDERED GUTTER NUMBER as the definition of which line the caret is on, and a leaked
 * `showGutter: false` fails them with "no gutter element beside the caret" — a message that sends
 * the reader to the goto-line code for a defect entirely about a preference.
 * `goto-line-keybinding.e2e.ts:94-95` records that exact misattribution having happened once.
 */

/** Long lines, so the document genuinely wraps and the re-wrap this spec warns about is real. */
const FILLER = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ';
const LINES = Array.from(
  { length: 200 },
  (_, i) => `line ${String(i + 1).padStart(3, '0')} ${FILLER.repeat(3)}`,
);

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-gutvis-'));
  writeFileSync(join(root, 'wide.txt'), LINES.join('\n') + '\n', 'utf8');
  return root;
}

async function openEditorWithFile(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  await win.getByTestId(`editor-${pid}`).click();
  await win.getByTestId('file-explorer-tree').getByText('wide.txt', { exact: true }).click();
  await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('line 001', {
    timeout: 8000,
  });
  return pid;
}

/**
 * Set `editor.showGutter` FROM THE MAIN WINDOW, through the real key-scoped write path.
 *
 * The same IPC the settings form's toggle uses (`config.writePatch`, 032 FR-001): main validates it,
 * writes `settings.json`, and the hot-reload watcher broadcasts to every renderer. Nothing is
 * stubbed and nothing is written behind the app's back — which is what makes the assertions that
 * follow statements about the application rather than about a test fixture.
 */
async function setGutter(win: Page, value: boolean): Promise<void> {
  const result = await win.evaluate(
    (on) =>
      window.throng?.config?.writePatch?.({ kind: 'settings' }, [
        { path: ['editor', 'showGutter'], value: on },
      ]),
    value,
  );
  expect(result?.ok, `the settings write was refused: ${JSON.stringify(result)}`).toBe(true);
}

/** The preferences window, opened on `tab` (the shape `preferences-reset.e2e.ts` established). */
async function openPrefs(
  app: ElectronApplication,
  win: Page,
  tab: 'settings' | 'keybindings' | 'themes',
): Promise<Page> {
  await win.bringToFront();
  await win.getByTestId('title-bar-cog').click();
  await win.getByTestId(`cog-menu-${tab}`).click();

  let prefs: Page | undefined;
  await expect
    .poll(
      async () => {
        for (const page of app.windows()) {
          if (page === win || page.isClosed()) continue;
          if ((await page.getByTestId('prefs-mode-toggle').count()) > 0) {
            prefs = page;
            return true;
          }
        }
        return false;
      },
      { timeout: 20_000, message: 'the preferences window never appeared' },
    )
    .toBe(true);
  return prefs as Page;
}

/**
 * The TEXT of the topmost visible line — a document anchor, not a pixel offset.
 *
 * The first `.cm-line` whose bottom edge is still below the scroller's top edge. Read as text and
 * sliced to the `line NNN` marker each line carries, so the answer is a statement about the
 * DOCUMENT: it survives the re-wrap that hiding the gutter causes, where a scroll offset does not.
 */
function topVisibleLine(win: Page): Promise<string> {
  return win.evaluate(() => {
    const scroller = document.querySelector('.editor-panel .cm-scroller');
    if (!scroller) return '';
    const top = scroller.getBoundingClientRect().top;
    for (const line of scroller.querySelectorAll('.cm-line')) {
      // +1px of slack: a line whose last pixel row is level with the top edge is not the line the
      // reader is looking at, and sub-pixel layout makes an exact comparison a coin flip.
      if (line.getBoundingClientRect().bottom > top + 1) return (line.textContent ?? '').slice(0, 8);
    }
    return '';
  });
}

/**
 * Put a WRAPPED row — not a logical line's first row — at the top of the viewport, and say which
 * document position landed there.
 *
 * ══ WHY THE SCROLL IS COMPUTED RATHER THAN A PIXEL CONSTANT ══
 *
 * `scrollTop = 1200` lands wherever it lands. What this declaration needs is a viewport whose top
 * row is *in the middle of a logical line*, because that is the only place the difference between a
 * LINE anchor and a ROW anchor is observable — and it is the case the feature exists for
 * (minified JSON, a prose paragraph, the preferences JSON editor, which wraps unconditionally). So
 * the scroll is placed on a specific visual row of a specific logical line, and the number of rows
 * that line has is asserted rather than assumed.
 *
 * Returns the `line NNN` marker of that logical line and the character offset WITHIN it of the
 * position at the top-left of the viewport — the document position the reader is looking at.
 */
async function scrollToWrappedRow(
  win: Page,
): Promise<{ marker: string; offset: number; rows: number; row: number }> {
  return win.evaluate(() => {
    const scroller = document.querySelector('.editor-panel .cm-scroller');
    const content = document.querySelector('.editor-panel .cm-content');
    if (!scroller || !content) throw new Error('no editor scroller');

    // A line well below the top of the document, so "unchanged" is a real claim rather than
    // "still at 0" — and one that is currently rendered, since CodeMirror virtualises.
    const lines = [...scroller.querySelectorAll('.cm-line')];
    const line = lines[Math.min(5, lines.length - 1)];
    if (!line) throw new Error('no rendered lines');

    /** One client rect per VISUAL ROW — the granularity `lineBlockAtHeight` does not have. */
    const rowsOf = (el: Element): DOMRect[] => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return [...r.getClientRects()].filter((rect) => rect.height > 0);
    };

    const rows = rowsOf(line);
    const row = Math.min(3, rows.length - 1);
    scroller.scrollTop += rows[row]!.top - scroller.getBoundingClientRect().top;

    // Now read back what is actually at the top-left, from the DOM rather than from arithmetic.
    const top = scroller.getBoundingClientRect().top;
    const x = content.getBoundingClientRect().left + 2;
    const caret = document.caretRangeFromPoint(x, top + 2);
    if (!caret) throw new Error('no caret position at the top-left of the viewport');
    const node = caret.startContainer;
    const host =
      node.nodeType === Node.TEXT_NODE
        ? (node.parentElement?.closest('.cm-line') ?? null)
        : (node as Element).closest('.cm-line');
    if (!host) throw new Error('the top-left of the viewport is not inside a line');

    // Character offset within the line, summed across however many text nodes highlighting made.
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let offset = 0;
    let seen: Node | null;
    while ((seen = walker.nextNode())) {
      if (seen === node) {
        offset += caret.startOffset;
        break;
      }
      offset += seen.textContent?.length ?? 0;
    }

    return { marker: (host.textContent ?? '').slice(0, 8), offset, rows: rows.length, row };
  });
}

/**
 * How far below the top of the viewport that same document position now sits, in pixels, and how
 * tall one visual row is.
 *
 * The whole of FR-044's scroll half, measured at the granularity the requirement is about. `0` means
 * the reader's place was kept exactly; one row height means they were moved by one row; anything
 * larger is the reader being thrown up the line — which is what a LOGICAL-line anchor does, by
 * however many rows they had scrolled into it.
 */
async function anchorOffsetFromTop(
  win: Page,
  at: { marker: string; offset: number },
): Promise<{ found: boolean; delta: number; rowHeight: number }> {
  return win.evaluate((target) => {
    const scroller = document.querySelector('.editor-panel .cm-scroller');
    if (!scroller) return { found: false, delta: 0, rowHeight: 0 };
    const top = scroller.getBoundingClientRect().top;
    const line = [...scroller.querySelectorAll('.cm-line')].find((el) =>
      (el.textContent ?? '').startsWith(target.marker),
    );
    if (!line) return { found: false, delta: 0, rowHeight: 0 };

    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let seen = 0;
    let node: Node | null;
    let host: Node | null = null;
    let within = 0;
    while ((node = walker.nextNode())) {
      const len = node.textContent?.length ?? 0;
      if (target.offset <= seen + len) {
        host = node;
        within = target.offset - seen;
        break;
      }
      seen += len;
    }
    if (!host) return { found: false, delta: 0, rowHeight: 0 };

    const at = document.createRange();
    at.setStart(host, within);
    at.setEnd(host, Math.min(within + 1, host.textContent?.length ?? within));
    const rect = at.getBoundingClientRect();

    const whole = document.createRange();
    whole.selectNodeContents(line);
    const rows = [...whole.getClientRects()].filter((r) => r.height > 0);
    return { found: true, delta: rect.top - top, rowHeight: rows[0]?.height ?? 0 };
  }, at);
}

/** How far `.cm-content`'s left edge sits from `.cm-scroller`'s — the width the gutter is spending. */
function textInset(win: Page): Promise<number> {
  return win.evaluate(() => {
    const scroller = document.querySelector('.editor-panel .cm-scroller');
    const content = document.querySelector('.editor-panel .cm-content');
    if (!scroller || !content) return -1;
    return content.getBoundingClientRect().left - scroller.getBoundingClientRect().left;
  });
}

const readout = (win: Page, id: string, pid: string): Promise<string | null> =>
  win.getByTestId(`editor-status-${id}-${pid}`).textContent();

/* ────────────────────────────────────────────────────────────────────────── *
 * (1) FR-043 — it comes and goes on an editor that is ALREADY open
 * ────────────────────────────────────────────────────────────────────────── */

/*
 * `@reserve:window`, not `@reserve:layout`. This declaration makes no geometric claim at all — it
 * asserts `.cm-gutters` is present, then absent, then present. What no cheaper layer can supply is
 * the SECOND WINDOW: the toggle is the real control on the real preferences form, in a different
 * renderer realm, and the editor that has to notice it is in the main window. That process boundary
 * is the irreducible part, and the tag has to name the reason the test is here.
 */
test('the gutter goes and returns on an already-open editor, with no reopen', { tag: ['@extended', '@editor', '@reserve:window'] }, async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  const root = makeProject();
  try {
    await runApp(
      async (app, win) => {
        await createProject(win, 'GutterVis', root);
        const pid = await openEditorWithFile(win);
        const gutter = win.getByTestId(`editor-${pid}`).locator('.cm-gutters');

        // Present to begin with: the shipped default is ON, and an absence assertion after a
        // toggle proves nothing if it was never there.
        await expect(gutter).toHaveCount(1);

        /*
         * The REAL control, clicked by a user, in the window that owns it. The other three
         * declarations drive `config.writePatch` directly — which is the same write path, but not
         * the same evidence: this is the one that says the row on the form is wired to the setting.
         */
        const prefs = await openPrefs(app, win, 'settings');
        await expect(prefs.getByTestId('settings-tab')).toBeVisible();
        await prefs.getByTestId('control-editor.showGutter').click();

        /*
         * `toHaveCount(0)`, not `getComputedStyle(document.querySelector('.cm-gutters')!)`. With the
         * gutter hidden that element is null, and the non-null assertion the neighbouring
         * `editor-gutter.e2e.ts:31-34` establishes would throw a TypeError inside `page.evaluate` —
         * a failure whose stack points at the helper rather than at this assertion.
         */
        await expect(gutter, 'the gutter is gone from the open panel').toHaveCount(0);

        // …and back. The panel was never reopened and the file was never re-read.
        await prefs.getByTestId('control-editor.showGutter').click();
        await expect(gutter, 'and it comes back').toHaveCount(1);
        await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
          'line 001',
        );
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    cleanupTemp(cfg);
    cleanupTemp(root);
  }
});

/* ────────────────────────────────────────────────────────────────────────── *
 * (2) FR-041 — the reclaimed width reaches the TEXT
 * ────────────────────────────────────────────────────────────────────────── */

test('the text starts at the panel’s left padding once the gutter is hidden', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  const root = makeProject();
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'GutterVis', root);
        const pid = await openEditorWithFile(win);
        const gutter = win.getByTestId(`editor-${pid}`).locator('.cm-gutters');
        await expect(gutter).toHaveCount(1);

        /*
         * THIS is the assertion research.md D3 rejects the CSS approach for. `visibility: hidden`
         * would satisfy every "the gutter is not visible" check and leave this number exactly where
         * it started — the width the user was trying to reclaim never reaching the text.
         *
         * Measured on `.cm-content`, never on `.cm-line`: the lines are virtualised, and each one
         * carries its own 6px left padding in both states, so a line's left edge moves by the same
         * amount either way and says nothing about the gutter.
         */
        const withGutter = await textInset(win);
        expect(withGutter, 'the gutter must be spending real width to begin with').toBeGreaterThan(
          10,
        );

        await setGutter(win, false);
        await expect(gutter).toHaveCount(0);

        await expect
          .poll(() => textInset(win), {
            timeout: 8000,
            message: 'the text column never moved left — the reclaimed width did not reach it',
          })
          .toBeLessThanOrEqual(1);
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    cleanupTemp(cfg);
    cleanupTemp(root);
  }
});

/* ────────────────────────────────────────────────────────────────────────── *
 * (3) FR-044 — the reader keeps their place, and their selection
 * ────────────────────────────────────────────────────────────────────────── */

test('the top visible line and the selection survive the toggle', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  const root = makeProject();
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'GutterVis', root);
        const pid = await openEditorWithFile(win);

        // A selection the status bar can report: three lines from the top of the document.
        await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
        await win.keyboard.press('Control+Home');
        await win.keyboard.press('Shift+ArrowDown');
        await win.keyboard.press('Shift+ArrowDown');
        await win.keyboard.press('Shift+End');

        /*
         * Scroll to a WRAPPED ROW in the middle of a logical line — see `scrollToWrappedRow`. The
         * top of the document would make "unchanged" vacuous; the top of a LINE would make the
         * assertion below unable to tell a row anchor from a line anchor, which is the defect.
         */
        const anchor = await scrollToWrappedRow(win);
        expect(
          anchor.rows,
          'the document must genuinely wrap, or there is no visual row to distinguish',
        ).toBeGreaterThanOrEqual(3);
        expect(anchor.row, 'and the viewport must start INSIDE that line, not at its first row')
          .toBeGreaterThanOrEqual(2);

        await expect.poll(() => topVisibleLine(win), { timeout: 8000 }).toMatch(/^line \d{3}$/);
        const before = await topVisibleLine(win);
        expect(before, 'the scroll must have left the top of the document').not.toBe('line 001');

        const line = await readout(win, 'line', pid);
        const column = await readout(win, 'column', pid);
        // `toHaveCount(1)` FIRST. `textContent()` returns `''` for an element that exists and throws
        // a 30-second timeout for one that does not, so `expect(selected).not.toBeNull()` below could
        // never fail: by the time it ran, either the element was there or the call had already blown
        // up somewhere with no message about a status bar.
        await expect(
          win.getByTestId(`editor-status-selected-${pid}`),
          'the status bar must be reporting a selection',
        ).toHaveCount(1);
        const selected = await readout(win, 'selected', pid);

        await setGutter(win, false);
        await expect(win.getByTestId(`editor-${pid}`).locator('.cm-gutters')).toHaveCount(0);

        /*
         * The DOCUMENT anchor, not `scrollDOM.scrollTop`. Hiding the gutter widens the text column,
         * which re-wraps this deliberately-long-lined document and changes its rendered height — so
         * the pixel offset provably moves, and only the place the reader was at can be promised.
         */
        await expect
          .poll(() => topVisibleLine(win), {
            timeout: 8000,
            message: 'the reader was moved to a different line by a change of preference',
          })
          .toBe(before);

        /*
         * ══ AND AT THE GRANULARITY THE REQUIREMENT IS ACTUALLY ABOUT ══
         *
         * The line assertion above passes whether the reader kept their place or was thrown to the
         * TOP of the line they were three rows into: `topVisibleLine` iterates `.cm-line`, which is
         * one element per LOGICAL line however many rows it wraps to, so both outcomes read back the
         * same eight characters.
         *
         * That is not a hypothetical gap. `lineBlockAtHeight` returns the block for a whole logical
         * line — CodeMirror's own words: "a range delimited on both sides by either a non-hidden line
         * break, or the start/end of the document" — and wrapping does not subdivide it. Anchoring
         * on it and restoring with `y: 'start'` therefore puts the line's FIRST row at the top, and
         * the reader loses however far into the line they had scrolled. In a long logical line —
         * minified JSON, a prose paragraph, the preferences JSON editor which wraps unconditionally
         * — that is hundreds of rows.
         *
         * So this measures the position that WAS at the top-left and asks where it is now. One row
         * of slack, because the anchor is recovered here through `caretRangeFromPoint` and in the
         * implementation through `posAtCoords`, and the two may disagree by a character at a wrap
         * boundary. A line anchor misses by the number of rows the reader had scrolled in — asserted
         * above to be at least two — so the two outcomes are never within a row of each other.
         */
        await expect
          .poll(
            async () => {
              const now = await anchorOffsetFromTop(win, anchor);
              // Infinity, never -1, when the position cannot be located: a sentinel that satisfies
              // the bound below would be a test that passes because its measurement failed. And the
              // magnitude, so being thrown DOWN the line fails as loudly as being thrown up it.
              if (!now.found || now.rowHeight <= 0) return Number.POSITIVE_INFINITY;
              return Math.abs(now.delta) / now.rowHeight;
            },
            {
              timeout: 8000,
              message:
                'the reader was thrown to the start of their logical line: the position that was ' +
                'at the top of the viewport is now several visual rows below it (FR-044)',
            },
          )
          .toBeLessThanOrEqual(1);

        // The selection half is safe by construction — a reconfigure carries no `changes` and no
        // `selection` — but "by construction" is an argument, and this is the measurement.
        expect(await readout(win, 'line', pid), 'the caret line').toBe(line);
        expect(await readout(win, 'column', pid), 'the caret column').toBe(column);
        expect(await readout(win, 'selected', pid), 'the selected count').toBe(selected);
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    cleanupTemp(cfg);
    cleanupTemp(root);
  }
});

/* ────────────────────────────────────────────────────────────────────────── *
 * (4) FR-042 — the standalone editor, in the other window, agrees
 * ────────────────────────────────────────────────────────────────────────── */

test('the standalone editor in the preferences window reads the same setting', { tag: ['@extended', '@editor', '@reserve:window'] }, async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  const root = makeProject();
  try {
    await runApp(
      async (app, win) => {
        await createProject(win, 'GutterVis', root);

        /*
         * The KEY BINDINGS document, not settings. The toggle below rewrites `settings.json`, and a
         * JSON tab showing that same file would take an external-change notice at the same instant —
         * a second subject in a test about a gutter. Key bindings is the same `StandaloneEditor`
         * over a document this test never touches.
         */
        const prefs = await openPrefs(app, win, 'keybindings');
        await prefs.getByTestId('prefs-mode-toggle').click();
        const editor = prefs.getByTestId('json-editor-keybindings');
        await expect(editor).toBeVisible();
        const gutter = editor.locator('.cm-gutters');
        await expect(gutter, 'the standalone editor draws a gutter to begin with').toHaveCount(1);

        // From the OTHER window. This is the whole point of the declaration: one setting, two
        // renderer realms, and no way for them to disagree.
        await win.bringToFront();
        await setGutter(win, false);

        await expect(
          gutter,
          'the preferences JSON editor kept its gutter while the panels lost theirs — the second ' +
            'call site (#254 warns about it by name) was missed',
        ).toHaveCount(0);
        // Still the same editor, still holding the document: hidden, not unmounted.
        await expect(editor).toBeVisible();

        await win.bringToFront();
        await setGutter(win, true);
        await expect(gutter).toHaveCount(1);
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    cleanupTemp(cfg);
    cleanupTemp(root);
  }
});
