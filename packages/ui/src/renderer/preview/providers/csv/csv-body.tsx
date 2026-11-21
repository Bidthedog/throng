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
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import {
  cellDialogOn,
  wrapCellsOn,
  lockFirstRowOn,
  lockFirstColumnOn,
  cellDialogText,
  columnLabel,
  flattenCellText,
  isJsonContainer,
  longCellThresholdOf,
  firstBinding,
  logCaught,
  logExpected,
  parseTsv,
  type PreviewCopyFormat,
} from '@throng/core';
import {
  cellValue,
  GRID_MAX_CELLS,
  GRID_MAX_ROW_COUNT,
  parseCsv,
  recordAtLine,
  recordFieldCount,
  type CsvGridOperation,
  type CsvModel,
} from '@throng/core/csv';
import type { PreviewBodyProps } from '../../provider-view.js';
import { DataGrid, GRID_DEFAULT_COLUMN_WIDTH, GRID_MAX_COLUMN_WIDTH, GRID_MIN_COLUMN_WIDTH, type DataGridHandle, type GridMenuTarget } from '../../../grid/data-grid.js';
import { rangeOf, type GridRange, type GridSelection } from '../../../grid/grid-selection.js';
import { useCsvScrollSync } from './use-csv-scroll-sync.js';
import { useSyncMarkFrom } from '../../sync-mark-store.js';
import { useGridGoTo } from '../../../grid/use-grid-go-to.js';
import { useFilePlaces } from '../../../grid/use-file-places.js';
import { copyGridRange } from '../../../grid/grid-copy.js';
import { gridPrintRow } from '../../../grid/grid-print-row.js';
import { registerGridPrintSource, type GridPrintSource } from '../../../grid/grid-print.js';
import { CellDialog } from '../../../grid/cell-dialog.js';
import { copiedBlockFor, hasCopiedBlock, recordCopy, type CopiedBlock } from '../../../grid/copied-block.js';
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
import { Spinner } from '../../../common/loading.js';
import '../../../grid/grid.css';
import '../../loading-placeholder.css';

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
  const { panelId, content, filePath, projectRoot, providerSettings, cellDialogChoice, wrapChoice, lockFirstRowChoice, lockFirstColumnChoice, registerGoTo, navigationSeq, syncLine, syncEcho, onTopLineChange, onTopLineRead, syncMark: syncMarkProp, syncMarkSource, onDrawn, onViewStateCapture, onOpenInEditor, onPrint, zoom = 1 } = props;
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
  // 073 FR-072 (T083) — the grid refused over a document it cannot parse without loss (FR-046) leaves a record, once
  // per file and line.
  useEffect(() => {
    if (malformedLine !== null) logExpected('csv-body: show the grid', `refused, the CSV cannot be parsed without loss from line ${malformedLine}: ${filePath}`);
  }, [malformedLine, filePath]);
  const rowCount = model?.records ?? 0;
  const colCount = model?.width ?? 0;

  const getCell = useCallback(
    (row: number, col: number): string => (model === null ? '' : cellValue(model, modelText, row, col)),
    [model, modelText],
  );

  // 075 FR-075b — what Print… prints: every row, read when it runs. With Lock first row on, the first row is the
  // table's header, repeated on every page.
  const printRead = useRef<() => GridPrintSource>(() => ({ rowCount: 0, colCount: 0, cell: () => '', header: null, width: () => undefined }));
  const headerRow = lockFirstRowOn(lockFirstRowChoice, providerSettings.lockFirstRow);
  printRead.current = () => {
    const skip = headerRow && rowCount > 0 ? 1 : 0;
    return {
      rowCount: rowCount - skip,
      colCount,
      cell: (row, col) => getCell(row + skip, col),
      header: skip === 1 ? Array.from({ length: colCount }, (_, c) => getCell(0, c)) : null,
      width: (col) => widths[col],
    };
  };
  const [printRoot, printRootRef] = useState<HTMLDivElement | null>(null);
  useEffect(() => (printRoot === null ? undefined : registerGridPrintSource(printRoot, () => printRead.current())), [printRoot]);

  // data-model §13 — every draw reports exactly one of onDrawn / onBodyFailure.
  const onDrawnRef = useRef(onDrawn);
  onDrawnRef.current = onDrawn;
  useEffect(() => {
    if (parsed !== null) onDrawnRef.current(filePath);
  }, [parsed, filePath]);

  // FR-008d — the selection and scroll belong to the file: a move to another CSV shows its own, A1 on a first visit.
  useFilePlaces(gridRef, filePath, navigationSeq, parsed !== null && parsed.text === text);

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
  // `target` is a Save As location (FR-035a); without one the document is saved where it is.
  const writeDocument = useCallback(
    async (target?: string): Promise<boolean> => {
      const gridSave = window.throng?.preview?.gridSave;
      const answer = await (target === undefined ? gridSave?.(panelId) : gridSave?.(panelId, target));
      if (answer === undefined) return false;
      if (!answer.ok) {
        logExpected('csv-body: save', `the save was refused (${answer.reason}): ${answer.error}`, new Error(answer.reason));
        return false;
      }
      return true;
    },
    [panelId],
  );
  const save = useCallback((): Promise<boolean> => writeDocument(), [writeDocument]);

  // FR-035a — Save As asks with the editor's own dialog (`use-editor.ts` `chooseLocation`), then writes through
  // the same one save path; main re-points the preview, which follows the file at its new path.
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;
  const projectRootRef = useRef(projectRoot);
  projectRootRef.current = projectRoot;
  const saveAs = useCallback(async (): Promise<boolean> => {
    const current = filePathRef.current;
    const cut = Math.max(current.lastIndexOf('/'), current.lastIndexOf('\\'));
    const chosen = await window.throng?.editor?.chooseSavePath?.({
      defaultDir: cut > 0 ? current.slice(0, cut) : projectRootRef.current,
      defaultName: current.slice(cut + 1),
    });
    if (chosen === undefined || chosen === null) return false;
    return writeDocument(chosen);
  }, [writeDocument]);

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
  // FR-038a — what a copy or cut held, when it was whole rows or whole columns, for Insert Copied Rows / Columns.
  const copy = useCallback(
    (range: GridRange, format: PreviewCopyFormat = copyFormat) => {
      const sel = gridRef.current?.getSelection();
      void copyGridRange(range, getCell, format).then((ok) => {
        if (ok && sel !== undefined) recordCopy(sel, range, rowCount, getCell);
      });
    },
    [copyFormat, getCell, rowCount],
  );

  /*
   * FR-037i — Esc straight after a Cut undoes it, once. The mark is armed with the text the document held before the
   * cut; the first different text to arrive is what the cut produced, and Esc undoes only while the document still
   * holds exactly that — any later change, from this grid or a text editor on the file, leaves it unequal.
   */
  const cutMark = useRef<{ before: string; after: string | null } | null>(null);
  const textNow = useRef(text);
  textNow.current = text;
  useEffect(() => {
    const mark = cutMark.current;
    if (mark !== null && mark.after === null && text !== mark.before) mark.after = text;
  }, [text]);
  const escapeCut = useCallback((): boolean => {
    const mark = cutMark.current;
    cutMark.current = null;
    if (mark === null || mark.after === null || mark.after !== textNow.current) return false;
    void window.throng?.preview?.gridUndo?.(panelId);
    return true;
  }, [panelId]);

  const cut = useCallback(
    (sel: GridSelection, range: GridRange) => {
      void copyGridRange(range, getCell, copyFormat).then((ok) => {
        if (!ok) return;
        cutMark.current = { before: textNow.current, after: null };
        // Recorded before the rows go: the record holds the values the cut took.
        recordCopy(sel, range, rowCount, getCell);
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
  const insertRows = useCallback(
    (at: number, values?: string[][]) =>
      void send(
        values === undefined
          ? { kind: 'insertRows', at: Math.min(at, rowCount), count: 1 }
          : { kind: 'insertRows', at: Math.min(at, rowCount), count: values.length, values },
      ),
    [send, rowCount],
  );
  const insertColumn = useCallback(
    (at: number, columns?: string[][]) =>
      void send(columns === undefined ? { kind: 'insertColumn', at } : { kind: 'insertColumn', at, count: columns.length, columns }),
    [send],
  );

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
      saveAs,
      saveForClose: save,
      isDirty: () => ownsRef.current && dirtyRef.current,
      openFile: async () => {},
      revert: () => {},
      reloadFromDisk: async () => false,
    });
    return () => unregisterEditorActions(panelId);
  }, [panelId, save, saveAs]);
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

  /* ── The cell dialog (FR-036a, FR-036b, FR-060a) ─────────────────────────────────────────────── */

  // Offered by the panel's own choice (its status-bar toggle), else by the setting. Off means NO dialog at all:
  // no routing of long cells and no menu item.
  const cellDialogAvailable = cellDialogOn(cellDialogChoice, providerSettings.editLongCellsInDialog);
  const longCellThreshold = longCellThresholdOf(providerSettings.longCellThreshold);
  const [cellDialog, setCellDialog] = useState<{ row: number; col: number; initial: string } | null>(null);

  const openCellDialog = useCallback(
    (row: number, col: number): void => {
      setCellDialog({ row, col, initial: cellDialogText(getCell(row, col)) });
    },
    [getCell],
  );
  // The dialog hands the keyboard back to the grid itself, once it has unmounted (`returnFocus`).
  const closeCellDialog = useCallback((): void => {
    setCellDialog(null);
  }, []);
  const focusGrid = useCallback((): void => gridRef.current?.focus(), []);
  // Saving writes the flattened text as one edit (one undo step); text unchanged from what the dialog opened with
  // writes nothing.
  const saveCellDialog = (text: string): void => {
    const open = cellDialog;
    closeCellDialog();
    if (open === null || text === open.initial) return;
    setCells([{ row: open.row, col: open.col, value: flattenCellText(text) }]);
  };

  // FR-043a — Ctrl+G and the menus' Go to Row… open the shared Go to dialog for rows.
  // 073 FR-033c — scroll in step with the linked text editor, as a Markdown preview does.
  const gridSync = useCsvScrollSync(gridRef, parsed, { syncLine, syncEcho, onTopLineChange, onTopLineRead });
  const syncMark = useSyncMarkFrom(syncMarkSource, syncMarkProp);
  const markedRow = useMemo(
    () => {
      const starts = syncMark === null ? null : gridSync.starts();
      return syncMark === null || starts === null ? null : { row: recordAtLine(starts, syncMark.line), on: syncMark.on };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `parsed` stands for the starts it keys
    [syncMark, parsed, gridSync.starts],
  );
  const goTo = useGridGoTo(panelId, gridRef, rowCount, registerGoTo);

  /* ── Menus (contracts/grid-ui.md) ────────────────────────────────────────────────────────────── */

  const buildMenu = useCallback(
    (target: GridMenuTarget, point: { x: number; y: number }, copied: CopiedBlock | null) => {
      const grid = gridRef.current;
      if (grid === null) return;
      const sel = grid.getSelection();
      const range = rangeOf(sel, colCount);
      const at = sel.active;
      const chord = (id: Parameters<typeof firstBinding>[1]): string | undefined => firstBinding(keybindings, id) ?? undefined;
      const items: MenuAction[] = [];
      const insert: MenuAction[] = [
        { label: 'Insert Row Above', icon: 'insertRowAbove', section: 'create', onClick: () => insertRows(at.row), shortcut: chord('grid.insertRowAbove') },
        { label: 'Insert Row Below', icon: 'insertRowBelow', section: 'create', onClick: () => insertRows(at.row + 1), shortcut: chord('grid.insertRowBelow') },
        { label: 'Insert Column Left', icon: 'insertColumnLeft', section: 'create', onClick: () => insertColumn(at.col), shortcut: chord('grid.insertColumnLeft') },
        { label: 'Insert Column Right', icon: 'insertColumnRight', section: 'create', onClick: () => insertColumn(at.col + 1), shortcut: chord('grid.insertColumnRight') },
      ];
      const width: MenuAction = {
        label: 'Column Width…',
        section: 'viewState',
        onClick: () => setWidthPrompt({ col: at.col, value: String(widths[at.col] ?? GRID_DEFAULT_COLUMN_WIDTH) }),
      };
      // FR-037e — every menu offers the clipboard for the selection the right-click leaves.
      const clipboard = (rows: boolean): MenuAction[] => [
        { label: 'Cut', icon: 'cut', section: 'content', group: 'clipboard', onClick: () => cut(rows ? { ...sel, rows: true } : sel, range) },
        { label: 'Copy', icon: 'copy', section: 'content', group: 'clipboard', onClick: () => copy(range) },
        { label: 'Paste', icon: 'paste', section: 'content', group: 'clipboard', onClick: pasteFromMenu },
      ];
      // FR-038a — beside the blank inserts, never instead of them.
      const insertCopied: MenuAction[] = [];
      if (copied !== null && copied.kind === 'rows' && copied.values.length <= GRID_MAX_ROW_COUNT) {
        const rows = copied.values;
        insertCopied.push(
          { label: 'Insert Copied Rows Above', icon: 'insertRowAbove', section: 'create', onClick: () => insertRows(at.row, rows) },
          { label: 'Insert Copied Rows Below', icon: 'insertRowBelow', section: 'create', onClick: () => insertRows(at.row + 1, rows) },
        );
      } else if (copied !== null && copied.kind === 'columns' && copied.values.length <= GRID_MAX_ROW_COUNT) {
        const columns = copied.values;
        insertCopied.push(
          { label: 'Insert Copied Columns Left', icon: 'insertColumnLeft', section: 'create', onClick: () => insertColumn(at.col, columns) },
          { label: 'Insert Copied Columns Right', icon: 'insertColumnRight', section: 'create', onClick: () => insertColumn(at.col + 1, columns) },
        );
      }
      if (target.kind === 'row') {
        items.push(
          insert[0]!,
          insert[1]!,
          ...insertCopied,
          ...clipboard(true),
          { label: 'Go to Row…', icon: 'goToRow', section: 'navigate', onClick: goTo.open, shortcut: chord('preview.goToHeading') },
        );
      } else if (target.kind === 'column') {
        items.push(
          insert[2]!,
          insert[3]!,
          ...insertCopied,
          ...clipboard(false),
          width,
          { label: 'Reset Column Width', icon: 'resetColumnWidth', section: 'viewState', onClick: () => resetWidth(target.col) },
        );
      } else {
        items.push(
          { label: 'Undo', icon: 'undo', section: 'content', group: 'history', onClick: () => history('undo') },
          { label: 'Redo', icon: 'redo', section: 'content', group: 'history', onClick: () => history('redo') },
          { label: 'Cut', icon: 'cut', section: 'content', group: 'clipboard', onClick: () => cut(sel, range) },
          { label: 'Copy', icon: 'copy', section: 'content', group: 'clipboard', onClick: () => copy(range) },
          { label: 'Copy as Rich Text', section: 'content', group: 'clipboard', onClick: () => copy(range, 'rich') },
          { label: 'Copy as Plain Text', section: 'content', group: 'clipboard', onClick: () => copy(range, 'plain') },
          { label: 'Paste', icon: 'paste', section: 'content', group: 'clipboard', onClick: pasteFromMenu },
          { label: 'Clear Cells', section: 'content', group: 'clipboard', onClick: () => clearRange(range) },
          ...(cellDialogAvailable
            ? [
                {
                  label: 'Edit in Dialog…',
                  icon: 'cellDialog' as const,
                  section: 'content' as const,
                  // FR-036d — the dialog edits one cell: a block, whole rows or whole columns disable it, and say why.
                  ...(sel.rows === true || range.top !== range.bottom || range.left !== range.right
                    ? { disabled: true, title: 'Select one cell to edit it in a dialog' }
                    : {}),
                  onClick: () => openCellDialog(target.row, target.col),
                },
              ]
            : []),
          { label: 'Select All', icon: 'selectAll', section: 'content', group: 'clipboard', onClick: () => grid.selectAll() },
          { label: 'Save', icon: 'save', section: 'content', group: 'file', onClick: () => void save(), shortcut: chord('editor.save') },
          { label: 'Save As…', icon: 'saveAs', section: 'content', group: 'file', onClick: () => void saveAs(), shortcut: chord('editor.saveAs') },
          { label: 'Go to Row…', icon: 'goToRow', section: 'navigate', onClick: goTo.open, shortcut: chord('preview.goToHeading') },
          ...insert,
          width,
        );
      }
      if (onOpenInEditor !== undefined) items.push({ label: 'Open in Editor', section: 'navigate', onClick: onOpenInEditor });
      items.push(gridPrintRow(chord('preview.print'), onPrint));
      openMenu(point.x, point.y, items);
    },
    [cellDialogAvailable, goTo.open, clearRange, colCount, copy, cut, history, insertColumn, insertRows, keybindings, onOpenInEditor, onPrint, openCellDialog, openMenu, pasteFromMenu, resetWidth, save, saveAs, widths],
  );

  // FR-038a — a header menu adds Insert Copied Rows / Columns while whole rows / columns are what the clipboard
  // still holds. The clipboard is read as the menu opens, as Paste reads it; every other menu opens at once.
  const onContextMenu = useCallback(
    (target: GridMenuTarget, point: { x: number; y: number }) => {
      const kind = target.kind === 'row' ? 'rows' : target.kind === 'column' ? 'columns' : null;
      const readClipboard = window.throng?.clipboard?.paste;
      if (kind === null || !hasCopiedBlock(kind) || readClipboard === undefined) {
        buildMenu(target, point, null);
        return;
      }
      void readClipboard()
        .then((clip) => buildMenu(target, point, copiedBlockFor(kind, clip.text)))
        .catch((error: unknown) => {
          logCaught('csv-body: read the clipboard for the menu', error);
          buildMenu(target, point, null);
        });
    },
    [buildMenu],
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

  if (parsed === null) {
    // 075 FR-043a — the placeholder everything in a preview shows while it loads, until the worker's first parse lands.
    // (Nothing to print yet: the print source registers on the grid body below.)
    return (
      <div className="preview-loading preview-loading--block" data-testid={`csv-loading-${panelId}`} aria-busy="true">
        <Spinner label="Loading CSV" />
        <span>Loading CSV…</span>
      </div>
    );
  }

  return (
    <div className="preview-grid-body" data-testid={`csv-body-${panelId}`} ref={printRootRef}>
      <DataGrid
        longCellThreshold={cellDialogAvailable ? longCellThreshold : undefined}
        multiLineInDialog={providerSettings.multiLineCellsInDialog !== false}
        onEditInDialog={openCellDialog}
        wrap={wrapCellsOn(wrapChoice, providerSettings.wrapCells)}
        lockFirstRow={lockFirstRowOn(lockFirstRowChoice, providerSettings.lockFirstRow)}
        lockFirstColumn={lockFirstColumnOn(lockFirstColumnChoice, providerSettings.lockFirstColumn)}
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
        onEscape={escapeCut}
        onContextMenu={onContextMenu}
        onScrollChange={gridSync.schedule}
        syncMarkRow={markedRow}
      />
      {goTo.dialog}
      {cellDialog !== null ? (
        <CellDialog
          returnFocus={focusGrid}
          cellLabel={`${columnLabel(cellDialog.col)}${cellDialog.row + 1}`}
          initial={cellDialog.initial}
          json={isJsonContainer(cellDialog.initial)}
          onSave={saveCellDialog}
          onCancel={closeCellDialog}
        />
      ) : null}
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
