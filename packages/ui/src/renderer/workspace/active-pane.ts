/**
 * Active-pane focus model (006 Phase A, FR-015/016, research D7; widened 046 FR-015). Tracks
 * whether the user's active pane is the **File Explorer** tree, a **workspace Panel**, or the
 * **Projects** pane. Panel-scoped shortcuts (Ctrl+S / Ctrl+Shift+S, and the terminal/editor panel
 * keys) are gated on a workspace Panel being active; clicking the File Explorer or Projects pane
 * makes Ctrl+S a no-op (and highlights that pane). A tiny reactive store so a side pane can
 * highlight itself and the keybinding handler can read the live value.
 */
import { useSyncExternalStore } from 'react';

export type ActivePane = 'files' | 'workspace' | 'projects';

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

/**
 * FR-082, narrowed by Supersession S26 (spec 046, controller ruling `bb0e3e85`) — a switch made
 * while the PROJECTS LIST is the active pane (a click/Enter on a row, or `project.next`/`previous`
 * pressed FROM the Projects pane) never claims the workspace on its own; the active pane stays on
 * the list. A switch made from the workspace — `project.next`/`previous` pressed while a panel holds
 * focus — is NOT this route: it still delivers focus into the new project's active panel exactly as
 * before (023 FR-030 / #144, `editor-caret-persist.e2e.ts`). Only the workspace's own routes
 * (a pointer-down inside it, `focus.*`, and now this one) claim it.
 *
 * `projects-store.tsx`'s `switchProject` marks the TARGET project's id here ONLY when
 * `getActivePane() === 'projects'` at the moment of the call — the one check that tells a
 * list-initiated switch and a chord-from-the-workspace switch apart, since both reach the SAME
 * `switchProject`. `PanelFocusSync`'s effect (`app.tsx`) consumes it as soon as ITS OWN layout
 * settles (`layout?.projectId` matches), regardless of whether that produces any observable
 * `activeTabId` change or the project even has a tab with a panel to focus at all — a switch INTO a
 * project with no tabs (or whose active tab holds no panel) must not leave a stale mark to wrongly
 * suppress the workspace claim for whatever `activeTabId` change comes next (an ordinary same-project
 * tab change, Ctrl+Tab/`tab-picker.tsx`, which must still claim the workspace as before, `52d8f13d`).
 */
let pendingSwitchProjectId: string | null = null;

export function markProjectSwitchPending(projectId: string): void {
  pendingSwitchProjectId = projectId;
}

/** Unconditionally drops any pending mark — the switch it was for has been abandoned (the daemon
 *  refused it), so nothing should still be waiting to consume it. */
export function clearProjectSwitchPending(): void {
  pendingSwitchProjectId = null;
}

/**
 * True (and clears the mark) when `projectId` is the pending switch's OWN target. `null` — no
 * layout yet, or nothing pending — never matches.
 */
export function consumeProjectSwitchPendingFor(projectId: string | null): boolean {
  if (projectId !== null && pendingSwitchProjectId === projectId) {
    pendingSwitchProjectId = null;
    return true;
  }
  return false;
}
