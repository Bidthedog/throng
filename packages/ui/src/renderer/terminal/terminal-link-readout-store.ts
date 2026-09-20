import { useSyncExternalStore } from 'react';

/**
 * 045 FR-167 (round four) — the hovered link's full target in a TERMINAL, keyed by panelId.
 *
 * Module-level for the same reason `cwd-store.ts` is: the status bar is a sibling of the xterm
 * instance inside `use-terminal.ts`'s mount effect, not its parent, so only a shared store lets the
 * effect tell the bar what the pointer is over. Set from `setHovered` alongside the existing tooltip
 * wiring; the WORDING (FR-167a's by-name resolution) is the caller's, so this store carries plain
 * text, never a `HoveredLink`.
 */
const readouts = new Map<string, string | null>();
const listeners = new Map<string, Set<() => void>>();

function notify(panelId: string): void {
  for (const listener of listeners.get(panelId) ?? []) listener();
}

/** Set on every hover/leave. A no-op when the text has not actually changed. */
export function setTerminalLinkReadout(panelId: string, text: string | null): void {
  const current = readouts.get(panelId) ?? null;
  if (current === text) return;
  readouts.set(panelId, text);
  notify(panelId);
}

/** This panel's hovered link's target, live. `null` while nothing is hovered. */
export function useTerminalLinkReadout(panelId: string): string | null {
  return useSyncExternalStore(
    (listener) => {
      let set = listeners.get(panelId);
      if (set === undefined) {
        set = new Set();
        listeners.set(panelId, set);
      }
      set.add(listener);
      return () => {
        set!.delete(listener);
        if (set!.size === 0) listeners.delete(panelId);
      };
    },
    () => readouts.get(panelId) ?? null,
    () => null,
  );
}

/** A panel closing takes its own entry with it, so a recycled panel id starts clean. */
export function clearTerminalLinkReadout(panelId: string): void {
  if (!readouts.has(panelId)) return;
  readouts.delete(panelId);
  notify(panelId);
}
