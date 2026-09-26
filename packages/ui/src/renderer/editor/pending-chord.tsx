/**
 * The pending indication for a multi-key chord in the editor (046 FR-091, FR-092, FR-126).
 *
 * `commands.ts`'s two-stroke engine owns the prefix and its ending rules; this module owns only what
 * the user SEES of it. The engine publishes one state here — a prefix is pending, or a second stroke
 * just completed nothing — and {@link PendingChord}, mounted once per window from `EditorChrome`,
 * portals that into the focused editor (`.cm-editor`, CodeMirror's own positioned root), so the
 * indication sits in the editor that is waiting rather than somewhere in the window chrome.
 *
 * The wording follows VS Code's Ctrl+K chords (research R19): "(Ctrl+E) was pressed. Waiting for
 * the next key of the chord…" and "The key combination (Ctrl+E,X) is not bound." Both name every key
 * pressed so far, written as the Key Bindings editor writes the chord (FR-126: `Ctrl+E,W`).
 */
import { useSyncExternalStore, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

/** What the indication shows, and in which editor. `null` when nothing is pending or reported. */
export type PendingChordState =
  | { readonly kind: 'pending' | 'unbound'; readonly host: HTMLElement; readonly keys: string }
  | null;

let current: PendingChordState = null;
const listeners = new Set<() => void>();

/** Publish a new indication state (the chord engine in `commands.ts` is the only writer). */
export function setPendingChord(next: PendingChordState): void {
  if (next === current) return;
  current = next;
  for (const l of [...listeners]) l();
}

/**
 * Clear the indication, but only when it is still `host`'s — an ending in one editor must never
 * wipe a prefix another editor has since started.
 */
export function clearPendingChord(host: HTMLElement): void {
  if (current?.host === host) setPendingChord(null);
}

/** The current indication state (for tests and the component below). */
export function getPendingChord(): PendingChordState {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The indication's text: what was pressed, and what is (or is not) happening next. */
export function pendingChordText(state: NonNullable<PendingChordState>): string {
  return state.kind === 'pending'
    ? `(${state.keys}) was pressed. Waiting for the next key of the chord…`
    : `The key combination (${state.keys}) is not bound.`;
}

/** The indication, portalled into the editor that owns the prefix. Renders nothing otherwise. */
export function PendingChord(): ReactElement | null {
  const state = useSyncExternalStore(subscribe, getPendingChord, getPendingChord);
  if (!state || !state.host.isConnected) return null;
  return createPortal(
    <div
      className={`editor-pending-chord editor-pending-chord--${state.kind}`}
      data-testid="editor-pending-chord"
      role="status"
      aria-live="polite"
    >
      {pendingChordText(state)}
    </div>,
    state.host,
  );
}
