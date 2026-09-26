/**
 * The Projects pane's imperative focus command (046 US2, FR-018), reachable from the window-level
 * keybinding handler — `explorer-commands.ts`'s pattern, one pane along.
 *
 * The Projects pane renders inside the collapsible left sidebar, so `focus.projects` may have to
 * REVEAL it before there is anything to focus: revealing is a state update, and the pane (and this
 * registration) exists only on the render after. `requestProjectsFocus` parks a request made before
 * anything is registered and honours it the instant something does — `explorer-commands.ts`'s
 * `requestExplorerFocus` restated for this pane.
 */
export interface ProjectsPanelCommands {
  /** Focus the active row — the first row with no active project, the create control with none. */
  focusActiveRow: () => void;
}

let current: ProjectsPanelCommands | null = null;
let pendingFocus = false;

export function registerProjectsPanelCommands(commands: ProjectsPanelCommands): void {
  current = commands;
  if (pendingFocus) {
    pendingFocus = false;
    commands.focusActiveRow();
  }
}

export function unregisterProjectsPanelCommands(commands: ProjectsPanelCommands): void {
  // Only the CURRENT registration may clear itself — the same re-mount ordering guard as
  // `explorer-commands.ts`.
  if (current === commands) current = null;
}

export function getProjectsPanelCommands(): ProjectsPanelCommands | null {
  return current;
}

/** Focus the pane NOW if it is mounted, else the instant it (re)registers. */
export function requestProjectsFocus(): void {
  if (current) current.focusActiveRow();
  else pendingFocus = true;
}

/** Tests only: no registration and no focus request left parked. */
export function __resetProjectsPanelCommands(): void {
  current = null;
  pendingFocus = false;
}
