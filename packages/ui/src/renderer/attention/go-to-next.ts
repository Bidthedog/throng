import {
  collectPanels,
  effectiveActivePanelId,
  listRows,
  nextMarkedPanel,
  type AttentionMark,
  type MarkedPanelTarget,
  type WorkspaceLayout,
} from '@throng/core';

/** What the project list gives navigation: structural, so the renderer's DTOs pass straight in. */
interface ListedProject {
  id: string;
  categoryId: string;
}
interface ListedCategory {
  id: string;
  isDefault: boolean;
  minimised: boolean;
  createdAt: string;
}

/**
 * Which marked panel "Go to Next Marked Panel" would take the user to (057 FR-080; research R14), or
 * `null` when nothing is marked.
 *
 * The navigation ORDER is project-list order, then tab order, then panel order. The list order is
 * `listRows`'s with every category EXPANDED: a project hidden under a minimised header is still
 * somewhere in the order (FR-080a), and the header being minimised is a choice about what the pane
 * shows, not about where the project is. This window only knows the panels of the layout it shows, so
 * only that project lists panels; core places a mark for any other panel after its project's known
 * ones, which is what lets the command reach a project this window has not loaded.
 *
 * The POSITION is the panel holding the keyboard, else the active tab's active panel, so the command
 * moves on from where the user actually is.
 */
export function nextMarkedTarget(input: {
  layout: WorkspaceLayout | null;
  focusedPanelId: string | null;
  projects: readonly ListedProject[];
  categories: readonly ListedCategory[];
  marks: readonly AttentionMark[];
}): MarkedPanelTarget | null {
  const { layout, marks } = input;
  if (marks.length === 0) return null;

  const rows = listRows(
    input.projects,
    input.categories.map((c) => ({ ...c, minimised: false })),
    null,
  );
  const projectIds = rows.flatMap((r) => (r.kind === 'project' ? [r.project.id] : []));

  const layoutPanels = layout === null ? [] : layout.tabs.flatMap((t) => collectPanels(t.root).map((p) => p.id));
  const order = projectIds.map((projectId) => ({
    projectId,
    panelIds: layout !== null && layout.projectId === projectId ? layoutPanels : [],
  }));

  const activeTab = layout?.tabs.find((t) => t.id === layout.activeTabId);
  const activePanel = activeTab === undefined ? null : (effectiveActivePanelId(activeTab) ?? null);
  const position =
    layout === null ? null : { projectId: layout.projectId, panelId: input.focusedPanelId ?? activePanel };

  return nextMarkedPanel(position, order, marks);
}
