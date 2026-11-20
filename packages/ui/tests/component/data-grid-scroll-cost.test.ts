/**
 * 073 SC-009, T039 — what the shared grid does per frame while the reader scrolls it, counted on 3,000 and 10,000 rows of
 * 50 columns with Wrap off and on. Maintainer reports: horizontal scrolling a CSV preview is laggy (MT-01); scrolling a
 * CSV in step with its editor lags (MT-10).
 *
 * What a count CAN show here: React commits per frame, how many cells React rendered against how many reached the DOM
 * (a cell rendered and thrown away in the same frame is pure waste), and whether a frame re-measured text. What it CANNOT
 * show: how long any of it takes — jsdom has no layout, paint or compositor. A frame time needs a DevTools trace.
 * (Rendered cells are compared with cells added only where no row is sized: with Wrap on, sizing a row reads every cell of
 * it through `getCell`, which is not a render.)
 *
 * The one cost that was real and removable: with Wrap on, a row entering the window was drawn at the estimated height,
 * then sized in a layout effect, which asked for a SECOND commit that dropped the rows the first one had drawn only because
 * the estimate was short. Rows are now sized in the virtualiser's own change notice, before React renders the frame.
 *
 * Layer: component — the grid mounted whole over a Profiler, with the scroller's offsets held by the test.
 */
import { act, render } from '@testing-library/react';
import { createElement, Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataGrid, type DataGridProps } from '../../src/renderer/grid/data-grid.js';

const ROW = 22;
const FRAMES = 30;
const frame = (): Promise<void> => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

/** Column 2 wraps over one to four times its natural lines, so every row has its own height with Wrap on. */
const cellText = (r: number, c: number): string => (c === 2 ? 'a long cell value that wraps over several lines when narrow '.repeat((r % 4) + 1) : `v${r}.${c}`);

let canvases = 0;
let styleReads = 0;
beforeEach(() => {
  canvases = 0;
  styleReads = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ((canvases += 1), { font: '', measureText: (t: string) => ({ width: t.length * 8 }) }) as unknown as CanvasRenderingContext2D,
  );
  const gcs = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((...a: Parameters<typeof gcs>) => ((styleReads += 1), gcs(...a)));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

interface Frame {
  commits: number;
  nested: number;
  cellRenders: number;
  cellsAdded: number;
  /** Rows that entered the DOM and left it again within one frame. */
  churned: number;
  /** Commits once the scrolling stops: the virtualiser's scroll-stop notice, run after the counted frames. */
  settle: number;
  canvases: number;
  styleReads: number;
}

async function scrollFrames(rows: number, wrap: boolean, axis: 'vertical' | 'horizontal', from = 0, step?: number): Promise<Frame> {
  let cellRenders = 0;
  let commits = 0;
  let nested = 0;
  const props: DataGridProps = {
    testId: 'g',
    rowCount: rows,
    colCount: 50,
    getCell: (r, c) => ((cellRenders += 1), cellText(r, c)),
    editable: true,
    columnWidths: {},
    zoom: 1,
    wrap,
    onColumnWidthChange: () => {},
  };
  const view = render(
    createElement(
      Profiler,
      { id: 'g', onRender: (_id: string, phase: string) => void ((commits += 1), phase === 'nested-update' && (nested += 1)) },
      createElement(DataGrid, props),
    ),
  );
  await frame();
  /*
   * The virtualiser reports "scrolling stopped" from a 150 ms timer that every scroll event restarts. On a slow runner a
   * frame can outlast it, and the stop notice's commit then lands inside the counted frames (Windows CI: 31 commits in
   * 30 frames) although the reader never stopped. Timers are held from the first scroll and run after the last frame,
   * where that commit is counted on its own (`settle`).
   */
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const scroller = view.container.querySelector<HTMLElement>('.data-grid__scroller')!;
  let top = 0;
  let left = 0;
  Object.defineProperty(scroller, 'scrollTop', { get: () => top, set: (v: number) => void (top = v), configurable: true });
  Object.defineProperty(scroller, 'scrollLeft', { get: () => left, set: (v: number) => void (left = v), configurable: true });
  const at = (i: number): void => {
    if (axis === 'vertical') top = from + i * (step ?? (wrap ? 400 : 5 * ROW));
    else left = from + i * (step ?? 150);
    act(() => void scroller.dispatchEvent(new Event('scroll')));
  };
  if (from > 0) {
    at(0); // arrive at the start offset, then let it settle before counting
    await frame();
    act(() => void vi.runOnlyPendingTimers());
  }
  let added = 0;
  const cellsIn = (n: Node): number => (n instanceof HTMLElement ? (n.hasAttribute('data-grid-cell') ? 1 : n.querySelectorAll('[data-grid-cell]').length) : 0);
  let churned = 0;
  const pending: MutationRecord[] = [];
  const mo = new MutationObserver((records) => void pending.push(...records));
  mo.observe(view.container, { subtree: true, childList: true });
  /** Reads one frame's records: the cells that came in, and the nodes that both came in and went out. */
  const drain = (): void => {
    const came = new Set<Node>();
    const went = new Set<Node>();
    pending.push(...mo.takeRecords());
    for (const r of pending.splice(0)) {
      for (const n of r.addedNodes) {
        added += cellsIn(n);
        came.add(n);
      }
      for (const n of r.removedNodes) went.add(n);
    }
    for (const n of came) if (went.has(n)) churned += 1;
  };
  commits = nested = cellRenders = canvases = styleReads = 0;
  for (let i = 1; i <= FRAMES; i += 1) {
    at(i);
    await frame();
    drain();
  }
  const counted = commits;
  act(() => void vi.runOnlyPendingTimers());
  const settle = commits - counted;
  vi.useRealTimers();
  mo.disconnect();
  view.unmount();
  return { commits: counted, nested, cellRenders, cellsAdded: added, churned, canvases, styleReads, settle };
}

describe.each([
  [3000, true],
  [10000, true],
])('a %i-row grid, Wrap %s, scrolled fast (400 px a frame)', (rows, wrap) => {
  it('going down: every frame is one commit, no cell is rendered and then dropped, text is not re-measured from the DOM', async () => {
    const f = await scrollFrames(rows, wrap, 'vertical');
    expect(f.cellsAdded).toBeGreaterThan(FRAMES); // rows really entered: the bounds below are not vacuous
    expect(f.nested).toBe(0); // was 0.4 a frame: a row entering at the estimate was sized in a second commit
    expect(f.commits).toBeLessThanOrEqual(FRAMES);
    expect(f.settle).toBeLessThanOrEqual(1); // stopping costs one commit, not one per frame
    expect(f.churned).toBe(0); // a row drawn at the estimate and dropped once its neighbours were sized
    expect(f.styleReads).toBe(0); // the canvas font is read once per width/zoom/content, not once per frame that sizes a row
    expect(f.canvases).toBe(0);
  }, 120_000);

  it('going up: the same bounds hold when rows enter above the fold', async () => {
    const f = await scrollFrames(rows, wrap, 'vertical', 20_000, -400);
    expect(f.cellsAdded).toBeGreaterThan(FRAMES);
    expect(f.nested).toBe(0);
    expect(f.commits).toBeLessThanOrEqual(FRAMES);
    expect(f.settle).toBeLessThanOrEqual(1); // stopping costs one commit, not one per frame
    expect(f.churned).toBe(0);
    expect(f.styleReads).toBe(0);
  }, 120_000);
});

describe.each([
  [3000, false],
  [3000, true],
  [10000, false],
  [10000, true],
])('a %i-row grid, Wrap %s, scrolled sideways (MT-01)', (rows, wrap) => {
  it('every frame is one commit, only the cells that entered are rendered, and no text is measured', async () => {
    const f = await scrollFrames(rows, wrap, 'horizontal');
    expect(f.cellsAdded).toBeGreaterThan(FRAMES);
    expect(f.nested).toBe(0);
    expect(f.commits).toBeLessThanOrEqual(FRAMES);
    expect(f.settle).toBeLessThanOrEqual(1); // stopping costs one commit, not one per frame
    expect(f.cellRenders).toBeLessThanOrEqual(f.cellsAdded); // a memoised cell that stays in the window is not rendered again
    expect(f.styleReads).toBe(0);
    expect(f.canvases).toBe(0);
  }, 120_000);
});

describe.each([
  [3000, false],
  [10000, false],
])('a %i-row grid, Wrap %s, scrolled slowly down (110 px a frame)', (rows, wrap) => {
  it('every frame is one commit and renders only the cells that entered', async () => {
    const f = await scrollFrames(rows, wrap, 'vertical');
    expect(f.cellsAdded).toBeGreaterThan(FRAMES);
    expect(f.nested).toBe(0);
    expect(f.commits).toBeLessThanOrEqual(FRAMES);
    expect(f.settle).toBeLessThanOrEqual(1); // stopping costs one commit, not one per frame
    expect(f.cellRenders).toBeLessThanOrEqual(f.cellsAdded);
  }, 120_000);
});
