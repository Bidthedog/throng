/**
 * 073 FR-001 – FR-008, FR-024, FR-025, FR-036 – FR-039 — the shared data grid as a component.
 * Layer: component — what the grid renders, which DOM events it turns into intents, its aria shape and the
 * in-cell editor's keyboard handling need a DOM; the movement arithmetic itself is proved at unit
 * (`grid-selection.test.ts`), so these cases prove WIRING with one representative each. jsdom has no
 * layout, so the grid draws a fallback 800 x 600 window — enough to assert what is virtualised.
 */
import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { createElement, createRef } from 'react';
import { formatGrouped } from '@throng/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DataGrid,
  GRID_DEFAULT_COLUMN_WIDTH,
  type DataGridHandle,
  type DataGridProps,
} from '../../src/renderer/grid/data-grid.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(over: Partial<DataGridProps> = {}) {
  const spies = {
    onCommitEdit: vi.fn(),
    onClear: vi.fn(),
    onCopy: vi.fn(),
    onCut: vi.fn(),
    onPaste: vi.fn(),
    onHistory: vi.fn(),
    onContextMenu: vi.fn(),
    onSelectionChange: vi.fn(),
    onScrollChange: vi.fn(),
    onColumnWidthChange: vi.fn(),
  };
  const ref = createRef<DataGridHandle>();
  const props: DataGridProps & { ref: typeof ref } = {
    testId: 'grid',
    rowCount: 50,
    colCount: 6,
    getCell: (r, c) => `r${r}c${c}`,
    editable: true,
    columnWidths: {},
    zoom: 1,
    ...spies,
    ...over,
    ref,
  };
  const utils = render(createElement(DataGrid, props));
  const root = screen.getByTestId('grid');
  const cellAt = (r: number, c: number): HTMLElement => {
    const el = root.querySelector<HTMLElement>(`[data-grid-cell][data-row="${r}"][data-col="${c}"]`);
    if (!el) throw new Error(`no cell ${r},${c} in the DOM`);
    return el;
  };
  const key = (k: string, init: Partial<KeyboardEventInit> = {}): boolean =>
    fireEvent.keyDown(root, { key: k, ...init });
  const rerender = (next: Partial<DataGridProps>): void =>
    utils.rerender(createElement(DataGrid, { ...props, ...next, ref }));
  return { ...spies, ref, root, cellAt, key, rerender };
}

const sel = (g: ReturnType<typeof setup>) => g.ref.current!.getSelection();

describe('DataGrid rendering', () => {
  it('draws column letters, grouped row numbers and cell text, with the grid aria shape', () => {
    const g = setup({ rowCount: 1500, colCount: 28 });
    const heads = [...g.root.querySelectorAll('[role="columnheader"]')].map((e) => e.textContent);
    expect(heads.slice(0, 3)).toEqual(['A', 'B', 'C']);
    expect(g.root.querySelector('[role="rowheader"]')?.textContent).toBe(formatGrouped(1));
    expect(g.cellAt(0, 1).textContent).toBe('r0c1');
    expect(g.root).toHaveAttribute('role', 'grid');
    expect(g.root).toHaveAttribute('aria-colcount', '28');
    expect(g.root).toHaveAttribute('aria-rowcount', '1501');
    expect(g.root).toHaveAttribute('tabindex', '0');
  });

  it('uses columnHeader labels when the parent supplies them', () => {
    const g = setup({ columnHeader: (c) => `Col ${c}` });
    expect(g.root.querySelector('[role="columnheader"]')?.textContent).toBe('Col 0');
  });

  it('shows a newline as a visible marker and keeps the full value in the tooltip', () => {
    const g = setup({ getCell: () => 'a\nb' });
    expect(g.cellAt(0, 0).textContent).toBe('a⏎b');
    expect(g.cellAt(0, 0)).toHaveAttribute('title', 'a\nb');
  });

  it('renders a value as literal text and creates no element from it (FR-005)', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const g = setup({ getCell: () => payload });
    expect(g.cellAt(0, 0).textContent).toBe(payload);
    expect(g.root.querySelector('img')).toBeNull();
    expect(g.cellAt(0, 0).children).toHaveLength(0);
  });

  it('shows one empty cell for an empty table', () => {
    const g = setup({ rowCount: 0, colCount: 0 });
    expect(g.cellAt(0, 0).textContent).toBe('');
    expect(g.root.querySelectorAll('[data-grid-cell]')).toHaveLength(1);
  });

  it('draws only the visible window of a 100,000 x 50 table (FR-003)', () => {
    const g = setup({ rowCount: 100_000, colCount: 50 });
    const drawn = g.root.querySelectorAll('[data-grid-cell]').length;
    expect(drawn).toBeGreaterThan(20);
    expect(drawn).toBeLessThan(2000);
  });
});

describe('DataGrid keyboard', () => {
  it('moves the active cell with the arrows and extends with Shift', () => {
    const g = setup();
    g.key('ArrowDown');
    g.key('ArrowRight');
    expect(sel(g).active).toEqual({ row: 1, col: 1 });
    expect(g.cellAt(1, 1)).toHaveClass('data-grid__cell--active');
    g.key('ArrowDown', { shiftKey: true });
    expect(sel(g)).toMatchObject({ anchor: { row: 1, col: 1 }, active: { row: 2, col: 1 } });
    expect(g.cellAt(2, 1)).toHaveAttribute('aria-selected', 'true');
    expect(g.cellAt(3, 1)).toHaveAttribute('aria-selected', 'false');
    expect(g.onSelectionChange).toHaveBeenLastCalledWith(sel(g));
  });

  it('pages by the visible rows, jumps with Ctrl+End and selects everything with Ctrl+A', () => {
    const g = setup();
    g.key('PageDown');
    expect(sel(g).active.row).toBe(26);
    g.key('End', { ctrlKey: true });
    expect(sel(g).active).toEqual({ row: 49, col: 5 });
    g.key('a', { ctrlKey: true });
    expect(g.ref.current!.selectedRange()).toEqual({ top: 0, left: 0, bottom: 49, right: 5 });
  });

  it('Tab moves right, and leaves the grid at the last cell instead of trapping focus', () => {
    const g = setup({ rowCount: 1, colCount: 2 });
    expect(g.key('Tab')).toBe(false);
    expect(sel(g).active.col).toBe(1);
    expect(g.key('Tab')).toBe(true);
  });

  it('keeps its selection across a content update, clamped to what remains (FR-025)', () => {
    const g = setup();
    act(() => {
      g.ref.current!.setSelection({ anchor: { row: 40, col: 5 }, active: { row: 40, col: 5 } });
    });
    g.rerender({ rowCount: 10, colCount: 3 });
    expect(sel(g).active).toEqual({ row: 9, col: 2 });
  });
});

describe('DataGrid mouse', () => {
  it('click selects a cell, Shift+click extends, and a drag extends', () => {
    const g = setup();
    fireEvent.mouseDown(g.cellAt(1, 1), { button: 0 });
    expect(sel(g).active).toEqual({ row: 1, col: 1 });
    fireEvent.mouseDown(g.cellAt(3, 2), { button: 0, shiftKey: true });
    expect(g.ref.current!.selectedRange()).toEqual({ top: 1, left: 1, bottom: 3, right: 2 });
    fireEvent.mouseUp(window);

    // jsdom lays nothing out, so a point maps through the gutter and the 22 px rows: x past the gutter by
    // 2.5 columns, y past the header by 4.5 rows.
    fireEvent.mouseDown(g.cellAt(0, 0), { button: 0 });
    const gutter = Number.parseFloat(g.root.querySelector<HTMLElement>('.data-grid__gutter')!.style.width);
    const header = Number.parseFloat(g.root.querySelector<HTMLElement>('.data-grid__header')!.style.height);
    fireEvent.mouseMove(window, {
      clientX: gutter + GRID_DEFAULT_COLUMN_WIDTH * 2.5,
      clientY: header + 22 * 4.5,
    });
    fireEvent.mouseUp(window);
    expect(g.ref.current!.selectedRange()).toEqual({ top: 0, left: 0, bottom: 4, right: 2 });
  });

  it('a row number selects the whole row; a column letter selects the whole column', () => {
    const g = setup();
    fireEvent.mouseDown(g.root.querySelector('[role="rowheader"][data-row="2"]')!, { button: 0 });
    fireEvent.mouseUp(window);
    expect(sel(g).rows).toBe(true);
    expect(g.ref.current!.selectedRange()).toEqual({ top: 2, left: 0, bottom: 2, right: 5 });

    fireEvent.mouseDown(g.root.querySelector('[role="columnheader"][data-col="3"]')!, { button: 0 });
    fireEvent.mouseUp(window);
    expect(g.ref.current!.selectedRange()).toEqual({ top: 0, left: 3, bottom: 49, right: 3 });
  });

  it('marks the grid with the drag under way, and clears it on release (FR-008e)', () => {
    const g = setup();
    expect(g.root.getAttribute('data-drag')).toBeNull();
    fireEvent.mouseDown(g.root.querySelector('[role="columnheader"][data-col="1"]')!, { button: 0 });
    expect(g.root.getAttribute('data-drag')).toBe('cols');
    fireEvent.mouseUp(window);
    expect(g.root.getAttribute('data-drag')).toBeNull();
    fireEvent.mouseDown(g.root.querySelector('[role="rowheader"][data-row="2"]')!, { button: 0 });
    expect(g.root.getAttribute('data-drag')).toBe('rows');
    fireEvent.mouseUp(window);
    fireEvent.mouseDown(g.cellAt(1, 1), { button: 0 });
    expect(g.root.getAttribute('data-drag')).toBe('cells');
    fireEvent.mouseUp(window);
    expect(g.root.getAttribute('data-drag')).toBeNull();
  });

  describe('the corner cell selects everything (FR-008b)', () => {
    const corner = (g: ReturnType<typeof setup>): HTMLElement => g.root.querySelector<HTMLElement>('.data-grid__corner')!;

    it('is a named control', () => {
      const g = setup();
      expect(corner(g)).toHaveAccessibleName('Select all');
    });

    it('a click selects every row and column, as Select All does, without scrolling', () => {
      const g = setup();
      fireEvent.mouseDown(g.cellAt(2, 2), { button: 0 });
      fireEvent.mouseUp(window);
      const scroller = g.root.querySelector<HTMLElement>('.data-grid__scroller')!;
      scroller.scrollTop = 300;
      fireEvent.mouseDown(corner(g), { button: 0 });
      fireEvent.mouseUp(window);
      expect(g.ref.current!.selectedRange()).toEqual({ top: 0, left: 0, bottom: 49, right: 5 });
      expect(scroller.scrollTop).toBe(300);
    });

    it('a right-click selects everything and opens the selection menu', () => {
      const g = setup();
      fireEvent.contextMenu(corner(g), { button: 2 });
      expect(g.ref.current!.selectedRange()).toEqual({ top: 0, left: 0, bottom: 49, right: 5 });
      expect(g.onContextMenu).toHaveBeenCalledTimes(1);
    });
  });
});

describe('DataGrid cell editor (FR-036)', () => {
  it('Enter opens an editor holding the cell text; Enter commits and moves down', () => {
    const g = setup();
    g.key('Enter');
    const editor = screen.getByLabelText('Cell value') as HTMLTextAreaElement;
    expect(editor.value).toBe('r0c0');
    fireEvent.change(editor, { target: { value: 'new' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(g.onCommitEdit).toHaveBeenCalledWith(0, 0, 'new', 'down');
    expect(screen.queryByLabelText('Cell value')).toBeNull();
    expect(sel(g).active).toEqual({ row: 1, col: 0 });
  });

  it('typing a character opens the editor with that character replacing the value; Tab commits right', () => {
    const g = setup();
    g.key('x');
    const editor = screen.getByLabelText('Cell value') as HTMLTextAreaElement;
    expect(editor.value).toBe('x');
    fireEvent.keyDown(editor, { key: 'Tab' });
    expect(g.onCommitEdit).toHaveBeenCalledWith(0, 0, 'x', 'right');
    expect(sel(g).active).toEqual({ row: 0, col: 1 });
  });

  it('F2 opens the editor, Esc cancels without a commit, and an unchanged value is no commit', () => {
    const g = setup();
    g.key('F2');
    fireEvent.change(screen.getByLabelText('Cell value'), { target: { value: 'changed' } });
    fireEvent.keyDown(screen.getByLabelText('Cell value'), { key: 'Escape' });
    expect(g.onCommitEdit).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Cell value')).toBeNull();

    g.key('Enter');
    fireEvent.keyDown(screen.getByLabelText('Cell value'), { key: 'Enter' });
    expect(g.onCommitEdit).not.toHaveBeenCalled();
  });

  it('Shift+Enter and Alt+Enter insert a line break instead of committing', () => {
    const g = setup();
    g.key('Enter');
    const editor = screen.getByLabelText('Cell value') as HTMLTextAreaElement;
    fireEvent.keyDown(editor, { key: 'Enter', altKey: true });
    fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true });
    expect(editor.value).toBe('r0c0\n\n');
    expect(g.onCommitEdit).not.toHaveBeenCalled();
  });

  it('blur commits without moving', () => {
    const g = setup();
    g.key('x');
    fireEvent.blur(screen.getByLabelText('Cell value'));
    expect(g.onCommitEdit).toHaveBeenCalledWith(0, 0, 'x', 'none');
    expect(sel(g).active).toEqual({ row: 0, col: 0 });
  });

  it('Delete clears the selected range', () => {
    const g = setup();
    g.key('ArrowDown', { shiftKey: true });
    g.key('Delete');
    expect(g.onClear).toHaveBeenCalledWith({ top: 0, left: 0, bottom: 1, right: 0 });
  });

  it('a read-only grid never opens an editor and never offers clear, cut, paste or history', () => {
    const g = setup({ editable: false });
    g.key('Enter');
    g.key('F2');
    g.key('x');
    g.key('Delete');
    g.key('z', { ctrlKey: true });
    fireEvent.cut(g.root);
    fireEvent.paste(g.root, { clipboardData: { getData: () => 'a' } });
    expect(screen.queryByLabelText('Cell value')).toBeNull();
    expect(g.onClear).not.toHaveBeenCalled();
    expect(g.onHistory).not.toHaveBeenCalled();
    expect(g.onCut).not.toHaveBeenCalled();
    expect(g.onPaste).not.toHaveBeenCalled();
    // Copy still works on a read-only grid (FR-024).
    fireEvent.copy(g.root);
    expect(g.onCopy).toHaveBeenCalledOnce();
  });

  it('beginEdit() on the handle opens the editor on the active cell', () => {
    const g = setup();
    act(() => {
      g.ref.current!.setSelection({ anchor: { row: 2, col: 1 }, active: { row: 2, col: 1 } });
    });
    act(() => {
      g.ref.current!.beginEdit();
    });
    expect((screen.getByLabelText('Cell value') as HTMLTextAreaElement).value).toBe('r2c1');
  });
});

describe('DataGrid clipboard and history chords', () => {
  it('copy, cut and paste arrive as platform events and are consumed', () => {
    const g = setup();
    g.key('ArrowDown', { shiftKey: true });

    const copy = createEvent.copy(g.root);
    fireEvent(g.root, copy);
    expect(copy.defaultPrevented).toBe(true);
    expect(g.onCopy).toHaveBeenCalledWith(sel(g), { top: 0, left: 0, bottom: 1, right: 0 });

    const cut = createEvent.cut(g.root);
    fireEvent(g.root, cut);
    expect(cut.defaultPrevented).toBe(true);
    expect(g.onCut).toHaveBeenCalledOnce();

    const paste = createEvent.paste(g.root, { clipboardData: { getData: (t: string) => (t === 'text/plain' ? 'a\tb' : '') } });
    fireEvent(g.root, paste);
    expect(paste.defaultPrevented).toBe(true);
    // FR-037f: a paste lands at the selection's top-left (here row 0, the anchor), with the range it covers.
    expect(g.onPaste).toHaveBeenCalledWith('a\tb', { row: 0, col: 0 }, { top: 0, left: 0, bottom: 1, right: 0 });
  });

  it('leaves the Ctrl+C keydown itself alone, so the platform raises the event', () => {
    const g = setup();
    expect(g.key('c', { ctrlKey: true })).toBe(true);
    expect(g.onCopy).not.toHaveBeenCalled();
  });

  it('Ctrl+Z is undo; Ctrl+Y and Ctrl+Shift+Z are redo; Cmd works too', () => {
    const g = setup();
    g.key('z', { ctrlKey: true });
    g.key('y', { ctrlKey: true });
    g.key('Z', { ctrlKey: true, shiftKey: true });
    g.key('z', { metaKey: true });
    expect(g.onHistory.mock.calls.map((c) => c[0])).toEqual(['undo', 'redo', 'redo', 'undo']);
  });

  it('does not take undo while the cell editor is open: the textarea keeps its own', () => {
    const g = setup();
    g.key('Enter');
    fireEvent.keyDown(screen.getByLabelText('Cell value'), { key: 'z', ctrlKey: true });
    expect(g.onHistory).not.toHaveBeenCalled();
    fireEvent.copy(screen.getByLabelText('Cell value'));
    expect(g.onCopy).not.toHaveBeenCalled();
  });
});

describe('DataGrid context menu', () => {
  it('selects a cell outside the selection first, and keeps a selection it falls inside', () => {
    const g = setup();
    fireEvent.contextMenu(g.cellAt(2, 2), { clientX: 5, clientY: 6 });
    expect(g.onContextMenu).toHaveBeenLastCalledWith({ kind: 'cell', row: 2, col: 2 }, { x: 5, y: 6 });
    expect(sel(g).active).toEqual({ row: 2, col: 2 });

    g.key('ArrowDown', { shiftKey: true });
    fireEvent.contextMenu(g.cellAt(2, 2), { clientX: 1, clientY: 1 });
    expect(g.ref.current!.selectedRange()).toEqual({ top: 2, left: 2, bottom: 3, right: 2 });
  });

  it('a row number targets and selects that whole row; a column letter that whole column', () => {
    const g = setup();
    fireEvent.contextMenu(g.root.querySelector('[role="rowheader"][data-row="4"]')!, { clientX: 1, clientY: 2 });
    expect(g.onContextMenu).toHaveBeenLastCalledWith({ kind: 'row', row: 4 }, { x: 1, y: 2 });
    expect(g.ref.current!.selectedRange()).toEqual({ top: 4, left: 0, bottom: 4, right: 5 });

    fireEvent.contextMenu(g.root.querySelector('[role="columnheader"][data-col="2"]')!, { clientX: 3, clientY: 4 });
    expect(g.onContextMenu).toHaveBeenLastCalledWith({ kind: 'column', col: 2 }, { x: 3, y: 4 });
    expect(g.ref.current!.selectedRange()).toEqual({ top: 0, left: 2, bottom: 49, right: 2 });
  });

  it('a right-click the grid handles never reaches the panel around it, whose own menu would replace the grid’s (FR-037e)', () => {
    const outer = vi.fn();
    const onContextMenu = vi.fn();
    render(
      createElement(
        'div',
        { onContextMenu: outer },
        createElement(DataGrid, {
          testId: 'wrapped',
          rowCount: 5,
          colCount: 3,
          getCell: () => 'v',
          editable: true,
          columnWidths: {},
          zoom: 1,
          onColumnWidthChange: vi.fn(),
          onContextMenu,
        }),
      ),
    );
    const root = screen.getByTestId('wrapped');
    fireEvent.contextMenu(root.querySelector('[data-grid-cell][data-row="1"][data-col="1"]')!);
    fireEvent.contextMenu(root.querySelector('[role="rowheader"][data-row="2"]')!);
    fireEvent.contextMenu(root.querySelector('[role="columnheader"][data-col="0"]')!);
    expect(onContextMenu).toHaveBeenCalledTimes(3);
    expect(outer).not.toHaveBeenCalled();
  });

  it('Shift+F10 and the ContextMenu key open it on the active cell, once', () => {
    const g = setup();
    g.key('ArrowDown');
    g.key('F10', { shiftKey: true });
    expect(g.onContextMenu).toHaveBeenCalledOnce();
    expect(g.onContextMenu.mock.calls[0]![0]).toEqual({ kind: 'cell', row: 1, col: 0 });
    // The native contextmenu the chord then raises on the root must not open a second one.
    fireEvent.contextMenu(g.root);
    expect(g.onContextMenu).toHaveBeenCalledOnce();
  });
});

describe('DataGrid column resize (FR-006)', () => {
  const handle = (g: ReturnType<typeof setup>, col: number): HTMLElement =>
    g.root.querySelector<HTMLElement>(`[data-grid-resize][data-col="${col}"]`)!;
  const headWidth = (g: ReturnType<typeof setup>, col: number): number =>
    Number.parseFloat(g.root.querySelector<HTMLElement>(`[role="columnheader"][data-col="${col}"]`)!.style.width);

  it('previews live, then reports the width once on release', () => {
    const g = setup();
    fireEvent.mouseDown(handle(g, 1), { button: 0, clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 140 });
    expect(headWidth(g, 1)).toBe(GRID_DEFAULT_COLUMN_WIDTH + 40);
    expect(g.onColumnWidthChange).not.toHaveBeenCalled();
    fireEvent.mouseUp(window);
    expect(g.onColumnWidthChange).toHaveBeenCalledExactlyOnceWith(1, GRID_DEFAULT_COLUMN_WIDTH + 40);
  });

  it('clamps to 40–2000 and reports at zoom 1 whatever the zoom', () => {
    const g = setup({ zoom: 2, columnWidths: { 0: 200 } });
    fireEvent.mouseDown(handle(g, 0), { button: 0, clientX: 500 });
    fireEvent.mouseMove(window, { clientX: -5000 });
    fireEvent.mouseUp(window);
    expect(g.onColumnWidthChange).toHaveBeenLastCalledWith(0, 40);

    fireEvent.mouseDown(handle(g, 0), { button: 0, clientX: 0 });
    fireEvent.mouseMove(window, { clientX: 100 });
    fireEvent.mouseUp(window);
    // The parent never stored the first drag, so this starts from the prop's 200 again: 100 px of drag at zoom 2 is 50.
    expect(g.onColumnWidthChange).toHaveBeenLastCalledWith(0, 250);
  });

  it('a click on the handle without movement changes nothing and selects nothing', () => {
    const g = setup();
    g.key('ArrowDown');
    fireEvent.mouseDown(handle(g, 1), { button: 0, clientX: 10 });
    fireEvent.mouseUp(window);
    expect(g.onColumnWidthChange).not.toHaveBeenCalled();
    expect(sel(g).active).toEqual({ row: 1, col: 0 });
  });
});

describe('DataGrid scroll', () => {
  /** Records every scroll the grid makes itself (jsdom keeps no scroll position of its own). */
  function watchScroll(root: HTMLElement): string[] {
    const scroller = root.querySelector<HTMLElement>('.data-grid__scroller')!;
    const writes: string[] = [];
    for (const prop of ['scrollTop', 'scrollLeft'] as const) {
      Object.defineProperty(scroller, prop, {
        configurable: true,
        get: () => 0,
        set: (v: number) => void writes.push(`${prop}=${v}`),
      });
    }
    return writes;
  }

  it('selecting with the pointer never scrolls: a column letter, a row number, a cell, a right-click (FR-008a)', () => {
    const g = setup({ rowCount: 500, colCount: 40 });
    const writes = watchScroll(g.root);
    fireEvent.mouseDown(g.root.querySelector('[role="columnheader"][data-col="3"]')!, { button: 0 });
    fireEvent.mouseUp(window);
    expect(g.ref.current!.selectedRange()).toEqual({ top: 0, left: 3, bottom: 499, right: 3 });
    fireEvent.mouseDown(g.root.querySelector('[role="rowheader"][data-row="2"]')!, { button: 0 });
    fireEvent.mouseUp(window);
    fireEvent.mouseDown(g.cellAt(4, 4), { button: 0 });
    fireEvent.mouseUp(window);
    fireEvent.contextMenu(g.root.querySelector('[role="columnheader"][data-col="5"]')!, { clientX: 10, clientY: 10 });
    expect(writes).toEqual([]);
  });

  it('keyboard movement still brings the active cell into view (FR-008)', () => {
    const g = setup({ rowCount: 500, colCount: 40 });
    const writes = watchScroll(g.root);
    g.key('End', { ctrlKey: true });
    expect(writes.length).toBeGreaterThan(0);
  });

  it('reports the scroll position', () => {
    const g = setup();
    const scroller = g.root.querySelector<HTMLElement>('.data-grid__scroller')!;
    Object.defineProperty(scroller, 'scrollTop', { value: 44, configurable: true });
    fireEvent.scroll(scroller);
    expect(g.onScrollChange).toHaveBeenLastCalledWith({ top: 44, left: 0 });
  });
});

/** jsdom has no canvas: a stand-in context that measures every character as 8 px. */
function stubCanvas(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ font: '', measureText: (t: string) => ({ width: t.length * 8 }) }) as unknown as CanvasRenderingContext2D,
  );
}

describe('DataGrid double-click edit (FR-043)', () => {
  it('opens the editor on the clicked cell with the whole text selected', () => {
    const g = setup();
    fireEvent.mouseDown(g.cellAt(1, 1), { button: 0 });
    fireEvent.mouseUp(window);
    fireEvent.doubleClick(g.cellAt(1, 1));
    const editor = screen.getByLabelText('Cell value') as HTMLTextAreaElement;
    expect(editor.value).toBe('r1c1');
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([0, 4]);
    expect(sel(g).active).toEqual({ row: 1, col: 1 });
  });

  it('selects the cell it opens on even when no mouse-down selected it first', () => {
    const g = setup();
    fireEvent.doubleClick(g.cellAt(3, 2));
    expect((screen.getByLabelText('Cell value') as HTMLTextAreaElement).value).toBe('r3c2');
    expect(sel(g).active).toEqual({ row: 3, col: 2 });
  });

  it('still opens with the caret at the end for F2 and Enter', () => {
    const g = setup();
    g.key('F2');
    const editor = screen.getByLabelText('Cell value') as HTMLTextAreaElement;
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([4, 4]);
  });

  it('moves the caret, never the active cell, for arrows, Home, End and Ctrl+Home / Ctrl+End', () => {
    const g = setup();
    g.key('ArrowDown');
    g.key('ArrowRight');
    fireEvent.doubleClick(g.cellAt(1, 1));
    const editor = screen.getByLabelText('Cell value') as HTMLTextAreaElement;
    g.onSelectionChange.mockClear();
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) {
      fireEvent.keyDown(editor, { key: k });
      fireEvent.keyDown(editor, { key: k, shiftKey: true });
    }
    fireEvent.keyDown(editor, { key: 'Home', ctrlKey: true });
    fireEvent.keyDown(editor, { key: 'End', ctrlKey: true });
    expect(g.onSelectionChange).not.toHaveBeenCalled();
    expect(sel(g).active).toEqual({ row: 1, col: 1 });
    expect(screen.getByLabelText('Cell value')).toBe(editor);
  });

  it('is ignored by a read-only grid', () => {
    const g = setup({ editable: false });
    fireEvent.doubleClick(g.cellAt(1, 1));
    expect(screen.queryByLabelText('Cell value')).toBeNull();
  });

  it('a double-click inside the open editor does not reopen or reselect it', () => {
    const g = setup();
    fireEvent.doubleClick(g.cellAt(0, 0));
    const editor = screen.getByLabelText('Cell value');
    fireEvent.doubleClick(editor);
    expect(screen.getByLabelText('Cell value')).toBe(editor);
  });
});

describe('DataGrid column fit (FR-011)', () => {
  const wide = (r: number, c: number): string => (r === 30 && c === 1 ? 'x'.repeat(30) : `r${r}c${c}`);
  // 30 chars x 8 px + 13 px of cell padding, over every row though row 30 is not drawn.
  const FITTED = 253;
  const head = (g: ReturnType<typeof setup>, col: number): HTMLElement =>
    g.root.querySelector<HTMLElement>(`[role="columnheader"][data-col="${col}"]`)!;
  const edge = (g: ReturnType<typeof setup>, col: number): HTMLElement =>
    g.root.querySelector<HTMLElement>(`[data-grid-resize][data-col="${col}"]`)!;
  const click = (el: HTMLElement): void => {
    fireEvent.mouseDown(el, { button: 0, clientX: 10 });
    fireEvent.mouseUp(window);
  };

  it('fits the column to its widest value over every row on a header double-click', () => {
    stubCanvas();
    const g = setup({ getCell: wide });
    click(head(g, 1));
    click(head(g, 1));
    fireEvent.doubleClick(head(g, 1));
    expect(g.onColumnWidthChange).toHaveBeenCalledExactlyOnceWith(1, FITTED);
  });

  it('fits on a double-click of the resize edge too, and leaves the width otherwise unchanged by the mouse-downs', () => {
    stubCanvas();
    const g = setup({ getCell: wide });
    click(edge(g, 1));
    click(edge(g, 1));
    fireEvent.doubleClick(edge(g, 1));
    expect(g.onColumnWidthChange).toHaveBeenCalledExactlyOnceWith(1, FITTED);
  });

  it('counts the header label, and clamps to the 40 px minimum', () => {
    stubCanvas();
    const g = setup({ getCell: () => '', columnHeader: (c) => (c === 0 ? 'y'.repeat(40) : '') });
    fireEvent.doubleClick(head(g, 0));
    expect(g.onColumnWidthChange).toHaveBeenLastCalledWith(0, 40 * 8 + 13);
    fireEvent.doubleClick(head(g, 1));
    expect(g.onColumnWidthChange).toHaveBeenLastCalledWith(1, 40);
  });

  it('a second double-click on a still-fitted column restores the width it had before', () => {
    stubCanvas();
    const g = setup({ getCell: wide, columnWidths: { 1: 200 } });
    fireEvent.doubleClick(head(g, 1));
    expect(g.onColumnWidthChange).toHaveBeenLastCalledWith(1, FITTED);
    g.rerender({ getCell: wide, columnWidths: { 1: FITTED } });
    fireEvent.doubleClick(head(g, 1));
    expect(g.onColumnWidthChange).toHaveBeenLastCalledWith(1, 200);
    g.rerender({ getCell: wide, columnWidths: { 1: 200 } });
    fireEvent.doubleClick(head(g, 1));
    expect(g.onColumnWidthChange).toHaveBeenLastCalledWith(1, FITTED);
  });

  it('fits afresh, not restores, once the column no longer has the fitted width', () => {
    stubCanvas();
    const g = setup({ getCell: wide });
    fireEvent.doubleClick(head(g, 1));
    g.rerender({ getCell: wide, columnWidths: { 1: 300 } });
    fireEvent.doubleClick(head(g, 1));
    expect(g.onColumnWidthChange).toHaveBeenLastCalledWith(1, FITTED);
  });

  it('fits a 100,000-row column with one text measurement per row and no DOM (SC-004)', () => {
    const measureText = vi.fn((t: string) => ({ width: t.length * 8 }));
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => ({ font: '', measureText }) as unknown as CanvasRenderingContext2D);
    const g = setup({ rowCount: 100_000, getCell: (r) => `value ${r}` });
    fireEvent.doubleClick(head(g, 0));
    expect(g.onColumnWidthChange).toHaveBeenCalledOnce();
    // Every row and the header label once each — linear in the rows, never a layout pass per row.
    expect(measureText.mock.calls.length).toBeLessThanOrEqual(100_000 + 1);
    expect(getContext.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe('DataGrid has no row resize (FR-012a)', () => {
  it('a double-click on a row number does nothing: the row keeps its height and its one-line text', () => {
    stubCanvas();
    const g = setup({ getCell: (r, c) => (r === 2 && c === 3 ? 'l0\nl1\nl2' : `r${r}c${c}`) });
    const head = g.root.querySelector<HTMLElement>('[role="rowheader"][data-row="2"]')!;
    fireEvent.doubleClick(head);
    expect(Number.parseFloat(head.style.height)).toBe(22);
    expect(g.cellAt(2, 3).textContent).toBe('l0⏎l1⏎l2');
  });

  it('offers no collapseRow on the handle', () => {
    const g = setup();
    expect('collapseRow' in g.ref.current!).toBe(false);
  });
});

describe('DataGrid wrap (FR-013)', () => {
  const rowHead = (g: ReturnType<typeof setup>, row: number): HTMLElement =>
    g.root.querySelector<HTMLElement>(`[role="rowheader"][data-row="${row}"]`)!;
  const top = (el: HTMLElement): number => Number.parseFloat(el.style.top);
  const height = (el: HTMLElement): number => Number.parseFloat(el.style.height);
  const lines = (n: number): string => Array.from({ length: n }, (_, i) => `l${i}`).join('\n');

  it('is off by default: every row one line, line breaks drawn as a mark', () => {
    stubCanvas();
    const g = setup({ getCell: (r, c) => (r === 2 && c === 3 ? lines(3) : `r${r}c${c}`) });
    expect(height(rowHead(g, 2))).toBe(22);
    expect(g.cellAt(2, 3).textContent).toBe('l0⏎l1⏎l2');
    expect(g.cellAt(2, 3)).not.toHaveClass('data-grid__cell--wrap');
  });

  it('makes a row as tall as its tallest cell, showing the line breaks, and moves the rows below', () => {
    stubCanvas();
    const g = setup({ wrap: true, getCell: (r, c) => (r === 2 && c === 3 ? lines(3) : `r${r}c${c}`) });
    expect(height(rowHead(g, 2))).toBe(66);
    expect(g.cellAt(2, 3).textContent).toBe('l0\nl1\nl2');
    expect(g.cellAt(2, 3)).toHaveClass('data-grid__cell--wrap');
    expect(height(rowHead(g, 1))).toBe(22);
    expect(top(rowHead(g, 3))).toBe(22 * 2 + 66);
  });

  it('wraps a long value to its column width', () => {
    stubCanvas();
    // 120 px column less 13 px padding = 107 px = 13 characters at 8 px: 17 characters wrap to two lines.
    const g = setup({ wrap: true, getCell: (r, c) => (r === 1 && c === 0 ? 'aaaaaaaa bbbbbbbb' : '') });
    expect(height(rowHead(g, 1))).toBe(44);
  });

  it('has no line cap: sixty lines make a sixty-line row', () => {
    stubCanvas();
    const g = setup({ wrap: true, getCell: (r) => (r === 0 ? lines(60) : '') });
    expect(height(rowHead(g, 0))).toBe(60 * 22);
  });

  it('scales the line height with the zoom', () => {
    stubCanvas();
    const g = setup({ wrap: true, zoom: 2, getCell: (r) => (r === 0 ? lines(2) : '') });
    expect(height(rowHead(g, 0))).toBe(2 * 22 * 2);
  });

  it('re-flows when a column width changes, and back again when it is restored', () => {
    stubCanvas();
    const getCell = (r: number, c: number): string => (r === 1 && c === 0 ? 'aaaaaaaa bbbbbbbb' : '');
    const g = setup({ wrap: true, getCell, columnWidths: { 0: 400 } });
    expect(height(rowHead(g, 1))).toBe(22);
    g.rerender({ columnWidths: { 0: 120 } });
    expect(height(rowHead(g, 1))).toBe(44);
    g.rerender({ columnWidths: { 0: 400 } });
    expect(height(rowHead(g, 1))).toBe(22);
  });

  it('re-flows when the content changes', () => {
    stubCanvas();
    const g = setup({ wrap: true, getCell: () => 'one' });
    expect(height(rowHead(g, 0))).toBe(22);
    g.rerender({ getCell: (r: number) => (r === 0 ? lines(4) : 'one') });
    expect(height(rowHead(g, 0))).toBe(88);
  });

  it('returns every row to one line when turned off', () => {
    stubCanvas();
    const getCell = (r: number): string => (r === 0 ? lines(3) : 'x');
    const g = setup({ wrap: true, getCell });
    expect(height(rowHead(g, 0))).toBe(66);
    g.rerender({ wrap: false });
    expect(height(rowHead(g, 0))).toBe(22);
    expect(g.cellAt(0, 0).textContent).toBe('l0⏎l1⏎l2');
  });

  it('measures only the rows near the window, not all of 100,000 (SC-009)', () => {
    const measureText = vi.fn((t: string) => ({ width: t.length * 8 }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => ({ font: '', measureText }) as unknown as CanvasRenderingContext2D,
    );
    const getCell = vi.fn((r: number, c: number) => `row ${r} col ${c}`);
    setup({ wrap: true, rowCount: 100_000, getCell });
    const rowsAsked = new Set(getCell.mock.calls.map((call) => call[0]));
    expect(rowsAsked.size).toBeLessThan(200);
  });

  it('hit-tests, and places the cell editor, by the measured row positions below a tall row', () => {
    stubCanvas();
    const g = setup({ wrap: true, getCell: (r, c) => (r === 2 && c === 0 ? lines(3) : `r${r}c${c}`) });
    const gutter = Number.parseFloat(g.root.querySelector<HTMLElement>('.data-grid__gutter')!.style.width);
    const header = Number.parseFloat(g.root.querySelector<HTMLElement>('.data-grid__header')!.style.height);
    fireEvent.mouseDown(g.cellAt(0, 0), { button: 0 });
    // The middle of row 3, which starts at 110 px (2 x 22 + 66) and ends at 132.
    fireEvent.mouseMove(window, { clientX: gutter + 10, clientY: header + 110 + 11 });
    fireEvent.mouseUp(window);
    expect(g.ref.current!.selectedRange()).toEqual({ top: 0, left: 0, bottom: 3, right: 0 });

    act(() => {
      g.ref.current!.setSelection({ anchor: { row: 4, col: 0 }, active: { row: 4, col: 0 } });
    });
    act(() => {
      g.ref.current!.beginEdit();
    });
    expect(top(screen.getByLabelText('Cell value'))).toBe(132);
  });
});

describe('DataGrid long-cell routing (FR-036a)', () => {
  // Row 1 holds a value of 12 characters, every other cell 4-5; the threshold is 8.
  const getCell = (r: number, c: number): string => (r === 1 && c === 0 ? 'twelve chars' : `r${r}c${c}`);
  const routed = (over: Partial<DataGridProps> = {}) => {
    const onEditInDialog = vi.fn();
    const g = setup({ getCell, longCellThreshold: 8, onEditInDialog, ...over });
    return { g, onEditInDialog };
  };
  const select = (g: ReturnType<typeof setup>, r: number, c: number): void => {
    fireEvent.mouseDown(g.cellAt(r, c), { button: 0 });
    fireEvent.mouseUp(window);
  };

  it('sends F2, Enter and a double-click on a cell longer than the threshold to the dialog, not the in-cell editor', () => {
    const { g, onEditInDialog } = routed();
    select(g, 1, 0);
    g.key('F2');
    g.key('Enter');
    fireEvent.doubleClick(g.cellAt(1, 0));
    expect(onEditInDialog).toHaveBeenCalledTimes(3);
    expect(onEditInDialog).toHaveBeenLastCalledWith(1, 0);
    expect(screen.queryByLabelText('Cell value')).toBeNull();
  });

  it('sends a short cell holding a line break to the dialog too (FR-036c)', () => {
    const { g, onEditInDialog } = routed({ getCell: (r, c) => (r === 2 && c === 1 ? 'a\nb' : `r${r}c${c}`) });
    select(g, 2, 1);
    g.key('F2');
    fireEvent.doubleClick(g.cellAt(2, 1));
    expect(onEditInDialog).toHaveBeenCalledTimes(2);
    expect(onEditInDialog).toHaveBeenLastCalledWith(2, 1);
    expect(screen.queryByLabelText('Cell value')).toBeNull();
  });

  it('keeps a short multi-line cell in place when multi-line routing is off (FR-060c)', () => {
    const { g, onEditInDialog } = routed({
      getCell: (r, c) => (r === 2 && c === 1 ? 'a\nb' : `r${r}c${c}`),
      multiLineInDialog: false,
    });
    select(g, 2, 1);
    g.key('F2');
    expect(onEditInDialog).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Cell value')).toBeTruthy();
  });

  it('keeps the in-cell editor for a value at or under the threshold', () => {
    const { g, onEditInDialog } = routed();
    select(g, 0, 0);
    g.key('Enter');
    expect(screen.getByLabelText('Cell value')).toBeTruthy();
    expect(onEditInDialog).not.toHaveBeenCalled();
  });

  it('still opens the in-cell editor when a printable character is typed on a long cell', () => {
    const { g, onEditInDialog } = routed();
    select(g, 1, 0);
    g.key('x');
    expect((screen.getByLabelText('Cell value') as HTMLTextAreaElement).value).toBe('x');
    expect(onEditInDialog).not.toHaveBeenCalled();
  });

  it('edits in place everywhere when no threshold is given (the dialog is off)', () => {
    const { g, onEditInDialog } = routed({ longCellThreshold: undefined });
    select(g, 1, 0);
    g.key('F2');
    expect(screen.getByLabelText('Cell value')).toBeTruthy();
    expect(onEditInDialog).not.toHaveBeenCalled();
  });

  it('does nothing on a read-only grid', () => {
    const { g, onEditInDialog } = routed({ editable: false });
    select(g, 1, 0);
    g.key('Enter');
    fireEvent.doubleClick(g.cellAt(1, 0));
    expect(onEditInDialog).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Cell value')).toBeNull();
  });

  it('counts characters, so a value of exactly the threshold is not long', () => {
    const { g, onEditInDialog } = routed({ longCellThreshold: 12 });
    select(g, 1, 0);
    g.key('Enter');
    expect(onEditInDialog).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Cell value')).toBeTruthy();
  });
});

describe('DataGrid paste target (FR-037f)', () => {
  const pasteInto = (g: ReturnType<typeof setup>): void => {
    fireEvent.paste(g.root, { clipboardData: { getData: () => 'v' } });
  };

  it('lands at the top-left of a range extended down and right, not at its active cell', () => {
    const g = setup();
    g.key('ArrowDown', { shiftKey: true });
    g.key('ArrowRight', { shiftKey: true });
    expect(sel(g).active).toEqual({ row: 1, col: 1 });
    pasteInto(g);
    expect(g.onPaste).toHaveBeenCalledWith('v', { row: 0, col: 0 }, { top: 0, left: 0, bottom: 1, right: 1 });
  });

  it('lands at the top-left of a range extended up and left', () => {
    const g = setup();
    fireEvent.mouseDown(g.cellAt(3, 3), { button: 0 });
    fireEvent.mouseUp(window);
    g.key('ArrowUp', { shiftKey: true });
    g.key('ArrowLeft', { shiftKey: true });
    pasteInto(g);
    expect(g.onPaste).toHaveBeenCalledWith('v', { row: 2, col: 2 }, { top: 2, left: 2, bottom: 3, right: 3 });
  });

  it('lands in column 0 for a whole-row selection', () => {
    const g = setup();
    fireEvent.mouseDown(g.root.querySelector('[role="rowheader"][data-row="2"]')!, { button: 0 });
    fireEvent.mouseUp(window);
    pasteInto(g);
    expect(g.onPaste).toHaveBeenCalledWith('v', { row: 2, col: 0 }, { top: 2, left: 0, bottom: 2, right: 5 });
  });
});

describe('DataGrid goToRow handle (FR-043a)', () => {
  /** A scroller whose offset is real state, since jsdom has no scrolling. */
  function trackedScroller(root: HTMLElement): { top: () => number } {
    const scroller = root.querySelector<HTMLElement>('.data-grid__scroller')!;
    let top = 0;
    Object.defineProperty(scroller, 'scrollTop', { get: () => top, set: (v: number) => void (top = v), configurable: true });
    return { top: () => top };
  }

  it('makes the row\'s cell in the active column the active cell, with the row at the top', () => {
    const g = setup({ rowCount: 1200 });
    const scroll = trackedScroller(g.root);
    g.key('ArrowRight');
    g.key('ArrowRight');
    act(() => g.ref.current!.goToRow(899));
    expect(sel(g)).toMatchObject({ anchor: { row: 899, col: 2 }, active: { row: 899, col: 2 } });
    expect(scroll.top()).toBe(899 * 22);
  });

  it('takes a row below a wrapped row from the measured positions', () => {
    stubCanvas();
    const g = setup({ wrap: true, getCell: (r, c) => (r === 1 && c === 0 ? 'a\nb\nc' : `r${r}c${c}`) });
    const scroll = trackedScroller(g.root);
    act(() => g.ref.current!.goToRow(4));
    // Rows 0 and 2 are 22 px, row 1 is 66 px: row 4 starts at 22 + 66 + 22 + 22.
    expect(scroll.top()).toBe(132);
  });

  it('clamps a row outside the table to its nearest row, and reports the new selection', () => {
    const g = setup({ rowCount: 50 });
    trackedScroller(g.root);
    act(() => g.ref.current!.goToRow(9999));
    expect(sel(g).active.row).toBe(49);
    act(() => g.ref.current!.goToRow(-5));
    expect(sel(g).active.row).toBe(0);
    expect(g.onSelectionChange).toHaveBeenLastCalledWith(sel(g));
  });

});

describe('DataGrid middle button (FR-008f)', () => {
  const pasteOf = (g: ReturnType<typeof setup>, text: string) =>
    createEvent.paste(g.root, { clipboardData: { getData: (t: string) => (t === 'text/plain' ? text : '') } });
  /** A scroller whose offsets are real state, since jsdom has no scrolling. */
  function offsets(root: HTMLElement): { left: () => number; top: () => number } {
    const scroller = root.querySelector<HTMLElement>('.data-grid__scroller')!;
    let left = 0;
    let top = 0;
    Object.defineProperty(scroller, 'scrollLeft', { get: () => left, set: (v: number) => void (left = v), configurable: true });
    Object.defineProperty(scroller, 'scrollTop', { get: () => top, set: (v: number) => void (top = v), configurable: true });
    return { left: () => left, top: () => top };
  }

  it('a middle press changes no selection, and its default (autoscroll, paste) is prevented', () => {
    const g = setup();
    fireEvent.mouseDown(g.cellAt(1, 1), { button: 0 });
    fireEvent.mouseUp(window);
    const before = sel(g);
    const down = createEvent.mouseDown(g.cellAt(3, 2), { button: 1 });
    fireEvent(g.cellAt(3, 2), down);
    expect(down.defaultPrevented).toBe(true);
    expect(sel(g)).toEqual(before);
    const up = createEvent.mouseUp(g.cellAt(3, 2), { button: 1 });
    fireEvent(g.cellAt(3, 2), up);
    expect(up.defaultPrevented).toBe(true);
    const aux = createEvent('auxclick', g.cellAt(3, 2), { button: 1, bubbles: true, cancelable: true }, { EventType: 'MouseEvent' });
    fireEvent(g.cellAt(3, 2), aux);
    expect(aux.defaultPrevented).toBe(true);
    expect(g.onPaste).not.toHaveBeenCalled();
  });

  it('ignores the paste a middle click brings (Linux pastes the primary selection), but not an ordinary Ctrl+V', () => {
    const g = setup();
    fireEvent.mouseDown(g.cellAt(0, 0), { button: 1 });
    fireEvent.mouseUp(window, { button: 1 });
    const stray = pasteOf(g, 'primary selection');
    fireEvent(g.root, stray);
    expect(stray.defaultPrevented).toBe(true);
    expect(g.onPaste).not.toHaveBeenCalled();
    // The reader's next key ends the latch, so their own paste works at once.
    g.key('v', { ctrlKey: true });
    fireEvent(g.root, pasteOf(g, 'mine'));
    expect(g.onPaste).toHaveBeenCalledWith('mine', { row: 0, col: 0 }, expect.anything());
  });

  it('an ordinary paste with no middle press before it works', () => {
    const g = setup();
    fireEvent(g.root, pasteOf(g, 'plain'));
    expect(g.onPaste).toHaveBeenCalledTimes(1);
  });

  it('a middle drag scrolls the table by the pointer delta, both axes, and ends on release', () => {
    const g = setup();
    const at = offsets(g.root);
    const scroller = g.root.querySelector<HTMLElement>('.data-grid__scroller')!;
    scroller.scrollLeft = 300;
    scroller.scrollTop = 200;
    fireEvent.mouseDown(g.cellAt(2, 2), { button: 1, clientX: 100, clientY: 100 });
    expect(g.root.getAttribute('data-drag')).toBe('pan');
    fireEvent.mouseMove(window, { clientX: 70, clientY: 130 });
    expect(at.left()).toBe(330);
    expect(at.top()).toBe(170);
    fireEvent.mouseMove(window, { clientX: 150, clientY: 90 });
    expect(at.left()).toBe(250);
    expect(at.top()).toBe(210);
    fireEvent.mouseUp(window, { button: 1 });
    expect(g.root.hasAttribute('data-drag')).toBe(false);
    fireEvent.mouseMove(window, { clientX: 0, clientY: 0 });
    expect(at.left()).toBe(250);
  });

  it('a Ctrl+middle press (the zoom reset) is left alone: not prevented, no pan', () => {
    const g = setup();
    const down = createEvent.mouseDown(g.cellAt(0, 0), { button: 1, ctrlKey: true });
    fireEvent(g.cellAt(0, 0), down);
    expect(down.defaultPrevented).toBe(false);
    expect(g.root.hasAttribute('data-drag')).toBe(false);
  });

  it('a left press still selects as before', () => {
    const g = setup();
    fireEvent.mouseDown(g.cellAt(2, 1), { button: 0 });
    fireEvent.mouseUp(window);
    expect(sel(g).active).toEqual({ row: 2, col: 1 });
  });
});

describe('DataGrid lock first row and column (FR-039a)', () => {
  /** Move the scroller the way the browser does: a new offset, then the scroll event. */
  function scrollTo(root: HTMLElement, pos: { top: number; left: number }): void {
    const scroller = root.querySelector<HTMLElement>('.data-grid__scroller')!;
    let { top, left } = pos;
    Object.defineProperty(scroller, 'scrollTop', { get: () => top, set: (v: number) => void (top = v), configurable: true });
    Object.defineProperty(scroller, 'scrollLeft', { get: () => left, set: (v: number) => void (left = v), configurable: true });
    act(() => {
      fireEvent.scroll(scroller);
    });
  }
  const scrollerOf = (g: ReturnType<typeof setup>): HTMLElement => g.root.querySelector<HTMLElement>('.data-grid__scroller')!;
  const rowEl = (g: ReturnType<typeof setup>, r: number): HTMLElement | null =>
    g.root.querySelector<HTMLElement>(`.data-grid__cells [role="row"][aria-rowindex="${r + 2}"]`);
  const rowHead = (g: ReturnType<typeof setup>, r: number): HTMLElement | null =>
    g.root.querySelector<HTMLElement>(`[role="rowheader"][data-row="${r}"]`);
  const colHead = (g: ReturnType<typeof setup>, c: number): HTMLElement | null =>
    g.root.querySelector<HTMLElement>(`[role="columnheader"][data-col="${c}"]`);
  const HEADER = 24;
  const GUTTER = 40;

  it('is off by default: nothing is sticky and no cell is marked locked', () => {
    const g = setup();
    expect(g.root.querySelector('.data-grid__row--locked')).toBeNull();
    expect(g.root.querySelector('.data-grid__cell--locked-col')).toBeNull();
  });

  it('the first row stays rendered, directly under the header strip, however far the table is scrolled', () => {
    const g = setup({ rowCount: 100_000, lockFirstRow: true });
    scrollTo(g.root, { top: 22 * 50_000, left: 0 });
    const row = rowEl(g, 0)!;
    expect(row).not.toBeNull();
    expect(row).toHaveClass('data-grid__row--locked');
    expect(row.style.position).toBe('sticky');
    expect(row.style.top).toBe(`${HEADER}px`);
    expect(g.cellAt(0, 2).textContent).toBe('r0c2');
    // …and its row number goes with it.
    expect(rowHead(g, 0)!.style.position).toBe('sticky');
    expect(rowHead(g, 0)!.style.top).toBe(`${HEADER}px`);
    // The rows around the scroll position are the ordinary ones, and row 0 is drawn once.
    expect(g.root.querySelectorAll('[role="rowheader"][data-row="0"]')).toHaveLength(1);
    expect(rowEl(g, 50_000)).not.toBeNull();
    expect(rowEl(g, 50_000)).not.toHaveClass('data-grid__row--locked');
  });

  it('the first column stays rendered beside the row numbers, however far the table is scrolled sideways', () => {
    const g = setup({ colCount: 200, lockFirstColumn: true });
    scrollTo(g.root, { top: 0, left: 120 * 100 });
    for (const r of [0, 1, 2]) {
      const cell = g.cellAt(r, 0);
      expect(cell).toHaveClass('data-grid__cell--locked-col');
      expect(cell.style.position).toBe('sticky');
      expect(cell.style.left).toBe(`${GUTTER}px`);
      expect(cell.textContent).toBe(`r${r}c0`);
    }
    expect(colHead(g, 0)!.style.position).toBe('sticky');
    expect(colHead(g, 0)!.style.left).toBe(`${GUTTER}px`);
    expect(g.root.querySelectorAll('[data-grid-cell][data-row="1"][data-col="0"]')).toHaveLength(1);
    expect(g.cellAt(1, 100)).not.toHaveClass('data-grid__cell--locked-col');
  });

  it('A1 is locked both ways, and sits above the locked row and the locked column', () => {
    const g = setup({ rowCount: 5000, colCount: 200, lockFirstRow: true, lockFirstColumn: true });
    scrollTo(g.root, { top: 22 * 2000, left: 120 * 100 });
    const a1 = g.cellAt(0, 0);
    expect(a1).toHaveClass('data-grid__cell--locked-col');
    expect(rowEl(g, 0)).toHaveClass('data-grid__row--locked');
    expect(a1.style.left).toBe(g.root.querySelector<HTMLElement>('.data-grid__gutter')!.style.width);
    expect(Number(a1.style.zIndex)).toBeGreaterThan(Number(g.cellAt(0, 101).style.zIndex || 0));
  });

  it('locked cells are ordinary cells: they select, extend and show the active cell', () => {
    const g = setup({ lockFirstRow: true, lockFirstColumn: true });
    fireEvent.mouseDown(g.cellAt(0, 0), { button: 0 });
    fireEvent.mouseUp(window);
    expect(sel(g).active).toEqual({ row: 0, col: 0 });
    fireEvent.mouseDown(g.cellAt(3, 0), { button: 0, shiftKey: true });
    fireEvent.mouseUp(window);
    expect(g.ref.current!.selectedRange()).toEqual({ top: 0, left: 0, bottom: 3, right: 0 });
    expect(g.cellAt(3, 0)).toHaveClass('data-grid__cell--active');
  });

  it('a locked cell opens its editor on Enter, inside the locked strip so it stays with it, and commits', () => {
    const g = setup({ lockFirstRow: true, lockFirstColumn: true });
    fireEvent.mouseDown(g.cellAt(0, 2), { button: 0 });
    fireEvent.mouseUp(window);
    g.key('Enter');
    const editor = screen.getByLabelText('Cell value') as HTMLTextAreaElement;
    expect(rowEl(g, 0)!.contains(editor)).toBe(true);
    fireEvent.change(editor, { target: { value: 'edited' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(g.onCommitEdit).toHaveBeenCalledWith(0, 2, 'edited', 'down');
  });

  it('the editor of a locked-column cell in another row stays beside the row numbers', () => {
    const g = setup({ lockFirstColumn: true });
    fireEvent.mouseDown(g.cellAt(3, 0), { button: 0 });
    fireEvent.mouseUp(window);
    g.key('Enter');
    const editor = screen.getByLabelText('Cell value');
    const holder = editor.parentElement!;
    expect(rowEl(g, 3)!.contains(editor)).toBe(true);
    expect(holder.style.position).toBe('sticky');
    expect(holder.style.left).toBe(`${GUTTER}px`);
  });

  it('a double-click on a locked cell edits it, and a double-click on its column letter still fits the column', () => {
    const g = setup({ lockFirstRow: true, lockFirstColumn: true });
    fireEvent.doubleClick(g.cellAt(0, 0));
    expect(screen.getByLabelText('Cell value')).toBeTruthy();
  });

  it('keyboard navigation reveals a row that scrolled under the locked row, beyond it', () => {
    const g = setup({ rowCount: 200, lockFirstRow: true });
    scrollTo(g.root, { top: 660, left: 0 });
    // Row 30 starts at 660, exactly under the locked row (22 px): it must come out below it.
    act(() => g.ref.current!.scrollToCell(30, 0));
    expect(scrollerOf(g).scrollTop).toBe(660 - 22);
    // Row 0 itself is always in view: asking for it scrolls nothing.
    act(() => g.ref.current!.scrollToCell(0, 0));
    expect(scrollerOf(g).scrollTop).toBe(660 - 22);
  });

  it('keyboard navigation reveals a column that scrolled under the locked column, beyond it', () => {
    const g = setup({ colCount: 50, lockFirstColumn: true });
    scrollTo(g.root, { top: 0, left: 600 });
    act(() => g.ref.current!.scrollToCell(0, 5));
    expect(scrollerOf(g).scrollLeft).toBe(600 - 120);
    act(() => g.ref.current!.scrollToCell(0, 0));
    expect(scrollerOf(g).scrollLeft).toBe(600 - 120);
  });

  it('without a lock the same reveal does what it always did', () => {
    const g = setup({ rowCount: 200 });
    scrollTo(g.root, { top: 660, left: 0 });
    act(() => g.ref.current!.scrollToCell(30, 0));
    expect(scrollerOf(g).scrollTop).toBe(660);
  });

  it('dragging up over the locked row reaches row 0, not the row scrolled beneath it', () => {
    const g = setup({ rowCount: 200, lockFirstRow: true });
    scrollTo(g.root, { top: 660, left: 0 });
    fireEvent.mouseDown(g.cellAt(35, 1), { button: 0 });
    fireEvent.mouseMove(window, { clientX: GUTTER + 130, clientY: HEADER + 5 });
    fireEvent.mouseUp(window);
    expect(g.ref.current!.selectedRange()).toMatchObject({ top: 0, bottom: 35 });
  });

  it('a wrapped locked row keeps its height though it is far out of the window', () => {
    stubCanvas();
    const g = setup({
      rowCount: 1000,
      wrap: true,
      lockFirstRow: true,
      getCell: (r, c) => (r === 0 && c === 0 ? 'a\nb\nc' : `r${r}c${c}`),
    });
    scrollTo(g.root, { top: 22 * 500, left: 0 });
    expect(Number.parseFloat(rowHead(g, 0)!.style.height)).toBe(66);
    expect(Number.parseFloat(rowEl(g, 0)!.style.height)).toBe(66);
  });

  it('go to row puts the row just below the locked row', () => {
    const g = setup({ rowCount: 200, lockFirstRow: true });
    scrollTo(g.root, { top: 0, left: 0 });
    act(() => g.ref.current!.goToRow(50));
    expect(scrollerOf(g).scrollTop).toBe(50 * 22 - 22);
  });

  it('turning the lock off returns row 0 and column 0 to the ordinary window', () => {
    const g = setup({ lockFirstRow: true, lockFirstColumn: true });
    g.rerender({ lockFirstRow: false, lockFirstColumn: false });
    expect(g.root.querySelector('.data-grid__row--locked')).toBeNull();
    expect(g.root.querySelector('.data-grid__cell--locked-col')).toBeNull();
    expect(g.cellAt(0, 0).style.position).toBe('');
  });
});

describe('DataGrid scrolling cost (SC-009)', () => {
  /** Move the scroller the way the browser does: a new offset, then the scroll event. */
  function scrollTo(root: HTMLElement, pos: { top: number; left: number }): void {
    const scroller = root.querySelector<HTMLElement>('.data-grid__scroller')!;
    Object.defineProperty(scroller, 'scrollTop', { value: pos.top, configurable: true });
    Object.defineProperty(scroller, 'scrollLeft', { value: pos.left, configurable: true });
    act(() => {
      fireEvent.scroll(scroller);
    });
  }

  it('a one-row vertical step builds only the row that entered the window', () => {
    const getCell = vi.fn((r: number, c: number) => `r${r}c${c}`);
    const g = setup({ rowCount: 100_000, colCount: 50, getCell });
    const colsDrawn = g.root.querySelector('.data-grid__cells [role="row"]')!.children.length;
    getCell.mockClear();
    scrollTo(g.root, { top: 22, left: 0 });
    expect(getCell.mock.calls.length).toBeGreaterThan(0);
    expect(getCell.mock.calls.length).toBeLessThanOrEqual(3 * colsDrawn);
  });

  it('a one-column horizontal step builds only the column that entered the window', () => {
    const getCell = vi.fn((r: number, c: number) => `r${r}c${c}`);
    const g = setup({ rowCount: 100_000, colCount: 50, getCell });
    const rowsDrawn = g.root.querySelectorAll('.data-grid__cells [role="row"]').length;
    getCell.mockClear();
    scrollTo(g.root, { top: 0, left: GRID_DEFAULT_COLUMN_WIDTH });
    expect(getCell.mock.calls.length).toBeGreaterThan(0);
    expect(getCell.mock.calls.length).toBeLessThanOrEqual(3 * rowsDrawn);
  });

  it('still reports the scroll position to the parent on every step', () => {
    const g = setup({ rowCount: 100_000, colCount: 50 });
    scrollTo(g.root, { top: 88, left: 240 });
    expect(g.onScrollChange).toHaveBeenLastCalledWith({ top: 88, left: 240 });
  });
});
