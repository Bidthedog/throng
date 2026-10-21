import { collectPanels, type AttentionMark, type WorkspaceLayout } from '@throng/core';

/**
 * The order a project's or a category's marked panels are listed in (the popover, 057 FR-097, FR-098)
 * and cycled through (clicking a mark, FR-105): the project's panels in LAYOUT order where this window
 * holds that project's layout, else in the order they were raised — the only order main knows — with the
 * projects themselves in the order given, which is list order.
 */
export interface MarkGroup {
  projectId: string;
  projectName: string;
  marks: AttentionMark[];
}

export function groupMarksByProject(
  all: readonly AttentionMark[],
  projectIds: readonly string[],
  layout: WorkspaceLayout | null,
): MarkGroup[] {
  /** panelId -> position in the loaded layout, for the one project whose layout this window holds. */
  const index = new Map<string, number>();
  if (layout !== null) for (const tab of layout.tabs) for (const panel of collectPanels(tab.root)) index.set(panel.id, index.size);

  const order = (a: AttentionMark, b: AttentionMark): number => {
    if (layout !== null && layout.projectId === a.projectId) {
      const ai = index.get(a.panelId) ?? Number.MAX_SAFE_INTEGER;
      const bi = index.get(b.panelId) ?? Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
    }
    return a.raisedAt - b.raisedAt;
  };

  const result: MarkGroup[] = [];
  for (const projectId of projectIds) {
    const marks = all.filter((m) => m.projectId === projectId).sort(order);
    if (marks.length > 0) result.push({ projectId, projectName: marks[0].projectName, marks });
  }
  return result;
}

/**
 * The next panel in a click-to-cycle (FR-105): the one after `lastPanelId`, wrapping, starting at the first.
 * When the last one has cleared since (a mark clears once focused), the panel that slid into its place is
 * next, so the cycle neither skips one nor sticks.
 */
export function nextInCycle(
  panelIds: readonly string[],
  lastPanelId: string | null,
  lastIndex: number,
): { panelId: string; index: number } | null {
  if (panelIds.length === 0) return null;
  const at = lastPanelId === null ? -1 : panelIds.indexOf(lastPanelId);
  const index = at >= 0 ? (at + 1) % panelIds.length : lastIndex < 0 ? 0 : lastIndex % panelIds.length;
  return { panelId: panelIds[index], index };
}
