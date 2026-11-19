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
  extensions: ['.csv'],
  kind: 'text',
  editable: true,
  defaultOpenAction: 'preview',
  // Q1/Q2 — "Open CSVs in": Throng Editor · Throng Preview Editor · Default OS Program (074 FR-016, FR-017).
  filesNoun: 'CSVs',
  previewOptionLabel: 'Throng Preview Editor',
  flowingDocument: false,
  cellDialog: true,
  wrapToggle: true,
  enabledDescription:
    'Offer the CSV Preview Editor, the editable grid for .csv files. When off, every CSV Preview Editor closes (asking first about unsaved changes) and the preview commands for these files are shown disabled; a CSV still opens in the text editor.',
  // FR-036a, FR-036b, FR-060a — the cell dialog for long values.
  settings: [
    {
      leaf: 'editLongCellsInDialog',
      label: 'Edit long cells in a dialog',
      description:
        'Open a cell longer than the threshold in a dialog holding an editor, instead of editing it in place, and offer Edit in Dialog… on every cell. Each CSV Preview Editor can turn the dialog on or off for itself from its status bar; a panel that has not follows this setting.',
      control: 'toggle',
      default: true,
    },
    {
      leaf: 'longCellThreshold',
      label: 'Long cell threshold',
      description: 'A cell with more characters than this opens in the cell dialog when you double-click it or press F2 or Enter on it.',
      control: 'number',
      default: CSV_LONG_CELL_THRESHOLD.shipped,
      min: CSV_LONG_CELL_THRESHOLD.min,
      max: CSV_LONG_CELL_THRESHOLD.max,
      step: 10,
    },
    // FR-036c, FR-060c — a cell holding a line break opens in the dialog too.
    {
      leaf: 'multiLineCellsInDialog',
      label: 'Edit multi-line cells in a dialog',
      description:
        'Open a cell holding a line break in the cell dialog however short it is. When off, such a cell opens there only when it is longer than the threshold.',
      control: 'toggle',
      default: true,
    },
    // FR-013, FR-060b — wrap cells.
    {
      leaf: 'wrapCells',
      label: 'Wrap cells',
      description:
        'Show every cell in full: line breaks kept, each value wrapped to its column, and every row as tall as its tallest cell. Each CSV Preview Editor can turn wrapping on or off for itself from its status bar; a panel that has not follows this setting. Wrapping changes only how the grid draws and never edits the file.',
      control: 'toggle',
      default: false,
    },
  ],
};
