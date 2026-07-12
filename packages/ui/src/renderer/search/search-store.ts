/**
 * The find session (013) — which panel the one shared find bar is open on, its term,
 * its match modes, and the current/total count.
 *
 * The store is the single place that drives a {@link SearchController}: both the bar
 * (clicks, typing) and the key bindings (Ctrl+F, F3, …) go through these actions, so
 * there is exactly one path from "user asked for the next match" to "the engine moved".
 * A reactive module store in the style of `active-pane.ts` — no prop-drilling, and the
 * non-React key handler can read and drive it too.
 */
import { useSyncExternalStore } from 'react';
import { getPanelSearch } from './search-controller.js';
import { NO_MATCHES, NO_MODES, type MatchModes, type SearchCount } from './search-model.js';

export type FindPanelKind = 'editor' | 'terminal';

export interface FindState {
  /** The panel the bar is open on; `null` when find is closed. */
  panelId: string | null;
  panelKind: FindPanelKind | null;
  /** Replace controls are revealed (editor only — FR-002). */
  replaceShown: boolean;
  term: string;
  replacement: string;
  modes: MatchModes;
  count: SearchCount;
  /** Seeded once on open, so the bar can select the text for overtyping (FR-002b). */
  seeded: boolean;
  /**
   * Bumped on EVERY open, including re-opening an already-open bar. The bar keys its
   * focus/select effect on this: without it, pressing the find chord again after clicking
   * into the content would not return focus to the input, and the term the user then typed
   * would go straight into their document.
   */
  openSeq: number;
}

const CLOSED: FindState = {
  panelId: null,
  panelKind: null,
  replaceShown: false,
  term: '',
  replacement: '',
  modes: NO_MODES,
  count: NO_MATCHES,
  seeded: false,
  openSeq: 0,
};

let state: FindState = CLOSED;
const listeners = new Set<() => void>();

function emit(next: FindState): void {
  state = next;
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getFindState(): FindState {
  return state;
}

export function useFindState(): FindState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

/** Re-run the query against the panel and record the resulting count. */
function applyQuery(next: FindState): FindState {
  const controller = next.panelId ? getPanelSearch(next.panelId) : undefined;
  if (!controller) return { ...next, count: NO_MATCHES };
  const count = controller.setQuery(next.term, next.modes);
  return { ...next, count };
}

/**
 * Open find on a panel (FR-001). Re-opening on the SAME panel keeps the term (so
 * Ctrl+F twice does not lose your search) but re-seeds from a fresh selection.
 * Opening on a different panel starts a new session — the previous panel's session
 * belongs to that panel's view (a mirrored panel keeps its own).
 */
export function openFind(
  panelId: string,
  panelKind: FindPanelKind,
  opts?: { replace?: boolean },
): void {
  const controller = getPanelSearch(panelId);
  const samePanel = state.panelId === panelId;
  const seed = controller?.seedFromSelection() ?? '';
  const term = seed.length > 0 ? seed : samePanel ? state.term : '';
  const replaceShown = opts?.replace ?? (samePanel ? state.replaceShown : false);

  emit(
    applyQuery({
      ...state,
      panelId,
      panelKind,
      replaceShown: panelKind === 'editor' ? replaceShown : false,
      term,
      replacement: samePanel ? state.replacement : '',
      modes: samePanel ? state.modes : NO_MODES,
      seeded: true,
      // Always a NEW value, so re-opening an already-open bar still re-focuses its input.
      openSeq: state.openSeq + 1,
    }),
  );
}

/** Close find: clear the highlights and hand focus back to the panel (FR-004). */
export function closeFind(): void {
  const controller = state.panelId ? getPanelSearch(state.panelId) : undefined;
  controller?.close();
  emit(CLOSED);
}

/**
 * Close find if it is open on a panel that is no longer the active one, so switching
 * panels never leaves a stray bar acting on the wrong panel (spec Edge Cases).
 *
 * Closes WITHOUT refocusing: the user has just moved to a different panel, and dragging
 * focus back into the one they left would undo the very move they made.
 */
export function closeFindIfNotOn(activePanelId: string | null): void {
  if (state.panelId === null || state.panelId === activePanelId) return;
  getPanelSearch(state.panelId)?.close({ refocus: false });
  emit(CLOSED);
}

export function setTerm(term: string): void {
  if (state.panelId === null) return;
  emit(applyQuery({ ...state, term, seeded: false }));
}

export function setReplacement(replacement: string): void {
  if (state.panelId === null) return;
  emit({ ...state, replacement });
}

export function toggleMode(mode: keyof MatchModes): void {
  if (state.panelId === null) return;
  const modes = { ...state.modes, [mode]: !state.modes[mode] };
  emit(applyQuery({ ...state, modes }));
}

export function showReplace(): void {
  if (state.panelId === null || state.panelKind !== 'editor') return;
  emit({ ...state, replaceShown: true });
}

export function findNext(): void {
  const controller = state.panelId ? getPanelSearch(state.panelId) : undefined;
  if (!controller) return;
  emit({ ...state, count: controller.findNext(), seeded: false });
}

export function findPrevious(): void {
  const controller = state.panelId ? getPanelSearch(state.panelId) : undefined;
  if (!controller) return;
  emit({ ...state, count: controller.findPrevious(), seeded: false });
}

export function replaceCurrent(): void {
  const controller = state.panelId ? getPanelSearch(state.panelId) : undefined;
  if (controller?.panelKind !== 'editor' || controller.isReadOnly()) return;
  emit({ ...state, count: controller.replaceCurrent(state.replacement), seeded: false });
}

export function replaceAll(): void {
  const controller = state.panelId ? getPanelSearch(state.panelId) : undefined;
  if (controller?.panelKind !== 'editor' || controller.isReadOnly()) return;
  emit({ ...state, count: controller.replaceAll(state.replacement), seeded: false });
}

/** A terminal's matches move as output streams in (FR-012) — record the new count. */
export function updateCount(panelId: string, count: SearchCount): void {
  if (state.panelId !== panelId) return;
  emit({ ...state, count });
}

/** Test seam: drop all session state between cases. */
export function __resetFindState(): void {
  emit(CLOSED);
}
