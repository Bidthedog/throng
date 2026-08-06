import type { KittyKeyboardState } from '@throng/core';

/**
 * What each panel's running program has negotiated about the keyboard (028 follow-up), kept per
 * PANEL rather than per view.
 *
 * The negotiation — kitty flags, win32-input-mode — used to live on the xterm view, and an inactive
 * tab is unmounted, so every tab switch threw it away and started from zero. The program has no
 * reason to negotiate again: it did so once, at startup, and as far as it knows nothing has changed.
 * So after the first tab switch throng stopped believing the program wanted enhanced key reporting,
 * and chords silently reverted to their legacy encodings. That is the whole of "Ctrl+End worked
 * once, in one terminal".
 *
 * On the NORMAL screen this healed itself by accident: the replayed scrollback tail still contained
 * the negotiation, so re-parsing it re-enabled the protocol. That accident is gone for a full-screen
 * program, whose replay is deliberately suppressed (it was a visible flash of stale content) — which
 * is precisely the case that matters, because full-screen programs are the ones that negotiate.
 *
 * The state belongs to the session, not to a view of it. This is the smallest thing that says so.
 */
const modes = new Map<string, KittyKeyboardState>();

/** Remember what this panel's program has negotiated. */
export function saveKeyboardMode(panelId: string, state: KittyKeyboardState): void {
  modes.set(panelId, state);
}

/**
 * What this panel's program had negotiated, if anything. Read (not consumed) on mount: a panel may
 * be rebuilt many times over one program's life, and each rebuild needs the same answer.
 */
export function peekKeyboardMode(panelId: string): KittyKeyboardState | undefined {
  return modes.get(panelId);
}

/**
 * Forget it — the program is gone.
 *
 * Called when a session exits or is deliberately re-typed. Without this, the NEXT program to run in
 * the panel would inherit a negotiation it never made, and throng would send it CSI-u reports it
 * cannot read: the same class of bug in the opposite direction.
 */
export function clearKeyboardMode(panelId: string): void {
  modes.delete(panelId);
}
