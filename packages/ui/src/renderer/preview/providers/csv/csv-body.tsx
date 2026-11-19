/**
 * The CSV Preview Editor's body (073 FR-030 – FR-042, FR-046; research R1, R2, R4).
 *
 * An editable grid over the CSV's ONE document. The body holds no buffer: it draws the text the chrome
 * hands it (the document's, or the disk's until the first edit), and every grid action becomes a grid
 * operation sent to main (`throng:preview:gridEdit`), which resolves it against the document's current
 * text and applies it through the editor authority — one undo step, visible in every view. What comes
 * back is the next update's text, which this body parses and draws.
 *
 * ══ WHAT MAKES IT AN EDITOR ══
 *
 * - Undo / Redo: the editor's own chords in the grid, and the menu, performed by the document's authority.
 * - Save: `editor.save` reaches the active panel's `EditorActions`, which this body registers while the
 *   run owns its document (`ownsDocument`), so the CSV Preview Editor saves exactly as an editor does.
 * - Auto Save: scheduled after each applied edit from `editor.autoSave` / `editor.autoSaveDebounceMs`,
 *   as `use-editor.ts` schedules it.
 * - Unsaved changes: while the run owns its document, the body publishes `editor-state` (the tab, project
 *   and tree dots, the project-unload prompt) and `EditorActions.isDirty` (the panel-close prompt). While an
 *   editor holds the document it publishes neither, so the document is counted once (044 FR-044).
 *
 * ══ WHAT IT DRAWS ══
 *
 * Column letters and the first record as row 1, always (FR-042). A document with an unterminated quote is
 * not drawn as a grid — one inline notice names its first bad line, with Open in Editor (FR-046).
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import {
  cellValue,
  firstBinding,
  GRID_MAX_CELLS,
  logCaught,
  logExpected,
  parseCsv,
  parseTsv,
  recordFieldCount,
  type CsvGridOperation,
  type CsvModel,
  type PreviewCopyFormat,
} from '@throng/core';
import type { PreviewBodyProps } from '../../provider-view.js';
import { DataGrid, GRID_DEFAULT_COLUMN_WIDTH, GRID_MAX_COLUMN_WIDTH, GRID_MIN_COLUMN_WIDTH, type DataGridHandle, type GridMenuTarget } from '../../../grid/data-grid.js';
import { rangeOf, type GridRange, type GridSelection } from '../../../grid/grid-selection.js';
import { copyGridRange } from '../../../grid/grid-copy.js';
import { createGridWorker } from '../../../grid/worker-factory.js';
import { useAppSettings, useKeybindings } from '../../../config/config-store.js';
import { useContextMenu } from '../../../context-menu-provider.js';
import type { MenuAction } from '../../../workspace/context-menu.js';
import { usePreviewState } from '../../preview-store.js';
import { registerEditorActions, unregisterEditorActions } from '../../../editor/editor-actions.js';
import { removeEditorState, setEditorState } from '../../../editor/editor-state.js';
import { useGridColumnWidths, useProjectIdForRoot } from './column-widths.js';
import { registerCsvGridCommands, unregisterCsvGridCommands } from '../../../grid/grid-commands.js';
import type { CsvParseReply } from './csv-parse-handler.js';
import '../../../grid/grid.css';

/** Research R4 — below this many characters a parse is cheaper in-thread than a worker round trip. */
export const CSV_WORKER_THRESHOLD = 512 * 1024;

type Parsed = { text: string; model: CsvModel };

/** The grid model of `text`: in-thread below the threshold, else in the worker, keeping the last one shown. */
function useCsvModel(text: string): Parsed | null {
  const [parsed, setParsed] = useState<Parsed | null>(() =>
    text.length < CSV_WORKER_THRESHOLD ? { text, model: parseCsv(text) } : null,
  );
  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    if (text.length < CSV_WORKER_THRESHOLD) {
      setParsed((prev) => (prev?.text === text ? prev : { text, model: parseCsv(text) }));
      return;
    }
    let worker: ReturnType<typeof createGridWorker> | null = null;
    try {
      worker = createGridWorker('csv');
    } catch (error) {
      // No worker (a failed chunk): parse here rather than show nothing (FR-072 traces it).
      logCaught('csv-body: start the parse worker', error);
      setParsed({ text, model: parseCsv(text) });
      return;
    }
    worker.onmessage = (event: MessageEvent<CsvParseReply>) => {
      const reply = event.data;
      if (reply.id !== id || seq.current !== id) return;
      if (reply.ok) setParsed({ text, model: reply.model });
      else {
        logExpected('csv-body: parse in the worker', 'the worker could not parse the text, so it is parsed here instead', new Error(reply.error));
        setParsed({ text, model: parseCsv(text) });
      }
      worker?.terminate();
    };
    worker.onerror = (event) => {
      logCaught('csv-body: parse worker failed', event);
      if (seq.current === id) setParsed({ text, model: parseCsv(text) });
      worker?.terminate();
    };
    worker.postMessage({ id, text });
    return () => worker?.terminate();
  }, [text]);
  return parsed;
}

type GridEditAnswer = Awaited<ReturnType<NonNullable<NonNullable<NonNullable<Window['throng']>['preview']>['gridEdit']>>>;

export function CsvBody(props: PreviewBodyProps): ReactElement {
  const { panelId, content, filePath, projectRoot, onDrawn, onViewStateCapture, onOpenInEditor, zoom = 1 } = props;
  const text = content.kind === 'text' ? content.text : '';
  const parsed = useCsvModel(text);
  const run = usePreviewState(panelId);
  const ownsDocument = run?.ownsDocument === true;
  const dirty = run?.dirty === true;
  const settings = useAppSettings();
  const keybindings = useKeybindings();
  const { openMenu } = useContextMenu();
  const gridRef = useRef<DataGridHandle | null>(null);
  const [fault, setFault] = useState<number | null>(null);
  const [widthPrompt, setWidthPrompt] = useState<{ col: number; value: string } | null>(null);
  const { widths, setWidth, resetWidth } = useGridColumnWidths(projectRoot, filePath);
  // The project dot and the unload prompt count an unsaved document by its project (006 US8).
  const ownerProjectId = useProjectIdForRoot(projectRoot);

  const model = parsed?.model ?? null;
  const modelText = parsed?.text ?? '';
  const malformedLine = model?.fault?.line ?? fault;
  const rowCount = model?.records ?? 0;
  const colCount = model?.width ?? 0;

  const getCell = useCallback(
    (row: number, col: number): string => (model === null ? '' : cellValue(model, modelText, row, col)),
    [model, modelText],
  );

  // data-model §13 — every draw reports exactly one of onDrawn / onBodyFailure.
  const onDrawnRef = useRef(onDrawn);
  onDrawnRef.current = onDrawn;
  useEffect(() => {
    if (parsed !== null) onDrawnRef.current(filePath);
  }, [parsed, filePath]);

  // FR-025 — the place is the grid's scroll, kept across updates by the grid itself; this captures it for
  // the chrome's history entries.
  useEffect(() => {
    onViewStateCapture(() => gridRef.current?.getScroll() ?? null);
  }, [onViewStateCapture]);

  useEffect(() => {
    if (model !== null && model.fault === null) setFault(null);
  }, [model]);

  /* ── Edits ───────────────────────────────────────────────────────────────────────────────────── */

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = useCallback(async (): Promise<boolean> => {
    const answer = await window.throng?.preview?.gridSave?.(panelId);
    if (answer === undefined) return false;
    if (!answer.ok) {
      logExpected('csv-body: save', `the save was refused (${answer.reason}): ${answer.error}`, new Error(answer.reason));
      return false;
    }
    return true;
  }, [panelId]);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const send = useCallback(
    async (operation: CsvGridOperation): Promise<void> => {
      const gridEdit = window.throng?.preview?.gridEdit;
      if (gridEdit === undefined) return;
      let answer: GridEditAnswer;
      try {
        answer = await gridEdit({ panelId, filePath, operation });
      } catch (error) {
        logCaught('csv-body: grid edit', error);
        return;
      }
      if (!answer.ok) {
        if (answer.reason === 'malformed') setFault(answer.line);
        else logExpected('csv-body: grid edit', `main refused the edit (${answer.reason})`, new Error(answer.reason));
        return;
      }
      // Auto Save, exactly as an editor schedules it (use-editor.ts).
      const editor = settingsRef.current.editor;
      if (editor.autoSave && answer.dirty) {
        if (autoSaveTimer.current !== null) clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = setTimeout(() => void save(), editor.autoSaveDebounceMs);
      }
    },
    [panelId, filePath, save],
  );
  useEffect(
    () => () => {
      if (autoSaveTimer.current !== null) clearTimeout(autoSaveTimer.current);
    },
    [],
  );

  const setCells = useCallback(
    (cells: { row: number; col: number; value: string }[]) => {
      if (cells.length > 0) void send({ kind: 'setCells', cells });
    },
    [send],
  );

  const clearRange = useCallback(
    (range: GridRange) => {
      const cells: { row: number; col: number; value: string }[] = [];
      if (model === null) return;
      for (let r = range.top; r <= Math.min(range.bottom, rowCount - 1); r++) {
        const reach = Math.min(range.right, recordFieldCount(model, r) - 1);
        for (let c = range.left; c <= reach; c++) if (getCell(r, c) !== '') cells.push({ row: r, col: c, value: '' });
      }
      setCells(cells);
    },
    [getCell, model, rowCount, setCells],
  );

  const paste = useCallback(
    (pasted: string, at: { row: number; col: number }, range?: GridRange) => {
      const rows = parseTsv(pasted);
      const cells: { row: number; col: number; value: string }[] = [];
      const single = rows.length === 1 && rows[0]?.length === 1 ? (rows[0][0] as string) : null;
      if (single !== null && range !== undefined && (range.bottom > range.top || range.right > range.left)) {
        // FR-037f: one value onto a selection of several cells fills every one of them (bounded like a paste).
        const width = range.right - range.left + 1;
        const lastRow = Math.min(range.bottom, range.top + Math.max(1, Math.floor(GRID_MAX_CELLS / width)) - 1);
        for (let r = range.top; r <= lastRow; r++) {
          for (let c = range.left; c <= range.right; c++) cells.push({ row: r, col: c, value: single });
        }
      } else {
        rows.forEach((row, r) => row.forEach((value, c) => cells.push({ row: at.row + r, col: at.col + c, value })));
      }
      setCells(cells);
    },
    [setCells],
  );

  /** The menu's Paste: reads the clipboard and lands it at the selection's top-left, as the chord does (FR-037f). */
  const pasteFromMenu = useCallback(() => {
    const grid = gridRef.current;
    void window.throng?.clipboard
      ?.paste()
      .then((clip) => {
        const range = grid?.selectedRange() ?? { top: 0, left: 0, bottom: 0, right: 0 };
        paste(clip.text, { row: range.top, col: range.left }, range);
      })
      .catch((error: unknown) => logCaught('csv-body: paste from the menu', error));
  }, [paste]);

  const copyFormat = settings.editor.previews.copyFormat;
  const copy = useCallback(
    (range: GridRange, format: PreviewCopyFormat = copyFormat) => void copyGridRange(range, getCell, format),
    [copyFormat, getCell],
  );

  const cut = useCallback(
    (sel: GridSelection, range: GridRange) => {
      void copyGridRange(range, getCell, copyFormat).then((ok) => {
        if (!ok) return;
        if (sel.rows === true) void send({ kind: 'deleteRows', from: range.top, count: Math.min(range.bottom, rowCount - 1) - range.top + 1 });
        else clearRange(range);
      });
    },
    [clearRange, copyFormat, getCell, rowCount, send],
  );

  const history = useCallback(
    (step: 'undo' | 'redo') => void (step === 'undo' ? window.throng?.preview?.gridUndo?.(panelId) : window.throng?.preview?.gridRedo?.(panelId)),
    [panelId],
  );

  const activeCell = useCallback(() => gridRef.current?.getSelection().active ?? { row: 0, col: 0 }, []);
  const insertRows = useCallback((at: number) => void send({ kind: 'insertRows', at: Math.min(at, rowCount), count: 1 }), [send, rowCount]);
  const insertColumn = useCallback((at: number) => void send({ kind: 'insertColumn', at }), [send]);

  // FR-038 — the bindable commands act on the active cell of this panel.
  useEffect(() => {
    registerCsvGridCommands(panelId, {
      insertRowAbove: () => insertRows(activeCell().row),
      insertRowBelow: () => insertRows(activeCell().row + 1),
      insertColumnLeft: () => insertColumn(activeCell().col),
      insertColumnRight: () => insertColumn(activeCell().col + 1),
    });
    return () => unregisterCsvGridCommands(panelId);
  }, [panelId, insertRows, insertColumn, activeCell]);

  /* ── The document's unsaved state, counted once (FR-033, 044 FR-044) ─────────────────────────── */

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const ownsRef = useRef(ownsDocument);
  ownsRef.current = ownsDocument;
  // Registered always, so Ctrl+S saves the document whichever document it is; but the panel-close prompt
  // (isDirty) asks only while this panel holds the document alone — an editor showing it still has it.
  useEffect(() => {
    registerEditorActions(panelId, {
      save,
      saveAs: save,
      saveForClose: save,
      isDirty: () => ownsRef.current && dirtyRef.current,
      openFile: async () => {},
      revert: () => {},
      reloadFromDisk: async () => false,
    });
    return () => unregisterEditorActions(panelId);
  }, [panelId, save]);
  useEffect(() => {
    if (!ownsDocument) return;
    return () => removeEditorState(panelId);
  }, [ownsDocument, panelId]);
  useEffect(() => {
    if (!ownsDocument) return;
    const name = filePath.slice(Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1);
    setEditorState(panelId, {
      panelId,
      filePath,
      displayName: `${name} - Preview`,
      ownerRoot: projectRoot,
      ownerKind: 'project',
      dirty,
      fileMissing: false,
      unloadable: false,
      openPending: false,
      preview: true,
      ...(ownerProjectId !== undefined ? { ownerProjectId } : {}),
    });
  }, [ownsDocument, panelId, filePath, projectRoot, dirty, ownerProjectId]);

  /* ── Menus (contracts/grid-ui.md) ────────────────────────────────────────────────────────────── */

  const onContextMenu = useCallback(
    (target: GridMenuTarget, point: { x: number; y: number }) => {
      const grid = gridRef.current;
      if (grid === null) return;
      const sel = grid.getSelection();
      const range = rangeOf(sel, colCount);
      const at = sel.active;
      const chord = (id: Parameters<typeof firstBinding>[1]): string | undefined => firstBinding(keybindings, id) ?? undefined;
      const items: MenuAction[] = [];
      const insert: MenuAction[] = [
        { label: 'Insert Row Above', section: 'create', onClick: () => insertRows(at.row), shortcut: chord('grid.insertRowAbove') },
        { label: 'Insert Row Below', section: 'create', onClick: () => insertRows(at.row + 1), shortcut: chord('grid.insertRowBelow') },
        { label: 'Insert Column Left', section: 'create', onClick: () => insertColumn(at.col), shortcut: chord('grid.insertColumnLeft') },
        { label: 'Insert Column Right', section: 'create', onClick: () => insertColumn(at.col + 1), shortcut: chord('grid.insertColumnRight') },
      ];
      const width: MenuAction = {
        label: 'Column Width…',
        section: 'viewState',
        onClick: () => setWidthPrompt({ col: at.col, value: String(widths[at.col] ?? GRID_DEFAULT_COLUMN_WIDTH) }),
      };
      // FR-037e — every menu offers the clipboard for the selection the right-click leaves.
      const clipboard = (rows: boolean): MenuAction[] => [
        { label: 'Cut', section: 'content', group: 'clipboard', onClick: () => cut(rows ? { ...sel, rows: true } : sel, range) },
        { label: 'Copy', section: 'content', group: 'clipboard', onClick: () => copy(range) },
        { label: 'Paste', section: 'content', group: 'clipboard', onClick: pasteFromMenu },
      ];
      if (target.kind === 'row') {
        items.push(
          insert[0]!,
          insert[1]!,
          ...clipboard(true),
          { label: 'Reset Size', section: 'viewState', onClick: () => grid.collapseRow(target.row) },
        );
      } else if (target.kind === 'column') {
        items.push(
          insert[2]!,
          insert[3]!,
          ...clipboard(false),
          width,
          { label: 'Reset Size', section: 'viewState', onClick: () => resetWidth(target.col) },
        );
      } else {
        items.push(
          { label: 'Undo', section: 'content', group: 'history', onClick: () => history('undo') },
          { label: 'Redo', section: 'content', group: 'history', onClick: () => history('redo') },
          { label: 'Cut', section: 'content', group: 'clipboard', onClick: () => cut(sel, range) },
          { label: 'Copy', section: 'content', group: 'clipboard', onClick: () => copy(range) },
          { label: 'Copy as Rich Text', section: 'content', group: 'clipboard', onClick: () => copy(range, 'rich') },
          { label: 'Copy as Plain Text', section: 'content', group: 'clipboard', onClick: () => copy(range, 'plain') },
          { label: 'Paste', section: 'content', group: 'clipboard', onClick: pasteFromMenu },
          { label: 'Clear Cells', section: 'content', group: 'clipboard', onClick: () => clearRange(range) },
          { label: 'Select All', section: 'content', group: 'clipboard', onClick: () => grid.selectAll() },
          { label: 'Save', section: 'content', group: 'file', onClick: () => void save(), shortcut: chord('editor.save') },
          ...insert,
          width,
        );
      }
      if (onOpenInEditor !== undefined) items.push({ label: 'Open in Editor', section: 'navigate', onClick: onOpenInEditor });
      openMenu(point.x, point.y, items);
    },
    [clearRange, colCount, copy, cut, history, insertColumn, insertRows, keybindings, onOpenInEditor, openMenu, pasteFromMenu, resetWidth, save, widths],
  );

  const submitWidth = (e: FormEvent): void => {
    e.preventDefault();
    if (widthPrompt === null) return;
    const n = Number(widthPrompt.value);
    if (Number.isFinite(n)) setWidth(widthPrompt.col, Math.min(GRID_MAX_COLUMN_WIDTH, Math.max(GRID_MIN_COLUMN_WIDTH, Math.round(n))));
    setWidthPrompt(null);
    gridRef.current?.focus();
  };

  if (malformedLine !== null) {
    return (
      <div className="preview-grid-notice" role="alert" data-testid={`csv-malformed-${panelId}`}>
        <p>
          This CSV has a quote that never closes, starting on line {malformedLine}. It cannot be shown as a grid
          without losing data.
        </p>
        {onOpenInEditor !== undefined ? (
          <button type="button" className="preview-grid-notice-action" onClick={onOpenInEditor}>
            Open in Editor
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="preview-grid-body" data-testid={`csv-body-${panelId}`}>
      <DataGrid
        ref={gridRef}
        testId={`csv-grid-${panelId}`}
        rowCount={rowCount}
        colCount={colCount}
        getCell={getCell}
        editable
        columnWidths={widths}
        onColumnWidthChange={setWidth}
        zoom={zoom}
        onCommitEdit={(row, col, value) => setCells([{ row, col, value }])}
        onClear={clearRange}
        onCopy={(_sel, range) => copy(range)}
        onCut={cut}
        onPaste={paste}
        onHistory={history}
        onContextMenu={onContextMenu}
      />
      {widthPrompt !== null ? (
        <form className="preview-grid-width" onSubmit={submitWidth} data-testid={`csv-width-${panelId}`}>
          <label>
            Column width (pixels)
            <input
              autoFocus
              type="number"
              min={GRID_MIN_COLUMN_WIDTH}
              max={GRID_MAX_COLUMN_WIDTH}
              value={widthPrompt.value}
              onChange={(e) => setWidthPrompt({ col: widthPrompt.col, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setWidthPrompt(null);
              }}
            />
          </label>
          <button type="submit">Set Width</button>
          <button type="button" onClick={() => setWidthPrompt(null)}>
            Cancel
          </button>
        </form>
      ) : null}
    </div>
  );
}
