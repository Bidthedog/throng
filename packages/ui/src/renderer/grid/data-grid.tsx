/**
 * The shared data grid (073 FR-001 – FR-010, FR-024, FR-025, FR-036 – FR-039, FR-042, FR-059).
 *
 * ONE grid draws two bodies: the CSV Preview Editor (`editable`) and the spreadsheet preview (read-only).
 * It owns rendering, virtualisation (rows AND columns), selection, keyboard navigation, the in-cell editor,
 * the column-resize drag and the clipboard / history key handling. It owns NO data: the parent supplies
 * cell text through `getCell` and receives intents (`onCommitEdit`, `onClear`, `onPaste`, …). Every edit is
 * the parent's to apply, so undo, dirty state and persistence stay where documents already live.
 *
 * ══ TEXT, NEVER MARKUP (FR-005) ══
 *
 * A cell value is rendered as a React text node. There is no `innerHTML` anywhere in this file, so a value
 * such as `<img src=x onerror=alert(1)>` is drawn as those characters and creates no element.
 *
 * ══ CLIPBOARD IS EVENTS, NOT KEYS ══
 *
 * Ctrl/Cmd+C, X and V are the platform's own `copy` / `cut` / `paste` DOM events on the focused grid root,
 * so the menu's Copy item, the chord and the OS agree on one path. The keydown for those chords is left
 * alone. Undo/redo chords ARE keydowns (the text editor's own fixed chords, FR-035) and are not offered
 * while the cell editor is open: there the textarea's native undo applies.
 *
 * ══ NO SORT, FILTER, REORDER, FORMAT OR FROZEN PANES (FR-039) ══
 *
 * Deliberately absent; do not add them here.
 *
 * Scrolling is native: a `position: sticky` header strip and gutter sit inside one scroller, and
 * `@tanstack/react-virtual` supplies the window of rows and columns to draw.
 */
import { columnLabel, formatGrouped } from '@throng/core';
import {
  observeElementRect,
  useVirtualizer,
  type Rect,
  type VirtualItem,
  type Virtualizer,
} from '@tanstack/react-virtual';
import {
  forwardRef,
  useCallback,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  memo,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from 'react';
import {
  afterCommit,
  cell as mkCell,
  clampSelection,
  coversColumn,
  coversRow,
  indexAtOffset,
  inRange,
  isPrintableKey,
  moveSelection,
  rangeOf,
  selectAll,
  selectColumn,
  selectRow,
  single,
  type GridCell,
  type GridMoveKey,
  type GridRange,
  type GridSelection,
} from './grid-selection.js';
import { CELL_PADDING_X, EXPANDED_MAX_LINES, fitColumnWidth, wrappedLineCount, type MeasureText } from './fit.js';
import './grid.css';

export type { GridRange, GridSelection };

/** Row height at zoom 1, in px. */
export const GRID_ROW_HEIGHT = 22;
/** Column width at zoom 1 when the parent has stored none, in px. */
export const GRID_DEFAULT_COLUMN_WIDTH = 120;
/** Narrowest and widest a column may be made, at zoom 1. */
export const GRID_MIN_COLUMN_WIDTH = 40;
export const GRID_MAX_COLUMN_WIDTH = 2000;

const HEADER_HEIGHT = 24;
const MIN_GUTTER_WIDTH = 40;
/** What jsdom, or a not-yet-laid-out pane, reports as the viewport: enough to draw a window of cells. */
const FALLBACK_RECT: Rect = { width: 800, height: 600 };
/** A cell's display text is cut here; the CSS ellipsis and the tooltip carry the rest. */
const MAX_DISPLAY_CHARS = 1000;

export type GridMenuTarget =
  | { kind: 'cell'; row: number; col: number }
  | { kind: 'row'; row: number }
  | { kind: 'column'; col: number };

export interface DataGridHandle {
  focus(): void;
  selectAll(): void;
  getSelection(): GridSelection;
  setSelection(sel: GridSelection): void;
  selectedRange(): GridRange;
  scrollToCell(row: number, col: number): void;
  getScroll(): { top: number; left: number };
  setScroll(pos: { top: number; left: number }): void;
  /** Opens the in-cell editor on the active cell (editable only). */
  beginEdit(initial?: string, selectAllText?: boolean): void;
  /** Collapses an expanded row to one line (FR-006a); a no-op for a row that is not expanded. */
  collapseRow(row: number): void;
}

export interface DataGridProps {
  /** Root `data-testid`. */
  testId: string;
  /** >= 0; the grid always shows at least one row and one column (an empty cell) when 0. */
  rowCount: number;
  colCount: number;
  /** '' for missing. */
  getCell(row: number, col: number): string;
  /** Header strip label for a column. Default: `columnLabel(col)` (A, B, … Z, AA). */
  columnHeader?(col: number): string;
  editable: boolean;
  /** Missing = default width. Widths are at zoom 1. */
  columnWidths: Readonly<Record<number, number>>;
  /** On resize-drag end, with the width at zoom 1 clamped to 40–2000. */
  onColumnWidthChange(col: number, width: number): void;
  /** Multiplies row height, widths and font size. */
  zoom: number;
  /** Commit from the in-cell editor, only when the value changed. `move` is where the active cell goes next. */
  onCommitEdit?(row: number, col: number, value: string, move: 'down' | 'right' | 'none'): void;
  /** Delete on a selection (editable only). */
  onClear?(range: GridRange): void;
  /** `copy` / `cut` / `paste` DOM events on the focused grid root. Cut and paste only when editable. */
  onCopy?(sel: GridSelection, range: GridRange): void;
  onCut?(sel: GridSelection, range: GridRange): void;
  /** `at` is the selection's top-left (FR-037f); `range` is the whole selection, for a single value that fills it. */
  onPaste?(text: string, at: { row: number; col: number }, range: GridRange): void;
  /** Ctrl/Cmd+Z → undo; Ctrl/Cmd+Y and Ctrl/Cmd+Shift+Z → redo. Editable only, never while the cell editor is open. */
  onHistory?(step: 'undo' | 'redo'): void;
  /** Right-click, Shift+F10 or the ContextMenu key. The target is selected first when outside the selection. */
  onContextMenu?(target: GridMenuTarget, point: { x: number; y: number }): void;
  onSelectionChange?(sel: GridSelection): void;
  onScrollChange?(pos: { top: number; left: number }): void;
}

interface EditingState {
  row: number;
  col: number;
  /** What the cell held when the editor opened: a commit of the same text is not a change. */
  original: string;
  /** The editor's starting text (the typed character, or the cell's value). */
  text: string;
  /** Opened by a double-click (FR-043): the whole text starts selected instead of the caret at its end. */
  selectAll: boolean;
}

/** An expanded cell shows at most this many characters; its own scrollbar carries the rest of what is drawn. */
const MAX_EXPANDED_CHARS = 50_000;

/** Pixel widths of a text in `el`'s computed font, from one canvas context (no DOM, no layout per text). */
function makeMeasure(el: Element): MeasureText {
  const cs = getComputedStyle(el);
  const size = Number.parseFloat(cs.fontSize) || 13;
  let ctx: CanvasRenderingContext2D | null;
  try {
    ctx = document.createElement('canvas').getContext('2d');
  } catch {
    ctx = null;
  }
  if (ctx) {
    const context = ctx;
    context.font = `${cs.fontStyle || 'normal'} ${cs.fontWeight || 'normal'} ${cs.fontSize || '13px'} ${cs.fontFamily || 'sans-serif'}`;
    return (text) => context.measureText(text).width;
  }
  return (text) => text.length * size * 0.6;
}

const clampWidth = (w: number): number =>
  Math.round(Math.min(GRID_MAX_COLUMN_WIDTH, Math.max(GRID_MIN_COLUMN_WIDTH, w)));

/** A newline in a value is shown as a visible marker, in the DISPLAY only. */
export function displayText(value: string): string {
  const cut = value.length > MAX_DISPLAY_CHARS ? value.slice(0, MAX_DISPLAY_CHARS) : value;
  return cut.replace(/\r\n|\r|\n/g, '⏎');
}

const sameCell = (a: GridCell, b: GridCell): boolean => a.row === b.row && a.col === b.col;
const sameSel = (a: GridSelection, b: GridSelection): boolean =>
  sameCell(a.anchor, b.anchor) && sameCell(a.active, b.active) && !!a.rows === !!b.rows;

function numAttr(el: Element | null, name: string): number | null {
  const raw = el?.getAttribute(name);
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

/** The in-cell editor: a textarea laid over the cell. Enter / Tab / Esc / blur are decided here. */
function CellEditor(props: {
  initial: string;
  style: CSSProperties;
  minHeight: number;
  selectAll: boolean;
  onDone(value: string | null, move: 'down' | 'right' | 'none', refocus: boolean): void;
}): ReactElement {
  const { initial, style, minHeight, selectAll, onDone } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const finished = useRef(false);

  const grow = useCallback((): void => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(minHeight, el.scrollHeight)}px`;
  }, [minHeight]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (selectAll) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
    grow();
  }, [grow, selectAll]);

  const finish = (value: string | null, move: 'down' | 'right' | 'none', refocus: boolean): void => {
    if (finished.current) return;
    finished.current = true;
    onDone(value, move, refocus);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    // Nothing typed in the editor reaches the grid's own key handling.
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.altKey || e.shiftKey) {
        // Shift+Enter or Alt+Enter inserts a line break (the browser does nothing for Alt+Enter).
        e.currentTarget.setRangeText('\n', e.currentTarget.selectionStart, e.currentTarget.selectionEnd, 'end');
        grow();
      } else {
        finish(e.currentTarget.value, 'down', true);
      }
    } else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      finish(e.currentTarget.value, 'right', true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(null, 'none', true);
    }
  };

  return (
    <textarea
      ref={ref}
      className="data-grid__editor"
      style={style}
      defaultValue={initial}
      rows={1}
      spellCheck={false}
      aria-label="Cell value"
      onKeyDown={onKeyDown}
      onInput={grow}
      onBlur={(e) => finish(e.currentTarget.value, 'none', false)}
    />
  );
}

interface CellProps {
  row: number;
  col: number;
  start: number;
  size: number;
  /** False outside the data (the phantom empty row / column): drawn empty, never asked of `getCell`. */
  valid: boolean;
  getCell(row: number, col: number): string;
  selected: boolean;
  active: boolean;
  expanded: boolean;
  /** Line height of an expanded cell, in px. */
  lineH: number;
}

/** One cell. Memoised on primitives, so a scroll step rebuilds only the cells that entered the window (SC-009). */
const GridCell = memo(function GridCell(p: CellProps): ReactElement {
  const value = p.valid ? p.getCell(p.row, p.col) : '';
  return (
    <div
      role="gridcell"
      aria-colindex={p.col + 1}
      aria-selected={p.selected}
      data-grid-cell=""
      data-row={p.row}
      data-col={p.col}
      className={
        'data-grid__cell' +
        (p.expanded ? ' data-grid__cell--expanded' : '') +
        (p.selected ? ' data-grid__cell--selected' : '') +
        (p.active ? ' data-grid__cell--active' : '')
      }
      style={p.expanded ? { left: p.start, width: p.size, lineHeight: `${p.lineH}px` } : { left: p.start, width: p.size }}
      title={value === '' ? undefined : value}
    >
      {p.expanded ? (value.length > MAX_EXPANDED_CHARS ? value.slice(0, MAX_EXPANDED_CHARS) : value) : displayText(value)}
    </div>
  );
});

interface RowProps {
  row: number;
  start: number;
  size: number;
  totalW: number;
  colItems: ReadonlyArray<VirtualItem>;
  getCell(row: number, col: number): string;
  rowCount: number;
  colCount: number;
  /** The selected columns on this row; `selLeft > selRight` when the row holds none of the selection. */
  selLeft: number;
  selRight: number;
  /** The active column when the active cell is on this row, else -1. */
  activeCol: number;
  expanded: boolean;
  lineH: number;
}

/** One row of cells. A vertical scroll leaves every unchanged row's props equal, so those rows do not re-render. */
const GridRow = memo(function GridRow(p: RowProps): ReactElement {
  return (
    <div
      role="row"
      aria-rowindex={p.row + 2}
      className="data-grid__row"
      style={{ top: p.start, height: p.size, width: p.totalW }}
    >
      {p.colItems.map((c) => (
        <GridCell
          key={c.key}
          row={p.row}
          col={c.index}
          start={c.start}
          size={c.size}
          valid={p.row < p.rowCount && c.index < p.colCount}
          getCell={p.getCell}
          selected={c.index >= p.selLeft && c.index <= p.selRight}
          active={c.index === p.activeCol}
          expanded={p.expanded}
          lineH={p.lineH}
        />
      ))}
    </div>
  );
});

export const DataGrid = forwardRef<DataGridHandle, DataGridProps>(function DataGrid(props, handleRef) {
  const {
    testId,
    rowCount,
    colCount,
    getCell,
    columnHeader,
    editable,
    columnWidths,
    onColumnWidthChange,
    zoom,
    onCommitEdit,
    onClear,
    onCopy,
    onCut,
    onPaste,
    onHistory,
    onContextMenu,
    onSelectionChange,
    onScrollChange,
  } = props;

  const rows = Math.max(1, rowCount);
  const cols = Math.max(1, colCount);
  const rowH = GRID_ROW_HEIGHT * zoom;
  const headerH = HEADER_HEIGHT * zoom;
  const gutterW = Math.max(MIN_GUTTER_WIDTH, (formatGrouped(rows).length + 2) * 8) * zoom;

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [rawSel, setRawSel] = useState<GridSelection>(() => single(0, 0));
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [preview, setPreview] = useState<{ col: number; width: number } | null>(null);
  const [resizing, setResizing] = useState<{ col: number; startX: number; startWidth: number } | null>(null);
  const [dragging, setDragging] = useState<{ mode: 'cells' | 'rows' | 'cols'; anchor: GridCell } | null>(null);
  const lastKeyboardMenu = useRef(0);
  // FR-012: the rows shown in full. View state for the panel's life; never persisted, never a setting.
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  // FR-011: per column, the width a fit replaced and the width it set, so a second fit can undo the first.
  const fitMemo = useRef(new Map<number, { before: number; fitted: number }>());

  // FR-025: kept across a content update, clamped to the data that remains.
  const sel = useMemo(() => clampSelection(rawSel, rows, cols), [rawSel, rows, cols]);
  const selRef = useRef(sel);
  selRef.current = sel;

  const widthOf = useCallback(
    (col: number): number => {
      const w = preview && preview.col === col ? preview.width : (columnWidths[col] ?? GRID_DEFAULT_COLUMN_WIDTH);
      return clampWidth(w) * zoom;
    },
    [columnWidths, preview, zoom],
  );

  // jsdom (and a pane not yet laid out) reports a 0x0 viewport; a fallback keeps a window of cells drawn.
  const observeRect = useCallback(
    (instance: Virtualizer<HTMLDivElement, Element>, cb: (rect: Rect) => void) =>
      observeElementRect(instance, (r) => cb(r.width > 0 && r.height > 0 ? r : FALLBACK_RECT)),
    [],
  );

  // FR-012: an expanded row is as tall as its tallest cell's wrapped line count (capped), computed from
  // the canvas font rather than measured from the DOM, so virtualisation survives 100,000 rows (R12).
  const expandedHeights = useMemo((): ReadonlyMap<number, number> => {
    const heights = new Map<number, number>();
    const root = rootRef.current;
    if (expanded.size === 0 || !root) return heights;
    const measure = makeMeasure(root);
    for (const row of expanded) {
      let lines = 1;
      if (row < rowCount) {
        for (let col = 0; col < Math.min(cols, colCount) && lines < EXPANDED_MAX_LINES; col++) {
          const value = getCell(row, col);
          if (value === '') continue;
          const text = value.length > MAX_EXPANDED_CHARS ? value.slice(0, MAX_EXPANDED_CHARS) : value;
          lines = Math.max(lines, wrappedLineCount(text, widthOf(col) - CELL_PADDING_X * zoom, measure));
        }
      }
      heights.set(row, lines * rowH);
    }
    return heights;
  }, [expanded, getCell, cols, colCount, rowCount, widthOf, zoom, rowH]);
  const rowSize = useCallback((i: number): number => expandedHeights.get(i) ?? rowH, [expandedHeights, rowH]);

  // `useFlushSync: false` lets React batch the window update with the browser's own scroll instead of
  // flushing synchronously inside every scroll event (SC-009).
  const rowV = useVirtualizer<HTMLDivElement, Element>({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: rowSize,
    overscan: 8,
    useFlushSync: false,
    initialRect: FALLBACK_RECT,
    observeElementRect: observeRect,
  });
  const colV = useVirtualizer<HTMLDivElement, Element>({
    horizontal: true,
    count: cols,
    getScrollElement: () => scrollRef.current,
    estimateSize: widthOf,
    overscan: 7,
    useFlushSync: false,
    initialRect: FALLBACK_RECT,
    observeElementRect: observeRect,
  });

  // The virtualisers cache item sizes; a new zoom, width or live resize preview invalidates them.
  useLayoutEffect(() => {
    rowV.measure();
  }, [rowV, rowSize]);
  useLayoutEffect(() => {
    colV.measure();
  }, [colV, widthOf]);

  const viewport = useCallback((): { w: number; h: number } => {
    const el = scrollRef.current;
    return {
      w: el && el.clientWidth > 0 ? el.clientWidth : FALLBACK_RECT.width,
      h: el && el.clientHeight > 0 ? el.clientHeight : FALLBACK_RECT.height,
    };
  }, []);

  const ensureVisible = useCallback(
    (row: number, col: number): void => {
      const el = scrollRef.current;
      if (!el) return;
      const { w, h } = viewport();
      const bodyH = h - headerH;
      const bodyW = w - gutterW;
      const rm = rowV.measurementsCache[row];
      const top = rm ? rm.start : row * rowH;
      const bottom = rm ? rm.end : top + rowH;
      let st = el.scrollTop;
      if (top < st) st = top;
      else if (bottom > st + bodyH) st = bottom - bodyH;
      const m = colV.measurementsCache[col];
      let sl = el.scrollLeft;
      if (m) {
        if (m.start < sl) sl = m.start;
        else if (m.end > sl + bodyW) sl = m.end - bodyW;
      }
      if (st !== el.scrollTop) el.scrollTop = Math.max(0, st);
      if (sl !== el.scrollLeft) el.scrollLeft = Math.max(0, sl);
    },
    [colV, gutterW, headerH, rowH, rowV, viewport],
  );

  const commitSel = useCallback(
    (next: GridSelection, reveal = true): void => {
      if (sameSel(next, selRef.current)) return;
      selRef.current = next;
      setRawSel(next);
      if (reveal) ensureVisible(next.active.row, next.active.col);
      onSelectionChange?.(next);
    },
    [ensureVisible, onSelectionChange],
  );

  const rangeNow = (): GridRange => rangeOf(selRef.current, cols);

  const beginEdit = useCallback(
    (initial?: string, selectAllText = false): void => {
      if (!editable) return;
      const { row, col } = selRef.current.active;
      const original = getCell(row, col);
      ensureVisible(row, col);
      setEditing({ row, col, original, text: initial ?? original, selectAll: selectAllText && initial === undefined });
    },
    [editable, ensureVisible, getCell],
  );

  const finishEdit = (value: string | null, move: 'down' | 'right' | 'none', refocus: boolean): void => {
    const ed = editing;
    setEditing(null);
    if (!ed) return;
    if (value !== null && value !== ed.original) onCommitEdit?.(ed.row, ed.col, value, move);
    if (move !== 'none') {
      const next = afterCommit(selRef.current.active, move, rows, cols);
      commitSel({ anchor: next, active: next });
    }
    if (refocus) rootRef.current?.focus();
  };

  useImperativeHandle(
    handleRef,
    () => ({
      focus: () => rootRef.current?.focus(),
      selectAll: () => commitSel(selectAll(rows, cols), false),
      getSelection: () => selRef.current,
      setSelection: (s) => commitSel(clampSelection(s, rows, cols)),
      selectedRange: () => rangeOf(selRef.current, cols),
      scrollToCell: (row, col) => ensureVisible(row, col),
      getScroll: () => ({ top: scrollRef.current?.scrollTop ?? 0, left: scrollRef.current?.scrollLeft ?? 0 }),
      setScroll: (pos) => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTop = pos.top;
        el.scrollLeft = pos.left;
      },
      beginEdit,
      collapseRow: (row) =>
        setExpanded((prev) => {
          if (!prev.has(row)) return prev;
          const next = new Set(prev);
          next.delete(row);
          return next;
        }),
    }),
    [beginEdit, cols, commitSel, ensureVisible, rows],
  );

  // ── Pointer: cell / row / column selection, drag, resize ─────────────────────────────────────────────

  const hit = (clientX: number, clientY: number): GridCell => {
    const el = scrollRef.current;
    if (!el) return mkCell(0, 0);
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft - gutterW;
    const y = clientY - rect.top + el.scrollTop - headerH;
    // Rows can differ in height (FR-012), so a point maps through the virtualiser's measurements.
    return mkCell(
      y <= 0 ? 0 : Math.min(rows - 1, indexAtOffset(rowV.measurementsCache, y)),
      x <= 0 ? 0 : indexAtOffset(colV.measurementsCache, x),
    );
  };

  const onWindowMove = useEffectEvent((e: MouseEvent): void => {
    if (resizing) {
      setPreview({ col: resizing.col, width: clampWidth(resizing.startWidth + (e.clientX - resizing.startX) / zoom) });
      return;
    }
    if (!dragging) return;
    const at = hit(e.clientX, e.clientY);
    if (dragging.mode === 'cells') commitSel({ anchor: dragging.anchor, active: at }, false);
    else if (dragging.mode === 'rows') {
      commitSel(selectRow(at.row, { anchor: dragging.anchor, active: dragging.anchor, rows: true }), false);
    } else {
      commitSel(selectColumn(at.col, rows, { anchor: dragging.anchor, active: dragging.anchor }), false);
    }
  });
  const onWindowUp = useEffectEvent((): void => {
    if (resizing) {
      if (preview && preview.col === resizing.col && preview.width !== resizing.startWidth) {
        onColumnWidthChange(resizing.col, preview.width);
      }
      setPreview(null);
      setResizing(null);
    }
    setDragging(null);
  });
  const active = resizing !== null || dragging !== null;
  useEffect(() => {
    if (!active) return undefined;
    const move = (e: MouseEvent): void => onWindowMove(e);
    const up = (): void => onWindowUp();
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [active]);

  const onMouseDown = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'TEXTAREA') return;

    const handle = target.closest('[data-grid-resize]');
    if (handle) {
      const col = numAttr(handle, 'data-col');
      if (col === null) return;
      e.preventDefault();
      e.stopPropagation();
      const startWidth = clampWidth(columnWidths[col] ?? GRID_DEFAULT_COLUMN_WIDTH);
      setResizing({ col, startX: e.clientX, startWidth });
      return;
    }

    const cur = selRef.current;
    const cellEl = target.closest('[data-grid-cell]');
    if (cellEl) {
      const row = numAttr(cellEl, 'data-row');
      const col = numAttr(cellEl, 'data-col');
      if (row === null || col === null) return;
      const anchor = e.shiftKey && !cur.rows ? cur.anchor : mkCell(row, col);
      commitSel({ anchor, active: mkCell(row, col) }, false);
      setDragging({ mode: 'cells', anchor });
      return;
    }
    const rowEl = target.closest('[data-grid-rowheader]');
    if (rowEl) {
      const row = numAttr(rowEl, 'data-row');
      if (row === null) return;
      const next = selectRow(row, e.shiftKey && cur.rows ? cur : undefined);
      commitSel(next, false);
      setDragging({ mode: 'rows', anchor: next.anchor });
      return;
    }
    const colEl = target.closest('[data-grid-colheader]');
    if (colEl) {
      const col = numAttr(colEl, 'data-col');
      if (col === null) return;
      const next = selectColumn(col, rows, e.shiftKey ? cur : undefined);
      commitSel(next, false);
      setDragging({ mode: 'cols', anchor: next.anchor });
    }
  };

  // ── Double-click: fit a column (FR-011), expand a row (FR-012), edit a cell (FR-043) ─────────────────

  const fitColumn = (col: number): void => {
    const root = rootRef.current;
    if (!root) return;
    const current = clampWidth(columnWidths[col] ?? GRID_DEFAULT_COLUMN_WIDTH);
    const prior = fitMemo.current.get(col);
    if (prior && prior.fitted === current) {
      fitMemo.current.delete(col);
      onColumnWidthChange(col, prior.before);
      return;
    }
    const fitted = fitColumnWidth({
      count: col < colCount ? rowCount : 0,
      textAt: (i) => displayText(getCell(i, col)),
      header: columnHeader ? columnHeader(col) : columnLabel(col),
      measure: makeMeasure(root),
      zoom,
    });
    if (fitted === current) return;
    fitMemo.current.set(col, { before: current, fitted });
    onColumnWidthChange(col, fitted);
  };

  const toggleRow = (row: number): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(row)) next.add(row);
      return next;
    });
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'TEXTAREA') return;
    const colEl = target.closest('[data-grid-colheader]');
    if (colEl) {
      const col = numAttr(colEl, 'data-col');
      if (col !== null) fitColumn(col);
      return;
    }
    const rowEl = target.closest('[data-grid-rowheader]');
    if (rowEl) {
      const row = numAttr(rowEl, 'data-row');
      if (row !== null) toggleRow(row);
      return;
    }
    const cellEl = target.closest('[data-grid-cell]');
    if (cellEl && editable) {
      const row = numAttr(cellEl, 'data-row');
      const col = numAttr(cellEl, 'data-col');
      if (row === null || col === null) return;
      const cur = selRef.current;
      if (cur.active.row !== row || cur.active.col !== col || cur.anchor.row !== row || cur.anchor.col !== col || cur.rows) {
        commitSel(single(row, col), false);
      }
      beginEdit(undefined, true);
    }
  };

  // ── Context menu ──────────────────────────────────────────────────────────────────────────────────────

  const openMenu = (target: GridMenuTarget, point: { x: number; y: number }): void => {
    const cur = selRef.current;
    if (target.kind === 'cell') {
      if (!inRange(rangeOf(cur, cols), target.row, target.col)) commitSel(single(target.row, target.col), false);
    } else if (target.kind === 'row') {
      if (!coversRow(cur, target.row)) commitSel(selectRow(target.row), false);
    } else if (!coversColumn(cur, target.col, rows)) {
      commitSel(selectColumn(target.col, rows), false);
    }
    onContextMenu?.(target, point);
  };

  const openKeyboardMenu = (): void => {
    lastKeyboardMenu.current = Date.now();
    const { row, col } = selRef.current.active;
    const el = rootRef.current?.querySelector(`[data-grid-cell][data-row="${row}"][data-col="${col}"]`);
    const r = (el ?? rootRef.current)?.getBoundingClientRect();
    openMenu({ kind: 'cell', row, col }, { x: r?.left ?? 0, y: r?.bottom ?? 0 });
  };

  const onContextMenuEvent = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'TEXTAREA' || !onContextMenu) return;
    e.preventDefault();
    // The native contextmenu a keyboard chord raises right after keydown must not open a second menu.
    if (Date.now() - lastKeyboardMenu.current < 500) return;
    const point = { x: e.clientX, y: e.clientY };
    const cellEl = target.closest('[data-grid-cell]');
    const rowEl = target.closest('[data-grid-rowheader]');
    const colEl = target.closest('[data-grid-colheader]');
    const row = numAttr(cellEl ?? rowEl, 'data-row');
    const col = numAttr(cellEl ?? colEl, 'data-col');
    if (cellEl && row !== null && col !== null) openMenu({ kind: 'cell', row, col }, point);
    else if (rowEl && row !== null) openMenu({ kind: 'row', row }, point);
    else if (colEl && col !== null) openMenu({ kind: 'column', col }, point);
    else if (target === rootRef.current) openKeyboardMenu();
  };

  // ── Keyboard ──────────────────────────────────────────────────────────────────────────────────────────

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
    const ctrl = e.ctrlKey || e.metaKey;
    const consume = (): void => {
      e.preventDefault();
      e.stopPropagation();
    };

    if (ctrl && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'a') {
        consume();
        commitSel(selectAll(rows, cols), false);
        return;
      }
      if (editable && onHistory) {
        if (k === 'z' && !e.shiftKey) {
          consume();
          onHistory('undo');
          return;
        }
        if (k === 'y' || (k === 'z' && e.shiftKey)) {
          consume();
          onHistory('redo');
          return;
        }
      }
    }

    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      if (onContextMenu) {
        consume();
        openKeyboardMenu();
      }
      return;
    }

    let move: GridMoveKey | null = null;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'PageUp':
      case 'PageDown':
      case 'Home':
      case 'End':
        move = e.key;
        break;
      case 'Tab':
        move = e.shiftKey ? 'ShiftTab' : 'Tab';
        break;
    }
    if (move) {
      const { h } = viewport();
      const cur = selRef.current;
      const next = moveSelection(cur, move, {
        rowCount: rows,
        colCount: cols,
        pageRows: Math.max(1, Math.floor((h - headerH) / rowH)),
        extend: e.shiftKey,
        ctrl,
      });
      // Tab at the edge of the grid leaves it, so the grid is never a keyboard trap.
      if ((move === 'Tab' || move === 'ShiftTab') && sameCell(next.active, cur.active)) return;
      consume();
      commitSel(next);
      return;
    }

    if (e.key === 'Enter' || e.key === 'F2') {
      if (editable) {
        consume();
        beginEdit();
      }
      return;
    }
    if (e.key === 'Delete') {
      if (editable && onClear) {
        consume();
        onClear(rangeNow());
      }
      return;
    }
    if (editable && isPrintableKey(e)) {
      consume();
      beginEdit(e.key);
    }
  };

  // ── Clipboard events (platform chords and the menu's own Copy / Cut / Paste) ─────────────────────────

  const onCopyEvent = (e: ReactClipboardEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).tagName === 'TEXTAREA' || !onCopy) return;
    e.preventDefault();
    e.stopPropagation();
    onCopy(selRef.current, rangeNow());
  };
  const onCutEvent = (e: ReactClipboardEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).tagName === 'TEXTAREA' || !editable || !onCut) return;
    e.preventDefault();
    e.stopPropagation();
    onCut(selRef.current, rangeNow());
  };
  const onPasteEvent = (e: ReactClipboardEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).tagName === 'TEXTAREA' || !editable || !onPaste) return;
    e.preventDefault();
    e.stopPropagation();
    // FR-037f: a paste lands at the selection's top-left (column 0 for whole rows), never at its active cell.
    const range = rangeNow();
    onPaste(e.clipboardData.getData('text/plain'), { row: range.top, col: range.left }, range);
  };

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (el) onScrollChange?.({ top: el.scrollTop, left: el.scrollLeft });
  };

  // ── Render ────────────────────────────────────────────────────────────────────────────────────────────

  const range = rangeOf(sel, cols);
  const rowItems = rowV.getVirtualItems();
  const colItems = colV.getVirtualItems();
  const totalW = colV.getTotalSize();
  const totalH = rowV.getTotalSize();
  const editM = editing ? colV.measurementsCache[editing.col] : undefined;
  const editRowM = editing ? rowV.measurementsCache[editing.row] : undefined;
  const editTop = editing ? (editRowM ? editRowM.start : editing.row * rowH) : 0;
  const editMinH = editRowM ? editRowM.size : rowH;

  const rootStyle = { ['--throng-grid-zoom']: String(zoom) } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className="data-grid"
      data-testid={testId}
      role="grid"
      tabIndex={0}
      aria-rowcount={rows + 1}
      aria-colcount={cols}
      aria-multiselectable="true"
      aria-readonly={editable ? undefined : true}
      style={rootStyle}
      onKeyDown={onKeyDown}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenuEvent}
      onCopy={onCopyEvent}
      onCut={onCutEvent}
      onPaste={onPasteEvent}
    >
      <div ref={scrollRef} className="data-grid__scroller" onScroll={onScroll}>
        <div className="data-grid__canvas" style={{ width: gutterW + totalW, height: headerH + totalH }}>
          <div className="data-grid__header" role="row" style={{ width: gutterW + totalW, height: headerH }}>
            <div className="data-grid__corner" style={{ width: gutterW, height: headerH }} />
            <div className="data-grid__header-cells" style={{ left: gutterW, width: totalW, height: headerH }}>
              {colItems.map((c) => (
                <div
                  key={c.key}
                  role="columnheader"
                  aria-colindex={c.index + 1}
                  data-grid-colheader=""
                  data-col={c.index}
                  className={
                    'data-grid__colhead' +
                    (c.index === sel.active.col ? ' data-grid__colhead--active' : '') +
                    (c.index >= range.left && c.index <= range.right ? ' data-grid__colhead--in-range' : '')
                  }
                  style={{ left: c.start, width: c.size, height: headerH }}
                >
                  <span className="data-grid__colhead-label">{columnHeader ? columnHeader(c.index) : columnLabel(c.index)}</span>
                  <span
                    className="data-grid__resize"
                    data-grid-resize=""
                    data-col={c.index}
                    aria-hidden="true"
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="data-grid__body" style={{ width: gutterW + totalW, height: totalH }}>
            <div className="data-grid__gutter" style={{ width: gutterW, height: totalH }}>
              {rowItems.map((r) => (
                <div
                  key={r.key}
                  role="rowheader"
                  data-grid-rowheader=""
                  data-row={r.index}
                  className={
                    'data-grid__rowhead' +
                    (r.index === sel.active.row ? ' data-grid__rowhead--active' : '') +
                    (r.index >= range.top && r.index <= range.bottom ? ' data-grid__rowhead--in-range' : '')
                  }
                  style={{ top: r.start, height: r.size }}
                >
                  {formatGrouped(r.index + 1)}
                </div>
              ))}
            </div>
            <div className="data-grid__cells" style={{ left: gutterW, width: totalW, height: totalH }}>
              {rowItems.map((r) => {
                const inRows = r.index >= range.top && r.index <= range.bottom;
                return (
                  <GridRow
                    key={r.key}
                    row={r.index}
                    start={r.start}
                    size={r.size}
                    totalW={totalW}
                    colItems={colItems}
                    getCell={getCell}
                    rowCount={rowCount}
                    colCount={colCount}
                    selLeft={inRows ? range.left : 0}
                    selRight={inRows ? range.right : -1}
                    activeCol={r.index === sel.active.row ? sel.active.col : -1}
                    expanded={expanded.has(r.index)}
                    lineH={rowH}
                  />
                );
              })}
              {editing && editM ? (
                <CellEditor
                  key={`${editing.row}:${editing.col}`}
                  initial={editing.text}
                  minHeight={editMinH}
                  selectAll={editing.selectAll}
                  style={{ left: editM.start, top: editTop, width: editM.size, minHeight: editMinH }}
                  onDone={finishEdit}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
