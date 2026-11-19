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
  enabledDescription:
    'Offer the CSV Preview Editor, the editable grid for .csv files. When off, every CSV Preview Editor closes (asking first about unsaved changes) and the preview commands for these files are shown disabled; a CSV still opens in the text editor.',
};
