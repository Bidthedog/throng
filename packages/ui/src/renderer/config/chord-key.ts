/**
 * The layout-independent key segment for a keyboard chord.
 *
 * throng's key bindings are matched on the produced character (`e.key`), which is
 * friendly for most keys but wrong for the **backtick** key: on a US layout
 * Shift+backtick is `~`, but on a UK (and other) layout it is `¬`, and `~` sits on
 * an entirely different physical key. So a chord meant as "Ctrl+Shift+backtick"
 * (focus cycle-back, 012) cannot be expressed as a produced character portably.
 *
 * We normalise just that one physical key — `e.code === 'Backquote'` → `` ` `` —
 * so a default like `Ctrl+Shift+`` works on every layout; the Shift modifier then
 * distinguishes cycle from cycle-back. Every other key keeps its produced-character
 * behaviour unchanged.
 */
export function chordKey(e: { code: string; key: string }): string {
  return e.code === 'Backquote' ? '`' : e.key;
}

/** Whether the event is the physical backtick key (whose Shift state is meaningful). */
export function isBackquote(e: { code: string }): boolean {
  return e.code === 'Backquote';
}
