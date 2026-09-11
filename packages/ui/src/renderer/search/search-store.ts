/**
 * Find sessions (013, reshaped by 043 US1 / #220) — ONE SESSION PER PANEL.
 *
 * The store is the single place that drives a {@link SearchController}: both the bar
 * (clicks, typing) and the key bindings (Ctrl+F, F3, …) go through these actions, so
 * there is exactly one path from "user asked for the next match" to "the engine moved".
 * A reactive module store in the style of `active-pane.ts` — no prop-drilling, and the
 * non-React key handler can read and drive it too.
 *
 * ══ WHAT 043 CHANGED, AND WHY ══
 *
 * This used to be `let state: FindState = CLOSED` — ONE session for the whole window — and
 * `openFind` discarded the previous panel's term, replacement and modes whenever the panel
 * changed. Search in editor A, click into editor B, come back, and the search was gone (#220).
 *
 * It is now `Map<panelId, FindSession>` plus a separate `showingFor` pointer, modelled on the
 * controller registry in `search-controller.ts`, which was already per-panel. Three rules follow,
 * and they are the whole of User Story 1:
 *
 *   1. `showingFor` is PRESENTATION ONLY. Moving it hides one bar and shows another; it never
 *      mutates a session and never touches an engine (FR-002).
 *   2. Every action takes a `panelId`. No action reads "the current session" — that coupling is
 *      exactly where the defect lived (FR-003).
 *   3. A session's lifetime is its PANEL's: created on first open, kept across a hide, kept across
 *      a MOVE (a detach into a sub-workspace unmounts the panel and unregisters its controller —
 *      neither destroys it, FR-025b), and discarded only on `closeFind` or panel destroy (FR-006).
 */
import { useSyncExternalStore } from 'react';
import { getPanelSearch, unregisterPanelSearch } from './search-controller.js';
import { NO_MATCHES, NO_MODES, type MatchModes, type SearchCount } from './search-model.js';

export type FindPanelKind = 'editor' | 'terminal';

/** One panel's find session. Its lifetime is that panel's (FR-001 / FR-006). */
export interface FindSession {
  readonly panelId: string;
  readonly panelKind: FindPanelKind;
  /** Replace controls are revealed (editor only — 013 FR-002). */
  readonly replaceShown: boolean;
  readonly term: string;
  readonly replacement: string;
  readonly modes: MatchModes;
  readonly count: SearchCount;
  /** Seeded on open, so the bar can select the text for overtyping (013 FR-002b). */
  readonly seeded: boolean;
  /**
   * Bumped on EVERY open of THIS panel's bar, including re-opening one already up. The bar keys
   * its focus/select effect on it: without it, pressing the find chord again after clicking into
   * the content would not return focus to the input, and the term the user then typed would go
   * straight into their document.
   */
  readonly openSeq: number;
}

/**
 * The presentation view the bar and the terminal's key reservation read: which panel's bar is
 * showing, and that session's fields. `panelId: null` means NO bar is showing — which is no longer
 * the same statement as "no session exists", and that difference is the feature.
 */
export interface FindState {
  panelId: string | null;
  panelKind: FindPanelKind | null;
  replaceShown: boolean;
  term: string;
  replacement: string;
  modes: MatchModes;
  count: SearchCount;
  seeded: boolean;
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

const sessions = new Map<string, FindSession>();
let showingFor: string | null = null;
/**
 * The projection `getFindState` hands out, recomputed once per change rather than per read.
 * `useSyncExternalStore` compares snapshots by IDENTITY, so building a fresh object on every read
 * would re-render forever.
 */
let shown: FindState = CLOSED;
const listeners = new Set<() => void>();

function project(): FindState {
  const s = showingFor === null ? undefined : sessions.get(showingFor);
  return s ? { ...s } : CLOSED;
}

function emit(): void {
  shown = project();
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * The session showing right now, projected onto the flat shape (or {@link CLOSED}).
 *
 * A read-only OBSERVATION seam, deliberately not a hook: a component that renders find state wants
 * `useVisibleFindSession(panelId)` — its own panel's — and reaching for "whichever bar is up" is
 * the coupling 043 removed.
 */
export function getFindState(): FindState {
  return shown;
}

/** One panel's session, whether or not its bar is showing. */
export function getFindSession(panelId: string): FindSession | undefined {
  return sessions.get(panelId);
}

/** Which panel's bar is visible; `null` when none is (FR-002). */
export function findShowingFor(): string | null {
  return showingFor;
}

/** True while THIS panel's bar is the one on screen. */
export function isFindShowingOn(panelId: string | null): boolean {
  return panelId !== null && showingFor === panelId;
}

/**
 * The session a bar should draw: its own panel's, and only while that bar is the visible one.
 * A single subscription, and a snapshot whose identity changes only when this panel's session does.
 */
export function useVisibleFindSession(panelId: string): FindSession | null {
  const read = (): FindSession | null =>
    showingFor === panelId ? (sessions.get(panelId) ?? null) : null;
  return useSyncExternalStore(subscribe, read, read);
}

/** Re-run a session's query against its panel and record the resulting count. */
function applyQuery(session: FindSession): FindSession {
  const controller = getPanelSearch(session.panelId);
  if (!controller) return { ...session, count: NO_MATCHES };
  return { ...session, count: controller.setQuery(session.term, session.modes) };
}

/** Write a session back, but only if it still exists — an action racing a destroy resurrects none. */
function update(panelId: string, next: (session: FindSession) => FindSession): void {
  const current = sessions.get(panelId);
  if (!current) return;
  sessions.set(panelId, next(current));
  emit();
}

/**
 * Open find on a panel (013 FR-001), and show its bar.
 *
 * Re-opening on a panel that already has a session KEEPS that session — term, replacement and
 * modes — and merely re-seeds it from a fresh selection. Opening on a DIFFERENT panel now leaves
 * the first panel's session exactly where it was: that discard was #220.
 */
export function openFind(
  panelId: string,
  panelKind: FindPanelKind,
  opts?: { replace?: boolean },
): void {
  const controller = getPanelSearch(panelId);
  const existing = sessions.get(panelId);
  const seed = controller?.seedFromSelection() ?? '';
  const term = seed.length > 0 ? seed : (existing?.term ?? '');
  const replaceShown = opts?.replace ?? existing?.replaceShown ?? false;

  sessions.set(
    panelId,
    applyQuery({
      panelId,
      panelKind,
      replaceShown: panelKind === 'editor' ? replaceShown : false,
      term,
      replacement: existing?.replacement ?? '',
      modes: existing?.modes ?? NO_MODES,
      count: NO_MATCHES,
      seeded: true,
      // Always a NEW value, so re-opening an already-open bar still re-focuses its input.
      openSeq: (existing?.openSeq ?? 0) + 1,
    }),
  );
  showingFor = panelId;
  emit();
}

/**
 * Close find ON ONE PANEL (FR-005): clear that panel's highlights, hand focus back to it, and
 * discard its session. Every other panel's session is untouched — Escape in A must not close B.
 */
export function closeFind(panelId: string): void {
  getPanelSearch(panelId)?.close();
  sessions.delete(panelId);
  if (showingFor === panelId) showingFor = null;
  emit();
}

/**
 * Follow the active panel: show ITS session's bar, or none (FR-002 / FR-004).
 *
 * This is a HIDE, not a close. It sets `showingFor` and nothing else — no session is mutated and
 * no engine is told anything, which is what lets the user come back to a panel and find their
 * search exactly as they left it, current match included. It used to `emit(CLOSED)` and call
 * `controller.close({ refocus: false })`, and that is the half of #220 the bar itself could see.
 *
 * It also RESTORES: a panel that becomes active and already has a session shows it again with no
 * chord pressed, which is US1 scenario 1's "and then returns to A".
 */
export function followActivePanel(activePanelId: string | null): void {
  const next = activePanelId !== null && sessions.has(activePanelId) ? activePanelId : null;
  if (next === showingFor) return;
  showingFor = next;
  emit();
}

export function setTerm(panelId: string, term: string): void {
  update(panelId, (s) => applyQuery({ ...s, term, seeded: false }));
}

export function setReplacement(panelId: string, replacement: string): void {
  update(panelId, (s) => ({ ...s, replacement }));
}

export function toggleMode(panelId: string, mode: keyof MatchModes): void {
  update(panelId, (s) => applyQuery({ ...s, modes: { ...s.modes, [mode]: !s.modes[mode] } }));
}

export function showReplace(panelId: string): void {
  update(panelId, (s) => (s.panelKind === 'editor' ? { ...s, replaceShown: true } : s));
}

/**
 * Reveal replace, or put it away again (043 FR-008) — the disclosure control's whole implementation.
 *
 * It writes the SESSION's `replaceShown`, which is the same field `openFind(…, { replace: true })`
 * sets for `Ctrl+H`. That is not an implementation detail but the requirement: FR-009 says the two
 * routes must never disagree, and one piece of state is the only arrangement in which they cannot.
 * A `useState` inside the bar would satisfy every single-route test and drift on the first crossing.
 *
 * Refused on a terminal for the same reason `showReplace` is (FR-013): its find is read-only, so
 * there is no row to disclose and no control drawn to ask for one.
 */
export function toggleReplace(panelId: string): void {
  update(panelId, (s) =>
    s.panelKind === 'editor' ? { ...s, replaceShown: !s.replaceShown } : s,
  );
}

export function findNext(panelId: string): void {
  const controller = getPanelSearch(panelId);
  if (!controller) return;
  update(panelId, (s) => ({ ...s, count: controller.findNext(), seeded: false }));
}

export function findPrevious(panelId: string): void {
  const controller = getPanelSearch(panelId);
  if (!controller) return;
  update(panelId, (s) => ({ ...s, count: controller.findPrevious(), seeded: false }));
}

export function replaceCurrent(panelId: string): void {
  const controller = getPanelSearch(panelId);
  if (controller?.panelKind !== 'editor' || controller.isReadOnly()) return;
  update(panelId, (s) => ({ ...s, count: controller.replaceCurrent(s.replacement), seeded: false }));
}

export function replaceAll(panelId: string): void {
  const controller = getPanelSearch(panelId);
  if (controller?.panelKind !== 'editor' || controller.isReadOnly()) return;
  update(panelId, (s) => ({ ...s, count: controller.replaceAll(s.replacement), seeded: false }));
}

/**
 * A terminal's matches move as output streams in (013 FR-012) — record the new count.
 *
 * A straight write into THAT panel's session, with no reference to which bar is showing: a
 * background terminal whose scrollback is still growing keeps an honest count, ready for the
 * moment its bar comes back.
 */
export function updateCount(panelId: string, count: SearchCount): void {
  update(panelId, (s) => ({ ...s, count }));
}

/**
 * The panel is GONE — discard its find session and its controller (FR-006).
 *
 * ══ WHY THIS IS NOT `unregisterPanelSearch` ══
 *
 * `unregisterPanelSearch` runs from the editor's and terminal's UNMOUNT cleanup, and a panel
 * unmounts for two very different reasons: it was destroyed, or it MOVED — detached into a
 * sub-workspace, reattached, dragged to another tab. FR-025b says a session travels with its
 * panel, so hanging the discard off the unregister would throw away the user's search every time
 * they moved a panel. The discard therefore belongs to the explicit destroy paths (`disposeEditor`,
 * `destroyPanel`, the cross-window destroy cascade), which is what this function is for.
 */
export function destroyPanelSearch(panelId: string): void {
  unregisterPanelSearch(panelId);
  sessions.delete(panelId);
  if (showingFor === panelId) showingFor = null;
  emit();
}

/** Test seam: drop every session between cases. */
export function __resetFindState(): void {
  sessions.clear();
  showingFor = null;
  emit();
}
