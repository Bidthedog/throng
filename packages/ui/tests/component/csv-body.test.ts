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
import { EditorView } from '@codemirror/view';
import userEvent from '@testing-library/user-event';
import type { IconKey } from '@throng/core';
import { drawnIcon, iconMarkup } from './helpers/icon-markup.js';
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
  // jsdom has no text geometry; the cell dialog's CodeMirror asks for it on every measure.
  const range = Range.prototype as unknown as Record<string, unknown>;
  range.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  range.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 });
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

  it('Reset Column Width on a column header puts the column back to the default width', () => {
    mount('a,b\n1,2\n');
    fireEvent.mouseDown(document.querySelector('[data-grid-resize][data-col="1"]')!, { button: 0, clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 160 });
    fireEvent.mouseUp(window);
    expect(colWidth(1)).toBe(180);
    fireEvent.contextMenu(colHead(1), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByTestId('menu-item-Reset Column Width'));
    expect(colWidth(1)).toBe(120);
  });

  it('a row header menu has no Reset Row Height, and a double-click on a row number does nothing (FR-012a, FR-006c)', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => ({ font: '', measureText: (t: string) => ({ width: t.length * 8 }) }) as unknown as CanvasRenderingContext2D,
    );
    mount('a,b\n"x\ny\nz",2\n');
    fireEvent.doubleClick(rowHead(1));
    expect(Number.parseFloat(rowHead(1).style.height)).toBe(22);
    fireEvent.contextMenu(rowHead(1), { clientX: 5, clientY: 5 });
    expect(screen.queryByTestId('menu-item-Reset Row Height')).toBeNull();
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

describe('CsvBody Esc after a Cut (FR-037i)', () => {
  beforeEach(() => {
    const clip = { write: vi.fn(async () => {}), writeRich: vi.fn(async () => {}), paste: vi.fn(async () => ({ text: '' })) };
    window.throng = { preview: bridge, clipboard: clip } as unknown as typeof window.throng;
  });
  const grid = (): HTMLElement => screen.getByTestId('csv-grid-p1');
  const showText = (h: ReturnType<typeof mount>, text: string): void =>
    h.rerender(createElement(ContextMenuProvider, { children: createElement(CsvBody, props(text)) }));
  const cutThen = async (next: (h: ReturnType<typeof mount>) => void): Promise<ReturnType<typeof mount>> => {
    const h = mount('a,b\n1,2\n3,4\n');
    fireEvent.mouseDown(cellAt(1, 0), { button: 0 });
    fireEvent.mouseUp(window);
    fireEvent.cut(grid());
    await waitFor(() => expect(bridge.gridEdit).toHaveBeenCalled());
    // The edit lands: the document now holds the cut text.
    showText(h, 'a,b\n,2\n3,4\n');
    next(h);
    return h;
  };

  it('undoes the cut once, and a second Esc does nothing more', async () => {
    await cutThen(() => {});
    fireEvent.keyDown(grid(), { key: 'Escape' });
    expect(bridge.gridUndo).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(grid(), { key: 'Escape' });
    expect(bridge.gridUndo).toHaveBeenCalledTimes(1);
  });

  it('does nothing once anything else has changed the document since the cut', async () => {
    await cutThen((h) => showText(h, 'a,b\n,2\nx,4\n'));
    fireEvent.keyDown(grid(), { key: 'Escape' });
    expect(bridge.gridUndo).not.toHaveBeenCalled();
  });

  it('does nothing with no cut before it', () => {
    mount('a,b\n1,2\n');
    fireEvent.keyDown(grid(), { key: 'Escape' });
    expect(bridge.gridUndo).not.toHaveBeenCalled();
  });
});

describe('CsvBody cell dialog (FR-036a, FR-036b, FR-060a)', () => {
  // Threshold 5: 'ab' and 'name' are short; the JSON object (7 characters) and the two-line value are long.
  const TEXT = 'name,doc\nab,"{""k"":1}"\n"line one\nline two",x\n';
  const settings = (over: Record<string, unknown> = {}): PreviewBodyProps['providerSettings'] => ({
    enabled: true,
    editLongCellsInDialog: true,
    longCellThreshold: 5,
    ...over,
  });
  const open = (over: Partial<PreviewBodyProps> = {}) =>
    mount(TEXT, { providerSettings: settings(), ...over });
  const grid = (): HTMLElement => screen.getByTestId('csv-grid-p1');
  const dialog = (): HTMLElement | null => screen.queryByTestId('cell-dialog');
  const view = (): EditorView => EditorView.findFromDOM(dialog()!.querySelector<HTMLElement>('.cm-editor')!)!;
  const dialogText = (): string => view().state.doc.toString();
  const setDialogText = (text: string): void =>
    act(() => view().dispatch({ changes: { from: 0, to: view().state.doc.length, insert: text } }));
  const select = (r: number, c: number): void => {
    fireEvent.mouseDown(cellAt(r, c), { button: 0 });
    fireEvent.mouseUp(window);
  };
  const menuHas = (label: string): boolean => document.querySelector(`[data-testid="menu-item-${label}"]`) !== null;

  it('opens a long cell in the dialog on Enter, F2 and a double-click, and a short cell in the cell editor', () => {
    open();
    select(2, 0);
    fireEvent.keyDown(grid(), { key: 'Enter' });
    expect(dialog()).not.toBeNull();
    expect(screen.queryByLabelText('Cell value')).toBeNull();
    expect(dialogText()).toBe('line one\nline two');
    fireEvent.keyDown(dialog()!, { key: 'Escape' });
    expect(dialog()).toBeNull();

    fireEvent.keyDown(grid(), { key: 'F2' });
    expect(dialog()).not.toBeNull();
    fireEvent.keyDown(dialog()!, { key: 'Escape' });
    fireEvent.doubleClick(cellAt(2, 0));
    expect(dialog()).not.toBeNull();
    fireEvent.keyDown(dialog()!, { key: 'Escape' });

    select(1, 0);
    fireEvent.keyDown(grid(), { key: 'Enter' });
    expect(dialog()).toBeNull();
    expect(screen.getByLabelText('Cell value')).toBeTruthy();
  });

  it('still edits in place when a character is typed on a long cell', () => {
    open();
    select(2, 0);
    fireEvent.keyDown(grid(), { key: 'x' });
    expect(dialog()).toBeNull();
    expect((screen.getByLabelText('Cell value') as HTMLTextAreaElement).value).toBe('x');
  });

  it('opens a value that is a JSON object pretty-printed, with the editor highlighting it as JSON', async () => {
    open();
    select(1, 1);
    fireEvent.keyDown(grid(), { key: 'Enter' });
    expect(dialogText()).toBe('{\n  "k": 1\n}');
    await waitFor(() => expect(dialog()!.querySelector('.cm-editor')?.textContent).toContain('"k"'));
  });

  it('Esc cancels without writing, and gives the keyboard back to the grid', () => {
    open();
    select(2, 0);
    fireEvent.keyDown(grid(), { key: 'Enter' });
    setDialogText('changed');
    fireEvent.keyDown(dialog()!, { key: 'Escape' });
    expect(dialog()).toBeNull();
    expect(bridge.gridEdit).not.toHaveBeenCalled();
  });

  // Reported 2026-11-19: after the dialog closed the grid looked focused but no shortcut reached it — focus was
  // handed back while the dialog's focus trap was still mounted, which pulled it straight back into the closing
  // dialog and left it on the page body.
  it.each([
    ['Escape', (): void => void fireEvent.keyDown(dialog()!, { key: 'Escape' })],
    ['Cancel', (): void => void fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))],
    ['Save', (): void => void fireEvent.click(screen.getByRole('button', { name: 'Save' }))],
    ['Ctrl+Enter', (): void => void fireEvent.keyDown(dialog()!, { key: 'Enter', ctrlKey: true })],
  ])('closing by %s puts DOM focus back on the grid, so its shortcuts work', async (_how, close) => {
    open();
    select(2, 0);
    fireEvent.keyDown(grid(), { key: 'Enter' });
    expect(dialog()).not.toBeNull();
    // Focus inside the dialog, as it is once the editor has taken the caret.
    act(() => dialog()!.querySelector<HTMLElement>('.cm-content')!.focus());
    act(() => close());
    expect(dialog()).toBeNull();
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(document.activeElement).toBe(grid());
  });

  it('Save with the text unchanged writes nothing', async () => {
    open();
    select(1, 1);
    fireEvent.keyDown(grid(), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(dialog()).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(bridge.gridEdit).not.toHaveBeenCalled();
  });

  it('Save writes the text with each line break turned into one space, as ONE setCells edit', async () => {
    open();
    select(2, 0);
    fireEvent.keyDown(grid(), { key: 'Enter' });
    setDialogText('first\nsecond\r\n  third');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bridge.gridEdit).toHaveBeenCalledTimes(1));
    expect(bridge.gridEdit.mock.calls[0]?.[0].operation).toEqual({
      kind: 'setCells',
      cells: [{ row: 2, col: 0, value: 'first second   third' }],
    });
    expect(dialog()).toBeNull();
  });

  it('Ctrl+Enter saves too, and flattens an edited JSON value, line break and indent becoming one space', async () => {
    open();
    select(1, 1);
    fireEvent.keyDown(grid(), { key: 'Enter' });
    setDialogText('{\n    "k": 2,\n    "j": [\n        1\n    ]\n}');
    fireEvent.keyDown(dialog()!, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(bridge.gridEdit).toHaveBeenCalledTimes(1));
    expect(bridge.gridEdit.mock.calls[0]?.[0].operation).toEqual({
      kind: 'setCells',
      cells: [{ row: 1, col: 1, value: '{ "k": 2, "j": [ 1 ] }' }],
    });
  });

  it('Edit in Dialog… is on every cell\'s menu, short or long, and opens that cell', () => {
    open();
    fireEvent.contextMenu(cellAt(1, 0), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByTestId('menu-item-Edit in Dialog…'));
    expect(dialogText()).toBe('ab');
    setDialogText('one\ntwo');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    return waitFor(() =>
      expect(bridge.gridEdit.mock.calls[0]?.[0].operation).toEqual({
        kind: 'setCells',
        cells: [{ row: 1, col: 0, value: 'one two' }],
      }),
    );
  });

  describe('Edit in Dialog… needs exactly one cell (FR-036d)', () => {
    const item = (): HTMLElement => screen.getByTestId('menu-item-Edit in Dialog…');
    const menuAt = (r: number, c: number): void => {
      fireEvent.contextMenu(cellAt(r, c), { clientX: 5, clientY: 5 });
    };

    it('is enabled for one cell, and says why it is disabled once the selection is wider', () => {
      open();
      select(1, 0);
      menuAt(1, 0);
      expect(item()).toHaveAttribute('aria-disabled', 'false');
    });

    it('is disabled for a block of cells', () => {
      open();
      select(0, 0);
      fireEvent.keyDown(grid(), { key: 'ArrowRight', shiftKey: true });
      menuAt(0, 0);
      expect(item()).toHaveAttribute('aria-disabled', 'true');
      expect(item().getAttribute('title')).toMatch(/one cell/i);
    });

    it('is disabled for whole rows and for whole columns', () => {
      open();
      fireEvent.mouseDown(document.querySelector('[role="rowheader"][data-row="1"]')!, { button: 0 });
      fireEvent.mouseUp(window);
      menuAt(1, 0);
      expect(item()).toHaveAttribute('aria-disabled', 'true');
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      fireEvent.mouseDown(document.querySelector('[role="columnheader"][data-col="1"]')!, { button: 0 });
      fireEvent.mouseUp(window);
      menuAt(0, 1);
      expect(item()).toHaveAttribute('aria-disabled', 'true');
    });

    it('a disabled item does nothing when clicked', () => {
      open();
      select(0, 0);
      fireEvent.keyDown(grid(), { key: 'ArrowRight', shiftKey: true });
      menuAt(0, 0);
      fireEvent.click(item());
      expect(dialog()).toBeNull();
    });
  });

  describe('availability — the panel\'s own choice, else the setting', () => {
    it('with the setting off and no choice: no routing and no menu item', () => {
      open({ providerSettings: settings({ editLongCellsInDialog: false }) });
      select(2, 0);
      fireEvent.keyDown(grid(), { key: 'Enter' });
      expect(dialog()).toBeNull();
      expect(screen.getByLabelText('Cell value')).toBeTruthy();
      fireEvent.keyDown(screen.getByLabelText('Cell value'), { key: 'Escape' });
      fireEvent.contextMenu(cellAt(1, 0), { clientX: 5, clientY: 5 });
      expect(menuHas('Edit in Dialog…')).toBe(false);
    });

    it('with the setting on but the panel switched off: the same', () => {
      open({ cellDialogChoice: false });
      select(2, 0);
      fireEvent.keyDown(grid(), { key: 'Enter' });
      expect(dialog()).toBeNull();
      fireEvent.keyDown(screen.getByLabelText('Cell value'), { key: 'Escape' });
      fireEvent.contextMenu(cellAt(1, 0), { clientX: 5, clientY: 5 });
      expect(menuHas('Edit in Dialog…')).toBe(false);
    });

    it('with the setting off but the panel switched on: both are offered', () => {
      open({ providerSettings: settings({ editLongCellsInDialog: false }), cellDialogChoice: true });
      select(2, 0);
      fireEvent.keyDown(grid(), { key: 'Enter' });
      expect(dialog()).not.toBeNull();
      fireEvent.keyDown(dialog()!, { key: 'Escape' });
      fireEvent.contextMenu(cellAt(1, 0), { clientX: 5, clientY: 5 });
      expect(menuHas('Edit in Dialog…')).toBe(true);
    });

    it('reads the threshold as a whole number of at least 1', () => {
      open({ providerSettings: settings({ longCellThreshold: 0 }) });
      select(1, 0);
      fireEvent.keyDown(grid(), { key: 'Enter' });
      // 'ab' has 2 characters: more than 1, so a threshold of 0 (clamped to 1) sends it to the dialog.
      expect(dialog()).not.toBeNull();
    });
  });
});

describe('CsvBody menu icons (FR-037g)', () => {
  const iconOf = (label: string): string | undefined =>
    drawnIcon(document.querySelector(`[data-testid="menu-item-${label}"]`));
  const expectIcons = (expected: Record<string, IconKey>): void => {
    for (const [label, key] of Object.entries(expected)) {
      expect(document.querySelector(`[data-testid="menu-item-${label}"]`), label).not.toBeNull();
      expect(iconOf(label), label).toBe(iconMarkup(key));
    }
  };
  const head = (kind: 'columnheader' | 'rowheader', n: number): HTMLElement =>
    document.querySelector<HTMLElement>(`[role="${kind}"][data-${kind === 'columnheader' ? 'col' : 'row'}="${n}"]`)!;

  beforeEach(() => {
    window.throng = { preview: bridge, clipboard: { paste: vi.fn(async () => ({ text: '' })) } } as unknown as typeof window.throng;
  });

  it('draws a themeable icon on each cell-menu item that has a picture, and none on Column Width…', () => {
    mount('a,b\n1,2\n', { providerSettings: { enabled: true, editLongCellsInDialog: true, longCellThreshold: 5 } });
    fireEvent.contextMenu(cellAt(0, 0), { clientX: 5, clientY: 5 });
    expectIcons({
      Undo: 'undo',
      Redo: 'redo',
      Cut: 'cut',
      Copy: 'copy',
      Paste: 'paste',
      'Select All': 'selectAll',
      Save: 'save',
      'Save As…': 'saveAs',
      'Edit in Dialog…': 'cellDialog',
      'Insert Row Above': 'insertRowAbove',
      'Insert Row Below': 'insertRowBelow',
      'Insert Column Left': 'insertColumnLeft',
      'Insert Column Right': 'insertColumnRight',
      'Go to Row…': 'goToRow',
    });
    expect(iconOf('Column Width…')).toBeUndefined();
    // FR-037h — a header's own menu offers no Select Row / Select Column: clicking the header already selected it.
    expect(screen.queryByTestId('menu-item-Select Column')).toBeNull();
  });

  it('draws them on the row-header menu', () => {
    mount('a,b\n1,2\n');
    fireEvent.contextMenu(head('rowheader', 1), { clientX: 5, clientY: 5 });
    expectIcons({
      'Insert Row Above': 'insertRowAbove',
      'Insert Row Below': 'insertRowBelow',
      Cut: 'cut',
      Copy: 'copy',
      Paste: 'paste',
      'Go to Row…': 'goToRow',
    });
  });

  it('draws them on the column-header menu', () => {
    mount('a,b\n1,2\n');
    fireEvent.contextMenu(head('columnheader', 1), { clientX: 5, clientY: 5 });
    expectIcons({
      'Insert Column Left': 'insertColumnLeft',
      'Insert Column Right': 'insertColumnRight',
      Cut: 'cut',
      Copy: 'copy',
      Paste: 'paste',
      'Reset Column Width': 'resetColumnWidth',
    });
    expect(iconOf('Column Width…')).toBeUndefined();
  });
});

describe('CsvBody wrap (FR-013, FR-060b)', () => {
  const rowHeight = (r: number): number =>
    Number.parseFloat(document.querySelector<HTMLElement>(`[role="rowheader"][data-row="${r}"]`)!.style.height);
  const DOC = 'a,b\n"x\ny\nz",2\n';

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => ({ font: '', measureText: (t: string) => ({ width: t.length * 8 }) }) as unknown as CanvasRenderingContext2D,
    );
  });

  it('is off by default: every row one line, cells truncated', () => {
    mount(DOC);
    expect(rowHeight(1)).toBe(22);
    expect(cellAt(1, 0).textContent).toBe('x⏎y⏎z');
  });

  it('wraps when the panel chose it: the row grows to show every line break', () => {
    mount(DOC, { wrapChoice: true });
    expect(rowHeight(1)).toBe(66);
    expect(cellAt(1, 0).textContent).toBe('x\ny\nz');
  });

  it('wraps when the setting is on and the panel has not chosen', () => {
    mount(DOC, { providerSettings: { enabled: true, wrapCells: true } });
    expect(rowHeight(1)).toBe(66);
  });

  it('takes the panel choice over the setting, either way', () => {
    mount(DOC, { wrapChoice: false, providerSettings: { enabled: true, wrapCells: true } });
    expect(rowHeight(1)).toBe(22);
  });

  it('changes nothing in the document: no edit is sent and nothing becomes dirty', () => {
    mount(DOC, { wrapChoice: true });
    expect(bridge.gridEdit).not.toHaveBeenCalled();
    expect(getEditorState('p1')?.dirty ?? false).toBe(false);
  });
});

describe('CsvBody Go to Row (FR-043a, FR-043b)', () => {
  const rows = (n: number): string => `h1,h2,h3\n${Array.from({ length: n - 1 }, (_, i) => `a${i},b${i},c${i}`).join('\n')}\n`;
  const grid = (): HTMLElement => screen.getByTestId('csv-grid-p1');
  const dialog = (): HTMLElement | null => screen.queryByTestId('grid-goto-p1');
  const input = (): HTMLInputElement => screen.getByTestId('grid-goto-p1-input') as HTMLInputElement;
  const activeRow = (): string | null =>
    document.querySelector('[data-grid-cell].data-grid__cell--active')?.getAttribute('data-row') ?? null;
  const select = (r: number, c: number): void => {
    fireEvent.mouseDown(cellAt(r, c), { button: 0 });
    fireEvent.mouseUp(window);
  };
  /** The body's claim on Ctrl+G, as the panel dispatches it. */
  function mountClaiming(text: string) {
    const registerGoTo = vi.fn();
    mount(text, { registerGoTo });
    const open = (): void => {
      const claim = registerGoTo.mock.calls.at(-1)?.[0] as (() => void) | null;
      act(() => claim?.());
    };
    return { registerGoTo, open };
  }

  it('hands the panel its opener on mount and takes it back on unmount', () => {
    const registerGoTo = vi.fn();
    const { unmount } = mount('a,b\n1,2\n', { registerGoTo });
    expect(registerGoTo).toHaveBeenLastCalledWith(expect.any(Function));
    unmount();
    expect(registerGoTo).toHaveBeenLastCalledWith(null);
  });

  it('the chord opens a dialog naming the active cell\'s row and the row count, digit-grouped', () => {
    const { open } = mountClaiming(rows(1200));
    open();
    expect(dialog()).not.toBeNull();
    expect(screen.getByTestId('grid-goto-p1-status').textContent).toBe('Row 1 of 1,200');
    expect(input()).toHaveFocus();
  });

  it('names the row of the active cell as the row header numbers it', () => {
    const { open } = mountClaiming(rows(40));
    select(6, 2);
    open();
    expect(screen.getByTestId('grid-goto-p1-status').textContent).toBe('Row 7 of 40');
  });

  it('refuses a letter and a number past the last row', async () => {
    const { open } = mountClaiming(rows(1200));
    open();
    const user = userEvent.setup();
    await user.type(input(), 'x');
    expect(input().value).toBe('');
    await user.type(input(), '1300');
    expect(input().value).toBe('130');
  });

  it('Enter makes that row\'s cell in the active column the active cell, closes, and returns focus to the grid', async () => {
    const { open } = mountClaiming(rows(1200));
    select(0, 2);
    open();
    const user = userEvent.setup();
    await user.type(input(), '900{Enter}');
    expect(dialog()).toBeNull();
    expect(grid()).toHaveFocus();
    // The virtualised window in jsdom does not draw row 900, so read the active row back through the dialog.
    open();
    expect(screen.getByTestId('grid-goto-p1-status').textContent).toBe('Row 900 of 1,200');
  });

  it('Enter with nothing typed leaves the dialog open and the active cell where it was', async () => {
    const { open } = mountClaiming(rows(40));
    select(3, 1);
    open();
    const user = userEvent.setup();
    await user.type(input(), '{Enter}');
    expect(dialog()).not.toBeNull();
    expect(activeRow()).toBe('3');
  });

  it('Escape closes it, moving nothing, with focus back in the grid', () => {
    const { open } = mountClaiming(rows(40));
    select(3, 1);
    open();
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(dialog()).toBeNull();
    expect(activeRow()).toBe('3');
    expect(grid()).toHaveFocus();
  });

  it('Go to Row… is on the cell menu and the row-header menu, and opens the same dialog', () => {
    mount(rows(40));
    fireEvent.contextMenu(cellAt(2, 1), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByTestId('menu-item-Go to Row…'));
    expect(dialog()).not.toBeNull();
    expect(screen.getByTestId('grid-goto-p1-status').textContent).toBe('Row 3 of 40');
    fireEvent.keyDown(input(), { key: 'Escape' });

    fireEvent.contextMenu(document.querySelector('[role="rowheader"][data-row="4"]')!, { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByTestId('menu-item-Go to Row…'));
    expect(screen.getByTestId('grid-goto-p1-status').textContent).toBe('Row 5 of 40');
  });

  it('is not on the column-header menu', () => {
    mount(rows(40));
    fireEvent.contextMenu(document.querySelector('[role="columnheader"][data-col="1"]')!, { clientX: 5, clientY: 5 });
    expect(document.querySelector('[data-testid="menu-item-Go to Row…"]')).toBeNull();
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
