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

// `panel.rename` joins them: F2 renames the panel, and a terminal must not also hand it to the
// program. It is safe to take unconditionally for the reason `search.close` is not — F2 has no
// meaning at a shell prompt that a user could be relying on, whereas Escape plainly does.
// `terminal.redraw` (028, Ctrl+F5) joins them for the same reason as `panel.rename`: throng acts on
// the chord, so the program must not also receive it. Ctrl+F5 is not in the constitution's reserved
// tier and no shell reads it as a line-editing key, which is why it is takeable at all — but it IS a
// key a full-screen program could receive, so the shadow is recorded as an exception, not assumed
// free (Principle IV).
const ALWAYS_OURS = new Set<ActionId>([
  'search.find',
  'panel.rename',
  'terminal.redraw',
  ...SCROLLBACK_ACTIONS,
]);

/** Ours only while a find session is live on the panel — otherwise the program's. */
const OURS_WHILE_FINDING = new Set<ActionId>([
  'search.close',
  'search.findNext',
  'search.findPrevious',
]);

/**
 * True when a terminal must NOT deliver this key to the running program because throng
 * is going to act on it (FR-010 / FR-014 / SC-002).
 *
 * ## Why 016's dispatch SCOPE does not replace this, and must not be made to
 *
 * It looks like a hard-coded scope table that `COMMAND_SCOPES` now subsumes, and 016's T093 said
 * exactly that. It isn't, and here is the difference: scope answers *"is this command live here?"*,
 * while this answers *"does throng take this key, or does the SHELL?"* — and those are not the same
 * question, because a key can belong to a command that is live in a terminal and STILL belong to
 * the program.
 *
 * Substituting `resolveAction(kb, ev, 'terminal') !== null` for this would break three things at
 * once, all of them silently:
 *
 *   • `search.replace` is scoped to panels, so it resolves in a terminal — and its default chord is
 *     **Ctrl+H, which is BACKSPACE**. throng would eat every backspace at the shell.
 *   • `editor.save` is scoped to panels too, and **Ctrl+S is XOFF**. throng would take it, and the
 *     user could never pause terminal output again.
 *   • `search.close` resolves whether or not a bar is open, and it is **Escape** — vim's insert mode,
 *     a menu, a readline edit. With no find session up, Escape is not ours to take.
 *
 * So the default here is DENY: the shell keeps the key unless there is a specific reason to take it.
 * Scope narrows what may reach this function; it cannot decide what this function decides.
 */
export function reservedByTerminal(
  action: ActionId | null,
  findOpen: boolean,
  /**
   * The running program owns the keyboard (028 follow-up): it has negotiated enhanced key reporting,
   * or it is painting the alternate screen.
   *
   * Reported from Claude Code running in a throng terminal: `Ctrl+End` "doesn't register at all".
   * It is bound to `terminal.scrollToBottom` and reserved unconditionally, so the program never sees
   * it — and inside a full-screen program that binding has nothing to do anyway, because the
   * alternate screen HAS no scrollback to scroll. Reserving it there costs the user a key and buys
   * them nothing.
   */
  programOwnsKeyboard = false,
): boolean {
  if (action === null) return false;
  // Scrollback navigation is throng's only while there is scrollback to navigate and nobody has
  // asked for the keyboard. The wheel still scrolls, and `search.find` / `panel.rename` stay ours
  // either way — they are about throng's window, not about the text.
  if (programOwnsKeyboard && SCROLLBACK_ACTIONS.includes(action)) return false;
  if (ALWAYS_OURS.has(action)) return true;
  return findOpen && OURS_WHILE_FINDING.has(action);
}
