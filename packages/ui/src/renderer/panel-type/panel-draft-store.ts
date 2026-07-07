import type { FormState } from './form-state.js';

/**
 * Per-panel type-selection FORM draft, shared across windows (005). A cloned Panel
 * has the same panel id in the project and in every sub-workspace; while it is
 * untyped, all its views must show the SAME in-progress form (selected type +
 * inputs). This tiny store holds each panel's draft, notifies local subscribers
 * (so the form re-renders), and — for a LOCAL edit — broadcasts it to the other
 * windows over the `panel.notifyDraft` bridge. A received draft is applied with
 * `broadcast: false` so it does not echo back (no loop).
 *
 * Kept as a module store (like `exit-store`) so it survives the form component
 * remounting and is reachable from the cross-window sync listener.
 */
export const EMPTY_DRAFT: FormState = Object.freeze({ selectedKind: null, values: {} });

const drafts = new Map<string, FormState>();
const listeners = new Map<string, Set<() => void>>();

function emit(panelId: string): void {
  listeners.get(panelId)?.forEach((l) => l());
}

/** The panel's current draft, or the shared EMPTY_DRAFT (stable ref for useSyncExternalStore). */
export function getDraft(panelId: string): FormState {
  return drafts.get(panelId) ?? EMPTY_DRAFT;
}

/** Replace a panel's draft. A local edit (`broadcast: true`) is mirrored to the
 *  other windows; a remote-applied draft (`broadcast: false`) only updates here. */
export function setDraft(panelId: string, state: FormState, opts: { broadcast: boolean }): void {
  drafts.set(panelId, state);
  emit(panelId);
  if (opts.broadcast) window.throng?.panel?.notifyDraft?.(panelId, state);
}

/** Drop a panel's draft (on Confirm / when the Panel becomes typed). */
export function clearDraft(panelId: string): void {
  if (drafts.delete(panelId)) emit(panelId);
}

/** Subscribe to a panel's draft changes (for useSyncExternalStore). */
export function subscribeDraft(panelId: string, listener: () => void): () => void {
  let set = listeners.get(panelId);
  if (!set) {
    set = new Set();
    listeners.set(panelId, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(panelId);
  };
}
