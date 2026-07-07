/**
 * Per-panel last-exit info (005 Phase C, FR-017/019/020). When a terminal ends —
 * a clean/unexpected exit, or a launch failure — its Panel reverts to the
 * type-selection form; this tiny module carries the exit code / error message
 * across that revert so the returning form can keep it visible. Cleared when the
 * Panel is re-typed.
 */
export interface PanelExitInfo {
  message: string;
  code?: number | null;
  unexpected?: boolean;
}

const lastExit = new Map<string, PanelExitInfo>();

export function setPanelExit(panelId: string, info: PanelExitInfo): void {
  lastExit.set(panelId, info);
}

export function getPanelExit(panelId: string): PanelExitInfo | undefined {
  return lastExit.get(panelId);
}

export function clearPanelExit(panelId: string): void {
  lastExit.delete(panelId);
}
