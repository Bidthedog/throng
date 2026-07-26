/**
 * The Files & Folders pane's commands, reachable from the window-level keybinding handler
 * (024 US3, #85 follow-up).
 *
 * The tree's own keydown handler only fires while a DOM element inside the tree holds focus, and
 * "working in the Files & Folders pane" is a broader thing than that: focus may be on the pane's
 * toolbar, on the pane container after a context-menu action, or nowhere in particular after a
 * dialog has closed. Ctrl+Z in the tree stopped working in exactly those moments — which reads as
 * undo being unreliable rather than as focus being somewhere unexpected.
 *
 * So the pane also registers its commands here, and the window-level handler dispatches them
 * whenever the ACTIVE PANE is Files & Folders. The scope model already guarantees the other half:
 * `file.*` commands resolve only in the `explorer` scope, so an editor keeps its own Ctrl+Z.
 */
export interface ExplorerCommands {
  undoFileOp: () => void;
  redoFileOp: () => void;
}

let current: ExplorerCommands | null = null;

export function registerExplorerCommands(commands: ExplorerCommands): void {
  current = commands;
}

export function unregisterExplorerCommands(commands: ExplorerCommands): void {
  // Only the CURRENT registration may clear itself: a project switch mounts the new tree before the
  // old one unmounts, so an unguarded clear on unmount would wipe the live registration.
  if (current === commands) current = null;
}

export function getExplorerCommands(): ExplorerCommands | null {
  return current;
}
