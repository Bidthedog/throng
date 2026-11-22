/**
 * 073 FR-055 — parses a workbook off the renderer's main thread. SheetJS is imported HERE and nowhere
 * else in the renderer, so it rides in the worker's own bundle and in no window chunk (FR-009).
 */
import { readWorkbook } from './workbook-read.js';
import { handleWorkbookParse, type WorkbookParseRequest } from './spreadsheet-handler.js';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkbookParseRequest>) => void) | null;
  postMessage(m: unknown): void;
};

scope.onmessage = (event) => {
  scope.postMessage(handleWorkbookParse(event.data, readWorkbook));
};
