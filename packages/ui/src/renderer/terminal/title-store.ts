import { useSyncExternalStore } from 'react';

/**
 * Live terminal window titles (US10, #89), keyed by panelId. Unlike the cwd (which the daemon
 * polls and pushes over the bridge), the title is announced client-side by the shell/program via
 * OSC 0/2 and surfaced by xterm's `onTitleChange` — so it is set here directly from the terminal
 * component, no bridge involved. A panel header subscribes via {@link useTerminalTitle} to show the
 * live title. Module-level so every panel header shares one subscription and filters by id.
 *
 * The title is UNTRUSTED PTY output rendered in the app's chrome: it is stored as plain text (React
 * escapes it on render — no markup passthrough) and LENGTH-CAPPED here so a program setting a
 * pathological multi-kilobyte title cannot break the header layout.
 */
const MAX_TITLE_LEN = 256;
const titles = new Map<string, string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Record the terminal's reported title for a panel (capped). Empty string clears it. */
export function setTerminalTitle(panelId: string, raw: string): void {
  const next = raw.slice(0, MAX_TITLE_LEN);
  if (!next) {
    if (titles.delete(panelId)) emit();
    return;
  }
  if (titles.get(panelId) === next) return;
  titles.set(panelId, next);
  emit();
}

/** Drop a panel's title when its terminal is disposed. */
export function clearTerminalTitle(panelId: string): void {
  if (titles.delete(panelId)) emit();
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

/** This panel's live terminal title, or `undefined` when none has been reported. */
export function useTerminalTitle(panelId: string): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => titles.get(panelId),
    () => undefined,
  );
}
