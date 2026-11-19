/**
 * 073 FR-051, FR-056, FR-058, FR-059 — the spreadsheet preview's body: the sheet switcher, the header
 * row setting, a reload that keeps the chosen sheet, and one inline notice for a workbook it cannot read.
 *
 * Layer: component — what the body renders from the bytes the source route hands it. The reader itself is
 * `spreadsheet-read.test.ts`'s; the route's containment and cap are `preview-read-source`'s.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { SpreadsheetBody } from '../../src/renderer/preview/providers/spreadsheet/spreadsheet-body.js';
import { readWorkbook } from '../../src/renderer/preview/providers/spreadsheet/workbook-read.js';
import { handleWorkbookParse, type WorkbookParseRequest } from '../../src/renderer/preview/providers/spreadsheet/spreadsheet-handler.js';
import { setGridWorkerFactory, type GridWorker } from '../../src/renderer/grid/worker-factory.js';
import type { PreviewBodyProps } from '../../src/renderer/preview/provider-view.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';

function book(sheets: Record<string, string[][]>, hidden: string[] = []): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  wb.Workbook = { Sheets: Object.keys(sheets).map((n) => ({ Hidden: hidden.includes(n) ? 1 : 0 })) };
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
}

const props = (url: string, over: Partial<PreviewBodyProps> = {}): PreviewBodyProps => ({
  panelId: 's1',
  content: { kind: 'resource', url },
  filePath: 'D:/proj/book.xlsx',
  projectRoot: 'D:/proj',
  providerSettings: { enabled: true, firstRowHeader: false, maxPreviewMb: 25 },
  initialViewState: undefined,
  onViewStateCapture: () => {},
  onFollow: () => {},
  onNotice: () => {},
  onDrawn: () => {},
  onBodyFailure: () => {},
  ...over,
});

const mount = (url: string, over: Partial<PreviewBodyProps> = {}) =>
  render(createElement(ContextMenuProvider, { children: createElement(SpreadsheetBody, props(url, over)) }));

const cell = (r: number, c: number): string | null =>
  document.querySelector(`[data-grid-cell][data-row="${r}"][data-col="${c}"]`)?.textContent ?? null;

let bytes: ArrayBuffer;
let readSource: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setGridWorkerFactory(() => {
    const worker: GridWorker = {
      onmessage: null,
      onerror: null,
      terminate: () => {},
      postMessage: (message) => {
        const reply = handleWorkbookParse(message as WorkbookParseRequest, readWorkbook);
        queueMicrotask(() => worker.onmessage?.({ data: reply } as MessageEvent));
      },
    };
    return worker;
  });
  bytes = book({ Data: [['h1', 'h2'], ['a', 'b']], Secret: [['s']], Third: [['t']] }, ['Secret']);
  readSource = vi.fn(async () => ({ ok: true, bytes: bytes.slice(0) }));
  window.throng = { preview: { readSource } } as unknown as typeof window.throng;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.throng;
  setGridWorkerFactory(null);
});

describe('SpreadsheetBody', () => {
  it('lists every sheet in order, marks the hidden one, and opens on the first visible sheet (FR-051)', async () => {
    mount('throng-preview://source/s1?rev=1');
    await waitFor(() => expect(cell(0, 0)).toBe('h1'));
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Data', 'Secret (hidden)', 'Third']);
    fireEvent.click(screen.getByTestId('spreadsheet-sheet-Third'));
    await waitFor(() => expect(cell(0, 0)).toBe('t'));
  });

  it('shows the first row in the header strip when First row is a header is on (FR-059)', async () => {
    mount('throng-preview://source/s1?rev=1', {
      providerSettings: { enabled: true, firstRowHeader: true, maxPreviewMb: 25 },
    });
    await waitFor(() => expect(cell(0, 0)).toBe('a'));
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toContain('h1');
  });

  it('reads again on a new revision and keeps the chosen sheet while it exists (FR-058)', async () => {
    const view = mount('throng-preview://source/s1?rev=1');
    await waitFor(() => expect(cell(0, 0)).toBe('h1'));
    fireEvent.click(screen.getByTestId('spreadsheet-sheet-Third'));
    await waitFor(() => expect(cell(0, 0)).toBe('t'));
    bytes = book({ Data: [['x']], Third: [['changed']] });
    view.rerender(createElement(ContextMenuProvider, { children: createElement(SpreadsheetBody, props('throng-preview://source/s1?rev=2')) }));
    await waitFor(() => expect(cell(0, 0)).toBe('changed'));
    expect(readSource).toHaveBeenCalledTimes(2);
  });

  it('says in one inline notice when the file is not a workbook it can read (FR-056)', async () => {
    bytes = new TextEncoder().encode('PK\u0003\u0004 not a zip').buffer;
    mount('throng-preview://source/s1?rev=1');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/could not be read as a workbook/));
  });

  describe('header menus (FR-037e, FR-006a)', () => {
    const colHead = (c: number): HTMLElement => document.querySelector<HTMLElement>(`[role="columnheader"][data-col="${c}"]`)!;
    const rowHead = (r: number): HTMLElement => document.querySelector<HTMLElement>(`[role="rowheader"][data-row="${r}"]`)!;
    const labels = (): string[] =>
      [...document.querySelectorAll('[role="menuitem"]')].map((el) => (el.getAttribute('data-testid') ?? '').replace(/^menu-item-/, ''));

    it('a column header and a row header menu each offer Copy, and never Cut or Paste', async () => {
      mount('throng-preview://source/s1?rev=1');
      await waitFor(() => expect(cell(0, 0)).toBe('h1'));
      fireEvent.contextMenu(colHead(0), { clientX: 5, clientY: 5 });
      expect(labels()).toContain('Copy');
      expect(labels()).not.toContain('Cut');
      expect(labels()).not.toContain('Paste');
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      fireEvent.contextMenu(rowHead(0), { clientX: 5, clientY: 5 });
      expect(labels()).toContain('Copy');
      expect(labels()).not.toContain('Cut');
    });

    it('Reset Size on a column header returns the column to the default width', async () => {
      mount('throng-preview://source/s1?rev=1');
      await waitFor(() => expect(cell(0, 0)).toBe('h1'));
      const width = (): number => Number.parseFloat(colHead(1).style.width);
      fireEvent.mouseDown(document.querySelector('[data-grid-resize][data-col="1"]')!, { button: 0, clientX: 100 });
      fireEvent.mouseMove(window, { clientX: 160 });
      fireEvent.mouseUp(window);
      expect(width()).toBe(180);
      fireEvent.contextMenu(colHead(1), { clientX: 5, clientY: 5 });
      fireEvent.click(screen.getByTestId('menu-item-Reset Size'));
      expect(width()).toBe(120);
    });

    it('Reset Size on a row header collapses an expanded row', async () => {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
        () => ({ font: '', measureText: (t: string) => ({ width: t.length * 8 }) }) as unknown as CanvasRenderingContext2D,
      );
      bytes = book({ Data: [['h'], ['x\ny\nz']] });
      mount('throng-preview://source/s1?rev=1');
      await waitFor(() => expect(cell(1, 0)).toBe('x\ny\nz'.replace(/\n/g, '⏎')));
      const height = (): number => Number.parseFloat(rowHead(1).style.height);
      fireEvent.doubleClick(rowHead(1));
      expect(height()).toBe(66);
      fireEvent.contextMenu(rowHead(1), { clientX: 5, clientY: 5 });
      fireEvent.click(screen.getByTestId('menu-item-Reset Size'));
      expect(height()).toBe(22);
    });
  });

  it('has no cell dialog: Enter on a long cell and the cell menu offer none (read-only, FR-036a)', async () => {
    bytes = book({ Data: [['a value much longer than the shipped threshold of fifty characters, surely']] });
    mount('throng-preview://source/s1?rev=1');
    await waitFor(() => expect(cell(0, 0)).toContain('a value much longer'));
    fireEvent.keyDown(screen.getByTestId('spreadsheet-grid-s1'), { key: 'Enter' });
    fireEvent.doubleClick(document.querySelector('[data-grid-cell][data-row="0"][data-col="0"]')!);
    expect(screen.queryByTestId('cell-dialog')).toBeNull();
    fireEvent.contextMenu(document.querySelector('[data-grid-cell][data-row="0"][data-col="0"]')!, { clientX: 5, clientY: 5 });
    expect(screen.queryByTestId('menu-item-Edit in Dialog…')).toBeNull();
  });

  it('never opens a cell editor (read-only, FR-001)', async () => {
    mount('throng-preview://source/s1?rev=1');
    await waitFor(() => expect(cell(0, 0)).toBe('h1'));
    fireEvent.keyDown(screen.getByTestId('spreadsheet-grid-s1'), { key: 'Enter' });
    expect(screen.queryByLabelText('Cell value')).toBeNull();
  });
});
