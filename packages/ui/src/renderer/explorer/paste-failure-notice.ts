/**
 * What a paste that ended with failures says (050 FR-013, contracts/ui-surfaces §2).
 *
 * One notice for the whole run, one row per item that did not land: the item through the one subject
 * formatter (`formatSubject`, 030 FR-058 — so the 48-character bound and the folder qualifier are
 * decided in `@throng/core` and nowhere else), then the reason. The reason is the sentence the
 * engine prepared — classified by the 029 failure classes where a class applies, and the cause's own
 * wording is preferred over the raw text so an errno never reaches the screen (029 FR-018). The raw
 * text stays reachable through Copy via `copyDetail`.
 */
import {
  causeMessage,
  formatSubject,
  type NoticeSubject,
  type TransferFailure,
  type TransferResult,
} from '@throng/core';
import { formatGrouped } from '@throng/core';
import { useCallback } from 'react';
import { useNotify, type NoticeInput } from '../common/notification.js';

/** One failed item, as the row the user reads. */
export function failureRow(failure: TransferFailure): string {
  const subject: NoticeSubject = { kind: 'file', name: failure.name, dir: failure.dir };
  const reason = failure.cause
    ? causeMessage(failure.cause, { subjectPresented: true })
    : failure.message;
  return `${formatSubject(subject)}: ${reason}`;
}

const plural = (n: number): string => `${formatGrouped(n)} ${n === 1 ? 'item' : 'items'}`;

/**
 * The failure report for a finished run, or `null` when the run left nothing to report.
 *
 * `total` is the run's top-level item count when the progress feed supplied it; without it the headline
 * says how many failed and not out of how many, rather than guessing a denominator.
 */
export function pasteFailureNotice(
  result: Pick<TransferResult, 'failures' | 'rollbackFailures' | 'outcome'>,
  total?: number,
): NoticeInput | null {
  const rolledBack = result.outcome === 'rolled-back' && result.rollbackFailures.length > 0;
  const failures = rolledBack ? result.rollbackFailures : result.failures;
  if (failures.length === 0) return null;

  const k = failures.length;
  const message = rolledBack
    ? `Roll back could not restore ${plural(k)}`
    : total !== undefined && total >= k
      ? `${formatGrouped(k)} of ${plural(total)} could not be pasted`
      : `${plural(k)} could not be pasted`;

  return {
    severity: 'error',
    message,
    // A SET of items: no single subject names it (the rows name each one).
    subject: { kind: 'none' },
    details: failures.map(failureRow),
    copyDetail: failures
      .map((f) => `${f.name}: ${f.cause?.raw ?? f.message}`)
      .join('\n'),
    testId: 'paste-progress',
  };
}

/**
 * Report a finished DRAG's failures as one notice (050 FR-013, FR-019e).
 *
 * A drag has no progress card to turn into the report, so its failures are raised directly. It is a
 * hook of its own, rather than a `notify` call inside `use-explorer-data.ts`, because that file is
 * deliberately not a notice call site — its errors reach the user through `useErrorNotice` — and
 * `notice-phrases.test.ts` relies on that boundary.
 */
export function useTransferFailureReporter(): (result: TransferResult) => void {
  const { notify } = useNotify();
  return useCallback(
    (result) => {
      const failure = pasteFailureNotice(result);
      if (failure) notify({ ...failure, instanceKey: result.jobId });
    },
    [notify],
  );
}
