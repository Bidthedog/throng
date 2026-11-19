import type { TerminalToggleId } from '@throng/core';

/**
 * 076 FR-006, research R6 — how a toggle COMMAND reaches the terminal panel it is for.
 *
 * The window dispatcher resolves the focused panel; the panel owns the flip (resolve, commit, report a failed
 * write, withdraw marks). Each mounted terminal panel registers its flip here, so the command, the status-bar
 * toggle and the menu item all run the one implementation.
 */
type Flip = (id: TerminalToggleId) => void;

const flips = new Map<string, Flip>();

/** Register a panel's flip. Returns the un-register, which leaves a newer registration for the panel alone. */
export function registerTerminalToggles(panelId: string, flip: Flip): () => void {
  flips.set(panelId, flip);
  return () => {
    if (flips.get(panelId) === flip) flips.delete(panelId);
  };
}

/** Run a toggle on a panel. False when no terminal is registered for it: nothing to act on (048 FR-092). */
export function runTerminalToggle(panelId: string, id: TerminalToggleId): boolean {
  const flip = flips.get(panelId);
  if (!flip) return false;
  flip(id);
  return true;
}
