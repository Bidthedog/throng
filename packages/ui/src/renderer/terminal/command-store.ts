import { useSyncExternalStore } from 'react';

/**
 * Live foreground commands per terminal panel (025 FR-019), the twin of `cwd-store.ts`.
 *
 * The daemon observes which command holds each terminal and pushes `terminal.command`
 * notifications; UI-main forwards them here. Command memory reads the value at the moment a
 * terminal ends and decides whether to promote it into the Panel's memory.
 *
 * Module-level, so the single bridge subscription is shared across every panel rather than one
 * per panel — the same reason `cwd-store` is built this way.
 *
 * The value is deliberately RETAINED when a terminal detaches or the daemon stops observing
 * (FR-019f): the last thing seen running is the capture candidate, and clearing it on detach
 * would silently turn "still running" into "nothing was running" and lose the user's command.
 */
const commands = new Map<string, string | null>();
const listeners = new Set<() => void>();
let unsubscribeBridge: (() => void) | null = null;

/**
 * Register the bridge listener.
 *
 * MUST be called when a terminal MOUNTS, not when its value is first read. Subscribing lazily on
 * read meant the listener was installed at the first terminal *end* — by which point every
 * notification for that session had already been dropped, so the first capture of every renderer
 * session saw nothing and silently saved nothing. `cwd-store` escapes this only because a panel
 * header subscribes to it on mount; this store has no such reader, so it must be armed explicitly.
 */
export function ensureTerminalCommandBridge(): void {
  ensureBridge();
}

function ensureBridge(): void {
  if (unsubscribeBridge) return;
  unsubscribeBridge =
    window.throng?.terminal?.onCommand?.((e) => {
      if (commands.get(e.panelId) === e.command) return;
      commands.set(e.panelId, e.command);
      for (const l of listeners) l();
    }) ?? null;
}

/**
 * Subscribe to this panel's observed command, so it can be persisted as it changes (FR-019).
 * Returns `undefined` until the first observation arrives.
 */
export function useTerminalCommand(panelId: string): string | null | undefined {
  return useSyncExternalStore(
    (notify) => {
      ensureBridge();
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    () => commands.get(panelId),
    () => undefined,
  );
}

/**
 * The command last observed holding `panelId`'s terminal, or null when it was last seen idle.
 * `undefined` means nothing has been observed yet — which is NOT the same as idle, and callers
 * must not treat it as "nothing was running".
 */
export function peekTerminalCommand(panelId: string): string | null | undefined {
  ensureBridge();
  return commands.get(panelId);
}

/**
 * Drop a panel's observation.
 *
 * Called when a terminal COLD-STARTS, so a value observed in that panel's previous terminal can
 * never be promoted into the next one. Without this, a panel whose second terminal runs a command
 * that exits immediately re-saves the first terminal's command — which FR-017 forbids ("MUST NOT
 * be replaced by a command that has already exited").
 */
export function forgetTerminalCommand(panelId: string): void {
  commands.delete(panelId);
}
