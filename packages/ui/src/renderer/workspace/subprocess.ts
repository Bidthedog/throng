import { collectPanels, type LayoutNode } from '@throng/core';

/**
 * Terminal/subprocess awareness for Destroy confirmations (005 / FR-018).
 *
 * The inline terminal view registers/unregisters its Panel here as it attaches /
 * ends, so {@link panelHasLiveTerminal} reflects real session state: the Destroy
 * flow routes through `terminal.kill` (FR-018) and — critically — the destroy
 * confirmation only fires for a Panel that actually hosts a running terminal.
 * A plain/empty Panel destroys immediately with no warning.
 */
const running = new Set<string>();

export function markTerminalRunning(panelId: string): void {
  running.add(panelId);
}

export function markTerminalStopped(panelId: string): void {
  running.delete(panelId);
}

/** Real state: whether this Panel currently hosts a live terminal session. */
export function panelHasLiveTerminal(panelId: string): boolean {
  return running.has(panelId);
}

/**
 * Whether destroying this Panel needs a confirmation: true only when it hosts a
 * live terminal (losing a running shell is the destructive case). A Panel with no
 * running subprocess is safe to remove without warning.
 */
export function panelHasRunningSubprocess(panelId: string): boolean {
  return panelHasLiveTerminal(panelId);
}

/** Count Panels within a node that currently host a running subprocess. */
export function runningSubprocessCount(node: LayoutNode): number {
  return collectPanels(node).filter((p) => panelHasRunningSubprocess(p.id)).length;
}
