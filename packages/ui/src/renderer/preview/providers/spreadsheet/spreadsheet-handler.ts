/**
 * 073 FR-055 — the spreadsheet worker's message protocol, as a plain function so a component test can run
 * it in-thread through `setGridWorkerFactory`.
 */
import type { WorkbookRead } from './workbook-read.js';

export interface WorkbookParseRequest {
  id: number;
  bytes: ArrayBuffer;
}

export type WorkbookParseReply = { id: number; read: WorkbookRead };

export function handleWorkbookParse(request: WorkbookParseRequest, read: (bytes: ArrayBuffer) => WorkbookRead): WorkbookParseReply {
  return { id: request.id, read: read(request.bytes) };
}
