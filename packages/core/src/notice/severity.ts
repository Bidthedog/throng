/**
 * 030 — the four severities a notice can have.
 *
 * Declared here rather than beside any one consumer because three of them need the same closed set
 * and must agree: the settings shape is keyed by it (`display-mode.ts`), the log level is derived
 * from it (`log-level.ts`), and the renderer's `NoticeInput.severity` is the same four words. A
 * second copy would drift, and the direction it drifts in is a severity that silently has no
 * configured display mode.
 */
export type NoticeSeverity = 'error' | 'warning' | 'info' | 'success';

/**
 * The set, in the order Preferences lists it — most severe first.
 *
 * Exported so callers ITERATE the severities rather than re-listing them; a hand-written list is
 * how a fifth severity would end up configurable in one place and not another.
 */
export const NOTICE_SEVERITIES: readonly NoticeSeverity[] = ['error', 'warning', 'info', 'success'];
