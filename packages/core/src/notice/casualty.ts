/**
 * 041 FR-007/FR-007aa — the identity a notice's list de-duplicates on.
 *
 * ══ WHY THIS EXISTS AT ALL ══
 *
 * 030 keyed the list on `panelId`, and that was complete until 041 FR-013 stopped creating a panel
 * for a refused open. A casualty with no panel has no `panelId`, so FR-007's "at most one row per
 * casualty" becomes UNSTATEABLE in the old model rather than merely unimplemented — which is the
 * whole reason #327 and #328 are one piece of work: fixing the first removes the only key the second
 * had.
 *
 * ══ THE PANEL SUPERSEDES THE PAIR (FR-007aa) ══
 *
 * FR-007 says the identity is "the subject it failed on and the reason, PLUS the panel where there is
 * one". That reads as a triple and is not one — it is a fallback, and the difference is load-bearing
 * in both directions:
 *
 *   • A COMPOSITE would break 030 FR-037a. A notice consolidates one cause or one operation
 *     (030 FR-035/FR-036), so within a single notice a given panel fails once; adding `reason` to the
 *     key could only ever split a panel that is meant to appear exactly once, "however many times its
 *     failure is reported".
 *   • THE PAIR ALONE is not enough, because two panels can legitimately fail on the same subject for
 *     the same reason and both belong in the list.
 *
 * The case that looks like a counter-example — the same panel defeated by a DIFFERENT cause — never
 * reaches here. A different cause is a different NOTICE (FR-006, 030 FR-036), decided by `groupKey`
 * before this function is asked anything. Row identity is only ever a question INSIDE one notice,
 * where the cause is already fixed.
 *
 * ══ WHY THE SEPARATOR IS A NUL ══
 *
 * A subject is a path and a reason is a word, so every PRINTABLE separator is a character one of them
 * may contain — and then `('a b', 'c')` and `('a', 'b c')` key identically, and two unrelated
 * failures silently become one row. Neither a path nor a reason can contain a NUL, so it cannot
 * collide.
 *
 * It is built with `String.fromCharCode(0)` and never written as a literal byte. A raw NUL in a source
 * file makes git classify that file as BINARY: no textual diff, no textual merge, and ripgrep skips
 * it — so every later change to it is invisible to review while the code goes on working identically.
 */
import type { AffectedCasualty } from './affected.js';

/** Not a literal byte — see the note above on what one does to a tracked file. */
const SEPARATOR = String.fromCharCode(0);

/**
 * What two reports must share to be the same casualty.
 *
 * The panel where there is one, else the subject and the reason together.
 */
export function casualtyKey(casualty: AffectedCasualty): string {
  return casualty.panelId ?? `${casualty.subject ?? ''}${SEPARATOR}${casualty.reason ?? ''}`;
}
