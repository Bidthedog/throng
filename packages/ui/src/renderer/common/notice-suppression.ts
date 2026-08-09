/**
 * 029 FR-019 — one cause, one notice.
 *
 * Kept as a plain module rather than living inside {@link NotificationProvider} so the rule is
 * unit-testable without a DOM (every vitest project here runs `environment: 'node'`). Same shape as
 * `terminal/exit-store.ts`, for the same reason.
 *
 * ══ WHAT THIS COLLAPSES, AND WHAT IT MUST NOT ══
 *
 * Measured on master: a missing project root raises TWO notices for ONE absent folder — an
 * `ENOENT: … realpath` from the file tree and an `Internal error: Cannot lock …` from a terminal
 * trying to attach. One problem, told twice, in two vocabularies, neither naming the folder.
 *
 * But `notice-stacking.e2e.ts` proves two DIFFERENT failures must still be two notices — that was
 * itself a fix (#178), where the model dropped any live notice sharing a test id and silently chose
 * which of the user's two problems to report. So the key must be exactly as coarse as "the same
 * underlying cause" and no coarser: kind + subject, never the surface and never the message text.
 */

/**
 * Is this cause already on screen?
 *
 * `liveKeys` are the cause keys of the notices currently displayed — which is what bounds
 * suppression to the notice's own lifetime (FR-019c). A dismissed notice is simply not in the list,
 * so the cause re-arms with no timer and no correlation id to maintain.
 */
export function shouldSuppressForCause(liveKeys: readonly string[], incomingKey: string | undefined): boolean {
  // FR-011b: a failure matching none of the five kinds has NO cause, and must keep today's
  // behaviour. Suppressing on a falsy key would silently collapse unrelated raw errors into one —
  // the opposite of the requirement, and invisible when it happened.
  if (!incomingKey) return false;
  return liveKeys.includes(incomingKey);
}
