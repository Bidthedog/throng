/**
 * 073 T075 — the record-to-line mapping a CSV pair scrolls by is worked out once per document version, and only when the
 * view is in step with an editor at all. `recordStartLines` is a pass over the whole text; run once per scrolled frame, or per
 * mark move, or per keystroke, it made a large CSV slow (the maintainer's report). The mapping must not be recomputed by
 * a scroll, a mark, or the sync line moving, and a CSV not in step with any editor must not compute it on a keystroke.
 *
 * Layer: component — the CSV body over a 3,000-row file, with the mapping counted.
 */
import { act, fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordStartLines } from '@throng/core/csv';
import { CsvBody } from '../../src/renderer/preview/providers/csv/csv-body.js';
import { __resetColumnWidthCache } from '../../src/renderer/preview/providers/csv/column-widths.js';
import type { PreviewBodyProps } from '../../src/renderer/preview/provider-view.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { __resetPreviewStore } from '../../src/renderer/preview/preview-store.js';

// The CSV body imports the record mapping from the CSV subpath (073 FR-009, T081).
vi.mock('@throng/core/csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@throng/core/csv')>();
  return { ...actual, recordStartLines: vi.fn(actual.recordStartLines) };
});

const ROW = 22;
const csv = (n: number, tail = ''): string => Array.from({ length: n }, (_, i) => `r${i},b${i},c${i}`).join('\n') + '\n' + tail;
const base = (text: string, over: Partial<PreviewBodyProps> = {}): PreviewBodyProps => ({
  panelId: 'p1',
  content: { kind: 'text', text },
  filePath: 'D:/proj/data.csv',
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

let top = 0;
const counted = recordStartLines as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  top = 0;
  counted.mockClear();
  const range = Range.prototype as unknown as Record<string, unknown>;
  range.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  range.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 });
  window.throng = { preview: {} } as unknown as typeof window.throng;
});
afterEach(() => {
  delete window.throng;
  __resetPreviewStore();
  __resetColumnWidthCache();
});

function mount(text: string, over: Partial<PreviewBodyProps>) {
  const onTopLineChange = vi.fn((): boolean | void => undefined);
  const view = render(tree(base(text, { onTopLineChange, ...over })));
  const scroller = document.querySelector<HTMLElement>('.data-grid__scroller')!;
  Object.defineProperty(scroller, 'scrollTop', { get: () => top, set: (v: number) => void (top = v), configurable: true });
  Object.defineProperty(scroller, 'clientHeight', { get: () => 24 + 20 * ROW, configurable: true });
  const update = (text2: string, next: Partial<PreviewBodyProps>): void =>
    view.rerender(tree(base(text2, { onTopLineChange, ...over, ...next })));
  return { scroller, update, onTopLineChange };
}

const frame = (): Promise<void> => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

describe('a CSV in step with an editor works the mapping out once per document version', () => {
  it('a hundred sync lines, marks and scrolled frames compute it once', async () => {
    const text = csv(3000);
    const m = mount(text, { syncLine: 0, syncMark: null });
    for (let i = 1; i <= 100; i += 1) {
      act(() => m.update(text, { syncLine: i * 5, syncMark: { line: i * 5 + 10, on: true } }));
      top = i * 9 * ROW;
      act(() => void fireEvent.scroll(m.scroller));
      await frame();
    }
    expect(counted.mock.calls.length).toBeLessThanOrEqual(1);
    expect(m.onTopLineChange).toHaveBeenCalled(); // the scrolls really reported: the count is not vacuous
  });

  it('works it out again for the next version of the text, once, and not for the same text re-rendered', async () => {
    const m = mount(csv(3000), { syncLine: 0, syncMark: { line: 4, on: true } });
    expect(counted.mock.calls.length).toBe(1);
    act(() => m.update(csv(3000), { syncLine: 0, syncMark: { line: 9, on: true } }));
    expect(counted.mock.calls.length).toBe(1);
    act(() => m.update(csv(3000, 'x,y,z\n'), { syncLine: 0, syncMark: { line: 9, on: true } }));
    await frame();
    expect(counted.mock.calls.length).toBe(2);
  });
});

describe('a CSV that is not in step with an editor works nothing out', () => {
  it('a keystroke, a scroll and a re-render compute no mapping when there is no sync line and no mark', async () => {
    const m = mount(csv(3000), { syncLine: null, syncMark: null });
    for (let i = 1; i <= 10; i += 1) {
      act(() => m.update(csv(3000, 'x'.repeat(i)), { syncLine: null, syncMark: null }));
      top = i * 5 * ROW;
      act(() => void fireEvent.scroll(m.scroller));
      await frame();
    }
    expect(counted).not.toHaveBeenCalled();
    expect(m.onTopLineChange).not.toHaveBeenCalled();
  });
});
