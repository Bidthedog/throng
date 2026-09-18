import { LINK_IDLE_SCAN_MS } from '@throng/core';

/**
 * The terminal's IDLE SCAN — 045 FR-137 (contract §7 P13; data-model §14.2).
 *
 * FR-136 marks a link AT REST, which means knowing a path resolves before the pointer reaches it.
 * FR-071 and FR-072 forbid an existence check on the output path. This is how both hold: the rows IN
 * VIEW are scanned only once the output has been quiet for `LINK_IDLE_SCAN_MS`; a write cancels a scan
 * in progress; and a scan reads nothing but the viewport, through the same provider — and so the same
 * per-line cap and the same cache — that a hover uses (P4). While a program is streaming, nothing is
 * asked about at all.
 *
 * It knows nothing of xterm: it is told that the output went quiet, that a write happened (never its
 * data), which rows are in view, and how to scan one. So it is driven by a fake clock in a unit test,
 * and wired to `term.onWriteParsed` in `use-terminal.ts`.
 */
export interface LinkIdleScanDeps {
  /** Call `listener` once `quietMs` pass with no write; returns the unsubscribe. */
  readonly onWriteQuiet: (listener: () => void, quietMs: number) => () => void;
  /** The bare write signal — no data — so a scan in progress can stop. Optional. */
  readonly onWrite?: (listener: () => void) => () => void;
  /** The rows in view, 0-based and inclusive. */
  readonly viewportRows: () => { readonly top: number; readonly bottom: number };
  /** Scan one row (0-based): the provider's own ask, cache-backed. */
  readonly scanRow: (row: number) => void;
  /** A pass is starting — the caller may drop what the previous pass collected. */
  readonly onScanStart?: () => void;
  /** A pass reached the bottom of the viewport. */
  readonly onScanned?: () => void;
}

export interface LinkIdleScan {
  /**
   * Scan again NOW if the output is quiet — for something other than a write that changed what the
   * rows mean (an answer landing, a scroll). While output is streaming it does nothing: the quiet
   * that ends the stream will scan anyway, and asking now would be the output path asking.
   */
  rescan(): void;
  dispose(): void;
}

/** Rows scanned per turn, so a write arriving mid-scan stops it within one small slice. */
const ROWS_PER_SLICE = 8;

export function createLinkIdleScan(deps: LinkIdleScanDeps): LinkIdleScan {
  let disposed = false;
  /** True from a quiet signal until the next write: the only state in which a scan may run. */
  let quiet = false;
  /** Bumped by every write and every new pass; a slice from an older pass stops at once. */
  let pass = 0;
  let slice: ReturnType<typeof setTimeout> | undefined;

  const stop = (): void => {
    pass += 1;
    if (slice !== undefined) clearTimeout(slice);
    slice = undefined;
  };

  const start = (): void => {
    if (disposed) return;
    quiet = true;
    stop();
    const mine = pass;
    const { top, bottom } = deps.viewportRows();
    let row = Math.max(0, top);
    deps.onScanStart?.();
    const step = (): void => {
      slice = undefined;
      if (disposed || mine !== pass) return;
      const end = Math.min(bottom, row + ROWS_PER_SLICE - 1);
      for (; row <= end; row += 1) deps.scanRow(row);
      if (row <= bottom) slice = setTimeout(step, 0);
      else deps.onScanned?.();
    };
    step();
  };

  const offQuiet = deps.onWriteQuiet(start, LINK_IDLE_SCAN_MS);
  const offWrite = deps.onWrite?.(() => {
    quiet = false;
    stop();
  });

  return {
    rescan() {
      if (quiet && !disposed) start();
    },
    dispose() {
      disposed = true;
      stop();
      offQuiet();
      offWrite?.();
    },
  };
}
