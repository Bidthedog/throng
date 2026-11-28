/**
 * The spreadsheet preview's body (073 FR-050 – FR-059; research R6, R7).
 *
 * A read-only grid per sheet, with a sheet switcher. The bytes come through the confined source route
 * (`throng:preview:readSource`, the protocol handler's own containment and size cap, FR-070) and are
 * parsed by SheetJS in the spreadsheet worker (FR-055), so the panel and the app answer input while a large
 * workbook parses. Each update from main carries a new source URL revision: the file changed on disk, and
 * the body reads it again, keeping the selected sheet when one of that name still exists (FR-058).
 *
 * Nothing here edits: the grid is `editable={false}`, so it opens no cell editor and offers no cut, paste,
 * clear or insert.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { columnLabel, formatSetting, logCaught, logExpected, SETTINGS_METADATA, type FieldDescriptor, type PreviewCopyFormat } from '@throng/core';
import type { PreviewBodyProps } from '../../provider-view.js';
import { DataGrid, GRID_DEFAULT_COLUMN_WIDTH, GRID_MAX_COLUMN_WIDTH, GRID_MIN_COLUMN_WIDTH, type DataGridHandle, type GridMenuTarget } from '../../../grid/data-grid.js';
import { rangeOf, type GridRange } from '../../../grid/grid-selection.js';
import { useGridGoTo } from '../../../grid/use-grid-go-to.js';
import { useFilePlaces } from '../../../grid/use-file-places.js';
import { copyGridRange } from '../../../grid/grid-copy.js';
import { GridNumberPrompt } from '../../../grid/grid-number-prompt.js';
import { registerGridPrintSource, type GridPrintSource } from '../../../grid/grid-print.js';
import { createGridWorker } from '../../../grid/worker-factory.js';
import { GRID_MAX_CELLS } from '@throng/core/csv';
import { useAppSettings, useKeybindings } from '../../../config/config-store.js';
import { useContextMenu } from '../../../context-menu-provider.js';
import { spreadsheetMenu } from './spreadsheet-menu.js';
import { requestReadOnlyFlash } from '../../read-only-marker.js';
import type { WorkbookRead, WorkbookRefusal, WorkbookSheet } from './workbook-read.js';
import type { WorkbookParseReply } from './spreadsheet-handler.js';
import { Spinner } from '../../../common/loading.js';
import '../../../grid/grid.css';
import '../../loading-placeholder.css';

type Loaded = { state: 'loading' } | { state: 'read'; read: WorkbookRead } | { state: 'unreadable'; status: number };

const REFUSAL_TEXT: Readonly<Record<WorkbookRefusal, string>> = {
  password: 'This workbook is protected by a password, so it cannot be previewed.',
  malformed: 'This file could not be read as a workbook. It may be damaged, or not a spreadsheet at all.',
  unsupported: 'This workbook is in a format the preview cannot read.',
  reader: 'The spreadsheet reader stopped before it could read this workbook. Refresh to try again.',
};

/** The Spreadsheet provider's size limit's descriptor, so the limit reads as Preferences shows it (MB). */
const LIMIT_DESCRIPTOR: FieldDescriptor = SETTINGS_METADATA.find((d) => d.key === 'editor.previews.providers.spreadsheet.maxPreviewBytes') ?? {
  key: '',
  label: '',
  description: '',
  group: '',
  control: 'slider',
  storedUnit: 'bytes',
  display: 'MB',
};

/**
 * FR-062 (T093) — the file grew past the limit between main's size check and this read. Main named the size and the
 * limit on its own notice; here only the limit is known, and Refresh re-runs main's check, which names both.
 */
function overLimitText(limit: unknown): string {
  return typeof limit === 'number'
    ? `This workbook is over the ${formatSetting(limit, LIMIT_DESCRIPTOR)} preview size limit set in Preferences. Refresh to check it again.`
    : 'This workbook is over the preview size limit set in Preferences. Refresh to check it again.';
}

function parseOffThread(bytes: ArrayBuffer, id: number): Promise<WorkbookRead> {
  return new Promise((resolve) => {
    let worker: ReturnType<typeof createGridWorker>;
    try {
      worker = createGridWorker('spreadsheet');
    } catch (error) {
      logCaught('spreadsheet-body: start the worker', error);
      resolve({ ok: false, reason: 'reader', detail: 'The spreadsheet reader could not start.' });
      return;
    }
    worker.onmessage = (event: MessageEvent<WorkbookParseReply>) => {
      if (event.data.id !== id) return;
      worker.terminate();
      resolve(event.data.read);
    };
    worker.onerror = (event) => {
      logCaught('spreadsheet-body: the worker failed', event);
      worker.terminate();
      resolve({ ok: false, reason: 'reader', detail: 'The spreadsheet reader stopped.' });
    };
    worker.postMessage({ id, bytes }, [bytes]);
  });
}

export function SpreadsheetBody(props: PreviewBodyProps): ReactElement {
  const { panelId, content, filePath, providerSettings, registerGoTo, navigationSeq, onDrawn, onBodyFailure, onViewStateCapture, readSource, onCopyCapped, gridToggles, zoom = 1 } = props;
  const source = content.kind === 'resource' ? content.url : '';
  const firstRowHeader = providerSettings.firstRowHeader === true;
  const settings = useAppSettings();
  const keybindings = useKeybindings();
  const { openMenu } = useContextMenu();
  const gridRef = useRef<DataGridHandle | null>(null);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  // The source revision `loaded` was read from, so a navigation knows when the arriving workbook is the one on screen.
  const [loadedFor, setLoadedFor] = useState('');
  const [sheetName, setSheetName] = useState<string | null>(null);
  const [widths, setWidths] = useState<Record<string, Record<number, number>>>({});
  const [widthPrompt, setWidthPrompt] = useState<{ col: number; value: string } | null>(null);
  /** FR-051 — each sheet's scroll, for the life of the panel. */
  const scrolls = useRef(new Map<string, { top: number; left: number }>());
  const seq = useRef(0);

  const onDrawnRef = useRef(onDrawn);
  onDrawnRef.current = onDrawn;
  const onFailureRef = useRef(onBodyFailure);
  onFailureRef.current = onBodyFailure;
  // 074 R4 — the chrome's passthrough to main's source route, as the PDF and image bodies read it.
  const readSourceRef = useRef(readSource);
  readSourceRef.current = readSource;

  useEffect(() => {
    onViewStateCapture(() => null);
  }, [onViewStateCapture]);

  /*
   * FR-051 (T079) — the chosen sheet, each sheet's scroll and its column widths belong to the workbook. A reused panel
   * moving to another file starts that file on its first visible sheet, even where it has a sheet of the same name. A
   * reload of the same file keeps them (FR-058): only a change of file resets them.
   */
  const shownFile = useRef(filePath);
  useEffect(() => {
    if (shownFile.current === filePath) return;
    shownFile.current = filePath;
    setSheetName(null);
    setWidths({});
    scrolls.current.clear();
  }, [filePath]);

  // Read and parse on every new source revision (FR-058).
  useEffect(() => {
    if (source === '') return;
    const id = ++seq.current;
    let live = true;
    // Absent, every read is refused (provider-view.ts), and the body shows its unreadable notice.
    void (readSourceRef.current?.() ?? Promise.resolve({ ok: false as const, status: 404 }))
      .then(async (answer) => {
        if (!live || seq.current !== id) return;
        if (!answer.ok) {
          logExpected('spreadsheet-body: read the workbook', `the source route answered ${answer.status}`, new Error(String(answer.status)));
          setLoaded({ state: 'unreadable', status: answer.status });
          setLoadedFor(source);
          return;
        }
        // A copy of exactly the file's bytes, owned here, so it can be transferred to the worker.
        const bytes = answer.bytes.slice().buffer;
        const result = await parseOffThread(bytes, id);
        if (!live || seq.current !== id) return;
        if (!result.ok) logExpected('spreadsheet-body: parse the workbook', `the workbook was refused (${result.reason}): ${result.detail}`, new Error(result.reason));
        setLoaded({ state: 'read', read: result });
        setLoadedFor(source);
      })
      .catch((error: unknown) => {
        logCaught('spreadsheet-body: read the workbook', error);
        if (live) onFailureRef.current(error);
      });
    return () => {
      live = false;
    };
  }, [panelId, source]);

  const sheets: readonly WorkbookSheet[] = loaded.state === 'read' && loaded.read.ok ? loaded.read.sheets : [];
  // FR-051, FR-058 — keep the chosen sheet while one of that name exists; else the first visible one.
  const sheet =
    sheets.find((s) => s.name === sheetName) ?? sheets.find((s) => !s.hidden) ?? sheets[0] ?? null;

  // FR-008d — the selection and scroll belong to the file: a move to another workbook shows its own, A1 on a first visit.
  useFilePlaces(gridRef, filePath, navigationSeq, loaded.state !== 'loading' && loadedFor === source);

  useEffect(() => {
    if (loaded.state !== 'loading') onDrawnRef.current(filePath);
  }, [loaded, filePath]);

  const bodyRows = useMemo(() => (sheet === null ? [] : firstRowHeader ? sheet.rows.slice(1) : sheet.rows), [sheet, firstRowHeader]);
  const header = firstRowHeader && sheet !== null ? (sheet.rows[0] ?? null) : null;
  const getCell = useCallback((row: number, col: number): string => bodyRows[row]?.[col] ?? '', [bodyRows]);
  const columnHeader = useCallback(
    (col: number): string => {
      const label = header?.[col];
      return label === undefined || label === '' ? columnLabel(col) : label;
    },
    [header],
  );

  const sheetWidths = useMemo(() => (sheet === null ? {} : (widths[sheet.name] ?? {})), [sheet, widths]);
  const setWidth = useCallback(
    (col: number, width: number) => {
      if (sheet === null) return;
      setWidths((all) => ({ ...all, [sheet.name]: { ...(all[sheet.name] ?? {}), [col]: width } }));
    },
    [sheet],
  );

  /** FR-006a — Reset Column Width: forget this sheet's width for the column, so it shows the default again. */
  const resetWidth = useCallback(
    (col: number) => {
      if (sheet === null) return;
      setWidths((all) => {
        const current = all[sheet.name];
        if (current === undefined || !(col in current)) return all;
        const next = { ...current };
        delete next[col];
        return { ...all, [sheet.name]: next };
      });
    },
    [sheet],
  );

  const switchTo =(name: string): void => {
    if (sheet !== null) {
      const pos = gridRef.current?.getScroll();
      if (pos !== undefined) scrolls.current.set(sheet.name, pos);
    }
    setSheetName(name);
  };
  useEffect(() => {
    if (sheet === null) return;
    const pos = scrolls.current.get(sheet.name);
    if (pos !== undefined) gridRef.current?.setScroll(pos);
  }, [sheet]);

  const copyFormat = settings.editor.previews.copyFormat;
  const copy = useCallback(
    (range: GridRange, format: PreviewCopyFormat = copyFormat) =>
      void copyGridRange(range, getCell, format, (copied, selected) => onCopyCapped?.(copied, selected, GRID_MAX_CELLS, 'copy')),
    [copyFormat, getCell, onCopyCapped],
  );
  const colCount = sheet?.width ?? 0;
  // FR-043a — Ctrl+G and the menus' Go to Row… open the shared Go to dialog for rows.
  const goTo = useGridGoTo(panelId, gridRef, bodyRows.length, registerGoTo);
  const onContextMenu = useCallback(
    (target: GridMenuTarget, point: { x: number; y: number }) => {
      const grid = gridRef.current;
      if (grid === null) return;
      const sel = grid.getSelection();
      const range = rangeOf(sel, colCount);
      const items = spreadsheetMenu({
        target,
        keybindings,
        ...(gridToggles !== undefined ? { toggles: gridToggles } : {}),
        actions: {
          copy: (format) => copy(range, format),
          selectAll: () => grid.selectAll(),
          goToRow: goTo.open,
          columnWidth: (col) => setWidthPrompt({ col, value: String(sheetWidths[col] ?? GRID_DEFAULT_COLUMN_WIDTH) }),
          resetWidth,
        },
      });
      openMenu(point.x, point.y, items);
    },
    [colCount, copy, goTo.open, gridToggles, keybindings, openMenu, resetWidth, sheetWidths],
  );

  // 075 FR-075b — what Print… prints: the sheet on screen, every row, read when it runs; with First row is header on,
  // that row is the table's header, repeated on every page.
  const printRead = useRef<() => GridPrintSource>(() => ({ rowCount: 0, colCount: 0, cell: () => '', header: null, width: () => undefined }));
  printRead.current = () => ({
    rowCount: bodyRows.length,
    colCount,
    cell: getCell,
    header: header === null ? null : Array.from({ length: colCount }, (_, c) => header[c] ?? ''),
    width: (col) => sheetWidths[col],
  });
  const [printRoot, printRootRef] = useState<HTMLDivElement | null>(null);
  useEffect(() => (printRoot === null ? undefined : registerGridPrintSource(printRoot, () => printRead.current())), [printRoot]);

  const submitWidth = (): void => {
    if (widthPrompt === null) return;
    const n = Number(widthPrompt.value);
    if (Number.isFinite(n)) setWidth(widthPrompt.col, Math.min(GRID_MAX_COLUMN_WIDTH, Math.max(GRID_MIN_COLUMN_WIDTH, Math.round(n))));
    setWidthPrompt(null);
    gridRef.current?.focus();
  };

  if (loaded.state === 'loading') {
    // 075 FR-043a — the placeholder everything in a preview shows while it loads (`loading-placeholder.css`).
    return (
      <div className="preview-loading preview-loading--block" data-testid={`spreadsheet-loading-${panelId}`} aria-busy="true">
        <Spinner label="Loading workbook" />
        <span>Loading workbook…</span>
      </div>
    );
  }
  if (loaded.state === 'unreadable' || !loaded.read.ok) {
    const read = loaded.state === 'read' ? loaded.read : null;
    // 413 — the file grew past the limit between main's check and this read (FR-062 names both on the banner).
    const message =
      read !== null && !read.ok
        ? REFUSAL_TEXT[read.reason]
        : loaded.state === 'unreadable' && loaded.status === 413
          ? overLimitText(providerSettings.maxPreviewBytes)
          : 'This workbook could not be read.';
    return (
      <div className="preview-grid-notice" role="alert" data-testid={`spreadsheet-notice-${panelId}`}>
        <p>{message}</p>
      </div>
    );
  }

  return (
    <div className="preview-grid-body preview-grid-body-sheets" data-testid={`spreadsheet-body-${panelId}`} ref={printRootRef}>
      <DataGrid
        key={sheet?.name ?? ''}
        ref={gridRef}
        testId={`spreadsheet-grid-${panelId}`}
        rowCount={bodyRows.length}
        colCount={colCount}
        getCell={getCell}
        columnHeader={columnHeader}
        editable={false}
        // FR-050b — an edit tried here flashes this panel's Read-only marker.
        onEditAttempt={() => requestReadOnlyFlash(panelId)}
        columnWidths={sheetWidths}
        onColumnWidthChange={setWidth}
        zoom={zoom}
        onCopy={(_sel, range) => copy(range)}
        onContextMenu={onContextMenu}
        onScrollChange={(pos) => {
          if (sheet !== null) scrolls.current.set(sheet.name, pos);
        }}
      />
      {goTo.dialog}
      <div className="preview-grid-sheets" role="tablist" aria-label="Sheets">
        {sheets.map((s) => (
          <button
            key={s.name}
            type="button"
            role="tab"
            aria-selected={s.name === sheet?.name}
            className={`preview-grid-sheet${s.hidden ? ' preview-grid-sheet-hidden' : ''}`}
            data-testid={`spreadsheet-sheet-${s.name}`}
            title={s.hidden ? `${s.name} (hidden in the workbook)` : s.name}
            onClick={() => switchTo(s.name)}
          >
            {s.hidden ? `${s.name} (hidden)` : s.name}
          </button>
        ))}
      </div>
      {widthPrompt !== null ? (
        <GridNumberPrompt
          testId={`spreadsheet-width-${panelId}`}
          label="Column width (pixels)"
          min={GRID_MIN_COLUMN_WIDTH}
          max={GRID_MAX_COLUMN_WIDTH}
          value={widthPrompt.value}
          submitLabel="Set Width"
          onChange={(value) => setWidthPrompt({ col: widthPrompt.col, value })}
          onSubmit={submitWidth}
          onCancel={() => {
            setWidthPrompt(null);
            gridRef.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}
