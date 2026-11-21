/**
 * 073 research R4 — the message protocol of the CSV parsing worker, as a plain function so a test can run
 * it in-thread through `setGridWorkerFactory`.
 */
import { logCaught } from '@throng/core';
import { type CsvModel } from '@throng/core/csv';

export interface CsvParseRequest {
  id: number;
  text: string;
}

export type CsvParseReply = { id: number; ok: true; model: CsvModel } | { id: number; ok: false; error: string };

export function handleCsvParse(
  request: CsvParseRequest,
  parse: (text: string) => CsvModel,
): { reply: CsvParseReply; transfer: Transferable[] } {
  try {
    const model = parse(request.text);
    return {
      reply: { id: request.id, ok: true, model },
      transfer: [
        model.recordStart.buffer,
        model.recordEnd.buffer,
        model.recordFieldStart.buffer,
        model.fieldStart.buffer,
        model.fieldEnd.buffer,
        model.fieldQuoted.buffer,
      ] as Transferable[],
    };
  } catch (error) {
    logCaught('csv-parse-worker: parse', error);
    return { reply: { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) }, transfer: [] };
  }
}
