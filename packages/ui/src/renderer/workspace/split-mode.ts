/**
 * 048 FR-021, FR-022, FR-025 — which panel, if any, is in split mode: the first stroke of a split
 * chord (`Ctrl+Shift+Alt+End`) has been pressed on it and the window dispatcher is waiting for an
 * arrow.
 *
 * Module-level rather than React state, like `panel-flash.ts`: the writer is the window dispatcher's
 * chord engine, the readers are each panel's box (the pulse) — and the endings that are not keys (a
 * menu opening, a drag starting) are plain callbacks that never see either component. Any of them
 * calls {@link endSplitMode}; the dispatcher subscribes and ends its chord engine's prefix with it, so
 * the pulse and the pending text stop together (FR-022).
 *
 * One panel at a time: starting on a panel replaces whatever was in split mode, and a restart on the
 * same panel (FR-025) is the same state, not a second mode stacked on the first.
 */
import { useSyncExternalStore } from 'react';

let current: string | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/** Put `panelId` in split mode (ending it anywhere else). */
export function startSplitMode(panelId: string): void {
  if (current === panelId) return;
  current = panelId;
  notify();
}

/** End split mode, whichever panel holds it. A no-op while idle. */
export function endSplitMode(): void {
  if (current === null) return;
  current = null;
  notify();
}

/** The panel in split mode, or `null`. */
export function getSplitModePanel(): string | null {
  return current;
}

/** Called on every start and end. Returns the unsubscribe. */
export function subscribeSplitMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether `panelId` is the panel in split mode — what its box reads to show the pulse. */
export function useSplitMode(panelId: string): boolean {
  return useSyncExternalStore(
    subscribeSplitMode,
    () => current === panelId,
    () => current === panelId,
  );
}

/** Tests only: idle, with no state carried between tests. */
export function __resetSplitMode(): void {
  current = null;
}
