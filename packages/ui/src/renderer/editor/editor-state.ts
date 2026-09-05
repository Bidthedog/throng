/**
 * Per-panel editor UI state (006). A tiny reactive store the Panel header, Tab,
 * and project list subscribe to for the file pill + the shared unsaved dot. The
 * document's content lives in CodeMirror (renderer) and UI main; this holds only
 * the small display/dirty facts the chrome needs.
 */
import { useSyncExternalStore } from 'react';

export interface EditorUiState {
  panelId: string;
  filePath: string | null;
  displayName: string;
  /** Owning project root (null for a sub-workspace-owned editor) — drives the pill
   *  path display (FR-088). */
  ownerRoot: string | null;
  ownerKind: 'project' | 'subworkspace';
  dirty: boolean;
  /** The backing file could not be loaded (missing/deleted) — drives the tab-open
   *  "cannot open file" warning (FR-100/105). */
  fileMissing: boolean;
  /**
   * The path could not be READ when this panel adopted the document (027 / #161) — drives the
   * in-panel unloadable banner.
   *
   * Separate from `fileMissing` on purpose. That one feeds the tab-open "cannot open file" dialog,
   * which FR-105 requires to stay silent on a remount; this one must survive exactly that remount,
   * because the editor is still showing text that is not its file's.
   */
  unloadable: boolean;
  /**
   * WHY it could not be read — the load reason beside the path (030 US5, FR-052).
   *
   * Never rendered (FR-034): it reaches the user through the failure banner's Copy control and the
   * diagnostic log, which for a silenced severity are the only two routes it has. Absent where the
   * authority reported the condition without one — a broadcast says the path is unreadable, not what
   * the last read attempt returned — and an absent system error is omitted rather than invented.
   */
  unloadableDetail?: string;
  /**
   * The panel's INITIAL OPEN has not decided anything yet (#369).
   *
   * The third state, and the reason it has to exist. `fileMissing` and `unloadable` are both false
   * in two entirely different situations — *the file is there*, and *nobody has looked yet* — and
   * anything reading them as one cannot tell a healthy panel from a panel still opening. That is
   * what made `missing-file-watcher` a verdict deadline: it sampled 300 ms after a tab activated,
   * skipped every panel whose two flags were still false, and re-armed only on the next tab or
   * settings change. A panel whose open answered at 301 ms was not reported late — it was never
   * reported at all, and on a machine slow enough for that to be the normal case the consolidated
   * notice 030 FR-034a requires simply never appeared.
   *
   * True from mount until the open ANSWERS: the load returned, the authority's verification came
   * back, or there was no path to open. So a reader waits on an answer rather than on a duration,
   * and no constant is left to be wrong on the next machine.
   *
   * FR-105 depends on this clearing reliably. A panel left pending forever would be reported when
   * its file was deleted under a tab the user was already looking at — which is the one thing that
   * rule forbids.
   */
  openPending: boolean;
  ownerProjectId?: string;
}

const states = new Map<string, EditorUiState>();
const listeners = new Set<() => void>();

/**
 * Bumped on every change, so a surface naming MANY panels can subscribe once (#294).
 *
 * `useEditorState` is per-panel, which is right for a panel's own header and useless to the tab
 * popover: it lists whatever panels a tab happens to hold, and a hook cannot be called in a `.map`
 * over a list whose length varies. A number is the snapshot rather than the Map because
 * `useSyncExternalStore` compares snapshots with `Object.is` — the Map's identity never changes, so
 * returning it would subscribe to nothing.
 */
let version = 0;

function emit(): void {
  version += 1;
  for (const l of listeners) l();
}

export function setEditorState(panelId: string, patch: Partial<EditorUiState>): void {
  const prev = states.get(panelId) ?? {
    panelId,
    filePath: null,
    displayName: 'Untitled',
    ownerRoot: null,
    ownerKind: 'project' as const,
    dirty: false,
    fileMissing: false,
    unloadable: false,
    /*
     * FALSE, not true — a panel nobody has said anything about is not one we are waiting on.
     *
     * Only `use-editor` knows an open is in flight, and it says so explicitly on mount. Defaulting
     * to true would make every hand-seeded panel in a test, and every non-editor writer of this
     * store, look like a pending open that no answer is ever coming for.
     */
    openPending: false,
  };
  states.set(panelId, { ...prev, ...patch, panelId });
  emit();
}

export function removeEditorState(panelId: string): void {
  if (states.delete(panelId)) emit();
}

export function getEditorState(panelId: string): EditorUiState | undefined {
  return states.get(panelId);
}

/** Re-render when ANY editor state changes; read the values with {@link getEditorState}. */
export function useEditorStateVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
}

export function allEditorStates(): EditorUiState[] {
  return [...states.values()];
}

/**
 * The id of an editor panel already showing `absPath`, or null (024 US4, FR-011b). Path comparison
 * normalises separators and is case-insensitive, matching how the platform treats file paths on
 * Windows — so a tree drop of an already-open file can focus the existing view instead of opening a
 * second one.
 */
export function findEditorPanelByPath(absPath: string): string | null {
  const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase();
  const target = norm(absPath);
  for (const s of states.values()) {
    if (s.filePath != null && norm(s.filePath) === target) return s.panelId;
  }
  return null;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Subscribe to ANY editor state change from outside React (#369).
 *
 * The same channel the hooks above use, exposed for a caller that is not rendering from it —
 * `missing-file-watcher`, which has to keep watching the panels whose open had not answered when it
 * sampled, and cannot express that as a hook: the set is discovered inside a `setTimeout`, and its
 * membership is per-activation rather than per-render.
 */
export function subscribeEditorStates(cb: () => void): () => void {
  return subscribe(cb);
}

/** Subscribe to one panel's editor state (pills + dot). */
export function useEditorState(panelId: string): EditorUiState | undefined {
  return useSyncExternalStore(
    subscribe,
    () => states.get(panelId),
    () => states.get(panelId),
  );
}

/** A stable key of the project ids that currently have an unsaved editor. Callers
 *  derive a Set from it (drives the project-list unsaved dot without per-row hooks). */
function dirtyProjectKey(): string {
  const ids = new Set<string>();
  for (const s of states.values()) {
    if (s.dirty && s.ownerProjectId) ids.add(s.ownerProjectId);
  }
  return [...ids].sort().join(',');
}

export function useDirtyProjectKey(): string {
  return useSyncExternalStore(subscribe, dirtyProjectKey, dirtyProjectKey);
}

/**
 * A stable key of the FILE PATHS that currently hold unsaved changes — the same idiom as
 * {@link dirtyProjectKey}, one level finer, so the file tree can mark the files themselves.
 *
 * Normalised (separators, case) because it is compared against paths the tree composes from a
 * project root, and Windows treats those as the same file however they are spelled. A stable string
 * rather than a Set so `useSyncExternalStore` can compare snapshots by value, and so the tree does
 * not need a hook per row.
 */
function dirtyPathKey(): string {
  const paths = new Set<string>();
  for (const s of states.values()) {
    if (s.dirty && s.filePath) paths.add(s.filePath.replace(/\\/g, '/').toLowerCase());
  }
  return [...paths].sort().join('\n');
}

export function useDirtyPathKey(): string {
  return useSyncExternalStore(subscribe, dirtyPathKey, dirtyPathKey);
}

/** True when any of the given panels has an unsaved editor (tab/project dot). */
export function useEditorDirty(panelIds: readonly string[]): boolean {
  const key = panelIds.join('\u0000');
  return useSyncExternalStore(
    subscribe,
    () => panelIds.some((id) => states.get(id)?.dirty === true),
    () => panelIds.some((id) => states.get(id)?.dirty === true),
  );
  // `key` participates only to document intent; the snapshot recomputes each call.
  void key;
}
