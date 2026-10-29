/**
 * How the document a view shows was read (059 FR-068) — the renderer's COPY of the document's state.
 *
 * The condition belongs to the document, so main owns it and relays it to every view of that document
 * (`readNotice` on the editor sync channel, and in `getContent` for a remount). This store only mirrors the
 * relay, keyed by the panel it named; nothing here decides how a file was read, and Dismiss asks main.
 */
import { useSyncExternalStore } from 'react';
import type { CodePageId, EncodingId } from '@throng/core';

/** What main relays: a read that may be in another encoding (`suspect`, with the code page `likely`), or a
 *  Reopen with Encoding (`reopened`). */
export interface ReadNotice {
  kind: 'suspect' | 'reopened';
  readAs: EncodingId;
  likely?: CodePageId | null;
  /** On a reopen in a code page: making it the fallback would read this file in it (FR-071). */
  fallbackHelps?: boolean;
}

const shown = new Map<string, ReadNotice>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Apply the relayed state for a panel: a notice, or `null` once it no longer applies. */
export function applyReadNotice(panelId: string, notice: ReadNotice | null): void {
  if (notice === null) {
    if (shown.delete(panelId)) emit();
    return;
  }
  shown.set(panelId, notice);
  emit();
}

/** Forget a panel's copy (the panel was destroyed). */
export function forgetReadNotice(panelId: string): void {
  if (shown.delete(panelId)) emit();
}

export function useReadNotice(panelId: string): ReadNotice | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => shown.get(panelId) ?? null,
  );
}

/** Test seam: drop every notice. */
export function __resetReadNotices(): void {
  shown.clear();
  emit();
}
