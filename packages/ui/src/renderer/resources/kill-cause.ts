/**
 * What a failed kill says (055 FR-064): the collector's cause CODE, in plain words. Never the code, and
 * never a raw error string — the failure-cause model's rule (030, 029): the cause owns the wording.
 *
 * Where the code is one of the model's own kinds the model's sentence is used, so a permission refusal
 * here reads as a permission refusal everywhere else in throng.
 */
import { causeMessage, type FailureCause } from '@throng/core';
import type { KillTargetResult } from '@throng/ipc-contract';

const DENIED: Pick<FailureCause, 'kind'> = { kind: 'permission-denied' };

/** One sentence for one target's failure. `subject` is the process's friendly name. */
export function killCauseText(result: Pick<KillTargetResult, 'outcome' | 'cause'>, subject: string): string {
  switch (result.cause) {
    case 'notUsersProcess':
      return 'It is not one of your projects’ processes, so throng will not end it.';
    case 'accessDenied':
    case 'denied':
      return causeMessage({ ...DENIED, subject, raw: '' }, { subjectPresented: true });
    case 'collectorUnavailable':
    case 'timeout':
      return 'The monitor could not reach its process reader. Try again in a moment.';
    case 'identityChanged':
      return 'That process id now belongs to a different program, so it was left alone.';
    default:
      // A target that was already gone is reported as what it is (US3/AC9), not as a refusal.
      if (result.outcome === 'gone') return 'It had already ended.';
      return result.outcome === 'denied'
        ? causeMessage({ ...DENIED, subject, raw: '' }, { subjectPresented: true })
        : 'The system would not end it.';
  }
}
