import type { ClipboardMode, NoticeSubject } from '@throng/core';

import type { NoticeInput } from './notification.js';

/**
 * 030 US5 / FR-055 — PUTTING TEXT ON THE CLIPBOARD, AND SAYING SO WHEN IT FAILS.
 *
 * The copy control is the route the failure banner's pointer sentence LEADS with, and the route a
 * notice offers for a message no user can accurately retype. A clipboard write is an IPC round trip
 * to UI main (the clipboard is an OS resource and lives behind a seam), so it can fail — and a
 * failure here looks exactly like a success: nothing moves, nothing is said, and the user pastes
 * whatever was on the clipboard beforehand into a bug report, believing it is the error.
 *
 * A failure that reaches the user as silence is the defect this whole feature exists to close, so
 * this one is reported the way every other one is: through the notice model, naming the thing it
 * could not copy.
 *
 * ══ WHY THE DEPENDENCIES ARE PARAMETERS ══
 *
 * `write` and `notify` are passed in rather than reached for. Every vitest project here runs
 * `environment: 'node'`, so a rule buried behind `window.throng` and a React context could not be
 * exercised at all — and a REJECTED clipboard write cannot be produced from an E2E, because there
 * is no way to make a real clipboard fail on demand. `use-copy.ts` is the thin binding that supplies
 * the two from the renderer, and it lives in its own module for a duller reason: `notification.tsx`
 * calls the function below from inside the provider, so a hook here that reached back for
 * `useNotify` would make the two modules import each other at run time.
 */

export interface CopyDeps {
  /** The clipboard bridge. Optional exactly as `window.throng?.clipboard?.write` is. */
  write?: (entry: { text: string; mode: ClipboardMode }) => Promise<void>;
  notify: (notice: NoticeInput) => void;
}

/** One wording, both surfaces (FR-042d) — the notice's copy control and the banner's. */
const COPY_FAILED = 'The details could not be put on the clipboard.';

/**
 * Put `text` on the clipboard verbatim; report a failure rather than swallowing it.
 *
 * Returns whether the text reached the clipboard, so a caller can act on it — and so the rule is
 * testable as a value rather than only as a side effect.
 */
export async function copyToClipboard(
  text: string,
  /** What was being copied, for the heading of the notice a failure would raise (FR-019). */
  subject: NoticeSubject,
  deps: CopyDeps,
): Promise<boolean> {
  // Nothing to copy is not a failure to copy. Raising here would turn an inert click into an error
  // the user has to dismiss.
  if (text.length === 0) return false;
  try {
    // `verbatim` — the text goes on the clipboard exactly as it reads, with no editor line or
    // rectangle semantics attached to it (FR-054).
    if (!deps.write) throw new Error('the clipboard bridge is not available');
    await deps.write({ text, mode: 'verbatim' });
    return true;
  } catch (error) {
    deps.notify({
      severity: 'error',
      subject,
      // Composes to `Couldn't copy Ghost — Main — Shell` — what was attempted, on what. Naming the
      // clipboard instead would name the component the user did not ask about and cannot act on.
      action: 'copy',
      message: COPY_FAILED,
      // The raw failure rides where every other raw failure rides: copied and logged, never
      // rendered (FR-034).
      copyDetail: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
