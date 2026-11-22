/**
 * 073 FR-023, research R4 — parses a CSV document's text off the renderer's main thread. The same core
 * parser the body runs in-thread for a small document; the model's typed arrays are transferred back,
 * not copied.
 */
import { parseCsv } from '@throng/core/csv';
import { handleCsvParse, type CsvParseRequest } from './csv-parse-handler.js';

const scope = self as unknown as { onmessage: ((e: MessageEvent<CsvParseRequest>) => void) | null; postMessage(m: unknown, t: Transferable[]): void };

scope.onmessage = (event) => {
  const { reply, transfer } = handleCsvParse(event.data, parseCsv);
  scope.postMessage(reply, transfer);
};
