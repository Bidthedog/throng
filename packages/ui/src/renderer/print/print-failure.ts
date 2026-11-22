/**
 * 075 FR-080 — a Print… that cannot reach Print Preview says so, once, in the window that started it.
 *
 * Two ways it fails before Print Preview exists to report anything: the printable cannot be built (the provider or the
 * bridge threw), or main refuses the request (too large, or not a printable it accepts) and names why. Either is one
 * notice naming the file and the cause, and a line in the diagnostic log. Main answering `{ opened: false }` with no
 * cause is not a failure: Print Preview was already open and was brought forward (FR-071).
 */
import { useCallback, useRef } from 'react';
import { formatGrouped, logExpected, PRINT_DOCUMENT_MAX_LENGTH } from '@throng/core';
import { useNotifyOptional } from '../common/notification.js';

/** Told when Print… failed for the document titled `title`, with the cause in the user's words. */
export type PrintFailed = (title: string, cause: string) => void;

/** The cause when the printable could not be built or the request did not reach main. */
export const PRINT_NOT_READY = 'It could not be made ready to print.';

/**
 * 075 FR-080 (maintainer, 2026-11-22: "throng waits for a long time before giving me any feedback") — a PDF whose
 * drawn pages pass what a print can carry, found while drawing them: the drawing stops at the page that passes it,
 * rather than drawing every page for main to refuse afterwards. `fitting` pages fit, of `total`.
 */
export class PrintTooLarge extends Error {
  constructor(
    readonly fitting: number,
    readonly total: number,
  ) {
    super(
      `This PDF is too large to print: a print holds at most ${formatGrouped(PRINT_DOCUMENT_MAX_LENGTH / 1024 / 1024)} MB of drawn pages, ` +
        `and this one's first ${formatGrouped(fitting)} of its ${formatGrouped(total)} pages fill it.`,
    );
    this.name = 'PrintTooLarge';
  }
}

/** The testId of the notice: one condition, one notice; a repeat flashes it. */
export const PRINT_FAILED_TEST_ID = 'print-failed';

/** Report a failed Print… from a component; stable across renders, so it can sit in an effect's closure. */
export function usePrintFailureNotice(): PrintFailed {
  const notifier = useNotifyOptional();
  const latest = useRef(notifier);
  latest.current = notifier;
  return useCallback((title: string, cause: string) => {
    logExpected('print: open Print Preview', 'the document could not be printed; the user is told in a notice', new Error(`${title}: ${cause}`));
    latest.current?.notify({
      severity: 'error',
      subject: { kind: 'file', name: title },
      action: 'print',
      message: cause,
      testId: PRINT_FAILED_TEST_ID,
    });
  }, []);
}
