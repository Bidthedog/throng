/**
 * 018 US9 / FR-061, moved to core by 041 (FR-013c) — WHAT COUNTS AS A REFUSAL.
 *
 * ══ WHY IT LIVES HERE NOW ══
 *
 * It was declared in `packages/ui/src/renderer/editor/editor-missing-notice.ts`, a RENDERER module.
 * 041 FR-013 makes the main process decide whether a file is openable BEFORE a panel is created, and
 * main cannot import from the renderer — so the enumeration had two consumers in two processes and
 * one of them could not reach it. That is Constitution II's test exactly: a pure domain decision with
 * cross-process consumers belongs in the platform-abstracted core.
 *
 * Re-exported from its old home, so no existing caller or test changes.
 *
 * ══ WHY IT IS ENUMERATED AT ALL ══
 *
 * This used to be spelt `reason !== 'binary' && reason !== 'too-large'`, in two places — a rule that
 * silently classified every OTHER reason as a missing file, including reasons that did not yet exist.
 * So the moment the load path learned to REFUSE a file on ownership grounds, the refusal was
 * announced as a file that "may have been moved, renamed, or deleted", which is not true, and then
 * SUPPRESSED for anyone with missing-file warnings off, which is worse than not true.
 *
 * It is enumerated now, and enumerated ONCE — a rule that has to be restated is a rule that will
 * eventually be restated differently.
 */

/** Reasons a file could not be opened that are NOT "the file isn't there". */
export const NOT_A_MISSING_FILE: ReadonlySet<string> = new Set([
  'binary',
  'too-large',
  'out-of-tree',
  'folder',
]);

/**
 * True when the file could not be opened because it is not there (as opposed to not permitted).
 *
 * ══ A MISSING FILE IS NOT A REFUSAL, AND 041 DEPENDS ON IT ══
 *
 * FR-015 is explicit: a missing file keeps its existing recovery path, where a panel may hold a
 * recovered buffer and be saved back to write its contents out. So `openInto` returns `open` for a
 * missing file and `refuse` only for the set above. Inverting this one predicate would silently
 * destroy something 018 shipped — the panel would never be created, and the recovered buffer with it.
 */
export function isMissingReason(reason: string): boolean {
  return !NOT_A_MISSING_FILE.has(reason);
}
