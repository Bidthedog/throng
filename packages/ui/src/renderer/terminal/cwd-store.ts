import { useSyncExternalStore } from 'react';

/**
 * Live terminal working directories (012 revision), keyed by panelId. The daemon
 * polls each shell's cwd and pushes `terminal.cwd` notifications; UI-main forwards
 * them here. A panel header subscribes via {@link useTerminalCwd} to show the cwd
 * even when a full-screen program hides the prompt. Module-level so the single
 * bridge subscription is shared across every panel header (each filters by id).
 */
const cwds = new Map<string, string>();
const listeners = new Set<() => void>();
let unsubscribeBridge: (() => void) | null = null;

function subscribe(notify: () => void): () => void {
  if (!unsubscribeBridge) {
    unsubscribeBridge =
      window.throng?.terminal?.onCwd?.((e) => {
        if (cwds.get(e.panelId) === e.cwd) return;
        cwds.set(e.panelId, e.cwd);
        for (const l of listeners) l();
      }) ?? null;
  }
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

/** This panel's terminal cwd, or `undefined` until the first update arrives. */
export function useTerminalCwd(panelId: string): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => cwds.get(panelId),
    () => undefined,
  );
}
