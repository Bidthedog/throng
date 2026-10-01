/**
 * Split a panel by its id, from a surface that does not hold the workspace store (048 FR-015).
 *
 * The editor, terminal, preview and Find in Files panels build their right-click menus deep inside
 * their own hooks and handlers, where neither the store nor the panel's tab id is in reach — and the
 * decision they need made is simply "split THIS panel that way". The window's workspace store registers
 * the one implementation here (`WorkspaceProvider`), so every menu reaches the same `splitPanel`, in the
 * tab that actually holds the panel, without each of them threading a context through.
 *
 * Module-level, like `panel-focus.ts` and `split-mode.ts`: there is one workspace store per renderer
 * window, and a window with none (the preferences window) has nothing to split, so the call is a no-op.
 */
import type { SplitDirection } from '@throng/core';

type SplitRunner = (panelId: string, direction: SplitDirection) => void;

let runner: SplitRunner | null = null;

/** The workspace store's implementation. Returns the unregister for its cleanup. */
export function registerSplitRunner(next: SplitRunner): () => void {
  runner = next;
  return () => {
    if (runner === next) runner = null;
  };
}

/** Split `panelId` toward `direction`, in whichever of this window's tabs holds it. */
export function splitPanelById(panelId: string, direction: SplitDirection): void {
  runner?.(panelId, direction);
}
