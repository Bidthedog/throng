import { collectPanels, type Tab, type WorkspaceLoadResult } from '@throng/core';

/** Where the daemon's saved panels live: each project's layout and every sub-workspace record. */
export interface LivePanelSources {
  projectIds(): readonly string[];
  layout(projectId: string): WorkspaceLoadResult;
  /** Every sub-workspace record; `onCorrupt` is told about each one that could not be read. */
  subWorkspaces(onCorrupt: () => void): readonly { tabs: readonly Tab[] }[];
}

/**
 * 057 FR-007 / FR-128 (#541) — the id of every panel a saved layout or sub-workspace still holds.
 *
 * A stored flag or ledger entry for a panel outside this set belongs to a panel that was destroyed, and
 * nothing in the UI can clear it any more. `null` means the answer is not known — a layout or
 * sub-workspace could not be read, so its panels cannot be listed — and a caller must then prune nothing:
 * dropping a mark the user still needs is worse than keeping a stranded one for another session.
 */
export function livePanelIds(sources: LivePanelSources): ReadonlySet<string> | null {
  const ids = new Set<string>();
  const add = (tabs: readonly Tab[]): void => {
    for (const tab of tabs) for (const panel of collectPanels(tab.root)) ids.add(panel.id);
  };
  for (const projectId of sources.projectIds()) {
    const loaded = sources.layout(projectId);
    if (!loaded.restored && loaded.reason === 'corrupt') return null;
    // A never-saved project falls back to a default layout whose ids are fresh, so it adds no match.
    if (loaded.restored) add(loaded.layout.tabs);
  }
  let corrupt = false;
  for (const sub of sources.subWorkspaces(() => (corrupt = true))) add(sub.tabs);
  return corrupt ? null : ids;
}
