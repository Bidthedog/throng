/**
 * Start the inline rename of the active tab from outside the strip — the `tabs.rename` chord
 * (067 FR-075).
 *
 * A module-level registration for the reason `tab-picker.tsx` and `panel-destroy.ts` give: the chord is
 * resolved by the window-level keydown listener, which has no route into a component's state. The tab
 * strip registers how; the chord and the strip's own double-click then start the SAME rename.
 *
 * `returnFocusTo` is the panel that held the keyboard when the chord was pressed, so that committing or
 * cancelling can hand the keyboard back to it (FR-077). A rename started any other way passes nothing
 * and returns nothing.
 */
let opener: ((returnFocusTo: string | null) => void) | null = null;

/** Register (or clear, with `null`) how the active tab's rename starts. */
export function registerTabRename(open: ((returnFocusTo: string | null) => void) | null): void {
  opener = open;
}

/** Start the rename. Returns whether anything was listening — no strip mounted is a no-op. */
export function requestTabRename(returnFocusTo: string | null): boolean {
  if (!opener) return false;
  opener(returnFocusTo);
  return true;
}
