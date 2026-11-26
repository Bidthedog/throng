/**
 * The CSV provider's descriptor (073 FR-020, FR-030, FR-031; data-model §4) — the CSV Preview Editor.
 *
 * The core half only; the grid is the renderer's half, `ui/src/renderer/preview/providers/csv/`. It is
 * the one EDITABLE provider: its preview is an editable grid over the file's one document (research R1),
 * which supersedes 044 FR-020/FR-025 for this provider alone. It ships Preview as its default open action
 * (Q2: "Throng Preview Editor"), and it is not a flowing document — a grid has no source lines to keep in
 * step with an editor and no headings to go to.
 *
 * Pure data — no OS, no DOM.
 */
import { CSV_LONG_CELL_THRESHOLD } from '../../csv/cell-text.js';
import type { PreviewProviderDescriptor } from '../provider.js';



export const csvProvider: PreviewProviderDescriptor = {
  id: 'csv',
  displayName: 'CSV',
  previewIcon: 'previewCsv',
  // 073 FR-043a — Ctrl+G and the menus' Go to open the grid's Go to Row dialog.
  goTo: 'row',
  extensions: ['.csv'],
  kind: 'text',
  // 075 FR-075b (the maintainer, 2026-11-20) — the grid prints as a table: every row, the header row on every page.
  print: 'document',
  editable: true,
  defaultOpenAction: 'preview',
  // Q1/Q2 — "Open CSVs in": Throng Editor · Throng Preview Editor · Default OS Program (074 FR-016, FR-017).
  filesNoun: 'CSVs',
  previewOptionLabel: 'Throng Preview Editor',
  flowingDocument: false,
  // FR-033c — no headings and no text selection (flowingDocument), but it scrolls in step with its text editor.
  scrollSync: true,
  cellDialog: true,
  wrapToggle: true,
  lockToggles: true,
  enabledDescription:
    'Offer the CSV Preview Editor, the editable grid for .csv files. Off closes it.',
  // FR-036a, FR-036b, FR-060a — the cell dialog for long values.
  settings: [
    {
      leaf: 'editLongCellsInDialog',
      label: 'Edit long cells in a dialog',
      description:
        'Edit a cell longer than the threshold in a dialog instead of in place.',
      control: 'toggle',
      default: true,
    },
    {
      leaf: 'longCellThreshold',
      label: 'Long cell threshold',
      description: 'A cell with more characters than this opens in the cell dialog when you edit it.',
      control: 'number',
      default: CSV_LONG_CELL_THRESHOLD.shipped,
      min: CSV_LONG_CELL_THRESHOLD.min,
      max: CSV_LONG_CELL_THRESHOLD.max,
      step: 10,
      hardMin: CSV_LONG_CELL_THRESHOLD.hardMin,
      hardMax: CSV_LONG_CELL_THRESHOLD.hardMax,
      storedUnit: 'characters',
      display: 'own',
    },
    // FR-036c, FR-060c — a cell holding a line break opens in the dialog too.
    {
      leaf: 'multiLineCellsInDialog',
      label: 'Edit multi-line cells in a dialog',
      description:
        'Open a cell holding a line break in the cell dialog, however short it is.',
      control: 'toggle',
      default: true,
    },
    // FR-013, FR-060b — wrap cells.
    {
      leaf: 'wrapCells',
      label: 'Wrap cells',
      description:
        'Show every cell in full: line breaks kept, values wrapped, rows as tall as their tallest cell.',
      control: 'toggle',
      default: false,
    },
    // FR-039a, FR-060d — lock the first row and first column.
    {
      leaf: 'lockFirstRow',
      label: 'Lock first row',
      description:
        'Keep the first row in view however far you scroll down.',
      control: 'toggle',
      default: false,
    },
    {
      leaf: 'lockFirstColumn',
      label: 'Lock first column',
      description:
        'Keep the first column in view however far you scroll across.',
      control: 'toggle',
      default: false,
    },
  ],
};
