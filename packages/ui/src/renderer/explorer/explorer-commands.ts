/**
 * The File Explorer pane's commands, reachable from the window-level keybinding handler
 * (024 US3, #85 follow-up).
 *
 * The tree's own keydown handler only fires while a DOM element inside the tree holds focus, and
 * "working in the File Explorer pane" is a broader thing than that: focus may be on the pane's
 * toolbar, on the pane container after a context-menu action, or nowhere in particular after a
 * dialog has closed. Ctrl+Z in the tree stopped working in exactly those moments — which reads as
 * undo being unreliable rather than as focus being somewhere unexpected.
 *
 * So the pane also registers its commands here, and the window-level handler dispatches them
 * whenever the ACTIVE PANE is File Explorer. The scope model already guarantees the other half:
 * `file.*` commands resolve only in the `explorer` scope, so an editor keeps its own Ctrl+Z.
 */
export interface ExplorerCommands {
  undoFileOp: () => void;
  redoFileOp: () => void;
  /**
   * 046 US2 (FR-017) — focus the tree's selected row, or its first row when nothing is selected.
   * Registered by `FileTree` while a project is open, and by `FileExplorerPane`'s empty-state
   * placeholder while none is — so `requestExplorerFocus` below always has SOMETHING to call once
   * the pane is mounted, whichever branch it is showing (contract §1).
   */
  focusSelectedOrFirst: () => void;
}

let current: ExplorerCommands | null = null;

/**
 * A focus asked for BEFORE the pane finished mounting (046, `panel-focus.ts`'s pattern).
 *
 * `focus.explorer` reveals the pane and asks for its focus in the same dispatch; revealing a
 * collapsed pane is a state update, so the pane mounts (and registers here) only on the NEXT
 * render. Rather than race that, the request is parked and honoured the moment something
 * registers. One slot, last request wins — the same reasoning `panel-focus.ts` records.
 */
let pendingFocus = false;

export function registerExplorerCommands(commands: ExplorerCommands): void {
  current = commands;
  if (pendingFocus) {
    pendingFocus = false;
    commands.focusSelectedOrFirst();
  }
}

export function unregisterExplorerCommands(commands: ExplorerCommands): void {
  // Only the CURRENT registration may clear itself: a project switch mounts the new tree before the
  // old one unmounts, so an unguarded clear on unmount would wipe the live registration.
  if (current === commands) current = null;
}

export function getExplorerCommands(): ExplorerCommands | null {
  return current;
}

/** Focus the pane NOW if it is mounted, else the instant it (re)registers (046, FR-017). */
export function requestExplorerFocus(): void {
  if (current) current.focusSelectedOrFirst();
  else pendingFocus = true;
}

/** Tests only: no registration and no focus request left parked. */
export function __resetExplorerCommands(): void {
  current = null;
  pendingFocus = false;
}
