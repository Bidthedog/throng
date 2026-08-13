import type { NoticeSubject } from '@throng/core';

import type { NoticeInput } from './notification.js';

/**
 * 030 US4 / FR-045 — RUNNING A FAILURE BANNER'S RETRY, AND SAYING SO WHEN IT COULD NOT RUN.
 *
 * ══ THE DEFECT THIS MODULE EXISTS TO CLOSE ══
 *
 * The banner used to run its attempt inside `try`/`finally` with no `catch`, on a `void`ed promise.
 * A REJECTING `onRetry` therefore settled the UI perfectly — the control re-enabled, and the banner
 * reported that the condition was still there — while losing the reason completely: nothing
 * notified, nothing logged, nothing copyable, and an unhandled rejection at the top of the renderer.
 *
 * It is reachable rather than theoretical: the editor's retry is `use-editor.ts#reloadFromDisk`,
 * which awaits a real IPC invoke, and a channel that has gone, a main process mid-teardown or a
 * handler that throws all arrive here as a rejection. In a feature whose whole subject is failures
 * not vanishing, a failure to retry that vanishes is the sharpest shape the bug has.
 *
 * ══ TWO OUTCOMES THAT LOOK THE SAME AND ARE NOT ══
 *
 *   • the attempt RAN and the condition did not clear → `false`, and NOTHING is raised. The banner
 *     is already the report of it (FR-040b's fixed sentence); a notice on top would announce the
 *     state the reader is looking at.
 *   • the attempt could not be MADE → `false` as well, because the control must not stay disabled
 *     forever (FR-045a) — but the cause is reported, because it is a different failure from the one
 *     the banner is about and nothing else on screen carries it.
 *
 * ══ WHY THE DEPENDENCY IS A PARAMETER ══
 *
 * The same reason `clipboard-copy.ts` takes `write` and `notify`: a rejected retry cannot be
 * produced from an E2E — `window.throng.editor.reload` is exposed through `contextBridge` and
 * cannot be replaced from the page, and there is no way to make a live IPC channel fail on demand.
 * With `notify` passed in, the rule is exercised at the unit layer (`tests/unit/panel-retry.test.ts`)
 * and `panel-failure-banner.tsx` is the thin binding that supplies it from the renderer.
 */

export interface RetryDeps {
  notify: (notice: NoticeInput) => void;
}

/** One wording, wherever a retry could not be attempted at all. */
const RETRY_ERROR = 'The retry could not be attempted.';

/**
 * Run `onRetry` and report its outcome; never reject, and never swallow a cause.
 *
 * Returns whether the condition CLEARED — so the caller settles its UI on a value rather than on a
 * side effect, and so `false` means the same thing whichever way the attempt ended.
 */
export async function attemptRetry(
  onRetry: () => Promise<boolean>,
  /** WHICH panel this retry was about, for the heading of the notice a rejection raises (FR-019). */
  subject: NoticeSubject,
  deps: RetryDeps,
): Promise<boolean> {
  try {
    // Called INSIDE the try: `onRetry` is typed as returning a promise, but a caller that throws
    // before its first await never produces one, and awaiting a call that already threw is too late.
    return await onRetry();
  } catch (error) {
    deps.notify({
      severity: 'error',
      subject,
      // Composes to `Couldn't retry Ghost — Main — Shell` — what was attempted, on what.
      action: 'retry',
      message: RETRY_ERROR,
      // The raw failure rides where every other raw failure rides: copied and logged, never
      // rendered (FR-034).
      copyDetail: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
