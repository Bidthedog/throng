/**
 * 073 FR-051, FR-056, FR-058, FR-059 — the spreadsheet preview's body: the sheet switcher, the header
 * row setting, a reload that keeps the chosen sheet, and one inline notice for a workbook it cannot read.
 *
 * Layer: component — what the body renders from the bytes the source route hands it. The reader itself is
 * `spreadsheet-read.test.ts`'s; the route's containment and cap are `preview-read-source`'s.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { IconKey } from '@throng/core';
import { drawnIcon, iconMarkup } from './helpers/icon-markup.js';
import { menuWithSubmenu } from './helpers/expand-submenus.js';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { SpreadsheetBody } from '../../src/renderer/preview/providers/spreadsheet/spreadsheet-body.js';
import { readWorkbook } from '../../src/renderer/preview/providers/spreadsheet/workbook-read.js';
import { handleWorkbookParse, type WorkbookParseRequest } from '../../src/renderer/preview/providers/spreadsheet/spreadsheet-handler.js';
import { setGridWorkerFactory, type GridWorker } from '../../src/renderer/grid/worker-factory.js';
import type { PreviewBodyProps } from '../../src/renderer/preview/provider-view.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { PREVIEW_LOADING_CLASS } from '../../src/renderer/preview/loading-placeholder.js';
import { PRINT_UNAVAILABLE } from '../../src/renderer/preview/print/print-command.js';
import { gridPrintable } from '../../src/renderer/grid/grid-print.js';
import { subscribeReadOnlyFlash } from '../../src/renderer/preview/read-only-marker.js';

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
  providerSettings: { enabled: true, firstRowHeader: false, maxPreviewBytes: 25 * 1024 * 1024 },
  initialViewState: undefined,
  onViewStateCapture: () => {},
  onFollow: () => {},
  onNotice: () => {},
  onDrawn: () => {},
  onBodyFailure: () => {},
  // The chrome's passthrough (preview-panel.tsx); the body never reads `window.throng` itself.
  readSource: (asset?: string) => readSource(asset),
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
  // 073 R7, 074 R4 — the unified read answers a Uint8Array with its type.
  readSource = vi.fn(async () => ({ ok: true, bytes: new Uint8Array(bytes.slice(0)), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
});

afterEach(() => {
  vi.restoreAllMocks();
  setGridWorkerFactory(null);
});

describe('while the workbook loads (075 FR-043a)', () => {
  it('shows the placeholder every preview shows while it loads, then the grid in its place', async () => {
    let answer!: (result: unknown) => void;
    readSource.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    mount('throng-preview://source/s1?rev=1');
    const placeholder = await screen.findByTestId('spreadsheet-loading-s1');
    expect(placeholder.classList.contains(PREVIEW_LOADING_CLASS)).toBe(true);
    expect(placeholder.classList.contains(`${PREVIEW_LOADING_CLASS}--block`)).toBe(true);
    expect(placeholder.textContent?.trim()).toBe('Loading workbook…');
    await act(async () =>
      answer({ ok: true, bytes: new Uint8Array(bytes.slice(0)), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    );
    await waitFor(() => expect(cell(0, 0)).toBe('h1'));
    expect(screen.queryByTestId('spreadsheet-loading-s1')).toBeNull();
  });
});

describe('the source read (074 R4)', () => {
  it('reads through the chrome’s readSource passthrough, and with none shows the unreadable notice', async () => {
    mount('throng-preview://source/s1?rev=1', { readSource: undefined });
    expect(await screen.findByTestId('spreadsheet-notice-s1')).toBeTruthy();
    expect(readSource).not.toHaveBeenCalled();
  });
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
      providerSettings: { enabled: true, firstRowHeader: true, maxPreviewBytes: 25 * 1024 * 1024 },
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

  it('keeps the selection per workbook: a move to another file starts at A1, and coming back finds it (FR-008d)', async () => {
    const rowsOf = (tag: string): string[][] => Array.from({ length: 20 }, (_, i) => [`${tag}${i}`, 'x', 'y']);
    const active = (): string | null => {
      const el = document.querySelector('[data-grid-cell].data-grid__cell--active');
      return el === null ? null : `${el.getAttribute('data-row')},${el.getAttribute('data-col')}`;
    };
    const at = (n: number, seq: number, file: string) =>
      createElement(ContextMenuProvider, {
        children: createElement(SpreadsheetBody, props(`throng-preview://source/s1?rev=${n}`, { filePath: file, navigationSeq: seq })),
      });
    bytes = book({ Data: rowsOf('a') });
    const view = render(at(1, 1, 'D:/proj/a.xlsx'));
    await waitFor(() => expect(cell(0, 0)).toBe('a0'));
    fireEvent.mouseDown(document.querySelector('[data-grid-cell][data-row="4"][data-col="2"]')!, { button: 0 });
    fireEvent.mouseUp(window);
    expect(active()).toBe('4,2');

    bytes = book({ Data: rowsOf('b') });
    view.rerender(at(2, 2, 'D:/proj/b.xlsx'));
    await waitFor(() => expect(cell(0, 0)).toBe('b0'));
    await waitFor(() => expect(active()).toBe('0,0'));

    bytes = book({ Data: rowsOf('a') });
    view.rerender(at(3, 3, 'D:/proj/a.xlsx'));
    await waitFor(() => expect(cell(0, 0)).toBe('a0'));
    await waitFor(() => expect(active()).toBe('4,2'));
  });

  it('opens another workbook on its own first visible sheet, even where it has a sheet of the name chosen before (FR-051, T079)', async () => {
    const at = (n: number, seq: number, file: string) =>
      createElement(ContextMenuProvider, {
        children: createElement(SpreadsheetBody, props(`throng-preview://source/s1?rev=${n}`, { filePath: file, navigationSeq: seq })),
      });
    bytes = book({ First: [['a-first']], Data: [['a-data']] });
    const view = render(at(1, 1, 'D:/proj/a.xlsx'));
    await waitFor(() => expect(cell(0, 0)).toBe('a-first'));
    fireEvent.click(screen.getByTestId('spreadsheet-sheet-Data'));
    await waitFor(() => expect(cell(0, 0)).toBe('a-data'));

    // A reused panel moves to workbook b, which also has a sheet called "Data".
    bytes = book({ Summary: [['b-summary']], Data: [['b-data']] });
    view.rerender(at(2, 2, 'D:/proj/b.xlsx'));
    await waitFor(() => expect(cell(0, 0)).toBe('b-summary'));

    // A reload of the SAME file still keeps the chosen sheet (FR-058).
    fireEvent.click(screen.getByTestId('spreadsheet-sheet-Data'));
    await waitFor(() => expect(cell(0, 0)).toBe('b-data'));
    bytes = book({ Summary: [['b-summary']], Data: [['b-data2']] });
    view.rerender(at(3, 2, 'D:/proj/b.xlsx'));
    await waitFor(() => expect(cell(0, 0)).toBe('b-data2'));
  });

  // FR-062 (convergence T093) — the file grew past the limit between main's check and the read: the body names the
  // limit, as main's notice does, and says Refresh checks it again (main's notice then names the size too).
  it('names the preview size limit when the read is refused as too large', async () => {
    readSource = vi.fn(async () => ({ ok: false, status: 413 }));
    mount('throng-preview://source/s1?rev=1');
    const notice = await screen.findByTestId('spreadsheet-notice-s1');
    expect(notice.textContent).toMatch(/25 MB/);
    expect(notice.textContent).toMatch(/Refresh/);
  });

  // FR-056 (convergence T092) — a reader that cannot start or stops is throng's failure, not the file's: the notice
  // must not call the file damaged.
  it('says the reader failed, not that the file is damaged, when the worker cannot start or stops', async () => {
    setGridWorkerFactory(() => {
      throw new Error('no worker');
    });
    mount('throng-preview://source/s1?rev=1');
    const notice = await screen.findByTestId('spreadsheet-notice-s1');
    expect(notice.textContent).not.toMatch(/damaged|not a spreadsheet/);
    expect(notice.textContent).toMatch(/spreadsheet reader/i);
  });

  it('says in one inline notice when the file is not a workbook it can read (FR-056)', async () => {
    bytes = new TextEncoder().encode('PK\u0003\u0004 not a zip').buffer;
    mount('throng-preview://source/s1?rev=1');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/could not be read as a workbook/));
  });

  describe('header menus (FR-037e, FR-006a)', () => {
    const colHead = (c: number): HTMLElement => document.querySelector<HTMLElement>(`[role="columnheader"][data-col="${c}"]`)!;
    const rowHead = (r: number): HTMLElement => document.querySelector<HTMLElement>(`[role="rowheader"][data-row="${r}"]`)!;
    const topLevel = (): string[] =>
      [...document.querySelectorAll('[data-testid="context-menu"] > [role="menuitem"]')].map((el) =>
        (el.getAttribute('data-testid') ?? '').replace(/^menu-item-/, ''),
      );

    it('every grid menu offers Print…, which runs the chrome\'s Print… (075 FR-063, FR-075b)', async () => {
      const onPrint = vi.fn();
      mount('throng-preview://source/s1?rev=1', { onPrint });
      await waitFor(() => expect(cell(0, 0)).toBe('h1'));
      const cellEl = (): HTMLElement => document.querySelector<HTMLElement>('[data-grid-cell][data-row="0"][data-col="0"]')!;
      for (const target of [cellEl, () => rowHead(0), () => colHead(0)]) {
        fireEvent.contextMenu(target(), { clientX: 5, clientY: 5 });
        fireEvent.click(screen.getByTestId('menu-item-Print…'));
      }
      expect(onPrint).toHaveBeenCalledTimes(3);
    });

    // FR-037g (convergence T104) — both grids: each Copy variant carries the copy icon, as the CSV grid's do.
    it('draws the copy icon on Copy, Copy as Rich Text and Copy as Plain Text', async () => {
      mount('throng-preview://source/s1?rev=1');
      await waitFor(() => expect(cell(0, 0)).toBe('h1'));
      menuWithSubmenu(document.querySelector<HTMLElement>('[data-grid-cell][data-row="0"][data-col="0"]')!, 'Copy as');
      for (const label of ['Copy', 'Copy as', 'Copy as Rich Text', 'Copy as Plain Text']) {
        expect(drawnIcon(screen.getByTestId(`menu-item-${label}`)), label).toBe(iconMarkup('copy' as IconKey));
      }
    });

    it('the grid menu\'s Print… shows its key binding, as every other preview\'s does (075 FR-063, FR-075b)', async () => {
      mount('throng-preview://source/s1?rev=1', { onPrint: vi.fn() });
      await waitFor(() => expect(cell(0, 0)).toBe('h1'));
      fireEvent.contextMenu(document.querySelector<HTMLElement>('[data-grid-cell][data-row="0"][data-col="0"]')!, { clientX: 5, clientY: 5 });
      expect(screen.getByTestId('menu-item-Print…').textContent).toContain('Ctrl+P');
    });

    it('prints the sheet on screen as a table, every row (075 FR-075b)', async () => {
      const { container } = mount('throng-preview://source/s1?rev=1');
      await waitFor(() => expect(cell(0, 0)).toBe('h1'));
      const output = await gridPrintable(container as HTMLElement, 'book.xlsx');
      if (output.kind !== 'document') throw new Error('not a document');
      const doc = new DOMParser().parseFromString(output.html, 'text/html');
      expect(doc.querySelector('tbody tr td')?.textContent).toBe('h1');
    });

    it('without the chrome\'s Print… route, every grid menu draws Print… disabled with the reason (075 FR-062)', async () => {
      mount('throng-preview://source/s1?rev=1');
      await waitFor(() => expect(cell(0, 0)).toBe('h1'));
      const cellEl = (): HTMLElement => document.querySelector<HTMLElement>('[data-grid-cell][data-row="0"][data-col="0"]')!;
      for (const target of [cellEl, () => rowHead(0), () => colHead(0)]) {
        fireEvent.contextMenu(target(), { clientX: 5, clientY: 5 });
        const print = screen.getByTestId('menu-item-Print…');
        expect(print.getAttribute('aria-disabled')).toBe('true');
        expect(print.getAttribute('title')).toBe(PRINT_UNAVAILABLE);
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      }
    });

    // T18 (2026-11-27), superseding 073 FR-050c: a workbook stays read-only, so the menus draw no editing row at all.
    it('every grid menu offers Copy and Copy as, and draws no Cut, Paste, Clear Cells, delete or insert (T18)', async () => {
      mount('throng-preview://source/s1?rev=1');
      await waitFor(() => expect(cell(0, 0)).toBe('h1'));
      const cellEl = (): HTMLElement => document.querySelector<HTMLElement>('[data-grid-cell][data-row="0"][data-col="0"]')!;
      const corner = (): HTMLElement => document.querySelector<HTMLElement>('[data-grid-corner]')!;
      const editing = [
        'Cut',
        'Paste',
        'Clear Cells',
        'Delete Row',
        'Delete Rows',
        'Delete Column',
        'Delete Columns',
        'Insert',
        'Insert Row Above',
        'Insert Rows Above…',
        'Insert Column Left',
        'Insert Columns Left…',
        'Undo',
        'Redo',
      ];
      const menus: [string, () => HTMLElement, string[]][] = [
        ['cell', cellEl, ['Copy', 'Copy as', 'Select All', 'Go to Row…', 'Print…']],
        ['row header', () => rowHead(0), ['Copy', 'Copy as', 'Select All', 'Go to Row…', 'Print…']],
        ['column header', () => colHead(0), ['Copy', 'Copy as', 'Column Width…', 'Reset Column Width', 'Print…']],
        ['corner', corner, ['Copy', 'Copy as', 'Go to Row…', 'Print…']],
      ];
      for (const [name, target, expected] of menus) {
        fireEvent.contextMenu(target(), { clientX: 5, clientY: 5 });
        expect([...topLevel()].sort(), name).toEqual([...expected].sort());
        for (const label of editing) expect(screen.queryByTestId(`menu-item-${label}`), `${name}: ${label}`).toBeNull();
        expect(screen.getByTestId('menu-item-Copy').getAttribute('aria-disabled'), name).not.toBe('true');
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      }
    });

    it('marks the grid read-only, which the faded cell text is keyed on', async () => {
      mount('throng-preview://source/s1?rev=1');
      await waitFor(() => expect(cell(0, 0)).toBe('h1'));
      expect(screen.getByTestId('spreadsheet-body-s1').querySelector('[role="grid"]')?.getAttribute('aria-readonly')).toBe('true');
    });

    it('Column Width… asks in the grid\'s modal number prompt and sizes the column right-clicked (T10)', async () => {
      mount('throng-preview://source/s1?rev=1');
      await waitFor(() => expect(cell(0, 0)).toBe('h1'));
      fireEvent.contextMenu(colHead(1), { clientX: 5, clientY: 5 });
      fireEvent.click(screen.getByTestId('menu-item-Column Width…'));
      const form = screen.getByTestId('spreadsheet-width-s1');
      expect(form.getAttribute('role')).toBe('dialog');
      expect(screen.getByTestId('spreadsheet-width-s1-scrim').contains(form)).toBe(true);
      const input = form.querySelector('input')!;
      expect(document.activeElement).toBe(input);
      fireEvent.change(input, { target: { value: '250' } });
      fireEvent.submit(form);
      expect(screen.queryByTestId('spreadsheet-width-s1')).toBeNull();
      expect(Number.parseFloat(colHead(1).style.width)).toBe(250);
    });

    it('draws a themeable icon on every item with a picture, and none on Column Width… (FR-037g)', async () => {
      mount('throng-preview://source/s1?rev=1');
      await waitFor(() => expect(cell(0, 0)).toBe('h1'));
      const iconOf = (label: string): string | undefined =>
        drawnIcon(document.querySelector(`[data-testid="menu-item-${label}"]`));
      const expectIcons = (expected: Record<string, IconKey>): void => {
        for (const [label, key] of Object.entries(expected)) {
          expect(document.querySelector(`[data-testid="menu-item-${label}"]`), label).not.toBeNull();
          expect(iconOf(label), label).toBe(iconMarkup(key));
        }
      };
      fireEvent.contextMenu(colHead(0), { clientX: 5, clientY: 5 });
      expectIcons({ Copy: 'copy', 'Copy as': 'copy', 'Reset Column Width': 'resetColumnWidth' });
      expect(screen.queryByTestId('menu-item-Select Column')).toBeNull();
      expect(iconOf('Column Width…')).toBeUndefined();
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      fireEvent.contextMenu(rowHead(0), { clientX: 5, clientY: 5 });
      expectIcons({ Copy: 'copy', 'Copy as': 'copy', 'Select All': 'selectAll', 'Go to Row…': 'goToRow' });
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      fireEvent.contextMenu(document.querySelector('[data-grid-cell][data-row="0"][data-col="0"]')!, { clientX: 5, clientY: 5 });
      expectIcons({ Copy: 'copy', 'Copy as': 'copy', 'Select All': 'selectAll', 'Go to Row…': 'goToRow' });
    });

    it('Go to Row… opens the shared dialog for the sheet rows, and the chord claim opens the same one (FR-043a)', async () => {
      const registerGoTo = vi.fn();
      mount('throng-preview://source/s1?rev=1', { registerGoTo });
      await waitFor(() => expect(cell(0, 0)).toBe('h1'));
      const rowCount = document.querySelectorAll('[role="rowheader"]').length;
      fireEvent.contextMenu(rowHead(1), { clientX: 5, clientY: 5 });
      fireEvent.click(screen.getByTestId('menu-item-Go to Row…'));
      expect(screen.getByTestId('grid-goto-s1-status').textContent).toBe(`Row 2 of ${rowCount}`);
      fireEvent.keyDown(screen.getByTestId('grid-goto-s1-input'), { key: 'Escape' });
      expect(screen.queryByTestId('grid-goto-s1')).toBeNull();
      const claim = registerGoTo.mock.calls.at(-1)?.[0] as () => void;
      act(() => claim());
      expect(screen.getByTestId('grid-goto-s1')).toBeTruthy();
    });

    it('Reset Column Width on a column header returns the column to the default width', async () => {
      mount('throng-preview://source/s1?rev=1');
      await waitFor(() => expect(cell(0, 0)).toBe('h1'));
      const width = (): number => Number.parseFloat(colHead(1).style.width);
      fireEvent.mouseDown(document.querySelector('[data-grid-resize][data-col="1"]')!, { button: 0, clientX: 100 });
      fireEvent.mouseMove(window, { clientX: 160 });
      fireEvent.mouseUp(window);
      expect(width()).toBe(180);
      fireEvent.contextMenu(colHead(1), { clientX: 5, clientY: 5 });
      fireEvent.click(screen.getByTestId('menu-item-Reset Column Width'));
      expect(width()).toBe(120);
    });

    it('a row header menu has no Reset Row Height, and a double-click on a row number does nothing (FR-012a)', async () => {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
        () => ({ font: '', measureText: (t: string) => ({ width: t.length * 8 }) }) as unknown as CanvasRenderingContext2D,
      );
      bytes = book({ Data: [['h'], ['x\ny\nz']] });
      mount('throng-preview://source/s1?rev=1');
      await waitFor(() => expect(cell(1, 0)).toBe('x\ny\nz'.replace(/\n/g, '⏎')));
      fireEvent.doubleClick(rowHead(1));
      expect(Number.parseFloat(rowHead(1).style.height)).toBe(22);
      fireEvent.contextMenu(rowHead(1), { clientX: 5, clientY: 5 });
      expect(screen.queryByTestId('menu-item-Reset Row Height')).toBeNull();
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

  it('never wraps: a workbook has no Wrap, whatever a stray choice or setting says (FR-013)', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => ({ font: '', measureText: (t: string) => ({ width: t.length * 8 }) }) as unknown as CanvasRenderingContext2D,
    );
    bytes = book({ Data: [['h'], ['x\ny\nz']] });
    mount('throng-preview://source/s1?rev=1', { wrapChoice: true });
    await waitFor(() => expect(cell(1, 0)).toBe('x\ny\nz'.replace(/\n/g, '⏎')));
    expect(Number.parseFloat(document.querySelector<HTMLElement>('[role="rowheader"][data-row="1"]')!.style.height)).toBe(22);
  });

  it('never locks: a workbook has no lock, whatever a stray choice says (FR-039a)', async () => {
    mount('throng-preview://source/s1?rev=1', { lockFirstRowChoice: true, lockFirstColumnChoice: true });
    await waitFor(() => expect(cell(0, 0)).toBe('h1'));
    expect(document.querySelector('.data-grid__row--locked')).toBeNull();
    expect(document.querySelector('.data-grid__cell--locked-col')).toBeNull();
  });

  it('never opens a cell editor (read-only, FR-001)', async () => {
    mount('throng-preview://source/s1?rev=1');
    await waitFor(() => expect(cell(0, 0)).toBe('h1'));
    fireEvent.keyDown(screen.getByTestId('spreadsheet-grid-s1'), { key: 'Enter' });
    expect(screen.queryByLabelText('Cell value')).toBeNull();
  });
});

// 073 FR-050b — an edit tried on the workbook's grid flashes this panel's Read-only marker, and edits nothing.
describe('an edit attempt flashes the Read-only marker (FR-050b)', () => {
  it('Enter on a cell asks for the flash and opens no editor', async () => {
    mount('throng-preview://source/s1?rev=1');
    await waitFor(() => expect(cell(0, 0)).toBe('h1'));
    const flashed = vi.fn();
    const stop = subscribeReadOnlyFlash('s1', flashed);
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    grid.focus();
    fireEvent.keyDown(grid, { key: 'Enter' });
    stop();
    expect(flashed).toHaveBeenCalledTimes(1);
    expect(document.querySelector('textarea')).toBeNull();
  });
});
