/**
 * 043 T057/T059 — the Find in Files results list: what it lists, how it highlights, and how it
 * survives a result set nothing bounds.
 *
 * ══ FOUR CLAIMS ABOUT THE RENDERED LIST ══
 *
 *   1. FR-032 — one row per MATCH. A file with three occurrences contributes three rows, each
 *      independently there to be acted on, never one row standing for the file.
 *   2. FR-036 — the matched text is highlighted INSIDE its snippet, with an ellipsis marking only
 *      the side that was actually truncated. A snippet that shows an ellipsis on an untruncated
 *      side is claiming text was cut that never was.
 *   3. FR-034a — results open EXPANDED at every grouping, so every row is reachable without an
 *      expand action; FR-034 — a collapsed group stays present and says how many matches it holds,
 *      digit-grouped (FR-014).
 *   4. FR-044 — the highlight's colours resolve from the search-match tokens 013 already ships.
 *      This is asserted over the STYLESHEET's source rather than through `getComputedStyle`,
 *      because jsdom does not substitute `var()` — a computed-style assertion here would read back
 *      the literal text or nothing at all, and pass either way. What the source can say exactly is
 *      the thing FR-044 asks: these rules read `searchMatch`/`searchMatchCurrent`, every colour they
 *      read is a token that already exists, and no colour is written into the sheet by hand.
 *
 * ══ AND ONE ABOUT THE LIST BEING WINDOWED (T059) ══
 *
 * Nothing in this renderer is windowed today (research R18), and the spec's Assumptions decline a
 * match ceiling — so a results list that renders every row is one `Ctrl+Shift+F` on a common word
 * away from painting tens of thousands of nodes. The assertion is structural, not timed: the DOM
 * holds a small window while the scroll extent covers the whole list, and scrolling changes WHICH
 * rows are in the DOM. jsdom has no layout, so the scroller's geometry is supplied the only way it
 * can be — `defineProperty` on the element, which is exactly what the component reads.
 */
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatGrouped } from '@throng/core';
import { RESULT_ROW_HEIGHT_PX } from '../../src/renderer/find-in-files/results-list.js';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  PANEL_ID,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
  resultRow,
  type FileSearchStub,
} from './helpers/find-in-files.js';

let bridge: FileSearchStub;

function mount(): void {
  renderFindInFilesPanel();
}

beforeEach(() => {
  __resetFindInFilesState();
  bridge = installFileSearchStub();
});

afterEach(() => {
  removeFileSearchStub();
  __resetFindInFilesState();
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-032 — one row per match
 * ────────────────────────────────────────────────────────────────────────── */

describe('the results list holds one row per match (FR-032)', () => {
  it('gives a file with three occurrences three rows, not one', () => {
    mount();
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [
        resultRow('src/a.ts', 3, 10),
        resultRow('src/a.ts', 9, 120),
        resultRow('src/a.ts', 40, 400),
        resultRow('src/b.ts', 1, 0),
      ],
      totalMatches: 4,
      filesScanned: 2,
    });

    expect(screen.getAllByTestId(/^fif-row-/)).toHaveLength(4);
    // Two files, so two headings — and the headings are not what carries the matches.
    expect(screen.getAllByTestId(/^fif-group-header-/)).toHaveLength(2);
    expect(screen.getByTestId('fif-row-src/a.ts-120')).toBeInTheDocument();
  });

  it('shows the total, digit-grouped, once the scan completes (FR-014)', () => {
    mount();
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [resultRow('src/a.ts', 1, 0)],
      totalMatches: 4096,
      filesScanned: 2048,
    });

    expect(screen.getByTestId(`fif-total-${PANEL_ID}`)).toHaveTextContent(formatGrouped(4096));
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-036 — the match, highlighted inside its snippet, with honest ellipses
 * ────────────────────────────────────────────────────────────────────────── */

describe('each row highlights the match inside its snippet (FR-036)', () => {
  it('marks the matched text and leaves the surrounding context unmarked', () => {
    mount();
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [resultRow('src/a.ts', 3, 10)],
      totalMatches: 1,
    });

    const row = screen.getByTestId('fif-row-src/a.ts-10');
    const mark = within(row).getByTestId('fif-match');
    expect(mark).toHaveTextContent('needle');
    expect(mark.className).toContain('fif-match');
    // The context is present and is NOT inside the mark — a row that highlighted the whole
    // snippet would satisfy "the match is highlighted" and show the user nothing.
    expect(row).toHaveTextContent('const needle = 1;');
    expect(mark.textContent).toBe('needle');
  });

  it('shows an ellipsis only on the side that was truncated', () => {
    mount();
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [
        resultRow('src/a.ts', 3, 10, { truncatedStart: true, truncatedEnd: false }),
        resultRow('src/b.ts', 4, 20, { truncatedStart: false, truncatedEnd: true }),
        resultRow('src/c.ts', 5, 30, { truncatedStart: false, truncatedEnd: false }),
      ],
      totalMatches: 3,
    });

    const leading = screen.getByTestId('fif-row-src/a.ts-10');
    expect(within(leading).queryByTestId('fif-ellipsis-start')).not.toBeNull();
    expect(within(leading).queryByTestId('fif-ellipsis-end')).toBeNull();

    const trailing = screen.getByTestId('fif-row-src/b.ts-20');
    expect(within(trailing).queryByTestId('fif-ellipsis-start')).toBeNull();
    expect(within(trailing).queryByTestId('fif-ellipsis-end')).not.toBeNull();

    const whole = screen.getByTestId('fif-row-src/c.ts-30');
    expect(within(whole).queryByTestId('fif-ellipsis-start')).toBeNull();
    expect(within(whole).queryByTestId('fif-ellipsis-end')).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-034a / FR-034 — open expanded; a collapsed group keeps its count
 * ────────────────────────────────────────────────────────────────────────── */

describe('groups open expanded and collapse to a count (FR-034a, FR-034, FR-014)', () => {
  it('shows every match row with no expand action first', () => {
    mount();
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [
        resultRow('src/a.ts', 1, 0),
        resultRow('src/a.ts', 2, 30),
        resultRow('lib/deep/c.ts', 7, 70),
      ],
      totalMatches: 3,
    });

    expect(screen.getAllByTestId(/^fif-row-/)).toHaveLength(3);
    // The toggle names what the CLICK will do, so an expanded group offers "Collapse".
    for (const toggle of screen.getAllByTestId(/^fif-group-toggle-/)) {
      expect(toggle.getAttribute('title')).toMatch(/collapse/i);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
    }
  });

  it('keeps a collapsed group present, showing its digit-grouped match count', async () => {
    const user = userEvent.setup({ delay: null });
    mount();
    // 1,234 matches in one file and one in another: the collapsed heading is the only place that
    // count is readable, so it is the place FR-014 has to be true.
    const many = Array.from({ length: 1234 }, (_, i) => resultRow('src/big.ts', i + 1, i * 10));
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: [...many, resultRow('src/small.ts', 1, 0)],
      totalMatches: 1235,
    });

    await user.click(screen.getByTestId('fif-group-toggle-src/big.ts'));

    const heading = screen.getByTestId('fif-group-header-src/big.ts');
    expect(heading).toBeInTheDocument();
    expect(within(heading).getByTestId('fif-group-count-src/big.ts')).toHaveTextContent(
      formatGrouped(1234),
    );
    expect(screen.getByTestId('fif-group-toggle-src/big.ts').getAttribute('aria-expanded')).toBe(
      'false',
    );
    // Its rows are gone; the other group's row is untouched.
    expect(screen.queryByTestId('fif-row-src/big.ts-0')).toBeNull();
    expect(screen.getByTestId('fif-row-src/small.ts-0')).toBeInTheDocument();
  });
});

/* FR-044 (colour tokens) and FR-079/FR-085 (stylesheet text) moved to unit/find-in-files-css.test.ts. */

/* ────────────────────────────────────────────────────────────────────────── *
 * T059 — the list is windowed
 * ────────────────────────────────────────────────────────────────────────── */

describe('the results list is virtualised (T059, FR-041)', () => {
  const HUGE = 4000;

  function emitHuge(): void {
    bridge.emit({
      panelId: PANEL_ID,
      generation: 1,
      status: 'complete',
      rows: Array.from({ length: HUGE }, (_, i) => resultRow('src/big.ts', i + 1, i * 10)),
      totalMatches: HUGE,
    });
  }

  it('renders a small window of a large result set, sized for the whole of it', () => {
    mount();
    emitHuge();

    const rendered = screen.getAllByTestId(/^fif-row-/);
    expect(rendered.length).toBeLessThan(200);
    expect(rendered.length).toBeGreaterThan(0);

    // The scroll extent still covers every row plus its heading, so the scrollbar tells the truth
    // about how much there is — the thing a hard cap at 200 rows cannot do.
    const sizer = screen.getByTestId(`fif-sizer-${PANEL_ID}`);
    expect(sizer.style.height).toBe(`${(HUGE + 1) * RESULT_ROW_HEIGHT_PX}px`);
  });

  it('renders different rows once the list is scrolled', () => {
    mount();
    emitHuge();

    expect(screen.getByTestId('fif-row-src/big.ts-0')).toBeInTheDocument();
    const deep = 2000;
    expect(screen.queryByTestId(`fif-row-src/big.ts-${deep * 10}`)).toBeNull();

    const scroller = screen.getByTestId(`fif-results-${PANEL_ID}`);
    // jsdom has no layout, so the scroller's geometry is supplied rather than measured — these are
    // exactly the two properties the component reads off the event target.
    Object.defineProperty(scroller, 'scrollTop', {
      value: deep * RESULT_ROW_HEIGHT_PX,
      configurable: true,
    });
    Object.defineProperty(scroller, 'clientHeight', { value: 400, configurable: true });
    fireEvent.scroll(scroller);

    expect(screen.getByTestId(`fif-row-src/big.ts-${deep * 10}`)).toBeInTheDocument();
    expect(screen.queryByTestId('fif-row-src/big.ts-0')).toBeNull();
  });
});
