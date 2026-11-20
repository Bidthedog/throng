/**
 * 073 research R4 — the one way a grid body starts a parsing worker (FR-023, FR-055, Principle XII).
 *
 * Production starts a module Web Worker from the given URL (Vite bundles it on its own, so its code is in
 * no eager chunk, FR-009). A component test has no `Worker`, so it replaces the factory with one that runs
 * the same handler in-thread (`setGridWorkerFactory`), and the body under test is exactly the shipped one.
 */

/** The part of a `Worker` a body uses. */
export interface GridWorker {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent | Event) => void) | null;
  terminate(): void;
}

export type GridWorkerKind = 'csv' | 'spreadsheet';

export type GridWorkerFactory = (kind: GridWorkerKind) => GridWorker;

/*
 * `new URL(…, import.meta.url)` must be written out literally at the `new Worker` call for Vite to find
 * and bundle each worker, so the two kinds are two literal calls rather than a lookup.
 */
const productionFactory: GridWorkerFactory = (kind) =>
  kind === 'csv'
    ? (new Worker(new URL('../preview/providers/csv/csv-parse-worker.ts', import.meta.url), { type: 'module' }) as GridWorker)
    : (new Worker(new URL('../preview/providers/spreadsheet/spreadsheet-worker.ts', import.meta.url), {
        type: 'module',
      }) as GridWorker);

let factory: GridWorkerFactory = productionFactory;

export function createGridWorker(kind: GridWorkerKind): GridWorker {
  return factory(kind);
}

/** Tests only: replace the factory; `null` restores production. */
export function setGridWorkerFactory(next: GridWorkerFactory | null): void {
  factory = next ?? productionFactory;
}
