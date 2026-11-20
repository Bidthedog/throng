/**
 * 073 FR-033c — a CSV preview scrolls in step with its text editor, both ways, through the same body contract the
 * Markdown preview keeps (044 FR-113, FR-121): the chrome hands down `syncLine` (the editor's top line, 0-based) and
 * `syncEcho`; the body reports its own scrolls through `onTopLineChange` and answers `onTopLineRead`.
 *
 * The grid's top visible row is the record whose first line is the preview's place: a record that spans lines maps to its
 * first line, and a line inside one maps back to that record. Wrap and the locked row are respected: the top row is the
 * first row not under the locked one, with each row's own height.
 *
 * Layer: component — the body over a real DataGrid, the scroller's offsets stubbed (jsdom does not scroll). The mapping
 * itself is `csv-record-lines.test.ts`'s; the chrome's wiring of `syncLine` is the panel's.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CsvBody } from '../../src/renderer/preview/providers/csv/csv-body.js';
import { __resetColumnWidthCache } from '../../src/renderer/preview/providers/csv/column-widths.js';
import type { PreviewBodyProps } from '../../src/renderer/preview/provider-view.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { __resetPreviewStore } from '../../src/renderer/preview/preview-store.js';

const FILE = 'D:/proj/data.csv';
const ROW = 22;

/** One record per line: record r is on line r. */
const plain = (n: number): string => `h\n${Array.from({ length: n - 1 }, (_, i) => `v${i}`).join('\n')}\n`;
/** Record 3 holds two line breaks, so records 3.. start two lines later than their number: starts = 0,1,2,3,6,7… */
const multi = (n: number): string =>
  Array.from({ length: n }, (_, i) => (i === 3 ? '"p\nq\nr"' : `v${i}`)).join('\n') + '\n';

const base = (text: string, over: Partial<PreviewBodyProps> = {}): PreviewBodyProps => ({
  panelId: 'p1',
  content: { kind: 'text', text },
  filePath: FILE,
  projectRoot: 'D:/proj',
  providerSettings: { enabled: true },
  initialViewState: undefined,
  navigationSeq: 1,
  onViewStateCapture: () => {},
  onFollow: () => {},
  onNotice: () => {},
  onDrawn: () => {},
  onBodyFailure: () => {},
  ...over,
});
const tree = (p: PreviewBodyProps) => createElement(ContextMenuProvider, { children: createElement(CsvBody, p) });

let scroller: HTMLElement;
let top = 0;
function track(): void {
  scroller = document.querySelector<HTMLElement>('.data-grid__scroller')!;
  Object.defineProperty(scroller, 'scrollTop', { get: () => top, set: (v: number) => void (top = v), configurable: true });
  Object.defineProperty(scroller, 'scrollLeft', { get: () => 0, set: () => {}, configurable: true });
}
/** The reader scrolls: a new offset, then the scroll event. */
function scrollBy(to: number): void {
  top = to;
  act(() => {
    fireEvent.scroll(scroller);
  });
}
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 40));

function mount(text: string, over: Partial<PreviewBodyProps> = {}) {
  const onTopLineChange = vi.fn((_line: number): boolean | void => undefined);
  const view = render(tree(base(text, { onTopLineChange, syncLine: null, ...over })));
  track();
  const update = (next: Partial<PreviewBodyProps>): void => view.rerender(tree(base(text, { onTopLineChange, ...over, ...next })));
  return { onTopLineChange, update, view };
}

beforeEach(() => {
  top = 0;
  const range = Range.prototype as unknown as Record<string, unknown>;
  range.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  range.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 });
  window.throng = { preview: {} } as unknown as typeof window.throng;
});
afterEach(() => {
  vi.restoreAllMocks();
  delete window.throng;
  __resetPreviewStore();
  __resetColumnWidthCache();
});

describe('the editor scrolls, the CSV follows (FR-033c, FR-113)', () => {
  it('brings the record on the editor\'s top line to the top of the grid', () => {
    const m = mount(plain(300));
    m.update({ syncLine: 120 });
    expect(top).toBe(120 * ROW);
  });

  it('a line inside a multi-line record is that record; a later record starts at its own first line', () => {
    const m = mount(multi(60));
    m.update({ syncLine: 5 }); // inside record 3 (lines 3 – 5)
    expect(top).toBe(3 * ROW);
    m.update({ syncLine: 8 }); // record 4 starts on line 6, record 5 on line 7, record 6 on line 8
    expect(top).toBe(6 * ROW);
  });

  it('applies a line once: an unchanged line does not pull a reader who scrolled by hand back', async () => {
    const m = mount(plain(300));
    m.update({ syncLine: 50 });
    scrollBy(200 * ROW);
    m.update({ syncLine: 50 });
    expect(top).toBe(200 * ROW);
    await settle();
  });

  it('an echo (the editor following this preview) is recorded and never scrolled to', () => {
    const m = mount(plain(300));
    m.update({ syncLine: 80, syncEcho: true });
    expect(top).toBe(0);
  });

  it('leaves the selection where it was', () => {
    const m = mount(plain(300));
    const cell = document.querySelector<HTMLElement>('[data-grid-cell][data-row="2"][data-col="0"]')!;
    fireEvent.mouseDown(cell, { button: 0 });
    fireEvent.mouseUp(window);
    m.update({ syncLine: 120 });
    // The selected cell is still the active one when the window is back over it.
    scrollBy(0);
    expect(document.querySelector('[data-grid-cell].data-grid__cell--active')?.getAttribute('data-row')).toBe('2');
  });

  it('does nothing while sync does not apply (no line)', () => {
    const m = mount(plain(300));
    m.update({ syncLine: null });
    expect(top).toBe(0);
  });

  it('when the record is already at the top, nothing moves', () => {
    const m = mount(plain(300));
    scrollBy(50 * ROW);
    m.update({ syncLine: 50 });
    expect(top).toBe(50 * ROW);
  });
});

describe('the CSV scrolls, the editor follows (FR-033c, FR-121f)', () => {
  it('reports the first source line of the record now at the top, once the scroll settles', async () => {
    const m = mount(plain(300), { syncLine: 0 });
    scrollBy(40 * ROW);
    await waitFor(() => expect(m.onTopLineChange).toHaveBeenCalledWith(40));
    expect(m.onTopLineChange).toHaveBeenCalledTimes(1);
  });

  it('a multi-line record reports its first line, and the record after it the line it really starts on', async () => {
    const m = mount(multi(60), { syncLine: 0 });
    scrollBy(3 * ROW);
    await waitFor(() => expect(m.onTopLineChange).toHaveBeenLastCalledWith(3));
    scrollBy(4 * ROW);
    await waitFor(() => expect(m.onTopLineChange).toHaveBeenLastCalledWith(6));
  });

  it('coalesces a burst of scrolls into one report', async () => {
    const m = mount(plain(300), { syncLine: 0 });
    for (const y of [5, 9, 20, 33]) scrollBy(y * ROW);
    await waitFor(() => expect(m.onTopLineChange).toHaveBeenCalled());
    await settle();
    expect(m.onTopLineChange).toHaveBeenCalledTimes(1);
    expect(m.onTopLineChange).toHaveBeenCalledWith(33);
  });

  it('never reports the scroll it made to follow the editor (no feedback loop)', async () => {
    const m = mount(plain(300), { syncLine: 0 });
    m.update({ syncLine: 120 });
    act(() => {
      fireEvent.scroll(scroller);
    });
    await settle();
    expect(m.onTopLineChange).not.toHaveBeenCalled();
  });

  it('reports a scroll of the reader\'s after it followed the editor, once the reader moves on', async () => {
    const m = mount(plain(300), { syncLine: 0 });
    m.update({ syncLine: 120 });
    scrollBy(10 * ROW);
    await waitFor(() => expect(m.onTopLineChange).toHaveBeenCalledWith(10));
  });

  it('does not report onto the record the editor is already at', async () => {
    const m = mount(plain(300), { syncLine: 30 });
    scrollBy(30 * ROW);
    await settle();
    expect(m.onTopLineChange).not.toHaveBeenCalled();
  });

  it('reports nothing without a sync line (sync is off, or there is no editor)', async () => {
    const m = mount(plain(300), { syncLine: null });
    scrollBy(40 * ROW);
    await settle();
    expect(m.onTopLineChange).not.toHaveBeenCalled();
  });

  it('a report the chrome could not act on is made again when the editor\'s line next changes', async () => {
    const m = mount(plain(300), { syncLine: 0 });
    m.onTopLineChange.mockReturnValueOnce(false);
    scrollBy(40 * ROW);
    await waitFor(() => expect(m.onTopLineChange).toHaveBeenCalledTimes(1));
    m.update({ syncLine: 1, syncEcho: true });
    await waitFor(() => expect(m.onTopLineChange).toHaveBeenCalledTimes(2));
    expect(m.onTopLineChange).toHaveBeenLastCalledWith(40);
  });

  it('answers onTopLineRead with the line at the top now', () => {
    let read: (() => number | null) | undefined;
    const m = mount(multi(60), { syncLine: 0, onTopLineRead: (fn) => void (read = fn) });
    expect(read?.()).toBe(0);
    scrollBy(4 * ROW);
    expect(read?.()).toBe(6);
    m.view.unmount();
  });
});

describe('locks and wrap are respected (FR-033c)', () => {
  it('with the first row locked, the top row is the first one under it, and an editor line puts its record just below it', async () => {
    const m = mount(plain(300), { syncLine: 0, lockFirstRowChoice: true });
    scrollBy(40 * ROW);
    // Row 40 starts at 880 px, under the locked row (22 px): the first row clear of it is 41.
    await waitFor(() => expect(m.onTopLineChange).toHaveBeenCalledWith(41));
    m.update({ syncLine: 100 });
    expect(top).toBe(100 * ROW - ROW);
  });

  it('with wrap on, rows have their own heights: the top row is read from them', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => ({ font: '', measureText: (t: string) => ({ width: t.length * 8 }) }) as unknown as CanvasRenderingContext2D,
    );
    // Record 0 is three lines tall, so row 1 starts at 66 px and is record 1, on source line 3.
    const text = '"a\nb\nc"\n' + Array.from({ length: 80 }, (_, i) => `v${i}`).join('\n') + '\n';
    const m = mount(text, { syncLine: 0, wrapChoice: true });
    scrollBy(66);
    await waitFor(() => expect(m.onTopLineChange).toHaveBeenCalledWith(3));
  });
});

describe('the sync mark: the grid row in step with the editor (FR-033d)', () => {
  const markedRows = (): { row: number; on: boolean }[] =>
    [...document.querySelectorAll<HTMLElement>('.data-grid__row--sync-mark')].map((el) => ({
      row: Number(el.getAttribute('aria-rowindex')) - 2,
      on: el.classList.contains('data-grid__row--sync-mark-on'),
    }));

  it('marks the row of the record the line falls in, and none without a mark', () => {
    const m = mount(multi(60), { syncMark: null });
    expect(markedRows()).toEqual([]);
    m.update({ syncMark: { line: 5, on: true } }); // inside record 3 (lines 3 - 5)
    expect(markedRows()).toEqual([{ row: 3, on: true }]);
    m.update({ syncMark: { line: 8, on: true } }); // record 6 starts on line 8
    expect(markedRows()).toEqual([{ row: 6, on: true }]);
  });

  it('is off while it fades, and clears with the mark', () => {
    const m = mount(plain(100), { syncMark: { line: 4, on: true } });
    m.update({ syncMark: { line: 4, on: false } });
    expect(markedRows()).toEqual([{ row: 4, on: false }]);
    m.update({ syncMark: null });
    expect(markedRows()).toEqual([]);
  });

  it('marks the locked first row in its strip when the record is row 0', () => {
    mount(plain(100), { syncMark: { line: 0, on: true }, lockFirstRowChoice: true });
    expect(markedRows()).toEqual([{ row: 0, on: true }]);
    expect(document.querySelector('.data-grid__row--locked')).toHaveClass('data-grid__row--sync-mark');
  });

  it('is the same row with wrap on', () => {
    const text = '"a\nb\nc"\n' + Array.from({ length: 20 }, (_, i) => `v${i}`).join('\n') + '\n';
    mount(text, { syncMark: { line: 3, on: true }, wrapChoice: true }); // record 1 starts on line 3
    expect(markedRows()).toEqual([{ row: 1, on: true }]);
  });

  it('touches neither the selection nor the scroll', () => {
    const m = mount(plain(300));
    const before = top;
    m.update({ syncMark: { line: 120, on: true } });
    expect(top).toBe(before);
    expect(document.querySelector('.data-grid__cell--active')?.getAttribute('data-row') ?? '0').toBe('0');
  });
});
