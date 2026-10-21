import type { AttentionMark } from '@throng/core';

/**
 * This window's copy of main's attention mark set (057 R5, the `command-store.ts` pattern).
 *
 * Main owns the marks and broadcasts the WHOLE set on every change (`throng:attention:changed`), so
 * there is nothing to merge: each message replaces the snapshot. The store is module-level so the one
 * bridge subscription is shared by every holder rather than one per row, tab and panel.
 *
 * The snapshot is an immutable array replaced wholesale, which is what lets `useSyncExternalStore`
 * compare by identity; the value-compared selectors in `use-attention.ts` then keep a holder from
 * re-rendering when the set changed in a way that does not concern it.
 */
let marks: readonly AttentionMark[] = [];
const listeners = new Set<() => void>();
let unsubscribeBridge: (() => void) | null = null;

function emit(): void {
  for (const l of [...listeners]) l();
}

/**
 * Register the bridge listener, once. Called when a holder first subscribes, and by `FocusReporter` so a
 * window that shows no holder yet still receives the set the moment one mounts.
 */
export function ensureAttentionBridge(): void {
  if (unsubscribeBridge) return;
  const attention = window.throng?.attention;
  if (!attention?.onChanged) return;
  /** Bumped by every broadcast, so an answer that left before one arrived can tell it is stale. */
  let broadcasts = 0;
  unsubscribeBridge = attention.onChanged((e) => {
    broadcasts += 1;
    setAttentionMarks(e.marks);
  });
  // Main broadcasts only when the set CHANGES, so a window that opens, is torn off or reloads after marks
  // were raised would show none until the next change: ask for the current set once, on attaching. A
  // broadcast that arrives first is newer than the answer, which is then dropped.
  const seen = broadcasts;
  void attention
    .getMarks?.()
    .then((answer) => {
      if (broadcasts === seen) setAttentionMarks(answer.marks);
    })
    // A preload without it, or main gone: the next broadcast still arrives, so there is nothing to report.
    .catch(() => {});
}

/** Replace the snapshot. The bridge calls it; a test calls it to stand in for main. */
export function setAttentionMarks(next: readonly AttentionMark[]): void {
  marks = next;
  emit();
}

/** The current mark set. */
export function getAttentionMarks(): readonly AttentionMark[] {
  return marks;
}

/** Subscribe to snapshot changes; returns the unsubscriber. */
export function subscribeAttention(listener: () => void): () => void {
  ensureAttentionBridge();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only: no marks, no bridge subscription, no listeners. */
export function __resetAttentionStore(): void {
  unsubscribeBridge?.();
  unsubscribeBridge = null;
  marks = [];
  listeners.clear();
}
