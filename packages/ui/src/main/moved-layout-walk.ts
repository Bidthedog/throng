/**
 * After a move lands, rewrite the layouts NO WINDOW HOLDS (050 R19, FR-016, FR-035).
 *
 * ══ WHY ══
 *
 * A window patches the layouts it holds from the move signals (`MovedPathSync`, `PreviewPathSync`,
 * `HistoryMirrorSync`). A project no window was showing kept the moved file's OLD path, so showing it later
 * raised "Couldn't open … (missing)" (MT-02) — the FR-016 defect "including for panels in other windows".
 * FR-035 needs the same walk: a panel whose file a move took out of its project must already say so when its
 * project is shown later, or after a restart, without reading the file.
 *
 * ══ WHAT IT DOES TO EACH EDITOR AND PREVIEW PANEL ══
 *
 * - `config.filePath` and every `config.history` entry follow the move — `movedPathOf`, the rule an open
 *   document follows, and core's `rewritePaths`, the rule a live history follows.
 * - When the file the panel SHOWS (an editor's `filePath`; a preview's `previewPathOf`) was moved: outside
 *   the panel's project root → `movedOut: true`; inside it → the key is dropped (an undo brought it back —
 *   whether another editor holds it meanwhile is settled when the panel next mounts and `openInto`
 *   answers). A panel's project is its `originProjectId`, else the layout's own project; a sub-workspace's
 *   own panel (`subworkspace:<id>`) belongs to no project and is never flagged.
 *
 * ══ ONE WRITER PER RECORD, IDEMPOTENT ══
 *
 * Exactly `preview-purge.ts`'s discipline, for exactly its reasons: the `held` records are the windows' to
 * write; a record that did not restore is never written (saving it would persist the daemon's default); a
 * record nothing in the move touches is never written, so a second walk over the same moves writes nothing.
 */
import { moveLayoutTabs, type Panel, type SubWorkspace, type WorkspaceLayout } from '@throng/core';
import type { MovePair } from './files-service.js';
import type { HeldRecords } from './preview-purge.js';

export interface MovedLayoutWalkDeps {
  /** The daemon RPC — `daemonClient.call` in main. */
  call<T>(method: string, params: unknown): Promise<T>;
  /** The records a window holds right now (`preview-purge.ts`'s O6). */
  held(): Promise<HeldRecords>;
  /** The broadcast a sub-workspace record change sends, once the write has landed. */
  notifySubWorkspaceChanged(id: string): void;
}

export interface MovedLayoutWalkResult {
  changedProjectIds: string[];
  changedSubWorkspaceIds: string[];
}

/** The per-panel rule is core's `movedPanelConfig` (`workspace/moved-paths.ts`), shared with the renderer. */
const rewriteTabs = moveLayoutTabs;

/** Rewrite the moved paths in every project layout and sub-workspace record no window holds. */
export async function walkMovedLayouts(
  deps: MovedLayoutWalkDeps,
  moves: readonly MovePair[],
): Promise<MovedLayoutWalkResult> {
  const result: MovedLayoutWalkResult = { changedProjectIds: [], changedSubWorkspaceIds: [] };
  if (moves.length === 0) return result;
  const held = await deps.held();
  const { projects } = await deps.call<{ projects: Array<{ id: string; rootFolder: string }> }>('projects.list', {});
  const roots = new Map(projects.map((p) => [p.id, p.rootFolder] as const));
  const projectRootOf = (fallbackProjectId: string | undefined) => (panel: Panel): string | undefined =>
    roots.get(panel.originProjectId) ?? (fallbackProjectId !== undefined ? roots.get(fallbackProjectId) : undefined);

  // ── Project layouts ──
  for (const { id: projectId } of projects) {
    if (held.projectIds.has(projectId)) continue;
    const loaded = await deps.call<{ layout: WorkspaceLayout; restored: boolean }>('workspace.load', { projectId });
    if (!loaded.restored) continue;
    const tabs = rewriteTabs(loaded.layout.tabs, moves, projectRootOf(projectId));
    if (tabs === null) continue;
    await deps.call('workspace.save', { projectId, layout: { ...loaded.layout, tabs } });
    result.changedProjectIds.push(projectId);
  }

  // ── Sub-workspace records ──
  const { subWorkspaces } = await deps.call<{ subWorkspaces: SubWorkspace[] }>('workspace.loadSubWorkspaces', {});
  const next = subWorkspaces.map((sub) => {
    if (held.subWorkspaceIds.has(sub.id)) return sub;
    const tabs = rewriteTabs(sub.tabs, moves, projectRootOf(undefined));
    if (tabs === null) return sub;
    result.changedSubWorkspaceIds.push(sub.id);
    return { ...sub, tabs };
  });
  if (result.changedSubWorkspaceIds.length > 0) {
    await deps.call('workspace.persistSubWorkspaces', { subWorkspaces: next });
    for (const id of result.changedSubWorkspaceIds) deps.notifySubWorkspaceChanged(id);
  }
  return result;
}
