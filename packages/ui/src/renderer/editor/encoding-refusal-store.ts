/**
 * The save refusal a view is showing (059 FR-021 … FR-023) — the renderer's COPY of the document's state.
 *
 * The refusal belongs to the document, so the authority owns it and relays it to every view of that
 * document (`saveRefused` on the editor sync channel). This store only mirrors the relay, keyed by the
 * panel the relay named; nothing here decides that a save was refused.
 *
 * One condition, one notice: a relay that arrives while the notice already stands is a REPEAT (a second
 * refused save), so it bumps `flash` instead of raising anything new.
 */
import { useSyncExternalStore } from 'react';
import type { EncodingId } from '@throng/core';

/** What the authority relays about a refused save. */
export interface SaveRefusal {
  encoding: EncodingId;
  /** The first character the encoding cannot represent. */
  char: string;
  /** 1-based. */
  line: number;
  column: number;
}

export interface ShownRefusal extends SaveRefusal {
  /** How many times the same condition was reported again while the notice stood. */
  flash: number;
}

const shown = new Map<string, ShownRefusal>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/**
 * Apply the relayed state for a panel: a refusal (raise, or flash when already shown) or `null` (cleared —
 * a successful save, or an edit that removed the character).
 */
export function applySaveRefusal(panelId: string, refusal: SaveRefusal | null): void {
  if (refusal === null) {
    if (shown.delete(panelId)) emit();
    return;
  }
  const prev = shown.get(panelId);
  shown.set(panelId, { ...refusal, flash: prev ? prev.flash + 1 : 0 });
  emit();
}

export function getSaveRefusal(panelId: string): ShownRefusal | null {
  return shown.get(panelId) ?? null;
}

/** Forget a panel's copy (the panel was destroyed). */
export function forgetSaveRefusal(panelId: string): void {
  if (shown.delete(panelId)) emit();
}

export function useSaveRefusal(panelId: string): ShownRefusal | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => shown.get(panelId) ?? null,
  );
}

/** Test seam: drop every refusal. */
export function __resetEncodingRefusals(): void {
  shown.clear();
  emit();
}
