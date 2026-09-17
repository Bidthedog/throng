/**
 * What THIS window knows of each panel's navigation history (044 T148, FR-104, FR-111;
 * contracts/navigation-history.md §1, §4).
 *
 * A mirror, never an authority (Principle XI). Main's `NavigationHistoryService` owns every history and
 * broadcasts each change; `HistoryMirrorSync` writes what arrives here, and an editor mounting without a
 * load seeds it from its attach answer. Nothing in the renderer computes a history: the Back / Forward
 * buttons and menu rows read `canGoBack` / `canGoForward` from this value, and the navigate command reads
 * `targetOf` from it to ask main for a move.
 *
 * Module-level and per window, like `preview-store`: a sub-workspace window runs its own instance and is
 * fed by the same broadcast.
 */
import { useSyncExternalStore } from 'react';
import type { NavigationHistory } from '@throng/core';

const histories = new Map<string, NavigationHistory>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

/** Mirror a panel's history. `null` means main purged it: the panel has none any more. */
export function setPanelHistory(panelId: string, history: NavigationHistory | null): void {
  if (history === null) {
    if (histories.delete(panelId)) emit();
    return;
  }
  histories.set(panelId, history);
  emit();
}

/** This panel's mirrored history, read without subscribing. `undefined` while none is known. */
export function getPanelHistory(panelId: string): NavigationHistory | undefined {
  return histories.get(panelId);
}

/** This panel's mirrored history, re-rendering when it changes. */
export function usePanelHistory(panelId: string): NavigationHistory | undefined {
  return useSyncExternalStore(
    subscribe,
    () => histories.get(panelId),
    () => undefined,
  );
}

/** Tests only: every entry gone. */
export function __resetHistoryStore(): void {
  histories.clear();
  emit();
}
