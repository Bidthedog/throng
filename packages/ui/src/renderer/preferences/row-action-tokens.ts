/**
 * The theme icon token behind each per-item row action (015, FR-013 / FR-009a).
 *
 * A plain, importable constant rather than three literals inlined into the JSX, because the rule
 * it carries — **three actions, three DISTINCT glyphs** — is worth asserting directly.
 *
 * The guard for it used to grep `row-actions.tsx` for `token="..."`, and it broke twice: once when
 * the tokens became function arguments, and once on CI alone, where a Windows checkout has CRLF
 * line endings and a regex written around `\n` silently matched nothing and asserted against an
 * empty object. A test that can pass locally and fail on CI for a reason that has nothing to do
 * with the behaviour is not a guard, it is a tripwire. Export the fact; assert the fact.
 *
 * Why the rule matters: all three actions now sit side by side on every row, permanently, and they
 * answer different questions — "what does Throng ship?", "what did I open this window with?",
 * "nothing, thanks". Two of them sharing a glyph would make the row lie about what a click does,
 * and there is nowhere for that lie to hide.
 */
export const ROW_ACTION_TOKENS = {
  /** Undo this one item back to the value it had when the window opened. */
  revert: 'revert',
  /** Restore this one item to the value Throng ships. Feature 014's restore-ONE token. */
  reset: 'retry',
  /** Empty this one item, where empty is a valid value for it. */
  clear: 'destroy',
} as const satisfies Record<'revert' | 'reset' | 'clear', string>;

export type RowActionName = keyof typeof ROW_ACTION_TOKENS;
