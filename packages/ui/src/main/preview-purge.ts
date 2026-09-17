/**
 * Purging a turned-off provider's previews from layouts NO WINDOW HOLDS (044 FR-063, FR-064; research
 * R19, O6; contracts/preview-ipc.md §5 step 2).
 *
 * ══ WHY MAIN, AND WHY ONLY THE UNHELD RECORDS ══
 *
 * FR-063 closes every preview of the provider "including previews in layouts that are persisted but not
 * currently loaded" (the 005 FR-026 precedent). A window closes its own through `PreviewProviderSync`
 * and writes its layout back itself; if main ALSO rewrote that record, the daemon write would race the
 * window's debounced save and one would silently undo the other. So each record has one writer: the
 * window that holds it, or this walk.
 *
 * **O6 — which records a window holds** (decided at T133): the main window holds the ACTIVE project's
 * layout — the one project the daemon marks `isActive` — and each open sub-workspace window holds its
 * own record (`WindowManager.childIds()`). Main passes both in as `held`, read at the moment of the
 * walk. "Active" is NOT "loaded" (fix round 1, item 3): at launch the daemon marks the last active
 * project before the main window's workspace store has opened anything at all, so `isActive` can name a
 * project no renderer has read yet. That errs toward treating MORE as held and purging LESS, which is
 * the safe direction — a preview left behind here is still caught the moment its layout is next
 * restored (FR-067); `held` is a race this walk declines to run into, never a licence to skip that
 * filter.
 *
 * The residue this leaves is a race in BOTH directions, and both are healed the same way (fix round 1,
 * item 4):
 * - **A purged record can come back.** While a sub-workspace window is saving, its own
 *   load-all/replace/persist round trip can interleave with this walk's, and land AFTER it — putting a
 *   purged CLOSED record back with the preview still in it.
 * - **This walk can overwrite a fresher write.** `held` is a snapshot taken once, at the START of the
 *   walk, but the walk itself makes one `workspace.load`/`workspace.loadSubWorkspaces` round trip per
 *   record and then, much later, the matching write. A project can become held — the user switches to
 *   it — or a sub-workspace window can open, in the gap between this walk's OWN load and save of that
 *   SAME record; this walk's write, built from the stale pre-switch snapshot, can then land after and
 *   overwrite whatever the now-held window just wrote.
 *
 * Neither is silent data loss for the one thing this walk is answerable for: the preview. Restoring
 * from either race is FR-067's job, not this walk's — a preview that comes back, or that a stale write
 * failed to remove, is filtered out the next time its layout loads, so nothing is ever mounted from it
 * either way.
 *
 * ══ NO NEW RPC ══
 *
 * The walk composes the daemon's existing methods — `projects.list`, `workspace.load/save`,
 * `workspace.loadSubWorkspaces/persistSubWorkspaces` — and core's pure operations: `removePanelsWhere`
 * for a project layout (a workspace's last panel becomes an empty panel, 002 FR-016) and
 * `stripPanelFromSubWorkspaces` for a sub-workspace (one left with no panel is dropped, 003 FR-026b).
 *
 * ══ WHICH FILE A PREVIEW IS ══
 *
 * `previewPathOf(config)`, the precedence `attach` and the renderer's restore filter use — so the three
 * cannot disagree about the same panel.
 *
 * ══ IDEMPOTENT ══
 *
 * A record with nothing to remove is never written, and a record that did not restore (missing or
 * corrupt) is never written at all — saving it would persist the default the daemon synthesised in its
 * place. A second run over purged records therefore writes nothing.
 */
import {
  PREVIEW_KIND,
  collectPanels,
  previewPathOf,
  removePanelsWhere,
  stripPanelFromSubWorkspaces,
  type Panel,
  type PreviewPanelConfig,
  type PreviewProviderRegistry,
  type SubWorkspace,
  type WorkspaceLayout,
} from '@throng/core';

/** The records a window holds right now (O6). */
export interface HeldRecords {
  projectIds: ReadonlySet<string>;
  subWorkspaceIds: ReadonlySet<string>;
}

export interface PreviewPurgeDeps {
  /** The daemon RPC — `daemonClient.call` in main. */
  call<T>(method: string, params: unknown): Promise<T>;
  held(): Promise<HeldRecords>;
  /** A fresh panel id, for a workspace's last panel. */
  newPanelId(): string;
  /**
   * Tell every window a sub-workspace record just changed or was deleted (044 US4 fix round 1, item 1)
   * — the exact broadcast a hand destroy sends (`destroy-sub-workspace.ts`'s `notifyChanged`), so the
   * sidebar's sub-workspace list and an open detach context refresh even though no window made this
   * edit. Called once per affected id, only after `workspace.persistSubWorkspaces` has actually landed.
   */
  notifySubWorkspaceChanged(id: string): void;
}

export interface PreviewPurgeResult {
  /** Every preview panel removed, from project layouts and sub-workspace records alike. */
  removedPanelIds: string[];
  /** Sub-workspaces dropped because the purge left them with no panel. */
  deletedSubWorkspaceIds: string[];
  /** Sub-workspaces rewritten (a matching preview removed) but kept — new in fix round 1, item 1. */
  changedSubWorkspaceIds: string[];
}

/** FR-063's match for main: the file's provider is one of those just turned off. */
export function previewPurgePredicate(
  registry: PreviewProviderRegistry,
  providerIds: readonly string[],
): (filePath: string) => boolean {
  const ids = new Set(providerIds);
  return (filePath) => {
    const id = registry.forPath(filePath)?.id;
    return id !== undefined && ids.has(id);
  };
}

const previewMatching =
  (matches: (filePath: string) => boolean) =>
  (panel: Panel): boolean => {
    if (panel.kind !== PREVIEW_KIND) return false;
    const path = previewPathOf(panel.config as PreviewPanelConfig | undefined);
    return path !== undefined && matches(path);
  };

interface LoadResult {
  layout: WorkspaceLayout;
  restored: boolean;
}

/** Remove matching previews from every project layout and sub-workspace record no window holds. */
export async function purgeUnloadedPreviews(
  deps: PreviewPurgeDeps,
  matches: (filePath: string) => boolean,
): Promise<PreviewPurgeResult> {
  const isPurged = previewMatching(matches);
  const held = await deps.held();
  const removedPanelIds: string[] = [];

  // ── Project layouts ──
  const { projects } = await deps.call<{ projects: Array<{ id: string }> }>('projects.list', {});
  for (const { id: projectId } of projects) {
    if (held.projectIds.has(projectId)) continue;
    const loaded = await deps.call<LoadResult>('workspace.load', { projectId });
    if (!loaded.restored) continue;
    const doomed = loaded.layout.tabs.flatMap((tab) => collectPanels(tab.root).filter(isPurged)).map((p) => p.id);
    if (doomed.length === 0) continue;
    const next = removePanelsWhere(loaded.layout, isPurged, deps.newPanelId);
    await deps.call('workspace.save', { projectId, layout: next });
    removedPanelIds.push(...doomed);
  }

  // ── Sub-workspace records ──
  const { subWorkspaces } = await deps.call<{ subWorkspaces: SubWorkspace[] }>('workspace.loadSubWorkspaces', {});
  const deletedSubWorkspaceIds: string[] = [];
  const changedSubWorkspaceIds: string[] = [];
  let changed = false;
  const kept: SubWorkspace[] = [];
  for (const sub of subWorkspaces) {
    if (held.subWorkspaceIds.has(sub.id)) {
      kept.push(sub);
      continue;
    }
    const doomed = sub.tabs.flatMap((tab) => collectPanels(tab.root).filter(isPurged)).map((p) => p.id);
    if (doomed.length === 0) {
      kept.push(sub);
      continue;
    }
    changed = true;
    removedPanelIds.push(...doomed);
    // One record at a time: a synced panel id can also sit in a HELD record, which must not be touched.
    let list: SubWorkspace[] = [sub];
    for (const panelId of doomed) list = stripPanelFromSubWorkspaces(list, panelId).list;
    if (list.length === 0) deletedSubWorkspaceIds.push(sub.id);
    else {
      kept.push(...list);
      changedSubWorkspaceIds.push(sub.id);
    }
  }
  if (changed) {
    await deps.call('workspace.persistSubWorkspaces', { subWorkspaces: kept });
    // Only once the record has actually landed (item 1) — a broadcast ahead of the write could race a
    // window's own refresh against a persist that has not happened yet.
    for (const id of [...changedSubWorkspaceIds, ...deletedSubWorkspaceIds]) deps.notifySubWorkspaceChanged(id);
  }

  return { removedPanelIds, deletedSubWorkspaceIds, changedSubWorkspaceIds };
}
