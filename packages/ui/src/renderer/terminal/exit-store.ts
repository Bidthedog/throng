/**
 * Per-panel last-exit info (005 Phase C, FR-017/019/020). When a terminal ends —
 * a clean/unexpected exit, or a launch failure — its Panel reverts to the
 * type-selection form; this tiny module carries the exit code / error message
 * across that revert so the returning form can keep it visible. Cleared when the
 * Panel is re-typed.
 *
 * 011 (US1): the exit notice can be DISMISSED independently of clearing the form.
 * A `dismissed` flag hides the notice without deleting the exit record or touching
 * the form draft; a fresh exit clears the flag so the notice re-shows (recurrence).
 * The store is reactive (subscribe/emit) so a dismiss re-renders the form at once.
 */
import { useSyncExternalStore } from 'react';

export interface PanelExitInfo {
  message: string;
  code?: number | null;
  unexpected?: boolean;
}

const lastExit = new Map<string, PanelExitInfo>();
const dismissed = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function setPanelExit(panelId: string, info: PanelExitInfo): void {
  lastExit.set(panelId, info);
  // A fresh exit re-shows the notice even if a prior one was dismissed (FR-003).
  dismissed.delete(panelId);
  emit();
}

export function getPanelExit(panelId: string): PanelExitInfo | undefined {
  return lastExit.get(panelId);
}

export function clearPanelExit(panelId: string): void {
  lastExit.delete(panelId);
  dismissed.delete(panelId);
  emit();
}

/** Hide the exit notice without clearing the record or the form draft (011, US1). */
export function dismissPanelExit(panelId: string): void {
  if (lastExit.has(panelId)) {
    dismissed.add(panelId);
    emit();
  }
}

export function isPanelExitDismissed(panelId: string): boolean {
  return dismissed.has(panelId);
}

/** The exit to SHOW: present and not dismissed. */
export function getVisiblePanelExit(panelId: string): PanelExitInfo | undefined {
  return dismissed.has(panelId) ? undefined : lastExit.get(panelId);
}

export function subscribePanelExit(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Reactively read the exit notice to show for a panel (undefined when none/dismissed). */
export function useVisiblePanelExit(panelId: string): PanelExitInfo | undefined {
  return useSyncExternalStore(
    subscribePanelExit,
    () => getVisiblePanelExit(panelId),
    () => getVisiblePanelExit(panelId),
  );
}
