/**
 * After a move lands, have the daemon rewrite the layouts NO WINDOW HOLDS (050 R19, FR-016, FR-035; 052 FR-001).
 *
 * ══ WHY ══
 *
 * A window patches the layouts it holds from the move signals (`MovedPathSync`, `PreviewPathSync`,
 * `HistoryMirrorSync`). A project no window was showing kept the moved file's OLD path, so showing it later
 * raised "Couldn't open … (missing)" (050 MT-02); a closed sub-workspace did the same after a plain rename (#397).
 *
 * ══ WHERE THE WORK HAPPENS ══
 *
 * In the daemon, as one `workspace.followMoves` (052 R2): one synchronous transaction, so no save can land between
 * the walk's read of a record and its write — the race that let the old main-side walk of load/save round trips
 * lose a window's change, or have its own undone (FR-005). The per-panel rule is core's `moveLayoutTabs`.
 *
 * ══ WHO HOLDS WHAT ══
 *
 * `preview-purge.ts`'s O6: the ACTIVE project's layout (the main window) and each open sub-workspace window's own
 * record. A loaded-but-inactive project is held by no window — the renderer keeps no cache of it — so the walk
 * covers it (052 FR-008).
 */
import type { MovePair } from './files-service.js';
import type { HeldRecords } from './preview-purge.js';

export interface MovedLayoutWalkDeps {
  /** The daemon RPC — `daemonClient.call` in main. */
  call<T>(method: string, params: unknown): Promise<T>;
  /** The records a window holds right now (`heldRecords`). */
  held(): Promise<HeldRecords>;
  /** The broadcast a sub-workspace record change sends, once the write has landed. */
  notifySubWorkspaceChanged(id: string): void;
}

export interface MovedLayoutWalkResult {
  changedProjectIds: string[];
  changedSubWorkspaceIds: string[];
  skipped: number;
}

/** O6 from the daemon's project list and the open sub-workspace windows. */
export function heldRecords(
  projects: ReadonlyArray<{ id: string; isActive?: boolean }>,
  openSubWorkspaceIds: readonly string[],
): HeldRecords {
  return {
    projectIds: new Set(projects.filter((p) => p.isActive === true).map((p) => p.id)),
    subWorkspaceIds: new Set(openSubWorkspaceIds),
  };
}

/** Rewrite the moved paths in every project layout and sub-workspace record no window holds. */
export async function walkMovedLayouts(
  deps: MovedLayoutWalkDeps,
  moves: readonly MovePair[],
): Promise<MovedLayoutWalkResult> {
  if (moves.length === 0) return { changedProjectIds: [], changedSubWorkspaceIds: [], skipped: 0 };
  const held = await deps.held();
  const result = await deps.call<MovedLayoutWalkResult>('workspace.followMoves', {
    moves,
    held: { projectIds: [...held.projectIds], subWorkspaceIds: [...held.subWorkspaceIds] },
  });
  for (const id of result.changedSubWorkspaceIds) deps.notifySubWorkspaceChanged(id);
  return result;
}
