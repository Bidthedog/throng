import {
  type LayoutNode,
  type Panel,
  type SubWorkspace,
  type SubWorkspaceBounds,
  type Tab,
  type WorkspaceLayout,
} from './model.js';
import { collectPanels, countPanels } from './invariants.js';
import { appendPanelToTabRoot, removeFromNode } from './operations.js';

function findPanel(node: LayoutNode, panelId: string): Panel | undefined {
  return collectPanels(node).find((p) => p.id === panelId);
}

function findPanelInLayout(layout: WorkspaceLayout, panelId: string): Panel | undefined {
  for (const tab of layout.tabs) {
    const panel = findPanel(tab.root, panelId);
    if (panel) return panel;
  }
  return undefined;
}

/** Deep-clone a split tree, preserving Panel ids (identity-sync) but giving the
 *  sub-workspace its own independent structure. */
function cloneNode(node: LayoutNode): LayoutNode {
  if (node.type === 'panel') return { ...node };
  return { ...node, children: node.children.map(cloneNode), sizes: [...node.sizes] };
}

/**
 * Detach a single Panel into a **new** sub-workspace by **cloning** it (US7 / 003
 * clone-and-sync model). The Panel STAYS in the main project — a project Panel may
 * live in many sub-workspaces — and a copy with the **same identity** (id /
 * originProjectId / title) becomes the sole Panel of a new Tab in the returned
 * sub-workspace, so the two are linked (full content-sync arrives with terminals;
 * identity is what's synced today). The main layout is returned unchanged. Refused
 * (sub-workspace = null) only when the Panel doesn't exist.
 */
export function detachPanel(
  layout: WorkspaceLayout,
  panelId: string,
  ids: { subWorkspace: string; tab: string },
  ownerUser: string,
  bounds: SubWorkspaceBounds,
  identity?: SubWorkspaceIdentity,
): { layout: WorkspaceLayout; subWorkspace: SubWorkspace | null } {
  const panel = findPanelInLayout(layout, panelId);
  if (!panel) return { layout, subWorkspace: null };
  const clone: Panel = { ...panel };

  const subWorkspace: SubWorkspace = {
    id: ids.subWorkspace,
    ownerUser,
    name: identity?.name ?? DEFAULT_SUBWORKSPACE_NAME,
    colour: identity?.colour ?? DEFAULT_SUBWORKSPACE_COLOUR,
    bounds,
    tabs: [{ id: ids.tab, title: nextSubWorkspaceTabName([]), root: clone, activePanelId: clone.id }],
  };
  return { layout, subWorkspace }; // main project keeps the Panel (clone, not move)
}

/**
 * Detach a whole Tab into a new sub-workspace by **cloning** it (003 clone-and-sync
 * model). The Tab stays in the main workspace; the sub-workspace gets a copy it
 * **owns** (a fresh Tab id) whose Panels keep their identities (still
 * project-owned, synced). The main layout is returned unchanged. Refused only when
 * the Tab doesn't exist.
 */
export function detachTab(
  layout: WorkspaceLayout,
  tabId: string,
  ids: { subWorkspace: string; tab: string },
  ownerUser: string,
  bounds: SubWorkspaceBounds,
  identity?: SubWorkspaceIdentity,
): { layout: WorkspaceLayout; subWorkspace: SubWorkspace | null } {
  const tab = layout.tabs.find((t) => t.id === tabId);
  if (!tab) return { layout, subWorkspace: null };

  const clonedTab: Tab = {
    id: ids.tab,
    // A Tab created in a sub-workspace gets a neutral, unique default name rather
    // than carrying the project Tab's title (003 / "via any method").
    title: nextSubWorkspaceTabName([]),
    root: cloneNode(tab.root),
    activePanelId: tab.activePanelId,
  };
  const subWorkspace: SubWorkspace = {
    id: ids.subWorkspace,
    ownerUser,
    name: identity?.name ?? DEFAULT_SUBWORKSPACE_NAME,
    colour: identity?.colour ?? DEFAULT_SUBWORKSPACE_COLOUR,
    bounds,
    tabs: [clonedTab],
  };
  return { layout, subWorkspace }; // main workspace keeps the Tab (clone, not move)
}

/**
 * Add (clone) a Tab into an **existing** sub-workspace as a new Tab the
 * sub-workspace owns (003 sync model). Panels keep their identity (synced).
 * Panels that **already exist anywhere in the sub-workspace are omitted** (a Panel
 * may live in a sub-workspace only once); if every Panel is already present, the
 * sub-workspace is returned unchanged (no empty Tab is created).
 */
export function addTabToSubWorkspace(sub: SubWorkspace, tab: Tab, newTabId: string): SubWorkspace {
  const existing = new Set(sub.tabs.flatMap((t) => collectPanels(t.root).map((p) => p.id)));
  let root: LayoutNode | null = tab.root;
  for (const p of collectPanels(tab.root)) {
    if (existing.has(p.id) && root) root = removeFromNode(root, p.id).node;
  }
  if (!root) return sub; // every Panel already present → nothing new to add

  const remaining = collectPanels(root);
  const activePanelId =
    remaining.find((p) => p.id === tab.activePanelId)?.id ?? remaining[0]?.id;
  const clonedTab: Tab = {
    id: newTabId,
    title: nextSubWorkspaceTabName(sub.tabs),
    root: cloneNode(root),
    activePanelId,
  };
  return { ...sub, tabs: [...sub.tabs, clonedTab] };
}

/**
 * Add (clone) a Panel into an **existing** sub-workspace (003 sync model): into a
 * named Tab (`ids.tabId`) — appended as a row sibling and made active — or as a
 * brand-new Tab (`ids.newTabId`) when no `tabId` is given. The Panel keeps its
 * identity (synced).
 */
export function addPanelToSubWorkspace(
  sub: SubWorkspace,
  panel: Panel,
  ids: { tabId?: string; newTabId: string },
): SubWorkspace {
  const clone: Panel = { ...panel };
  if (ids.tabId) {
    const tabs = sub.tabs.map((t) =>
      t.id === ids.tabId
        ? { ...t, root: appendPanelToTabRoot(t.root, clone), activePanelId: clone.id }
        : t,
    );
    return { ...sub, tabs };
  }
  return {
    ...sub,
    tabs: [
      ...sub.tabs,
      {
        id: ids.newTabId,
        title: nextSubWorkspaceTabName(sub.tabs),
        root: clone,
        activePanelId: clone.id,
      },
    ],
  };
}

/** A Panel may reattach to the main workspace only if it belongs to that project (INV-6). */
export function canReattachPanel(panel: Panel, layout: WorkspaceLayout): boolean {
  return panel.originProjectId === layout.projectId;
}

/**
 * Reattach a Panel from a sub-workspace into the main layout, **only** if the
 * Panel's origin project matches (INV-6 / FR-023). The Panel becomes a new Tab in
 * the main layout and is removed from the sub-workspace (its slot collapses). If
 * the Panel belongs to another project, the operation is refused and both states
 * are returned unchanged (the main workspace never mixes projects, INV-4).
 */
export function reattachPanel(
  layout: WorkspaceLayout,
  subWorkspace: SubWorkspace,
  panelId: string,
  newTabId: string,
): { layout: WorkspaceLayout; subWorkspace: SubWorkspace; reattached: boolean } {
  let panel: Panel | undefined;
  for (const tab of subWorkspace.tabs) {
    panel = findPanel(tab.root, panelId);
    if (panel) break;
  }
  if (!panel || !canReattachPanel(panel, layout)) {
    return { layout, subWorkspace, reattached: false };
  }

  // Remove from the sub-workspace (collapse + prune empty Tabs).
  const subTabs: Tab[] = [];
  for (const tab of subWorkspace.tabs) {
    const result = removeFromNode(tab.root, panelId);
    if (result.node) subTabs.push({ ...tab, root: result.node });
  }
  const updatedSub: SubWorkspace = { ...subWorkspace, tabs: subTabs };

  // Add to the main layout as a new Tab (its origin project).
  const newTab: Tab = {
    id: newTabId,
    title: `Tab ${layout.tabs.length + 1}`,
    root: panel,
    activePanelId: panel.id,
  };
  const newLayout: WorkspaceLayout = {
    ...layout,
    tabs: [...layout.tabs, newTab],
    activeTabId: newTabId,
  };

  return { layout: newLayout, subWorkspace: updatedSub, reattached: true };
}

/** Optional identity supplied when a sub-workspace is created by detach (003 / FR-012). */
export interface SubWorkspaceIdentity {
  name?: string;
  colour?: string;
}

export const DEFAULT_SUBWORKSPACE_NAME = 'Sub-workspace';
export const DEFAULT_SUBWORKSPACE_COLOUR = '#8a8f98';

/** Prefix for the auto-generated default name of a Tab created in a sub-workspace. */
export const SUBWORKSPACE_TAB_PREFIX = 'Sub-workspace Tab';

/**
 * Next unique default Tab name for a sub-workspace — `Sub-workspace Tab N`
 * (N = highest existing index + 1), so every Tab created in a sub-workspace by any
 * path gets a distinct, neutral name (003). Titles not matching the pattern are
 * ignored, so the first generated name is always `Sub-workspace Tab 1`.
 */
export function nextSubWorkspaceTabName(existing: ReadonlyArray<{ title: string }>): string {
  let max = 0;
  for (const t of existing) {
    const m = /^Sub-workspace Tab (\d+)$/.exec(t.title.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${SUBWORKSPACE_TAB_PREFIX} ${max + 1}`;
}

/** Shared candidate palette for project/sub-workspace dominant colours (003). */
export const SUBWORKSPACE_PALETTE: readonly string[] = [
  '#6aa3ff', '#e5534b', '#3fb950', '#d29922', '#a371f7',
  '#1f9ed1', '#ec6cb9', '#f0883e', '#56d4bb', '#9aa0aa',
];

/** Next auto name "Sub-workspace N" (N = highest existing index + 1), per FR-012. */
export function nextSubWorkspaceName(existing: ReadonlyArray<{ name: string }>): string {
  let max = 0;
  for (const s of existing) {
    const m = /^Sub-workspace (\d+)$/.exec(s.name.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${DEFAULT_SUBWORKSPACE_NAME} ${max + 1}`;
}

/** First palette colour not already in use (case-insensitive); falls back to palette[0]. */
export function pickUnusedColour(
  used: ReadonlyArray<string>,
  palette: ReadonlyArray<string> = SUBWORKSPACE_PALETTE,
): string {
  const taken = new Set(used.map((c) => c.toLowerCase()));
  return palette.find((c) => !taken.has(c.toLowerCase())) ?? palette[0];
}

/** Rename a sub-workspace (ignores blank names) — FR-012. */
export function renameSubWorkspace(sub: SubWorkspace, name: string): SubWorkspace {
  const trimmed = name.trim();
  return trimmed.length === 0 ? sub : { ...sub, name: trimmed };
}

/** Recolour a sub-workspace — FR-012. */
export function recolourSubWorkspace(sub: SubWorkspace, colour: string): SubWorkspace {
  return { ...sub, colour };
}

/**
 * Remove a Panel from a sub-workspace, collapsing its slot and pruning empty
 * Tabs. Returns `null` when no Panels remain — a sub-workspace cannot exist empty
 * (003 / FR-018), so the caller deletes it.
 */
export function removePanelFromSubWorkspace(
  sub: SubWorkspace,
  panelId: string,
): SubWorkspace | null {
  const tabs: Tab[] = [];
  for (const tab of sub.tabs) {
    const result = removeFromNode(tab.root, panelId);
    if (result.node) tabs.push({ ...tab, root: result.node });
  }
  if (tabs.length === 0 || tabs.every((t) => countPanels(t.root) === 0)) return null;
  return { ...sub, tabs };
}

/** Ids of the sub-workspaces whose tabs contain `panelId` (FR-026a — for the
 *  destroy dialog's "also lives in …" warning). */
export function findPanelLocations(
  list: ReadonlyArray<SubWorkspace>,
  panelId: string,
): string[] {
  return list
    .filter((sub) => sub.tabs.some((t) => collectPanels(t.root).some((p) => p.id === panelId)))
    .map((sub) => sub.id);
}

/**
 * Strip `panelId` from every sub-workspace in `list` (FR-026 destroy cascade):
 * each sub has the Panel removed (slot collapsed, empty Tabs pruned); a
 * sub-workspace left with no Panels is dropped and its id reported in `deletedIds`
 * (FR-026b — a sub-workspace cannot exist empty). Subs not containing the Panel are
 * returned unchanged.
 */
export function stripPanelFromSubWorkspaces(
  list: ReadonlyArray<SubWorkspace>,
  panelId: string,
): { list: SubWorkspace[]; deletedIds: string[] } {
  const kept: SubWorkspace[] = [];
  const deletedIds: string[] = [];
  for (const sub of list) {
    const contains = sub.tabs.some((t) => collectPanels(t.root).some((p) => p.id === panelId));
    if (!contains) {
      kept.push(sub);
      continue;
    }
    const stripped = removePanelFromSubWorkspace(sub, panelId);
    if (stripped) kept.push(stripped);
    else deletedIds.push(sub.id);
  }
  return { list: kept, deletedIds };
}

/**
 * Structural validation for a sub-workspace (US4). Unlike the main layout, a
 * sub-workspace MAY contain Panels from multiple projects (INV-5), so no
 * cross-project check is applied — only ≥ 1 Tab, each with ≥ 1 Panel.
 */
export function validateSubWorkspace(sub: SubWorkspace): string[] {
  const violations: string[] = [];
  if (sub.tabs.length < 1) violations.push('a sub-workspace must contain at least one Tab');
  for (const tab of sub.tabs) {
    if (countPanels(tab.root) < 1) {
      violations.push(`sub-workspace tab ${tab.id} must contain at least one Panel`);
    }
  }
  return violations;
}
