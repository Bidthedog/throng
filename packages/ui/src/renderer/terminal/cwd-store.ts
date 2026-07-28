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

/**
 * Record a cwd the SHELL reported (025 follow-up), rather than one the daemon observed.
 *
 * PowerShell's `Set-Location` never moves the process working directory, so the daemon's PEB read
 * can never see it. With shell integration on, the shell emits its location as an OSC 9;9 sequence
 * and this is where that lands — the same store the daemon feeds, so everything downstream
 * (the panel header, directory memory) works identically whichever way the value arrived.
 */
export function reportTerminalCwd(panelId: string, cwd: string): void {
  if (!cwd || cwds.get(panelId) === cwd) return;
  cwds.set(panelId, cwd);
  for (const l of listeners) l();
}

/**
 * Read a panel's last observed cwd without subscribing (025 FR-027). Used at the moment a
 * terminal ends, to remember the directory it was pointed at — a read, not a render.
 */
export function peekTerminalCwd(panelId: string): string | undefined {
  return cwds.get(panelId);
}

/** This panel's terminal cwd, or `undefined` until the first update arrives. */
export function useTerminalCwd(panelId: string): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => cwds.get(panelId),
    () => undefined,
  );
}
