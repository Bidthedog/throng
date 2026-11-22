/**
 * 073 FR-008d — a grid's selection (and scroll) belongs to the file it was made in. When a panel is moved to another CSV
 * (reuse by an open, or Back / Forward) the arriving file shows its own place — A1 on a first visit — and the file left
 * keeps its own for when the panel returns. A re-point of the same document (a Save As) is not a move and keeps the place.
 * Session only: nothing is written anywhere.
 *
 * Layer: component — the body stays mounted while its props change, which is exactly what a panel's navigation does to
 * it; what main stores on a history entry is `preview-history` territory and is not touched.
 */
import { fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CsvBody } from '../../src/renderer/preview/providers/csv/csv-body.js';
import { __resetColumnWidthCache } from '../../src/renderer/preview/providers/csv/column-widths.js';
import type { PreviewBodyProps } from '../../src/renderer/preview/provider-view.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { __resetPreviewStore } from '../../src/renderer/preview/preview-store.js';

const A = 'D:/proj/a.csv';
const B = 'D:/proj/b.csv';
const rows = (tag: string, n = 30): string => `h1,h2,h3\n${Array.from({ length: n }, (_, i) => `${tag}${i},x,y`).join('\n')}\n`;

const props = (filePath: string, text: string, navigationSeq: number): PreviewBodyProps => ({
  panelId: 'p1',
  content: { kind: 'text', text },
  filePath,
  projectRoot: 'D:/proj',
  providerSettings: { enabled: true },
  initialViewState: undefined,
  navigationSeq,
  onViewStateCapture: () => {},
  onFollow: () => {},
  onNotice: () => {},
  onDrawn: () => {},
  onBodyFailure: () => {},
});

const tree = (p: PreviewBodyProps) => createElement(ContextMenuProvider, { children: createElement(CsvBody, p) });
const cell = (r: number, c: number): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-grid-cell][data-row="${r}"][data-col="${c}"]`);
const activeCell = (): string | null => {
  const el = document.querySelector('[data-grid-cell].data-grid__cell--active');
  return el === null ? null : `${el.getAttribute('data-row')},${el.getAttribute('data-col')}`;
};
const select = (r: number, c: number): void => {
  fireEvent.mouseDown(cell(r, c)!, { button: 0 });
  fireEvent.mouseUp(window);
};

beforeEach(() => {
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

describe('a grid keeps its selection per file (FR-008d)', () => {
  it('a move to another CSV starts it at A1, whatever was selected in the file left', () => {
    const view = render(tree(props(A, rows('a'), 1)));
    select(4, 2);
    expect(activeCell()).toBe('4,2');
    view.rerender(tree(props(B, rows('b'), 2)));
    expect(activeCell()).toBe('0,0');
    expect(cell(0, 0)!.textContent).toBe('h1');
  });

  it('coming back to the file left finds its selection again', () => {
    const view = render(tree(props(A, rows('a'), 1)));
    select(4, 2);
    view.rerender(tree(props(B, rows('b'), 2)));
    select(6, 1);
    view.rerender(tree(props(A, rows('a'), 3)));
    expect(activeCell()).toBe('4,2');
    view.rerender(tree(props(B, rows('b'), 4)));
    expect(activeCell()).toBe('6,1');
  });

  it('a first visit to a file opens at A1 even after several others were visited', () => {
    const view = render(tree(props(A, rows('a'), 1)));
    select(3, 1);
    view.rerender(tree(props(B, rows('b'), 2)));
    select(5, 2);
    view.rerender(tree(props('D:/proj/c.csv', rows('c'), 3)));
    expect(activeCell()).toBe('0,0');
  });

  it('the same document re-pointed (a Save As changes the path, not the navigation) keeps the selection', () => {
    const view = render(tree(props(A, rows('a'), 1)));
    select(4, 2);
    view.rerender(tree(props('D:/proj/copy.csv', rows('a'), 1)));
    expect(activeCell()).toBe('4,2');
  });

  it('a file whose content is the same as the last one still restores its own selection', () => {
    const view = render(tree(props(A, rows('same'), 1)));
    select(7, 0);
    view.rerender(tree(props(B, rows('same'), 2)));
    expect(activeCell()).toBe('0,0');
    view.rerender(tree(props(A, rows('same'), 3)));
    expect(activeCell()).toBe('7,0');
  });

  it('keeps nothing on disk: no storage is written', () => {
    const local = vi.spyOn(Storage.prototype, 'setItem');
    const view = render(tree(props(A, rows('a'), 1)));
    select(4, 2);
    view.rerender(tree(props(B, rows('b'), 2)));
    expect(local).not.toHaveBeenCalled();
  });
});
