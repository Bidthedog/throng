/**
 * 043 review — every listed match stays REACHABLE, however the panel and the list change shape.
 *
 * Two defects, one subject. The results list is windowed (`results-list.tsx`), and a window is only
 * honest while the two numbers behind it — how tall the viewport is, and where the reading position
 * is — still describe the list that is actually on screen.
 *
 *   1. **The viewport was measured once, on mount.** `.fif-results` is `flex: 1 1 auto`, so it grows
 *      with the panel; the mounted slice did not. Drag a split from ~200px to ~900px and the list
 *      keeps the same short window with blank space under it — and because the content is then
 *      SHORTER than the scroller there is no scrollbar, no scroll event can fire, and the matches
 *      past the window cannot be reached with the mouse at all. Every neighbour that has this
 *      problem already solves it with a `ResizeObserver` (`file-tree.tsx`, `editor/status-strip.tsx`,
 *      `vertical-panel-stack.tsx`, `tab-group.tsx`, `use-terminal.ts`).
 *
 *   2. **The reading position was never clamped or reset.** Step to the end of a long list, then
 *      shorten it — collapse a group, or re-run a narrower search — and `current` names an index
 *      that no longer exists: `Enter` returns before it does anything, no row carries `aria-current`
 *      so nothing explains the silence, and `ArrowUp` writes a `scrollTop` far past the now-short
 *      content, which pins the window to a SINGLE mounted row that no scroll event can ever undo.
 *
 * ══ HOW THE VIEWPORT IS DRIVEN HERE ══
 *
 * jsdom has no layout: every rect is 0×0 and `ResizeObserver` is not implemented at all. So the
 * observer is stubbed exactly as `status-strip-fit-wiring.test.ts` stubs it — reporting a height on
 * `observe()` and again whenever {@link resizeTo} says so. The re-reporting half is the whole point:
 * defect 1 IS a resize, and a stub that only ever reported an initial size could not express it.
 *
 * What stays end-to-end is that the rows are VISIBLE and that the scrollbar disappears. Those are
 * facts about pixels. What this tier can prove is the fact that actually regressed: which rows are
 * mounted in the DOM, and which row the keyboard acts on.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  registerResultOpener,
  type ResultOpenRequest,
} from '../../src/renderer/find-in-files/result-open.js';
import {
  PANEL_ID,
  PROJECT_ROOT,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
  resultRow,
  type FileSearchStub,
} from './helpers/find-in-files.js';

/* ────────────────────────────────────────────────────────────────────────── *
 * A ResizeObserver that can report a SECOND size
 * ────────────────────────────────────────────────────────────────────────── */

/** The height every live observer reports. Reassigned by {@link resizeTo}. */
let viewportPx = 480;

interface Entry {
  cb: ResizeObserverCallback;
  targets: Set<Element>;
  self: ResizeObserver;
}

const observers = new Set<Entry>();

function report(entry: Entry): void {
  const contentRect = {
    width: 300,
    height: viewportPx,
    top: 0,
    left: 0,
    right: 300,
    bottom: viewportPx,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } satisfies DOMRectReadOnly;
  for (const target of entry.targets) {
    entry.cb([{ target, contentRect } as ResizeObserverEntry], entry.self);
  }
}

class StubResizeObserver implements ResizeObserver {
  private readonly entry: Entry;
  constructor(cb: ResizeObserverCallback) {
    this.entry = { cb, targets: new Set(), self: this };
    observers.add(this.entry);
  }
  observe(target: Element): void {
    this.entry.targets.add(target);
    report(this.entry);
  }
  unobserve(target: Element): void {
    this.entry.targets.delete(target);
  }
  disconnect(): void {
    observers.delete(this.entry);
  }
}

/** The panel was made taller — a split drag, a maximise, the sidebar hidden, replace put away. */
function resizeTo(px: number): void {
  viewportPx = px;
  act(() => {
    for (const entry of [...observers]) report(entry);
  });
}

let original: typeof globalThis.ResizeObserver | undefined;

beforeAll(() => {
  original = globalThis.ResizeObserver;
  globalThis.ResizeObserver = StubResizeObserver;
});

afterAll(() => {
  if (original) globalThis.ResizeObserver = original;
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Fixtures
 * ────────────────────────────────────────────────────────────────────────── */

let bridge: FileSearchStub;

const list = (): HTMLElement => screen.getByTestId(`fif-results-${PANEL_ID}`);
const rows = (): HTMLElement[] => screen.queryAllByTestId(/^fif-row-/);

/** `count` matches in one file, at offsets 0, 10, 20 … so a row's test id names its ordinal. */
function matchesIn(relPath: string, count: number): ReturnType<typeof resultRow>[] {
  return Array.from({ length: count }, (_, i) => resultRow(relPath, i + 1, i * 10));
}

function emit(generation: number, ...rowsIn: ReturnType<typeof resultRow>[]): void {
  bridge.emit({
    panelId: PANEL_ID,
    generation,
    status: 'complete',
    rows: rowsIn,
    totalMatches: rowsIn.length,
    filesScanned: 2,
  });
}

/**
 * Give the scroller a real geometry and scroll it.
 *
 * The two properties are exactly the ones `onScroll` reads off the event target; jsdom supplies
 * neither, so they are defined rather than measured.
 */
function scrollTo(px: number): void {
  const el = list();
  Object.defineProperty(el, 'scrollTop', { value: px, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: viewportPx, configurable: true });
  fireEvent.scroll(el);
}

beforeEach(() => {
  viewportPx = 480;
  __resetFindInFilesState();
  bridge = installFileSearchStub();
});

afterEach(() => {
  registerResultOpener(null);
  removeFileSearchStub();
  __resetFindInFilesState();
});

/* ────────────────────────────────────────────────────────────────────────── *
 * 1 — the list re-measures when the panel it lives in changes size
 * ────────────────────────────────────────────────────────────────────────── */

describe('the window follows the panel’s height, not the height it had on mount', () => {
  it('mounts a window sized for the SHORT panel it was dropped into', () => {
    // A Find in Files panel in a ~200px split: ten rows fit, and the overscan mounts a few more.
    viewportPx = 200;
    renderFindInFilesPanel();
    emit(1, ...matchesIn('src/a.ts', 40));

    // One heading plus twenty-two rows — `ceil(200 / 22) + 2 * 6 + 1` items.
    expect(rows()).toHaveLength(22);
    expect(screen.queryByTestId('fif-row-src/a.ts-390')).toBeNull();
  });

  it('mounts the rest once the split is dragged taller — the mouse has no other way to them', () => {
    viewportPx = 200;
    renderFindInFilesPanel();
    emit(1, ...matchesIn('src/a.ts', 40));
    expect(screen.queryByTestId('fif-row-src/a.ts-390')).toBeNull();

    resizeTo(900);

    /*
     * The whole of the defect is here. At 900px the content (41 items × 22px = 902px) no longer
     * overflows the scroller, so there is no scrollbar and no scroll event will ever fire again —
     * if the window does not grow with the panel, these seventeen matches are unreachable with a
     * mouse for as long as the panel stays that size.
     */
    expect(rows()).toHaveLength(40);
    expect(screen.getByTestId('fif-row-src/a.ts-390')).toBeInTheDocument();
  });

  it('follows the panel back down again', () => {
    renderFindInFilesPanel();
    emit(1, ...matchesIn('src/a.ts', 40));
    resizeTo(900);
    expect(rows()).toHaveLength(40);

    resizeTo(200);

    expect(rows()).toHaveLength(22);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * 2 — the reading position survives the list shrinking under it
 * ────────────────────────────────────────────────────────────────────────── */

describe('the reading position stays inside the list it is reading', () => {
  /**
   * Step to the end of a long list, come back to the top, then collapse the big group.
   *
   * 422 items become 22, and the position — index 421 — names nothing. Scrolling back first is not
   * ceremony: at the bottom of a 400-match file the group's own toggle is not mounted, so there
   * would be nothing to click.
   */
  function endThenCollapse(): void {
    renderFindInFilesPanel();
    emit(1, ...matchesIn('src/big.ts', 400), ...matchesIn('src/small.ts', 20));

    fireEvent.keyDown(list(), { key: 'End' });
    scrollTo(0);
    fireEvent.click(screen.getByTestId('fif-group-toggle-src/big.ts'));
  }

  it('keeps exactly one row current, so the highlight still explains where Enter will act', () => {
    endThenCollapse();

    const current = document.querySelectorAll('[data-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute('aria-current', 'true');
  });

  it('opens the row Enter lands on rather than doing nothing at all', () => {
    const opened: ResultOpenRequest[] = [];
    registerResultOpener((r) => opened.push(r));
    endThenCollapse();

    fireEvent.keyDown(list(), { key: 'Enter' });

    // The last row of the group that is still expanded — the one the clamped position lands on. It
    // carries the PANEL's root as well (043 T236), which a sub-workspace window has none of its own.
    expect(opened).toEqual([
      { relPath: 'src/small.ts', from: 190, to: 196, projectRoot: PROJECT_ROOT },
    ]);
  });

  it('does not collapse the mounted window to a single row on ArrowUp', () => {
    endThenCollapse();

    fireEvent.keyDown(list(), { key: 'ArrowUp' });

    /*
     * An unclamped position writes a `scrollTop` of ~8,800px into a list whose content is 484px
     * tall. `visibleRange` then clamps `start` to the last item and mounts exactly one — and since
     * the content is shorter than the viewport, no scroll event can ever reset it. The list stays
     * showing one row, and the only way out is to double-click it, which opens a file nobody asked
     * for.
     */
    expect(rows()).toHaveLength(20);
  });

  it('starts a new run’s list at the top rather than at an index the old one had', () => {
    const opened: ResultOpenRequest[] = [];
    registerResultOpener((r) => opened.push(r));
    renderFindInFilesPanel();
    emit(1, ...matchesIn('src/big.ts', 400));
    fireEvent.keyDown(list(), { key: 'End' });

    // A narrower search. These are different matches, and the position from the old list is a
    // statement about rows this list no longer holds.
    emit(2, ...matchesIn('src/small.ts', 3));
    fireEvent.keyDown(list(), { key: 'Enter' });

    // Index 0 of a fresh list is the group HEADING, so Enter collapses it and opens nothing.
    expect(opened).toEqual([]);
    expect(screen.getByTestId('fif-group-toggle-src/small.ts')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});
