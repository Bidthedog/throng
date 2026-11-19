/**
 * 073 FR-030, FR-033, FR-035 – FR-038, FR-046 — the CSV Preview Editor's body: it draws the document's
 * text as a grid, turns grid actions into grid operations for main, and is an editor (Save, Undo, the
 * unsaved count) only while it holds the document alone.
 *
 * Layer: component — what the body renders and what it sends across the bridge; main's resolution of
 * an operation is `csv-grid-service.integration.test.ts`'s, and the grid's own keys are
 * `data-grid.test.ts`'s.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCsv } from '@throng/core';
import { CsvBody, CSV_WORKER_THRESHOLD } from '../../src/renderer/preview/providers/csv/csv-body.js';
import { handleCsvParse, type CsvParseRequest } from '../../src/renderer/preview/providers/csv/csv-parse-handler.js';
import { setGridWorkerFactory, type GridWorker } from '../../src/renderer/grid/worker-factory.js';
import { __resetCopiedBlock } from '../../src/renderer/grid/copied-block.js';
import { __resetColumnWidthCache } from '../../src/renderer/preview/providers/csv/column-widths.js';
import type { PreviewBodyProps } from '../../src/renderer/preview/provider-view.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { __resetPreviewStore, applyPreviewUpdate } from '../../src/renderer/preview/preview-store.js';
import { getEditorActions } from '../../src/renderer/editor/editor-actions.js';
import { getEditorState } from '../../src/renderer/editor/editor-state.js';

const FILE = 'D:/proj/data.csv';

const props = (text: string, over: Partial<PreviewBodyProps> = {}): PreviewBodyProps => ({
  panelId: 'p1',
  content: { kind: 'text', text },
  filePath: FILE,
  projectRoot: 'D:/proj',
  providerSettings: { enabled: true },
  initialViewState: undefined,
  onViewStateCapture: () => {},
  onFollow: () => {},
  onNotice: () => {},
  onDrawn: () => {},
  onBodyFailure: () => {},
  ...over,
});

function mount(text: string, over: Partial<PreviewBodyProps> = {}) {
  return render(createElement(ContextMenuProvider, { children: createElement(CsvBody, props(text, over)) }));
}

function cellAt(r: number, c: number): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-grid-cell][data-row="${r}"][data-col="${c}"]`);
  if (!el) throw new Error(`no cell ${r},${c}`);
  return el;
}

let bridge: {
  gridEdit: ReturnType<typeof vi.fn>;
  gridUndo: ReturnType<typeof vi.fn>;
  gridRedo: ReturnType<typeof vi.fn>;
  gridSave: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  bridge = {
    gridEdit: vi.fn(async () => ({ ok: true, dirty: true })),
    gridUndo: vi.fn(async () => ({ ok: true })),
    gridRedo: vi.fn(async () => ({ ok: true })),
    gridSave: vi.fn(async () => ({ ok: true })),
  };
  window.throng = { preview: bridge } as unknown as typeof window.throng;
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetCopiedBlock();
  delete window.throng;
  setGridWorkerFactory(null);
  __resetPreviewStore();
  __resetColumnWidthCache();
});

describe('CsvBody draws the document as a grid', () => {
  it('puts each quoted value whole in its own cell, and HTML as literal text (FR-005, FR-022)', () => {
    mount('name,note\n"a, b","<img src=x onerror=alert(1)>"\n');
    expect(cellAt(1, 0).textContent).toBe('a, b');
    expect(cellAt(1, 1).textContent).toBe('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img')).toBeNull();
  });

  it('parses a large document in the worker, not in-thread (FR-023)', async () => {
    const posted: CsvParseRequest[] = [];
    setGridWorkerFactory(() => {
      const worker: GridWorker = {
        onmessage: null,
        onerror: null,
        terminate: () => {},
        postMessage: (message) => {
          posted.push(message as CsvParseRequest);
          const { reply } = handleCsvParse(message as CsvParseRequest, parseCsv);
          queueMicrotask(() => worker.onmessage?.({ data: reply } as MessageEvent));
        },
      };
      return worker;
    });
    const text = 'a,b\n'.repeat(Math.ceil(CSV_WORKER_THRESHOLD / 4) + 1);
    mount(text);
    await waitFor(() => expect(cellAt(0, 1).textContent).toBe('b'));
    expect(posted).toHaveLength(1);
  });

  it('refuses the grid over an unterminated quote, naming its line, with Open in Editor (FR-046)', () => {
    const onOpenInEditor = vi.fn();
    mount('a,b\n1,"open\n2,3\n', { onOpenInEditor });
    expect(screen.getByRole('alert').textContent).toContain('line 2');
    fireEvent.click(screen.getByRole('button', { name: 'Open in Editor' }));
    expect(onOpenInEditor).toHaveBeenCalled();
  });
});

describe('CsvBody edits through main (FR-035 – FR-037)', () => {
  it('sends a committed cell as one setCells operation for its own file', async () => {
    mount('a,b\n1,2\n');
    const grid = screen.getByTestId('csv-grid-p1');
    fireEvent.keyDown(grid, { key: 'Enter' });
    const editor = screen.getByLabelText('Cell value');
    fireEvent.change(editor, { target: { value: 'x' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    await waitFor(() =>
      expect(bridge.gridEdit).toHaveBeenCalledWith({
        panelId: 'p1',
        filePath: FILE,
        operation: { kind: 'setCells', cells: [{ row: 0, col: 0, value: 'x' }] },
      }),
    );
  });

  it('pastes tab-separated text at the selection\'s top-left (the active cell here) as one operation (FR-037c, FR-037d, FR-037f)', async () => {
    mount('a,b\n1,2\n');
    const grid = screen.getByTestId('csv-grid-p1');
    fireEvent.paste(grid, { clipboardData: { getData: () => 'p\tq\nr\ts' } });
    await waitFor(() => expect(bridge.gridEdit).toHaveBeenCalledTimes(1));
    expect(bridge.gridEdit.mock.calls[0]?.[0].operation).toEqual({
      kind: 'setCells',
      cells: [
        { row: 0, col: 0, value: 'p' },
        { row: 0, col: 1, value: 'q' },
        { row: 1, col: 0, value: 'r' },
        { row: 1, col: 1, value: 's' },
      ],
    });
  });

  it('undoes and redoes through the document, by the editor chords', () => {
    mount('a,b\n');
    const grid = screen.getByTestId('csv-grid-p1');
    fireEvent.keyDown(grid, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(grid, { key: 'y', ctrlKey: true });
    expect(bridge.gridUndo).toHaveBeenCalledWith('p1');
    expect(bridge.gridRedo).toHaveBeenCalledWith('p1');
  });

  it('clears the selected cells on Delete, skipping cells already empty', async () => {
    mount('a,,c\n');
    const grid = screen.getByTestId('csv-grid-p1');
    fireEvent.keyDown(grid, { key: 'End', shiftKey: true });
    fireEvent.keyDown(grid, { key: 'Delete' });
    await waitFor(() =>
      expect(bridge.gridEdit.mock.calls[0]?.[0].operation).toEqual({
        kind: 'setCells',
        cells: [
          { row: 0, col: 0, value: '' },
          { row: 0, col: 2, value: '' },
        ],
      }),
    );
  });
});

describe('CsvBody menus and paste target (FR-037e, FR-037f, FR-006a)', () => {
  let clip: { write: ReturnType<typeof vi.fn>; writeRich: ReturnType<typeof vi.fn>; paste: ReturnType<typeof vi.fn> };
  const lastOps = (): unknown[] => bridge.gridEdit.mock.calls.map((c) => c[0].operation);

  beforeEach(() => {
    clip = {
      write: vi.fn(async () => {}),
      writeRich: vi.fn(async () => {}),
      paste: vi.fn(async () => ({ text: 'z' })),
    };
    window.throng = { preview: bridge, clipboard: clip } as unknown as typeof window.throng;
  });

  const colHead = (c: number): HTMLElement => document.querySelector<HTMLElement>(`[role="columnheader"][data-col="${c}"]`)!;
  const rowHead = (r: number): HTMLElement => document.querySelector<HTMLElement>(`[role="rowheader"][data-row="${r}"]`)!;
  const labels = (): string[] =>
    [...document.querySelectorAll('[role="menuitem"]')].map((el) => (el.getAttribute('data-testid') ?? '').replace(/^menu-item-/, ''));
  const colWidth = (c: number): number => Number.parseFloat(colHead(c).style.width);

  it.each([
    ['a cell', () => cellAt(0, 0)],
    ['a row header', () => rowHead(0)],
    ['a column header', () => colHead(0)],
  ])('the menu of %s offers Cut, Copy and Paste', (_name, target) => {
    mount('a,b\n1,2\n');
    fireEvent.contextMenu(target(), { clientX: 5, clientY: 5 });
    expect(labels()).toEqual(expect.arrayContaining(['Cut', 'Copy', 'Paste']));
  });

  it('Cut on a whole column clears its values and removes no column', async () => {
    mount('a,b\n1,2\n3,4\n');
    fireEvent.contextMenu(colHead(1), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByTestId('menu-item-Cut'));
    await waitFor(() => expect(bridge.gridEdit).toHaveBeenCalledTimes(1));
    expect(lastOps()).toEqual([
      {
        kind: 'setCells',
        cells: [
          { row: 0, col: 1, value: '' },
          { row: 1, col: 1, value: '' },
          { row: 2, col: 1, value: '' },
        ],
      },
    ]);
    // Cut copies first (in the Copy preference's format), then clears.
    expect(clip.write.mock.calls.length + clip.writeRich.mock.calls.length).toBe(1);
  });

  it('Cut on a row header cuts the whole row', async () => {
    mount('a,b\n1,2\n');
    fireEvent.contextMenu(rowHead(1), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByTestId('menu-item-Cut'));
    await waitFor(() => expect(lastOps()).toEqual([{ kind: 'deleteRows', from: 1, count: 1 }]));
  });

  it('Paste from a column header menu lands at the column\'s top, one value filling the column', async () => {
    mount('a,b\n1,2\n3,4\n');
    fireEvent.contextMenu(colHead(1), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByTestId('menu-item-Paste'));
    await waitFor(() => expect(bridge.gridEdit).toHaveBeenCalledTimes(1));
    expect(lastOps()).toEqual([
      {
        kind: 'setCells',
        cells: [
          { row: 0, col: 1, value: 'z' },
          { row: 1, col: 1, value: 'z' },
          { row: 2, col: 1, value: 'z' },
        ],
      },
    ]);
  });

  it('a pasted block lands at the top-left of a range extended down and right, as one operation', async () => {
    mount('a,b,c\n1,2,3\n4,5,6\n');
    const grid = screen.getByTestId('csv-grid-p1');
    fireEvent.mouseDown(cellAt(0, 0), { button: 0 });
    fireEvent.mouseUp(window);
    fireEvent.keyDown(grid, { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(grid, { key: 'ArrowRight', shiftKey: true });
    fireEvent.paste(grid, { clipboardData: { getData: () => 'p\tq\nr\ts' } });
    await waitFor(() => expect(bridge.gridEdit).toHaveBeenCalledTimes(1));
    expect(lastOps()[0]).toEqual({
      kind: 'setCells',
      cells: [
        { row: 0, col: 0, value: 'p' },
        { row: 0, col: 1, value: 'q' },
        { row: 1, col: 0, value: 'r' },
        { row: 1, col: 1, value: 's' },
      ],
    });
  });

  it('one value pasted onto a multi-cell selection fills every selected cell', async () => {
    mount('a,b,c\n1,2,3\n4,5,6\n');
    const grid = screen.getByTestId('csv-grid-p1');
    fireEvent.mouseDown(cellAt(1, 1), { button: 0 });
    fireEvent.mouseUp(window);
    fireEvent.keyDown(grid, { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(grid, { key: 'ArrowRight', shiftKey: true });
    fireEvent.paste(grid, { clipboardData: { getData: () => 'v' } });
    await waitFor(() => expect(bridge.gridEdit).toHaveBeenCalledTimes(1));
    expect(lastOps()[0]).toEqual({
      kind: 'setCells',
      cells: [
        { row: 1, col: 1, value: 'v' },
        { row: 1, col: 2, value: 'v' },
        { row: 2, col: 1, value: 'v' },
        { row: 2, col: 2, value: 'v' },
      ],
    });
  });

  it('a whole-row selection pastes from column A', async () => {
    mount('a,b\n1,2\n3,4\n');
    fireEvent.mouseDown(rowHead(1), { button: 0 });
    fireEvent.mouseUp(window);
    fireEvent.paste(screen.getByTestId('csv-grid-p1'), { clipboardData: { getData: () => 'p\tq' } });
    await waitFor(() => expect(bridge.gridEdit).toHaveBeenCalledTimes(1));
    expect(lastOps()[0]).toEqual({
      kind: 'setCells',
      cells: [
        { row: 1, col: 0, value: 'p' },
        { row: 1, col: 1, value: 'q' },
      ],
    });
  });

  it('Reset Size on a column header puts the column back to the default width', () => {
    mount('a,b\n1,2\n');
    fireEvent.mouseDown(document.querySelector('[data-grid-resize][data-col="1"]')!, { button: 0, clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 160 });
    fireEvent.mouseUp(window);
    expect(colWidth(1)).toBe(180);
    fireEvent.contextMenu(colHead(1), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByTestId('menu-item-Reset Size'));
    expect(colWidth(1)).toBe(120);
  });

  it('Reset Size on a row header collapses an expanded row', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => ({ font: '', measureText: (t: string) => ({ width: t.length * 8 }) }) as unknown as CanvasRenderingContext2D,
    );
    mount('a,b\n"x\ny\nz",2\n');
    const height = (): number => Number.parseFloat(rowHead(1).style.height);
    fireEvent.doubleClick(rowHead(1));
    expect(height()).toBe(66);
    fireEvent.contextMenu(rowHead(1), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByTestId('menu-item-Reset Size'));
    expect(height()).toBe(22);
  });
});

describe('CsvBody Insert Copied Rows / Columns (FR-038a)', () => {
  /** A clipboard that remembers what was written, as the OS one does. */
  let clipText: string;
  const colHead = (c: number): HTMLElement => document.querySelector<HTMLElement>(`[role="columnheader"][data-col="${c}"]`)!;
  const rowHead = (r: number): HTMLElement => document.querySelector<HTMLElement>(`[role="rowheader"][data-row="${r}"]`)!;
  const ids = (): string[] =>
    [...document.querySelectorAll('[role="menuitem"]')].map((el) => (el.getAttribute('data-testid') ?? '').replace(/^menu-item-/, ''));
  const copiedItems = (): string[] => ids().filter((l) => l.startsWith('Insert Copied'));
  const lastOp = (): unknown => bridge.gridEdit.mock.calls.at(-1)?.[0].operation;

  beforeEach(() => {
    clipText = '';
    window.throng = {
      preview: bridge,
      clipboard: {
        write: vi.fn(async (e: { text: string }) => void (clipText = e.text)),
        writeRich: vi.fn(async (e: { text: string }) => void (clipText = e.text)),
        paste: vi.fn(async () => ({ text: clipText })),
      },
    } as unknown as typeof window.throng;
    __resetCopiedBlock();
  });

  /** Right-click `target` and choose Copy / Cut, waiting for the clipboard write to land. */
  async function chooseFrom(target: HTMLElement, label: string): Promise<void> {
    fireEvent.contextMenu(target, { clientX: 5, clientY: 5 });
    fireEvent.click(await screen.findByTestId(`menu-item-${label}`));
    await waitFor(() => expect(clipText).not.toBe(''));
  }

  it('offers Insert Copied Rows Above and Below on a row header while whole rows are on the clipboard, and inserts them', async () => {
    mount('a,b\n1,2\n3,4\n');
    await chooseFrom(rowHead(1), 'Copy');
    fireEvent.contextMenu(rowHead(2), { clientX: 5, clientY: 5 });
    await screen.findByTestId('menu-item-Insert Copied Rows Above');
    expect(copiedItems()).toEqual(['Insert Copied Rows Above', 'Insert Copied Rows Below']);
    // The blank inserts stay beside them.
    expect(ids()).toEqual(expect.arrayContaining(['Insert Row Above', 'Insert Row Below']));
    fireEvent.click(screen.getByTestId('menu-item-Insert Copied Rows Below'));
    await waitFor(() => expect(bridge.gridEdit).toHaveBeenCalledTimes(1));
    expect(lastOp()).toEqual({ kind: 'insertRows', at: 3, count: 1, values: [['1', '2']] });
  });

  it('inserts several copied rows as one operation', async () => {
    mount('a,b\n1,2\n3,4\n');
    fireEvent.mouseDown(rowHead(0), { button: 0 });
    fireEvent.mouseDown(rowHead(1), { button: 0, shiftKey: true });
    fireEvent.mouseUp(window);
    fireEvent.contextMenu(rowHead(1), { clientX: 5, clientY: 5 });
    fireEvent.click(await screen.findByTestId('menu-item-Copy'));
    await waitFor(() => expect(clipText).not.toBe(''));
    fireEvent.contextMenu(rowHead(2), { clientX: 5, clientY: 5 });
    fireEvent.click(await screen.findByTestId('menu-item-Insert Copied Rows Above'));
    await waitFor(() => expect(bridge.gridEdit).toHaveBeenCalledTimes(1));
    expect(lastOp()).toEqual({ kind: 'insertRows', at: 2, count: 2, values: [['a', 'b'], ['1', '2']] });
  });

  it('offers Insert Copied Columns Left and Right on a column header while whole columns are on the clipboard', async () => {
    mount('a,b\n1,2\n3,4\n');
    await chooseFrom(colHead(0), 'Copy');
    fireEvent.contextMenu(colHead(1), { clientX: 5, clientY: 5 });
    await screen.findByTestId('menu-item-Insert Copied Columns Left');
    expect(copiedItems()).toEqual(['Insert Copied Columns Left', 'Insert Copied Columns Right']);
    expect(ids()).toEqual(expect.arrayContaining(['Insert Column Left', 'Insert Column Right']));
    fireEvent.click(screen.getByTestId('menu-item-Insert Copied Columns Right'));
    await waitFor(() => expect(bridge.gridEdit).toHaveBeenCalledTimes(1));
    expect(lastOp()).toEqual({ kind: 'insertColumn', at: 2, count: 1, columns: [['a', '1', '3']] });
  });

  it('keeps rows and columns apart: copied columns offer no row items, and copied rows no column items', async () => {
    mount('a,b\n1,2\n');
    await chooseFrom(colHead(0), 'Copy');
    fireEvent.contextMenu(rowHead(1), { clientX: 5, clientY: 5 });
    await screen.findByTestId('menu-item-Insert Row Above');
    expect(copiedItems()).toEqual([]);
  });

  it('offers nothing after a copy of plain cells', async () => {
    mount('a,b\n1,2\n');
    await chooseFrom(rowHead(0), 'Copy');
    clipText = '';
    fireEvent.mouseDown(cellAt(1, 0), { button: 0 });
    fireEvent.mouseUp(window);
    fireEvent.copy(screen.getByTestId('csv-grid-p1'));
    await waitFor(() => expect(clipText).toBe('1'));
    fireEvent.contextMenu(rowHead(1), { clientX: 5, clientY: 5 });
    await screen.findByTestId('menu-item-Insert Row Above');
    expect(copiedItems()).toEqual([]);
  });

  it('offers nothing once the clipboard holds other text', async () => {
    mount('a,b\n1,2\n');
    await chooseFrom(rowHead(0), 'Copy');
    clipText = 'copied somewhere else';
    fireEvent.contextMenu(rowHead(1), { clientX: 5, clientY: 5 });
    await screen.findByTestId('menu-item-Insert Row Above');
    expect(copiedItems()).toEqual([]);
  });

  it('cut rows count as copied rows too', async () => {
    mount('a,b\n1,2\n3,4\n');
    await chooseFrom(rowHead(1), 'Cut');
    await waitFor(() => expect(bridge.gridEdit).toHaveBeenCalledTimes(1));
    fireEvent.contextMenu(rowHead(0), { clientX: 5, clientY: 5 });
    await screen.findByTestId('menu-item-Insert Copied Rows Above');
  });
});

describe('CsvBody Save As (FR-035a)', () => {
  let choose: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    choose = vi.fn(async () => 'D:/proj/copy.csv');
    window.throng = { preview: bridge, editor: { chooseSavePath: choose } } as unknown as typeof window.throng;
  });

  it('asks for a location, pre-filled with the file\'s folder and name, then saves there', async () => {
    mount('a,b\n1,2\n');
    expect(await getEditorActions('p1')!.saveAs()).toBe(true);
    expect(choose).toHaveBeenCalledWith({ defaultDir: 'D:/proj', defaultName: 'data.csv' });
    expect(bridge.gridSave).toHaveBeenCalledWith('p1', 'D:/proj/copy.csv');
  });

  it('saves nothing when the dialog is cancelled', async () => {
    choose.mockResolvedValue(null);
    mount('a,b\n1,2\n');
    expect(await getEditorActions('p1')!.saveAs()).toBe(false);
    expect(bridge.gridSave).not.toHaveBeenCalled();
  });

  it('plain Save still saves in place, with no location asked', async () => {
    mount('a,b\n1,2\n');
    expect(await getEditorActions('p1')!.save()).toBe(true);
    expect(choose).not.toHaveBeenCalled();
    expect(bridge.gridSave).toHaveBeenCalledWith('p1');
  });

  it('the grid\'s right-click menu offers Save As next to Save', () => {
    mount('a,b\n1,2\n');
    fireEvent.contextMenu(cellAt(0, 0), { clientX: 5, clientY: 5 });
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.getAttribute('data-testid'));
    expect(labels).toEqual(expect.arrayContaining(['menu-item-Save', 'menu-item-Save As…']));
    fireEvent.click(screen.getByTestId('menu-item-Save As…'));
    expect(choose).toHaveBeenCalled();
  });
});

describe('CsvBody is an editor of its document (FR-033, 044 FR-044)', () => {
  let revision = 0;
  const update = (ownsDocument: boolean, dirty: boolean): void => {
    revision += 1;
    applyPreviewUpdate({
      panelId: 'p1',
      revision,
      filePath: FILE,
      providerId: 'csv',
      content: null,
      dirty,
      parent: null,
      notice: null,
      ownsDocument,
    });
  };

  it('counts its unsaved document, and asks on close, only while it holds the document alone', () => {
    mount('a\n');
    act(() => update(false, true));
    // An editor holds the document: that editor counts it, and closing this preview loses nothing.
    expect(getEditorActions('p1')?.isDirty()).toBe(false);
    expect(getEditorState('p1')).toBeUndefined();

    act(() => update(true, true));
    expect(getEditorActions('p1')?.isDirty()).toBe(true);
    expect(getEditorState('p1')).toMatchObject({ dirty: true, filePath: FILE });
  });

  it('saves through the document from the editor actions Ctrl+S reaches', async () => {
    mount('a\n');
    await expect(getEditorActions('p1')?.save()).resolves.toBe(true);
    expect(bridge.gridSave).toHaveBeenCalledWith('p1');
  });
});
