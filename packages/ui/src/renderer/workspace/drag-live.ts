/**
 * Whether a tab-group drag (a panel or a tab chip) is in flight in this window.
 *
 * 048 FR-080's Escape handler in `tab-group.tsx` consumes the key and re-issues it on `document` so
 * dnd-kit cancels the drag. Anything else that listens for Escape in the capture phase (the maximise
 * layer, 054 FR-074) must stand back for that whole time, or it answers the re-issued key first and the
 * drag never sees it. Module-level like `split-mode.ts`: the writer is the tab group, the readers are
 * components that share no ancestor with the drag's handlers.
 */
let live = false;

export function setTabGroupDragLive(next: boolean): void {
  live = next;
}

export function isTabGroupDragLive(): boolean {
  return live;
}
