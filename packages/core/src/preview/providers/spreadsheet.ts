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
import { MAX_FILE_HARD_BOUNDS } from './media-settings.js';

const MB = 1024 * 1024;

/**
 * FR-061 — the shipped preview size limit and its slider shape, in bytes (077 FR-001): 5 MB steps from 5 MB to
 * 500 MB, shown in MB.
 */
export const SPREADSHEET_SIZE_LIMIT_BYTES = { shipped: 25 * MB, min: 5 * MB, max: 500 * MB, step: 5 * MB } as const;

export const spreadsheetProvider: PreviewProviderDescriptor = {
  id: 'spreadsheet',
  displayName: 'Spreadsheet',
  previewIcon: 'previewSpreadsheet',
  // 073 FR-043a — Ctrl+G and the menus' Go to open the grid's Go to Row dialog.
  goTo: 'row',
  // 073 FR-050a — workbooks open read-only, and say so on the status bar.
  readOnly: true,
  extensions: ['.xlsx', '.xlsm', '.xlsb', '.xls', '.ods', '.fods', '.numbers'],
  kind: 'binary',
  // 075 FR-075b (the maintainer, 2026-11-20) — the grid prints as a table: every row, the header row on every page.
  print: 'document',
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
    'Offer previews of spreadsheet workbooks, such as .xlsx, .ods and .numbers. Off closes them.',
  settings: [
    {
      leaf: 'firstRowHeader',
      label: 'First row is a header',
      description: 'Show each sheet\'s first row in the column header strip instead of the column letters.',
      control: 'toggle',
      default: false,
    },
    {
      leaf: 'maxPreviewBytes',
      label: 'Preview size limit',
      description: 'The largest workbook a spreadsheet preview loads.',
      control: 'number',
      default: SPREADSHEET_SIZE_LIMIT_BYTES.shipped,
      min: SPREADSHEET_SIZE_LIMIT_BYTES.min,
      max: SPREADSHEET_SIZE_LIMIT_BYTES.max,
      step: SPREADSHEET_SIZE_LIMIT_BYTES.step,
      ...MAX_FILE_HARD_BOUNDS,
      storedUnit: 'bytes',
      display: 'MB',
    },
  ],
  maxFileBytesSetting: 'maxPreviewBytes',
};
