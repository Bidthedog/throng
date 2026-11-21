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
import { columnLabel, formatGrouped, isLongCell, logExpected } from '@throng/core';
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
import { CELL_PADDING_X, fitColumnWidth, wrappedLineCount, type MeasureText } from './fit.js';
import { primaryModifierHeld } from '../config/host-modifiers.js';
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
  /** Goes to a row (0-based): its cell in the active column becomes the active cell and the row scrolls to the top (FR-043a). */
  goToRow(row: number): void;
  /**
   * 073 FR-033c — the first row a reader can see in full at the top: the row under the locked one when the first row is
   * locked, read from each row's own height (wrap). 0 at the very top of the grid.
   */
  topRow(): number;
  /**
   * 073 FR-033e — the row under the vertical centre of the visible rows (below the header and past a locked row, each
   * row at its own height). For the sync mark only; sync keys on {@link DataGridHandle.topRow}.
   */
  centreRow(): number;
  /** 073 FR-033c — scrolls `row` to the top (below the locked row) WITHOUT touching the selection; scroll sync's. */
  scrollRowToTop(row: number): void;
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
  /**
   * 073 FR-050b — a read-only grid's report that an edit was tried: a printable key, Enter, F2, a double-click on a
   * cell, Delete, Backspace, Cut, Paste, Undo or Redo. The grid edits nothing either way.
   */
  onEditAttempt?(): void;
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
  /**
   * 073 FR-036a — with both given, F2, Enter and a double-click on a cell of MORE than `longCellThreshold` characters
   * call `onEditInDialog` instead of opening the in-cell editor; a typed character still edits in place. Absent
   * `longCellThreshold` (the dialog is off for this panel) edits every cell in place.
   */
  longCellThreshold?: number;
  /** 073 FR-036c, FR-060c — a cell holding a line break goes to the dialog too, whatever its length. Default true. */
  multiLineInDialog?: boolean;
  onEditInDialog?(row: number, col: number): void;
  /** 073 FR-037i — Esc with no cell editor open; `true` when the owner acted on it (the key is then consumed). */
  onEscape?(): boolean;
  /**
   * 073 FR-013 — wrap cells: every cell shows its whole value, line breaks kept and wrapped to its column's width, and
   * every row is as tall as its tallest cell, with no line cap. Heights are worked out lazily for the rows near the
   * window and cached until a width, the zoom or the content changes (SC-009). Absent or false: one line per row.
   */
  wrap?: boolean;
  /**
   * 073 FR-039a — lock the first row and/or the first column: row 0 stays directly under the header strip whatever the
   * vertical scroll, column 0 stays beside the row numbers whatever the horizontal one, and A1 stays under both. They
   * are ordinary cells (selection, editing, menus), set apart by a theme-token separator. Absent or false: no lock.
   */
  lockFirstRow?: boolean;
  lockFirstColumn?: boolean;
  /**
   * 073 FR-033d — the row Synchronise Scrolling has in step with the linked editor, softly highlighted while `on` and
   * fading once it is not. Wherever the row sits in the viewport; the highlight touches no selection, focus or scroll.
   */
  syncMarkRow?: { row: number; on: boolean } | null;
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

/** A wrapped cell shows at most this many characters, so one pathological value cannot stall the layout. */
const MAX_WRAP_CHARS = 50_000;
/** A paste this soon after a middle press or release is the primary selection (Linux), not the reader's (FR-008f). */
const MIDDLE_PASTE_WINDOW_MS = 500;

/** Pixel widths of a text in `el`'s computed font, from one canvas context (no DOM, no layout per text). */
function makeMeasure(el: Element): MeasureText {
  const cs = getComputedStyle(el);
  const size = Number.parseFloat(cs.fontSize) || 13;
  let ctx: CanvasRenderingContext2D | null;
  try {
    ctx = document.createElement('canvas').getContext('2d');
  } catch (error) {
    logExpected('grid: measure text', 'with no canvas the fit falls back to a per-character estimate', error);
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
  size: number;
  /** False outside the data (the phantom empty row / column): drawn empty, never asked of `getCell`. */
  valid: boolean;
  getCell(row: number, col: number): string;
  selected: boolean;
  active: boolean;
  wrap: boolean;
  /** Line height of a wrapped cell, in px. */
  lineH: number;
  /** FR-039a — the cell is the locked first column's: sticky beside the row numbers, at this `left`. Null: an ordinary cell. */
  stickyLeft: number | null;
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
        (p.wrap ? ' data-grid__cell--wrap' : '') +
        (p.stickyLeft !== null ? ' data-grid__cell--locked-col' : '') +
        (p.selected ? ' data-grid__cell--selected' : '') +
        (p.active ? ' data-grid__cell--active' : '')
      }
      style={{
        width: p.size,
        ...(p.wrap ? { lineHeight: `${p.lineH}px` } : {}),
        ...(p.stickyLeft !== null ? { position: 'sticky' as const, left: p.stickyLeft, zIndex: 2 } : {}),
      }}
      title={value === '' ? undefined : value}
    >
      {/* FR-004 (T080) — the text in an element of its own: the cell is a flex container, on which no ellipsis is drawn. */}
      <span className="data-grid__cell-text">
        {p.wrap ? (value.length > MAX_WRAP_CHARS ? value.slice(0, MAX_WRAP_CHARS) : value) : displayText(value)}
      </span>
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
  wrap: boolean;
  lineH: number;
  /** FR-039a — this is the locked first row: sticky under the header strip, at this `top`. Null: an ordinary row. */
  stickyTop: number | null;
  /** FR-039a — the locked first column's `left` and width; null with no locked column. */
  stickyLeft: number | null;
  lockSize: number;
  /** The cell editor, when it edits a locked cell and so lives inside the strip it stays with. */
  editor: ReactElement | null;
  /** FR-033d — this row is the sync mark: 0 no, 1 fading out, 2 shown. */
  mark: 0 | 1 | 2;
}

/** One row of cells. A vertical scroll leaves every unchanged row's props equal, so those rows do not re-render. */
const GridRow = memo(function GridRow(p: RowProps): ReactElement {
  return (
    <div
      role="row"
      aria-rowindex={p.row + 2}
      className={
        'data-grid__row' +
        (p.stickyTop !== null ? ' data-grid__row--locked' : '') +
        (p.mark !== 0 ? ' data-grid__row--sync-mark' : '') +
        (p.mark === 2 ? ' data-grid__row--sync-mark-on' : '')
      }
      style={
        p.stickyTop !== null
          ? { position: 'sticky', top: p.stickyTop, height: p.size, width: p.totalW }
          : { top: p.start, height: p.size, width: p.totalW }
      }
    >
      {p.stickyLeft !== null ? (
        <>
          {/* The locked first column: drawn first, in the row's flow, and held beside the row numbers by `sticky`. */}
          {p.editor !== null && p.editor.key === 'sticky-col-editor' ? p.editor : null}
          <GridCell
            row={p.row}
            col={0}
            size={p.lockSize}
            valid={p.row < p.rowCount && 0 < p.colCount}
            getCell={p.getCell}
            selected={0 >= p.selLeft && 0 <= p.selRight}
            active={p.activeCol === 0}
            wrap={p.wrap}
            lineH={p.lineH}
            stickyLeft={p.stickyLeft}
          />
        </>
      ) : null}
      {p.editor !== null && p.editor.key !== 'sticky-col-editor' ? p.editor : null}
      <div
        className="data-grid__row-spacer"
        style={{ width: Math.max(0, (p.colItems[0]?.start ?? 0) - (p.stickyLeft !== null ? p.lockSize : 0)) }}
        aria-hidden="true"
      />
      {p.colItems.map((c) => (
        <GridCell
          key={c.key}
          row={p.row}
          col={c.index}
          size={c.size}
          valid={p.row < p.rowCount && c.index < p.colCount}
          getCell={p.getCell}
          selected={c.index >= p.selLeft && c.index <= p.selRight}
          active={c.index === p.activeCol}
          wrap={p.wrap}
          lineH={p.lineH}
          stickyLeft={null}
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
    onEditAttempt,
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
    longCellThreshold,
    multiLineInDialog = true,
    onEditInDialog,
    onEscape,
    wrap = false,
    lockFirstRow = false,
    syncMarkRow = null,
    lockFirstColumn = false,
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
  // FR-008f — the middle button pans. `pan` is the drag in progress (where it began and the scroll it began at).
  const [panning, setPanning] = useState(false);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  // When a middle button was last pressed or released here, for `onPasteEvent`: Linux pastes the PRIMARY selection on
  // a middle click, and that paste must not land in the grid.
  const lastMiddle = useRef(0);
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

  // FR-013: with wrap on, a row is as tall as its tallest cell's wrapped line count, computed from the canvas font
  // rather than measured from the DOM. The virtualiser is given a constant estimate, and only the rows it has
  // laid out near the window are sized (the layout effect below), so 100,000 rows never cost 100,000 measures (R12).
  // The cache is keyed by (row) within one (content, widths, zoom, wrap) and is dropped whenever any of them changes.
  const wrapCache = useMemo(
    () => (wrap ? new Map<number, number>() : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the cache is dropped when its inputs change, not read here
    [wrap, getCell, widthOf, cols, colCount, rowCount, rowH],
  );
  const rowSize = useCallback((): number => rowH, [rowH]);
  // The canvas font is read from the DOM once per cache, not once per frame that sizes a row: getComputedStyle after
  // React has written a frame's rows is a forced style recalculation. The cache is dropped whenever its inputs change,
  // and the font is not one of them (a row cached at the old font is stale already), so the two live and die together.
  const measureOf = useRef<{ cache: Map<number, number>; measure: MeasureText } | null>(null);
  /** The height of `index`, worked out (and cached) on first ask. */
  const wrapHeight = (cache: Map<number, number>, root: Element, index: number): number => {
    let height = cache.get(index);
    if (height === undefined) {
      if (measureOf.current?.cache !== cache) measureOf.current = { cache, measure: makeMeasure(root) };
      const { measure } = measureOf.current;
      let lines = 1;
      if (index < rowCount) {
        for (let col = 0; col < Math.min(cols, colCount); col++) {
          const value = getCell(index, col);
          if (value === '') continue;
          const text = value.length > MAX_WRAP_CHARS ? value.slice(0, MAX_WRAP_CHARS) : value;
          lines = Math.max(lines, wrappedLineCount(text, widthOf(col) - CELL_PADDING_X * zoom, measure));
        }
      }
      height = lines * rowH;
      cache.set(index, height);
    }
    return height;
  };
  /** Sizes the `items` that are not at their height yet; true when it changed one. */
  const sizeRows = (v: Virtualizer<HTMLDivElement, Element>, items: ReadonlyArray<VirtualItem>): boolean => {
    const root = rootRef.current;
    if (wrapCache === null || !root) return false;
    let changed = false;
    for (const item of items) {
      const height = wrapHeight(wrapCache, root, item.index);
      if (item.size !== height) {
        v.resizeItem(item.index, height);
        changed = true;
      }
    }
    return changed;
  };
  /** Set while `presize` is sizing rows: each resize notifies the virtualiser again, and that notice must not re-enter. */
  const presizing = useRef(false);
  /**
   * The virtualiser's change notice, which runs in the scroll event BEFORE React renders the frame it asked for: the rows
   * about to enter are sized here, so the frame is drawn once, at their heights. Left to the layout effect below, a row
   * entering at the estimated height was drawn, sized, and drawn again in a second commit that dropped the rows the
   * estimate had let in (SC-009; the maintainer's MT-10, scrolling a wrapped CSV).
   */
  const presize = (v: Virtualizer<HTMLDivElement, Element>): void => {
    if (wrapCache === null || presizing.current) return;
    presizing.current = true;
    try {
      // Sizing a row moves the rows below it, which can bring the window's end in or out: go on until it holds still.
      for (let pass = 0; pass < 8 && sizeRows(v, v.getVirtualItems()); pass += 1);
    } finally {
      presizing.current = false;
    }
  };

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
    onChange: (instance) => presize(instance),
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
  }, [rowV, rowSize, wrapCache]);
  // FR-013 — size the rows the virtualiser has laid out. Runs after every render and settles at once: a row already
  // at its height asks for nothing, and a cached row costs a map read.
  useLayoutEffect(() => {
    // FR-039a — a locked first row is drawn whatever the window holds, so it is sized whatever the window holds.
    const laidOut = rowV.getVirtualItems();
    const first = lockFirstRow && laidOut[0]?.index !== 0 ? rowV.measurementsCache[0] : undefined;
    sizeRows(rowV, first ? [first, ...laidOut] : laidOut);
  });
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
      // FR-039a — a locked first row / column covers the first `lockedH` / `lockedW` px of the window, so a cell is only
      // revealed once it is clear of them; the locked row and column themselves are always in view.
      const lockedH = lockFirstRow ? (rowV.measurementsCache[0]?.size ?? rowH) : 0;
      const lockedW = lockFirstColumn ? (colV.measurementsCache[0]?.size ?? widthOf(0)) : 0;
      const rm = rowV.measurementsCache[row];
      const top = rm ? rm.start : row * rowH;
      const bottom = rm ? rm.end : top + rowH;
      let st = el.scrollTop;
      if (!(lockFirstRow && row === 0)) {
        if (top - lockedH < st) st = top - lockedH;
        else if (bottom > st + bodyH) st = bottom - bodyH;
      }
      const m = colV.measurementsCache[col];
      let sl = el.scrollLeft;
      if (m && !(lockFirstColumn && col === 0)) {
        if (m.start - lockedW < sl) sl = m.start - lockedW;
        else if (m.end > sl + bodyW) sl = m.end - bodyW;
      }
      if (st !== el.scrollTop) el.scrollTop = Math.max(0, st);
      if (sl !== el.scrollLeft) el.scrollLeft = Math.max(0, sl);
    },
    [colV, gutterW, headerH, lockFirstColumn, lockFirstRow, rowH, rowV, viewport, widthOf],
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
      // FR-036a, FR-036c — F2, Enter and a double-click (no typed character) on a long or multi-line cell edit in the
      // dialog instead.
      if (initial === undefined && longCellThreshold !== undefined && onEditInDialog !== undefined && isLongCell(original, longCellThreshold, multiLineInDialog)) {
        onEditInDialog(row, col);
        return;
      }
      setEditing({ row, col, original, text: initial ?? original, selectAll: selectAllText && initial === undefined });
    },
    [editable, ensureVisible, getCell, longCellThreshold, multiLineInDialog, onEditInDialog],
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
      goToRow: (row) => {
        // FR-043a — the active column stays; the row is selected and brought to the TOP (not merely revealed).
        const target = Math.min(rows - 1, Math.max(0, Math.floor(row)));
        commitSel(single(target, selRef.current.active.col), false);
        const el = scrollRef.current;
        // FR-039a — with the first row locked, the row lands just below it rather than under it.
        const locked = lockFirstRow && target > 0 ? (rowV.measurementsCache[0]?.size ?? rowH) : 0;
        if (el) el.scrollTop = Math.max(0, (rowV.measurementsCache[target]?.start ?? target * rowH) - locked);
      },
      topRow: () => {
        const el = scrollRef.current;
        if (!el || el.scrollTop <= 0) return 0;
        const locked = lockFirstRow ? (rowV.measurementsCache[0]?.size ?? rowH) : 0;
        return Math.min(rows - 1, indexAtOffset(rowV.measurementsCache, el.scrollTop + locked));
      },
      centreRow: () => {
        const el = scrollRef.current;
        if (!el) return 0;
        const lockedH = lockFirstRow ? (rowV.measurementsCache[0]?.size ?? rowH) : 0;
        const bodyH = viewport().h - headerH;
        return Math.min(rows - 1, Math.max(0, indexAtOffset(rowV.measurementsCache, el.scrollTop + lockedH + Math.max(0, bodyH - lockedH) / 2)));
      },
      scrollRowToTop: (row) => {
        const target = Math.min(rows - 1, Math.max(0, Math.floor(row)));
        const el = scrollRef.current;
        const locked = lockFirstRow && target > 0 ? (rowV.measurementsCache[0]?.size ?? rowH) : 0;
        if (el) el.scrollTop = Math.max(0, (rowV.measurementsCache[target]?.start ?? target * rowH) - locked);
      },
    }),
    [beginEdit, cols, commitSel, ensureVisible, headerH, lockFirstRow, rowH, rowV, rows, viewport],
  );

  // ── Pointer: cell / row / column selection, drag, resize ─────────────────────────────────────────────

  const hit = (clientX: number, clientY: number): GridCell => {
    const el = scrollRef.current;
    if (!el) return mkCell(0, 0);
    const rect = el.getBoundingClientRect();
    // Where the point is inside the window (past the header strip and the row numbers), before the scroll is added.
    const xIn = clientX - rect.left - gutterW;
    const yIn = clientY - rect.top - headerH;
    const x = xIn + el.scrollLeft;
    const y = yIn + el.scrollTop;
    // FR-039a — the locked strip is drawn over whatever scrolled beneath it, so a point on it is row 0 / column 0.
    const inLockedRow = lockFirstRow && yIn < (rowV.measurementsCache[0]?.size ?? rowH);
    const inLockedCol = lockFirstColumn && xIn < (colV.measurementsCache[0]?.size ?? widthOf(0));
    // Rows can differ in height (FR-012), so a point maps through the virtualiser's measurements.
    return mkCell(
      inLockedRow || y <= 0 ? 0 : Math.min(rows - 1, indexAtOffset(rowV.measurementsCache, y)),
      inLockedCol || x <= 0 ? 0 : indexAtOffset(colV.measurementsCache, x),
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
  // FR-008f — while the middle button is held, the table follows the pointer. Release (anywhere) ends it.
  useEffect(() => {
    if (!panning) return undefined;
    const move = (e: MouseEvent): void => {
      const start = pan.current;
      const el = scrollRef.current;
      if (start === null || el === null) return;
      el.scrollLeft = start.left - (e.clientX - start.x);
      el.scrollTop = start.top - (e.clientY - start.y);
    };
    const up = (e: MouseEvent): void => {
      if (e.button !== 1) return;
      e.preventDefault();
      lastMiddle.current = Date.now();
      pan.current = null;
      setPanning(false);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [panning]);
  // The release and the `auxclick` after it: Chromium's primary-selection paste and any follow-on are their default.
  const swallowMiddle = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (e.button !== 1 || primaryModifierHeld(e)) return;
    e.preventDefault();
    lastMiddle.current = Date.now();
  };

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
    if (e.button === 1) {
      // Ctrl+middle-click (Cmd on macOS, 070 FR-030) is the zoom-reset gesture: left alone, as the Mermaid pan leaves it.
      if (primaryModifierHeld(e)) return;
      // FR-008f — no autoscroll, no primary-selection paste, no selection change; the drag pans instead.
      e.preventDefault();
      lastMiddle.current = Date.now();
      const el = scrollRef.current;
      pan.current = { x: e.clientX, y: e.clientY, left: el?.scrollLeft ?? 0, top: el?.scrollTop ?? 0 };
      setPanning(true);
      return;
    }
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

    // FR-008b — the corner selects everything, as Select All does, and never scrolls.
    if (target.closest('[data-grid-corner]')) {
      commitSel(selectAll(rows, cols), false);
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

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'TEXTAREA') return;
    const colEl = target.closest('[data-grid-colheader]');
    if (colEl) {
      const col = numAttr(colEl, 'data-col');
      if (col !== null) fitColumn(col);
      return;
    }
    // FR-012a — a row number's double-click does nothing: there is no row resize.
    if (target.closest('[data-grid-rowheader]')) return;
    const cellEl = target.closest('[data-grid-cell]');
    // FR-050b — a read-only grid reports the attempt.
    if (cellEl && !editable) {
      onEditAttempt?.();
      return;
    }
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
    // The grid's menu is THE menu wherever the grid opens one: a panel around it (the preview body's own
    // menu) must not open its menu over this one, which is what hid Cut, Copy and Paste (073 FR-037e). Empty
    // grid space opens nothing here, so the panel's menu still answers there.
    const handled = (): void => {
      e.preventDefault();
      e.stopPropagation();
    };
    // The native contextmenu a keyboard chord raises right after keydown must not open a second menu.
    if (Date.now() - lastKeyboardMenu.current < 500) {
      handled();
      return;
    }
    const point = { x: e.clientX, y: e.clientY };
    if (target.closest('[data-grid-corner]')) {
      // FR-008b — everything selected, then the selection's menu, opened over the active cell's menu target.
      handled();
      commitSel(selectAll(rows, cols), false);
      const { row: ar, col: ac } = selRef.current.active;
      openMenu({ kind: 'cell', row: ar, col: ac }, point);
      return;
    }
    const cellEl = target.closest('[data-grid-cell]');
    const rowEl = target.closest('[data-grid-rowheader]');
    const colEl = target.closest('[data-grid-colheader]');
    const row = numAttr(cellEl ?? rowEl, 'data-row');
    const col = numAttr(cellEl ?? colEl, 'data-col');
    if (cellEl && row !== null && col !== null) {
      handled();
      openMenu({ kind: 'cell', row, col }, point);
    } else if (rowEl && row !== null) {
      handled();
      openMenu({ kind: 'row', row }, point);
    } else if (colEl && col !== null) {
      handled();
      openMenu({ kind: 'column', col }, point);
    } else if (target === rootRef.current) {
      handled();
      openKeyboardMenu();
    }
  };

  // ── Keyboard ──────────────────────────────────────────────────────────────────────────────────────────

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
    lastMiddle.current = 0; // FR-008f — the reader's own key: a paste after it is theirs
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
      // FR-050b — Undo and Redo on a read-only grid are edit attempts.
      if (!editable && (k === 'z' || k === 'y')) {
        consume();
        onEditAttempt?.();
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

    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
      if (onEscape?.() === true) consume();
      return;
    }
    // FR-050b — on a read-only grid, every key that would edit is reported instead.
    if (!editable && (e.key === 'Enter' || e.key === 'F2' || e.key === 'Delete' || e.key === 'Backspace' || isPrintableKey(e))) {
      consume();
      onEditAttempt?.();
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
    if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
    if (!editable) {
      // FR-050b — Cut on a read-only grid is an edit attempt; nothing is cut.
      e.preventDefault();
      e.stopPropagation();
      onEditAttempt?.();
      return;
    }
    if (!onCut) return;
    e.preventDefault();
    e.stopPropagation();
    onCut(selRef.current, rangeNow());
  };
  const onPasteEvent = (e: ReactClipboardEvent<HTMLDivElement>): void => {
    // FR-008f — a paste that follows a middle press is the primary selection, never the reader's own: dropped. The
    // reader's next key ends the latch (`onKeyDown`), so a Ctrl+V straight after is theirs.
    if (Date.now() - lastMiddle.current < MIDDLE_PASTE_WINDOW_MS) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
    if (!editable) {
      // FR-050b — Paste on a read-only grid is an edit attempt; nothing is pasted.
      e.preventDefault();
      e.stopPropagation();
      onEditAttempt?.();
      return;
    }
    if (!onPaste) return;
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
  const colItemsAll = colV.getVirtualItems();
  // FR-039a — the locked first row and column are drawn on their own, so the windows leave them out. Memoised, so a
  // scroll step that moves neither leaves every row's props equal (SC-009).
  const colItems = useMemo(() => (lockFirstColumn ? colItemsAll.filter((c) => c.index > 0) : colItemsAll), [colItemsAll, lockFirstColumn]);
  const rowItemsWindow = useMemo(() => (lockFirstRow ? rowItems.filter((r) => r.index > 0) : rowItems), [rowItems, lockFirstRow]);
  const lockedColSize = colV.measurementsCache[0]?.size ?? widthOf(0);
  const stickyLeft = lockFirstColumn ? gutterW : null;
  const totalW = colV.getTotalSize();
  const totalH = rowV.getTotalSize();
  const editM = editing ? colV.measurementsCache[editing.col] : undefined;
  const editRowM = editing ? rowV.measurementsCache[editing.row] : undefined;
  const editTop = editing ? (editRowM ? editRowM.start : editing.row * rowH) : 0;
  const editMinH = editRowM ? editRowM.size : rowH;

  const rootStyle = { ['--throng-grid-zoom']: String(zoom) } as CSSProperties;

  // A column letter. The locked first column's is held beside the row numbers (FR-039a), the others are placed.
  const colHeadOf = (c: VirtualItem, locked: boolean): ReactElement => (
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
      style={
        locked
          ? { position: 'sticky', left: gutterW, zIndex: 2, width: c.size, height: headerH }
          : { left: c.start, width: c.size, height: headerH }
      }
    >
      <span className="data-grid__colhead-label">{columnHeader ? columnHeader(c.index) : columnLabel(c.index)}</span>
      <span className="data-grid__resize" data-grid-resize="" data-col={c.index} aria-hidden="true" />
    </div>
  );
  // A row number. The locked first row's is held under the header strip (FR-039a), the others are placed.
  const rowHeadOf = (r: VirtualItem, locked: boolean): ReactElement => (
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
      style={
        locked
          ? { position: 'sticky', top: headerH, left: 'auto', right: 'auto', zIndex: 1, height: r.size }
          : { top: r.start, height: r.size }
      }
    >
      {formatGrouped(r.index + 1)}
    </div>
  );
  // The cell editor. One that edits a locked cell lives inside the strip it stays with, so it is held there too.
  const editorInStrip = editing !== null && editM !== undefined && ((lockFirstRow && editing.row === 0) || (lockFirstColumn && editing.col === 0));
  const editorInLockedCol = editorInStrip && editing !== null && lockFirstColumn && editing.col === 0;
  const cellEditor =
    editing !== null && editM !== undefined ? (
      <CellEditor
        key={`${editing.row}:${editing.col}`}
        initial={editing.text}
        minHeight={editMinH}
        selectAll={editing.selectAll}
        style={{
          left: editorInLockedCol ? 0 : editM.start,
          top: editorInStrip ? 0 : editTop,
          width: editM.size,
          minHeight: editMinH,
        }}
        onDone={finishEdit}
      />
    ) : null;
  const rowEditor =
    editorInStrip && cellEditor !== null ? (
      editorInLockedCol ? (
        <div
          key="sticky-col-editor"
          style={{ position: 'sticky', left: gutterW, width: 0, height: 0, flex: '0 0 auto', zIndex: 5 }}
        >
          {cellEditor}
        </div>
      ) : (
        cellEditor
      )
    ) : null;
  // One row of cells; `locked` is the first row held under the header strip.
  const rowOf = (r: VirtualItem, locked: boolean): ReactElement => {
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
        wrap={wrap}
        lineH={rowH}
        stickyTop={locked ? headerH : null}
        stickyLeft={stickyLeft}
        lockSize={lockedColSize}
        editor={editing !== null && r.index === editing.row ? rowEditor : null}
        mark={syncMarkRow?.row === r.index ? (syncMarkRow.on ? 2 : 1) : 0}
      />
    );
  };

  return (
    <div
      ref={rootRef}
      className="data-grid"
      // FR-008e — a selection drag pins its pointer over the whole grid (grid.css), so crossing a header or a
      // resize edge does not flicker it.
      data-drag={panning ? 'pan' : dragging?.mode}
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
      onMouseUp={swallowMiddle}
      onAuxClick={swallowMiddle}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenuEvent}
      onCopy={onCopyEvent}
      onCut={onCutEvent}
      onPaste={onPasteEvent}
    >
      <div ref={scrollRef} className="data-grid__scroller" onScroll={onScroll}>
        <div className="data-grid__canvas" style={{ width: gutterW + totalW, height: headerH + totalH }}>
          <div className="data-grid__header" role="row" style={{ width: gutterW + totalW, height: headerH }}>
            <div
              className="data-grid__corner"
              data-grid-corner=""
              role="button"
              aria-label="Select all"
              title="Select all"
              style={{ width: gutterW, height: headerH }}
            />
            <div className="data-grid__header-cells" style={{ left: gutterW, width: totalW, height: headerH }}>
              {lockFirstColumn && colV.measurementsCache[0] ? colHeadOf(colV.measurementsCache[0], true) : null}
              {colItems.map((c) => colHeadOf(c, false))}
            </div>
          </div>
          <div className="data-grid__body" style={{ width: gutterW + totalW, height: totalH }}>
            <div className="data-grid__gutter" style={{ width: gutterW, height: totalH }}>
              {lockFirstRow && rowV.measurementsCache[0] ? rowHeadOf(rowV.measurementsCache[0], true) : null}
              {rowItemsWindow.map((r) => rowHeadOf(r, false))}
            </div>
            <div className="data-grid__cells" style={{ left: gutterW, width: totalW, height: totalH }}>
              {lockFirstRow && rowV.measurementsCache[0] ? rowOf(rowV.measurementsCache[0], true) : null}
              {rowItemsWindow.map((r) => rowOf(r, false))}
              {!editorInStrip ? cellEditor : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
