/**
 * Per-DOCUMENT fold state cache (047 US3, research R3) — the `word-wrap-store.ts` pattern applied
 * to folding.
 *
 * Fold state is a property of the DOCUMENT, not the panel (constitution Principle XI): every editor
 * or parented-preview view of the same file folds together, and this store is the per-window cache
 * a view derives from and reconfigures against when it changes. It is in-memory only, and it is NOT
 * the authority — the single original is main's fold map beside word wrap
 * (`main/editor-coordinator.ts`), because two windows on one document would otherwise each hold
 * their own answer. A local toggle updates the cache optimistically so the view redraws
 * immediately, tells the authority, and the authority relays it to every other view on the same key.
 *
 * This module does not know what a document KEY looks like — `file:<path>` for an editor or a
 * parented preview, `panel:<id>` for a standalone one (R3) — nor does it talk to IPC. Seeding
 * (`window.throng.editor.foldState`) and applying the authority's sync broadcast
 * (`window.throng.editor.onSync`, filtering on `msg.foldState?.key`) are the CALLER's job, exactly
 * as word wrap's own fetch and sync application live in `use-editor.ts` rather than in its store.
 */
import { useSyncExternalStore } from 'react';
import type { FoldState } from '@throng/core';

const folds = new Map<string, FoldState>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/**
 * Structural equality — `FoldState`'s own invariant is that `flipped` is sorted and de-duplicated
 * (`core/outline/fold-state.ts`), so two equal states already agree on order; this need not re-sort
 * to tell them apart. Reference equality would miss two independently-built states that mean the
 * same thing, which is exactly the case a sync echo and a local set both produce.
 */
function foldStatesEqual(a: FoldState | undefined, b: FoldState): boolean {
  if (a === undefined) return false;
  if (a === b) return true;
  if (a.base !== b.base || a.flipped.length !== b.flipped.length) return false;
  return a.flipped.every((slug, i) => slug === b.flipped[i]);
}

/** Read a document's fold state, seeding it from `seedDefault` on first sight. */
export function documentFoldState(docKey: string, seedDefault: FoldState): FoldState {
  const cur = folds.get(docKey);
  if (cur === undefined) {
    folds.set(docKey, seedDefault);
    return seedDefault;
  }
  return cur;
}

/** True once this document's fold state has been seen (so a caller can decide whether to seed). */
/**
 * Whether a key main relayed names the same entry as this window's `docKey`. Main keys a `file:`
 * entry by `fileKey` (editor-coordinator.ts) — forward-slashed, lower-cased — while this window keys
 * it by the path as it was spelled, so a plain `===` would drop every other window's toggle on a
 * Windows path. A `panel:` key is compared exactly: it carries an id, not a path.
 */
export function relayedKeyMatches(relayed: string, docKey: string): boolean {
  if (relayed === docKey) return true;
  if (!relayed.startsWith('file:') || !docKey.startsWith('file:')) return false;
  return relayed === docKey.replace(/\\/g, '/').toLowerCase();
}

export function hasFoldState(docKey: string): boolean {
  return folds.has(docKey);
}

/**
 * Apply a state that CAME FROM the authority. Never echoes back to main — that is the difference
 * between this and {@link setDocumentFoldState}, and getting it wrong is an infinite round trip.
 */
export function applyFoldStateFromSync(docKey: string, state: FoldState): void {
  if (foldStatesEqual(folds.get(docKey), state)) return;
  folds.set(docKey, state);
  emit();
}

/**
 * Set a document's fold state and tell the authority, which relays it to every other view on the
 * same key. `panelId` is optional so a caller can update the cache alone (tests, or a state that is
 * about to be superseded by another set in the same tick) without a round trip.
 */
export function setDocumentFoldState(docKey: string, state: FoldState, panelId?: string): void {
  if (foldStatesEqual(folds.get(docKey), state)) return;
  folds.set(docKey, state);
  emit();
  if (panelId) window.throng?.editor?.setFoldState?.(panelId, state);
}

/** Drop a document's fold state — called when no panel shows it any more. */
export function forgetFoldState(docKey: string): void {
  if (folds.delete(docKey)) emit();
}

/** Subscribe a component to a document's fold state. */
export function useDocumentFoldState(docKey: string, seedDefault: FoldState): FoldState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => documentFoldState(docKey, seedDefault),
  );
}

/** Test-only: clear all state. */
export function __resetFoldStateStore(): void {
  folds.clear();
  emit();
}
