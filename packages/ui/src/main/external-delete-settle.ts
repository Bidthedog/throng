/**
 * 081 FR-013a — how long a path that disappeared from outside throng must stay gone before an editor or a
 * standalone preview reports it missing. A tool that deletes a file and writes it again (an agent, a formatter,
 * `git checkout`) leaves a gap the folder watch sees as a delete; inside this window the path coming back is a
 * change, not a delete, and the panel reloads or offers the changed-on-disk choice (FR-013).
 *
 * A named constant, not a setting (clarification Q1): raise it here if rewrites land later than this.
 *
 * This is not the timer 019 FR-011 forbids. FR-011 forbids outlasting throng's own debounce where a bracket
 * exists: throng's own move, rename and delete open a bracket before the first filesystem call and close it
 * after, so they stay timer-free (019 FR-004, 081 FR-014). Another program's delete followed by a write cannot be
 * bracketed, so waiting a settle window is the only signal available.
 */
export const EXTERNAL_DELETE_SETTLE_MS = 500;
