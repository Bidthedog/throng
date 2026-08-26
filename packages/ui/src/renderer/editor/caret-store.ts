/**
 * Per-PANEL caret and selection state for the editor status bar (040 US1 — FR-004, FR-005, FR-006;
 * data-model.md §3.1, research.md D5).
 *
 * Constitution Principle XI splits an editor's state in two. The document — its content, its dirty
 * flag, its undo history, its language, its indentation — is ONE value however many panels show it.
 * The caret, the selection and the scroll position are view state and may differ per panel. These
 * readouts are squarely on the view side of that line, so this store is keyed by **panel id**, and
 * two panels showing one file report their own positions.
 *
 * That is the whole reason it is a separate store from {@link documentMetrics}, which is keyed by
 * document precisely because the counts must NOT differ between two views of one file (FR-007). Two
 * key scopes, two stores, and neither can be mistaken for the other at a call site.
 *
 * ══ WHY THE SELECTED COUNT LIVES HERE AND IS NOT ITS OWN STORE ══
 *
 * A selection is view state too, and its size is a pure function of a selection the caret update
 * already has in hand (data-model.md §3.3). Caching it separately would create a second thing that
 * can go stale against the caret it belongs to; writing it in the same call makes them one fact.
 *
 * ══ SNAPSHOT IDENTITY IS LOAD-BEARING ══
 *
 * `useSyncExternalStore` compares snapshots by identity, so {@link panelCaret} must return the SAME
 * object until something actually moves. A getter that assembles a fresh `{ position, selected }`
 * per call renders forever. Hence one stored object per panel, replaced on write, and one shared
 * {@link NO_CARET} for every panel nothing has written yet.
 */
import { useSyncExternalStore } from 'react';
import type { CaretPosition } from '@throng/core';

/** This panel's caret, and how much its selection covers. */
export interface PanelCaret {
  /** Where the caret is, in the register a text editor uses (FR-002). */
  position: CaretPosition;
  /**
   * Characters selected in this panel, or `null` for a bare caret (FR-005).
   *
   * `null` and `0` are different answers: `0` says a selection exists and covers no characters —
   * a whole-line-ending selection does — while `null` is what makes the readout ABSENT.
   */
  selected: number | null;
}

/**
 * What a panel reads before its editor has published anything.
 *
 * An empty document's caret really is at line 1, column 1 (FR-002), so this is a true answer rather
 * than a placeholder — and it is a single frozen instance so the identity check above holds for
 * every unwritten panel.
 */
export const NO_CARET: PanelCaret = Object.freeze({
  position: Object.freeze({ line: 1, column: 1 }),
  selected: null,
}) as PanelCaret;

const carets = new Map<string, PanelCaret>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/**
 * Publish this panel's caret and selection size.
 *
 * Called SYNCHRONOUSLY from the editor's update listener, inside the invocation that reported the
 * move (FR-008a) — a lagging caret position reads as a broken editor, and the work is a line
 * lookup CodeMirror has already indexed.
 */
export function setPanelCaret(
  panelId: string,
  position: CaretPosition,
  selected: number | null,
): void {
  const current = carets.get(panelId);
  if (
    current !== undefined &&
    current.position.line === position.line &&
    current.position.column === position.column &&
    current.selected === selected
  ) {
    return; // nothing moved; a needless emit is a needless render on the keystroke path
  }
  carets.set(panelId, { position, selected });
  emit();
}

/** This panel's caret, or {@link NO_CARET} if nothing has published one. */
export function panelCaret(panelId: string): PanelCaret {
  return carets.get(panelId) ?? NO_CARET;
}

/** Drop a panel's caret — called when the panel unmounts (data-model.md §3.1). */
export function forgetPanelCaret(panelId: string): void {
  if (carets.delete(panelId)) emit();
}

/** Subscribe to any panel's caret moving. */
export function subscribeCaret(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribe a component to ONE panel's caret. */
export function usePanelCaret(panelId: string): PanelCaret {
  return useSyncExternalStore(subscribeCaret, () => panelCaret(panelId));
}

/** Test-only: clear all state. */
export function __resetCaretStore(): void {
  carets.clear();
  emit();
}
