/**
 * Active-pane focus model (006 Phase A, FR-015/016, research D7). Tracks whether
 * the user's active pane is the **Files & Folders** tree or a **workspace Panel**.
 * Panel-scoped shortcuts (Ctrl+S / Ctrl+Shift+S, and the terminal/editor panel
 * keys) are gated on a workspace Panel being active; clicking the Files pane makes
 * Ctrl+S a no-op (and highlights that pane). A tiny reactive store so the Files
 * pane can highlight itself and the keybinding handler can read the live value.
 */
import { useSyncExternalStore } from 'react';

export type ActivePane = 'files' | 'workspace';

let current: ActivePane = 'workspace';
const listeners = new Set<() => void>();

export function setActivePane(pane: ActivePane): void {
  if (current === pane) return;
  current = pane;
  for (const l of listeners) l();
}

export function getActivePane(): ActivePane {
  return current;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useActivePane(): ActivePane {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
}
