/**
 * Which keys a TERMINAL hands to throng instead of to the shell (013).
 *
 * xterm handles Ctrl+F, F3, Escape and friends itself and writes them to the pty, so a
 * terminal must explicitly refuse the ones that belong to find. But refusing them all,
 * all of the time, would break the shell: **Escape** closes find — and also leaves vim's
 * insert mode, dismisses a menu, cancels a readline edit; **Ctrl+H** opens replace — and
 * is also backspace. Keys like those may only be taken while there is actually a find
 * session to take them for.
 *
 * So reservation is decided per keypress, from the live find state:
 *
 * - `search.find` and the scrollback-navigation keys are ALWAYS ours: they are how find is
 *   opened and how the viewport is moved, and neither has a meaning at the shell we would
 *   be stealing (the scrollback keys are the conventional terminal ones).
 * - `search.close` / `search.findNext` / `search.findPrevious` are ours ONLY while a find
 *   session is open on this panel. With no bar up, Escape and F3 go to the program.
 * - The replace commands are never a terminal's: replace is an editor affordance, and their
 *   default chords (Ctrl+H, Alt+Enter) mean something at a shell.
 */
import type { ActionId } from '@throng/core';

export const SEARCH_ACTIONS: readonly ActionId[] = [
  'search.find',
  'search.findNext',
  'search.findPrevious',
  'search.close',
  'search.replace',
  'search.replaceCurrent',
  'search.replaceAll',
];

export const SCROLLBACK_ACTIONS: readonly ActionId[] = [
  'terminal.scrollLineUp',
  'terminal.scrollLineDown',
  'terminal.scrollPageUp',
  'terminal.scrollPageDown',
  'terminal.scrollToTop',
  'terminal.scrollToBottom',
];

const ALWAYS_OURS = new Set<ActionId>(['search.find', ...SCROLLBACK_ACTIONS]);

/** Ours only while a find session is live on the panel — otherwise the program's. */
const OURS_WHILE_FINDING = new Set<ActionId>([
  'search.close',
  'search.findNext',
  'search.findPrevious',
]);

/**
 * True when a terminal must NOT deliver this key to the running program because throng
 * is going to act on it (FR-010 / FR-014 / SC-002).
 */
export function reservedByTerminal(action: ActionId | null, findOpen: boolean): boolean {
  if (action === null) return false;
  if (ALWAYS_OURS.has(action)) return true;
  return findOpen && OURS_WHILE_FINDING.has(action);
}
