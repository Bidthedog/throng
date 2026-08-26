/**
 * What the five readouts SAY, and where they say it (040 US1 — FR-005, FR-012, FR-013, FR-027;
 * AS8).
 *
 * ══ WHY THE COMPONENT TIER AND NOT E2E ══
 *
 * Every claim here is about text and about which group an element is in. jsdom renders both
 * faithfully. What it cannot do is MEASURE — no bar height, no overlap, no reclaimed width — and
 * none of that is asserted here; it is `editor-status-bar.e2e.ts` under `@reserve:layout`.
 *
 * ══ WHY THE PRESENTER IS EXERCISED DIRECTLY FOR THE LOCALE CASE ══
 *
 * AS8 asks that a locale grouping with `.` renders `1.048.576`. `Intl` takes its default locale
 * from the runtime, and nothing a rendered component is given can change that — so the locale
 * arrives as an argument to {@link statusReadouts}, and the AS8 assertion calls it with one. That
 * is the same code the component renders through, one parameter along, rather than a second
 * formatting path written for the test.
 */
import { act, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusStrip, statusReadouts } from '../../src/renderer/editor/status-strip.js';
import { setPanelCaret, __resetCaretStore } from '../../src/renderer/editor/caret-store.js';
import {
  scheduleDocumentMetrics,
  __resetDocumentMetricsStore,
} from '../../src/renderer/editor/document-metrics-store.js';
import { removePanelLanguage } from '../../src/renderer/editor/editor-language.js';

const PANEL = 'p1';
/** What `wordWrapDocKey` produces for a panel with no file path — an untitled buffer. */
const DOC_KEY = `panel:${PANEL}`;

beforeEach(() => {
  vi.useFakeTimers();
  __resetCaretStore();
  __resetDocumentMetricsStore();
});

afterEach(() => {
  vi.useRealTimers();
  removePanelLanguage(PANEL);
});

/**
 * Render the strip with a caret and a settled document behind it.
 *
 * The counts go in through the REAL debounced path and are advanced past their window, rather than
 * poked into the store — so a strip that read the wrong key, or read the pending value instead of
 * the settled one, fails here rather than in an E2E.
 */
function strip(opts: { line: number; column: number; selected?: number | null; text?: string }) {
  setPanelCaret(PANEL, { line: opts.line, column: opts.column }, opts.selected ?? null);
  if (opts.text !== undefined) {
    scheduleDocumentMetrics(DOC_KEY, opts.text);
    act(() => {
      vi.advanceTimersByTime(200);
    });
  }
  render(createElement(StatusStrip, { panelId: PANEL, projectId: 'proj-1', relPath: null }));
}

const readout = (id: string): HTMLElement => screen.getByTestId(`editor-status-${id}-${PANEL}`);
const maybeReadout = (id: string): HTMLElement | null =>
  screen.queryByTestId(`editor-status-${id}-${PANEL}`);

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-012 — an abbreviated label with its figure
 * ────────────────────────────────────────────────────────────────────────── */

describe('each readout renders as a label with its figure (FR-012)', () => {
  it('draws all five in the forms the requirement names', () => {
    /*
     * The exact strings FR-012 gives, in one render, because the SET is the requirement: five
     * figures, each with the word that says what it is, and no bare numbers.
     *
     * The document is built to produce them: 1,204 characters over 208 words, with 63 selected.
     */
    // 165 five-letter words + 43 four-letter ones + 207 spaces = 1204 characters, 208 words.
    const text = Array.from({ length: 208 }, (_, i) => 'x'.repeat(i < 165 ? 5 : 4)).join(' ');
    expect(text.length, 'the fixture must really be 1204 characters').toBe(1204);

    strip({ line: 412, column: 7, selected: 63, text });

    expect(readout('line')).toHaveTextContent('Ln 412');
    expect(readout('column')).toHaveTextContent('Col 7');
    expect(readout('selected')).toHaveTextContent('63 selected');
    expect(readout('chars')).toHaveTextContent('1,204 chars');
    expect(readout('words')).toHaveTextContent('208 words');
  });

  it('never renders a bare number without its word', () => {
    // The failure this guards: a "compact" rewrite that drops the labels and leaves `412 7 1,204`,
    // which is five numbers and no way to tell which is which.
    strip({ line: 412, column: 7, text: 'one two' });

    for (const id of ['line', 'column', 'chars', 'words']) {
      expect(readout(id).textContent, `${id} must carry its word`).toMatch(/[A-Za-z]/);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-005 — no selection means NO SEGMENT, not a zero
 * ────────────────────────────────────────────────────────────────────────── */

describe('the selected segment is absent with no selection (FR-005)', () => {
  it('renders nothing at all for a bare caret', () => {
    /*
     * `0 selected` is the obvious implementation and it is the defect: it is on screen permanently,
     * it says a selection exists, and it costs width the other four readouts need (FR-023).
     */
    strip({ line: 1, column: 1, selected: null, text: 'one two' });

    expect(maybeReadout('selected')).toBeNull();
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  it('appears the moment a selection does', () => {
    strip({ line: 1, column: 1, selected: 63, text: 'one two' });
    expect(readout('selected')).toHaveTextContent('63 selected');
  });

  it('renders a 0 rather than treating it as no selection', () => {
    /*
     * The producer of `0` is gone: FR-003a's reversal on 2026-08-25 made a line break one
     * character, so the old worked example — a selection covering only a line ending — now reports
     * `1`, and `selectedCharacters` answers `null` or at least 1.
     *
     * What is asserted is the strip's own rule, which the reversal did not change: ABSENT is
     * `null`, and a number is a number. A `selected && …` guard would render nothing for 0 and
     * pass every other test in this file.
     */
    strip({ line: 1, column: 1, selected: 0, text: 'one two' });
    expect(readout('selected')).toHaveTextContent('0 selected');
  });

  it('renders the 1 that a selected line ending now produces (FR-003a as reversed)', () => {
    // The case that replaced it, and the point of the reversal in one assertion: select one line
    // ending and the bar says a character is selected, because one is.
    strip({ line: 1, column: 1, selected: 1, text: 'one two' });
    expect(readout('selected')).toHaveTextContent('1 selected');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-013 — which GROUP each thing is in (membership, never geometry)
 * ────────────────────────────────────────────────────────────────────────── */

describe('the bar is split by alignment (FR-013)', () => {
  /*
   * jsdom has no layout, so "left-aligned" is asserted as GROUP MEMBERSHIP — the readouts are
   * children of the leading group, the language and wrap controls of the trailing one. That the
   * groups do not overlap and that width pressure lands between them is measured, and lives in
   * `editor-status-bar.e2e.ts`.
   */
  it('puts every readout in the leading group', () => {
    strip({ line: 412, column: 7, selected: 63, text: 'one two' });
    const leading = screen.getByTestId(`editor-status-readouts-${PANEL}`);

    for (const id of ['line', 'column', 'selected', 'chars', 'words']) {
      expect(leading, `${id} belongs with the readouts`).toContainElement(readout(id));
    }
  });

  it('keeps the language indicator and the wrap toggle in the trailing group (016 FR-010c)', () => {
    // 016 FR-010c already requires the language indicator to be "a right-aligned label in a status
    // strip along the bottom of the Editor Panel". The split preserves that rather than moving it.
    strip({ line: 1, column: 1, text: 'one two' });
    const trailing = screen.getByTestId(`editor-status-controls-${PANEL}`);

    expect(trailing).toContainElement(screen.getByTestId(`editor-language-${PANEL}`));
    expect(trailing).toContainElement(screen.getByTestId(`editor-word-wrap-${PANEL}`));
  });

  it('does not put a readout in with the controls', () => {
    // The mirror image, and the one a careless refactor breaks: a readout appended to the trailing
    // group would still render, still read correctly, and be on the wrong side of the bar.
    strip({ line: 412, column: 7, text: 'one two' });
    const trailing = screen.getByTestId(`editor-status-controls-${PANEL}`);

    expect(trailing).not.toContainElement(readout('line'));
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-027 — grouped at every magnitude, through the one core formatter
 * ────────────────────────────────────────────────────────────────────────── */

describe('every quantity is digit-grouped (FR-027, constitution 5.4.0)', () => {
  it('groups the counts', () => {
    const text = 'x'.repeat(1_048_576);
    strip({ line: 1, column: 1, text });

    expect(readout('chars')).toHaveTextContent('1,048,576 chars');
  });

  it('groups the LINE and the COLUMN too, not only the counts', () => {
    /*
     * The line number is the figure #256 asks for — an error message says "line 12345" and the user
     * is looking for it. FR-027 has no threshold, so this is not a special case for large files; it
     * is the rule applied to all four figures.
     */
    strip({ line: 12_345, column: 1_024, text: 'one two' });

    expect(readout('line')).toHaveTextContent('Ln 12,345');
    expect(readout('column')).toHaveTextContent('Col 1,024');
  });

  it('leaves a small figure ungrouped because grouping does nothing to it, not because of a floor', () => {
    // Constitution 4.5.0 REMOVED 018's five-digit floor. `formatGrouped(7)` is `7` because seven
    // has one digit, and that is the same rule, not an exception to it.
    strip({ line: 4, column: 7, text: 'one two' });

    expect(readout('line')).toHaveTextContent('Ln 4');
    expect(readout('column')).toHaveTextContent('Col 7');
  });
});

describe('the grouping follows the LOCALE, not a hardcoded comma (AS8)', () => {
  const caret = { position: { line: 1, column: 1 }, selected: null } as const;

  it('renders 1.048.576 in a locale that groups with a dot', () => {
    /*
     * The defect a hardcoded `,` produces is not a wrong separator: `1,048,576` in a de-DE locale
     * reads as a DECIMAL, so the figure is wrong by six orders of magnitude to the person reading
     * it. `formatGrouped` takes a locale precisely so this cannot happen.
     */
    const out = statusReadouts(caret, { totalCharacters: 1_048_576, totalWords: 1 }, 'de-DE');
    expect(out.find((r) => r.id === 'chars')?.text).toBe('1.048.576 chars');
  });

  it('renders the same figure with commas in a locale that groups with a comma', () => {
    // The control: the locale is really doing the work, rather than the assertion above passing
    // because the formatter ignores its argument and de-DE happens to be the runtime default.
    const out = statusReadouts(caret, { totalCharacters: 1_048_576, totalWords: 1 }, 'en-GB');
    expect(out.find((r) => r.id === 'chars')?.text).toBe('1,048,576 chars');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Before the counts have settled
 * ────────────────────────────────────────────────────────────────────────── */

describe('a document whose counts have not settled yet', () => {
  it('omits the count readouts rather than showing a zero', () => {
    /*
     * FR-008b lets the counts lag up to 200 ms. `0 chars` during that window is a wrong figure
     * rendered confidently; absent is the honest state, and it is what FR-017 asks for anyway.
     */
    strip({ line: 1, column: 1 });

    expect(maybeReadout('chars')).toBeNull();
    expect(maybeReadout('words')).toBeNull();
    expect(readout('line'), 'the caret figures do NOT wait — they are synchronous').toHaveTextContent(
      'Ln 1',
    );
  });
});
