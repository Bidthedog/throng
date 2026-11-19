/**
 * The Spreadsheet provider's descriptor (073 FR-050, FR-059, FR-061, FR-064; data-model §4) — a read-only
 * preview of a workbook, every sheet as a grid.
 *
 * The core half only; the renderer half reads the bytes through the confined source route and parses them
 * with SheetJS in a worker (`ui/src/renderer/preview/providers/spreadsheet/`). A binary provider, so it is
 * always standalone (044 FR-073). Its own size limit replaces the editor's for its previews (FR-062): a
 * workbook is opened to be looked at, not edited, and is often larger than a text file the editor would
 * hold.
 *
 * Pure data — no OS, no DOM.
 */
import type { PreviewProviderDescriptor } from '../provider.js';

/** FR-061 — the shipped preview size limit, in MB, and its slider shape (step 5 is 1% of the range). */
export const SPREADSHEET_SIZE_LIMIT_MB = { shipped: 25, min: 5, max: 500, step: 5 } as const;

export const spreadsheetProvider: PreviewProviderDescriptor = {
  id: 'spreadsheet',
  displayName: 'Spreadsheet',
  extensions: ['.xlsx', '.xlsm', '.xlsb', '.xls', '.ods', '.fods', '.numbers'],
  kind: 'binary',
  // Q5 — "Open spreadsheets in": Throng Preview · Default OS Program (binary, so no editor; 074 FR-016).
  filesNoun: 'spreadsheets',
  sourceMimeTypes: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel.sheet.macroEnabled.12',
    'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
    'application/vnd.ms-excel',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.spreadsheet-flat-xml',
    'application/vnd.apple.numbers',
  ],
  enabledDescription:
    'Offer previews of spreadsheet workbooks (.xlsx, .xlsm, .xlsb, .xls, .ods, .fods and .numbers). When off, every spreadsheet preview closes and their preview commands are shown disabled.',
  settings: [
    {
      leaf: 'firstRowHeader',
      label: 'First row is a header',
      description: "Show each sheet's first row in the column header strip instead of the column letters, with the data starting at its second row.",
      control: 'toggle',
      default: false,
    },
    {
      leaf: 'maxPreviewMb',
      label: 'Preview size limit (MB)',
      description: 'The largest workbook a spreadsheet preview loads. A larger one shows a notice naming its size and this limit instead.',
      control: 'number',
      default: SPREADSHEET_SIZE_LIMIT_MB.shipped,
      min: SPREADSHEET_SIZE_LIMIT_MB.min,
      max: SPREADSHEET_SIZE_LIMIT_MB.max,
      step: SPREADSHEET_SIZE_LIMIT_MB.step,
    },
  ],
  sizeLimitSetting: 'maxPreviewMb',
};
