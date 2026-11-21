/**
 * 073 FR-024 (convergence T082) — a grid Copy or Cut that stops at the cell bound says so, through the chrome's
 * `onCopyCapped`; a capped Cut removes nothing, so no cell leaves the file that the clipboard lacks. The bound itself
 * is `grid-copy-cap.test.ts`'s: here the copy is stubbed to report a cap, since a million-cell grid is no component
 * test's to draw.
 *
 * Layer: component — CsvBody in jsdom, the copy stubbed.
 */
import { createElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let capNext = false;
vi.mock('../../src/renderer/grid/grid-copy.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/grid/grid-copy.js')>();
  return {
    ...real,
    copyGridRange: vi.fn(async (_range: unknown, _get: unknown, _format: unknown, onCapped?: (c: number, s: number) => void) => {
      if (capNext) onCapped?.(4, 6);
      return true;
    }),
  };
});

import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { CsvBody } from '../../src/renderer/preview/providers/csv/csv-body.js';
import { copyCappedMessage } from '../../src/renderer/preview/preview-panel.js';
import type { PreviewBodyProps } from '../../src/renderer/preview/provider-view.js';
import { __resetColumnWidthCache } from '../../src/renderer/preview/providers/csv/column-widths.js';
import { __resetPreviewStore } from '../../src/renderer/preview/preview-store.js';

let bridge: { gridEdit: ReturnType<typeof vi.fn>; gridUndo: ReturnType<typeof vi.fn> };
let onCopyCapped: ReturnType<typeof vi.fn>;

function mount(text: string): void {
  const props = {
    panelId: 'p1',
    content: { kind: 'text', text, filePath: 'D:/proj/data.csv', rev: 1 },
    filePath: 'D:/proj/data.csv',
    projectRoot: 'D:/proj',
    providerSettings: {},
    initialViewState: undefined,
    onViewStateCapture: () => {},
    onFollow: () => {},
    onNotice: () => {},
    onDrawn: () => {},
    onBodyFailure: () => {},
    onCopyCapped,
  } as unknown as PreviewBodyProps;
  render(createElement(ContextMenuProvider, { children: createElement(CsvBody, props) }));
}

function selectCell(r: number, c: number): void {
  const el = document.querySelector<HTMLElement>(`[data-grid-cell][data-row="${r}"][data-col="${c}"]`);
  if (!el) throw new Error(`no cell ${r},${c}`);
  fireEvent.mouseDown(el, { button: 0 });
  fireEvent.mouseUp(window);
}

beforeEach(() => {
  capNext = false;
  onCopyCapped = vi.fn();
  bridge = { gridEdit: vi.fn(async () => ({ ok: true, dirty: true })), gridUndo: vi.fn(async () => ({ ok: true })) };
  window.throng = { preview: bridge } as unknown as typeof window.throng;
});

afterEach(() => {
  delete window.throng;
  __resetPreviewStore();
  __resetColumnWidthCache();
});

describe('a grid copy or cut stopped at the cell bound (FR-024)', () => {
  it('a capped Copy tells the chrome how many of how many', async () => {
    capNext = true;
    mount('a,b\n1,2\n3,4\n');
    selectCell(1, 0);
    fireEvent.copy(screen.getByTestId('csv-grid-p1'));
    await waitFor(() => expect(onCopyCapped).toHaveBeenCalledWith(4, 6, expect.any(Number), 'copy'));
  });

  it('a capped Cut says so and removes nothing', async () => {
    capNext = true;
    mount('a,b\n1,2\n3,4\n');
    selectCell(1, 0);
    fireEvent.cut(screen.getByTestId('csv-grid-p1'));
    await waitFor(() => expect(onCopyCapped).toHaveBeenCalledWith(4, 6, expect.any(Number), 'cut'));
    await new Promise((r) => setTimeout(r, 0));
    expect(bridge.gridEdit).not.toHaveBeenCalled();
  });

  it('a Cut within the bound still removes the cells, and says nothing', async () => {
    mount('a,b\n1,2\n3,4\n');
    selectCell(1, 0);
    fireEvent.cut(screen.getByTestId('csv-grid-p1'));
    await waitFor(() => expect(bridge.gridEdit).toHaveBeenCalled());
    expect(onCopyCapped).not.toHaveBeenCalled();
  });

  it('the notice names the bound and both counts, digit-grouped', () => {
    expect(copyCappedMessage(1_000_000, 1_005_000, 1_000_000, 'copy')).toBe(
      'A copy holds at most 1,000,000 cells, so only the first 1,000,000 of the 1,005,000 selected cells were copied.',
    );
    expect(copyCappedMessage(1_000_000, 1_005_000, 1_000_000, 'cut')).toMatch(/nothing was cut/);
  });
});
