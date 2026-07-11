import {
  isPanel,
  isSplit,
  LAYOUT_SCHEMA_VERSION,
  type LayoutNode,
  type Panel,
  type Tab,
  type WorkspaceLayout,
} from './model.js';
import { collectPanels, countPanels } from './invariants.js';
import { clampZoomLevel, stepZoomLevel } from '../config/zoom.js';

// Typed-panel ops (005) live in the panel-type module but are surfaced here so
// callers reach all layout mutations through one operations surface (FR-006/020).
export { setPanelType, clearPanelType } from '../panel-type/assignment.js';

/** Drop edge for splitting a Panel (FR-014). */
export type Edge = 'top' | 'bottom' | 'left' | 'right';

/** Identity pair for a new Tab + its initial Panel (caller-supplied, keeps core pure). */
export interface NewTabIds {
  tab: string;
  panel: string;
}

function makePanel(id: string, originProjectId: string, title: string): Panel {
  return { type: 'panel', id, originProjectId, title };
}

function equalSizes(count: number): number[] {
  return Array.from({ length: count }, () => 1 / count);
}

function totalPanels(layout: WorkspaceLayout): number {
  return layout.tabs.reduce((n, tab) => n + countPanels(tab.root), 0);
}

function findPanel(layout: WorkspaceLayout, panelId: string): Panel | undefined {
  for (const tab of layout.tabs) {
    const match = collectPanels(tab.root).find((p) => p.id === panelId);
    if (match) return match;
  }
  return undefined;
}

/** Remove a Panel from a node, collapsing single-child splits. */
export function removeFromNode(
  node: LayoutNode,
  panelId: string,
): { node: LayoutNode | null; removed: Panel | null } {
  if (isPanel(node)) {
    return node.id === panelId ? { node: null, removed: node } : { node, removed: null };
  }
  let removed: Panel | null = null;
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, i) => {
    const result = removeFromNode(child, panelId);
    if (result.removed) removed = result.removed;
    if (result.node) {
      children.push(result.node);
      sizes.push(node.sizes[i] ?? 1 / node.children.length);
    }
  });
  if (!removed) return { node, removed: null };
  if (children.length === 0) return { node: null, removed }; // tab will be pruned
  if (children.length === 1) return { node: children[0], removed }; // INV-3 collapse
  const sum = sizes.reduce((a, b) => a + b, 0) || 1;
  return { node: { ...node, children, sizes: sizes.map((s) => s / sum) }, removed };
}

/** Replace the target Panel with a 2-way split hosting the incoming Panel at `edge`. */
function insertAtEdge(node: LayoutNode, targetId: string, incoming: Panel, edge: Edge): LayoutNode {
  if (isPanel(node)) {
    if (node.id !== targetId) return node;
    const orientation = edge === 'left' || edge === 'right' ? 'row' : 'column';
    const incomingFirst = edge === 'left' || edge === 'top';
    const children = incomingFirst ? [incoming, node] : [node, incoming];
    return { type: 'split', orientation, children, sizes: equalSizes(2) };
  }
  return { ...node, children: node.children.map((c) => insertAtEdge(c, targetId, incoming, edge)) };
}

/** Add a Panel as a row sibling at the root of a Tab. */
export function appendPanelToTabRoot(root: LayoutNode, panel: Panel): LayoutNode {
  if (isSplit(root) && root.orientation === 'row') {
    const children = [...root.children, panel];
    return { ...root, children, sizes: equalSizes(children.length) };
  }
  return { type: 'split', orientation: 'row', children: [root, panel], sizes: equalSizes(2) };
}

export interface NullableTab {
  id: string;
  title: string;
  root: LayoutNode | null;
  activePanelId?: string;
}

/** Prune empty Tabs and repair activeTabId (INV-2/7). */
export function finalize(layout: WorkspaceLayout, tabs: NullableTab[]): WorkspaceLayout {
  const kept: Tab[] = tabs
    .filter((t): t is NullableTab & { root: LayoutNode } => t.root !== null)
    .map((t) => ({ id: t.id, title: t.title, root: t.root, activePanelId: t.activePanelId }));
  const activeTabId = kept.some((t) => t.id === layout.activeTabId)
    ? layout.activeTabId
    : (kept[0]?.id ?? layout.activeTabId);
  return { ...layout, tabs: kept, activeTabId };
}

/** The default empty workspace: one Tab with one untyped placeholder Panel (FR-029). */
export function createDefaultLayout(projectId: string, ids: NewTabIds): WorkspaceLayout {
  return {
    projectId,
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    tabs: [
      {
        id: ids.tab,
        title: 'Tab 1',
        root: makePanel(ids.panel, projectId, 'Panel 1'),
        activePanelId: ids.panel,
      },
    ],
    activeTabId: ids.tab,
  };
}

/** Add a new Tab (one placeholder Panel) and activate it (FR-012a). */
export function addTab(layout: WorkspaceLayout, ids: NewTabIds): WorkspaceLayout {
  const tab: Tab = {
    id: ids.tab,
    title: `Tab ${layout.tabs.length + 1}`,
    root: makePanel(ids.panel, layout.projectId, `Panel ${totalPanels(layout) + 1}`),
    activePanelId: ids.panel,
  };
  return { ...layout, tabs: [...layout.tabs, tab], activeTabId: ids.tab };
}

/** Add an empty placeholder Panel into a Tab (FR-012a). */
export function addPanel(layout: WorkspaceLayout, tabId: string, panelId: string): WorkspaceLayout {
  const panel = makePanel(panelId, layout.projectId, `Panel ${totalPanels(layout) + 1}`);
  return {
    ...layout,
    tabs: layout.tabs.map((tab) =>
      tab.id === tabId ? { ...tab, root: appendPanelToTabRoot(tab.root, panel) } : tab,
    ),
  };
}

/**
 * Move a Panel onto another Panel's edge, creating a row/column split (FR-014).
 * Works within a Tab (split) or across Tabs (regroup), collapsing the source slot
 * and never losing/duplicating a Panel. A no-op when source === target.
 */
export function movePanelToEdge(
  layout: WorkspaceLayout,
  sourceId: string,
  targetId: string,
  edge: Edge,
): WorkspaceLayout {
  if (sourceId === targetId) return layout;
  if (!findPanel(layout, sourceId) || !findPanel(layout, targetId)) return layout;

  let removed: Panel | null = null;
  const afterRemoval: NullableTab[] = layout.tabs.map((tab) => {
    const result = removeFromNode(tab.root, sourceId);
    if (result.removed) removed = result.removed;
    return { ...tab, root: result.node };
  });
  if (!removed) return layout;

  const inserted = afterRemoval.map((tab) =>
    tab.root ? { ...tab, root: insertAtEdge(tab.root, targetId, removed as Panel, edge) } : tab,
  );
  return finalize(layout, inserted);
}

/** Move a Panel into another Tab as a row sibling (FR cross-tab regroup). */
export function movePanelToTab(
  layout: WorkspaceLayout,
  sourceId: string,
  targetTabId: string,
): WorkspaceLayout {
  if (!findPanel(layout, sourceId)) return layout;

  let removed: Panel | null = null;
  const afterRemoval: NullableTab[] = layout.tabs.map((tab) => {
    const result = removeFromNode(tab.root, sourceId);
    if (result.removed) removed = result.removed;
    return { ...tab, root: result.node };
  });
  if (!removed) return layout;

  const inserted = afterRemoval.map((tab) => {
    if (tab.id !== targetTabId) return tab;
    if (!tab.root) return { ...tab, root: removed as Panel };
    return { ...tab, root: appendPanelToTabRoot(tab.root, removed as Panel) };
  });
  return finalize(layout, inserted);
}

/**
 * Move a Panel into a brand-new Tab that contains ONLY that Panel (FR-027 — the
 * drag-onto-"+" gesture). The Panel is moved (removed from its source Tab, whose
 * emptied split slot collapses and whose emptied Tab is pruned), the new Tab is
 * appended and becomes active. Never lets the workspace become empty: the sole
 * Panel of the workspace is not moved out (mirrors removePanel's guard), and an
 * unknown source id is a no-op.
 */
export function addTabFromPanel(
  layout: WorkspaceLayout,
  sourcePanelId: string,
  ids: { tab: string },
): WorkspaceLayout {
  if (totalPanels(layout) <= 1) return layout;
  if (!findPanel(layout, sourcePanelId)) return layout;

  let removed: Panel | null = null;
  const afterRemoval: NullableTab[] = layout.tabs.map((tab) => {
    const result = removeFromNode(tab.root, sourcePanelId);
    if (result.removed) removed = result.removed;
    return { ...tab, root: result.node };
  });
  if (!removed) return layout;

  const newTab: NullableTab = {
    id: ids.tab,
    title: `Tab ${layout.tabs.length + 1}`,
    root: removed as Panel,
    activePanelId: (removed as Panel).id,
  };
  return finalize({ ...layout, activeTabId: ids.tab }, [...afterRemoval, newTab]);
}

/**
 * Remove a Panel: collapse its split slot, remove an emptied Tab, but never let
 * the workspace become empty — the last Panel of the last Tab is retained (FR-016).
 */
export function removePanel(layout: WorkspaceLayout, panelId: string): WorkspaceLayout {
  if (totalPanels(layout) <= 1) return layout;
  let removed: Panel | null = null;
  const tabs: NullableTab[] = layout.tabs.map((tab) => {
    const result = removeFromNode(tab.root, panelId);
    if (result.removed) removed = result.removed;
    return { ...tab, root: result.node };
  });
  if (!removed) return layout;
  return finalize(layout, tabs);
}

/** Reorder a Tab to a new index (FR-012); persisted by the caller. */
export function reorderTab(layout: WorkspaceLayout, tabId: string, toIndex: number): WorkspaceLayout {
  const from = layout.tabs.findIndex((t) => t.id === tabId);
  if (from < 0) return layout;
  const tabs = [...layout.tabs];
  const [moved] = tabs.splice(from, 1);
  const clamped = Math.max(0, Math.min(toIndex, tabs.length));
  tabs.splice(clamped, 0, moved);
  return { ...layout, tabs };
}

/** Activate an existing Tab (ignores unknown ids). */
export function setActiveTab(layout: WorkspaceLayout, tabId: string): WorkspaceLayout {
  return layout.tabs.some((t) => t.id === tabId) ? { ...layout, activeTabId: tabId } : layout;
}

/** Rename a Tab (ignores blank titles) — FR-036. */
export function renameTab(layout: WorkspaceLayout, tabId: string, title: string): WorkspaceLayout {
  const trimmed = title.trim();
  if (trimmed.length === 0) return layout;
  return {
    ...layout,
    tabs: layout.tabs.map((tab) => (tab.id === tabId ? { ...tab, title: trimmed } : tab)),
  };
}

function renameInNode(node: LayoutNode, panelId: string, title: string): LayoutNode {
  if (isPanel(node)) {
    return node.id === panelId ? { ...node, title } : node;
  }
  return { ...node, children: node.children.map((c) => renameInNode(c, panelId, title)) };
}

/** Rename a Panel anywhere in the tree (ignores blank titles) — FR-037. */
export function renamePanel(
  layout: WorkspaceLayout,
  panelId: string,
  title: string,
): WorkspaceLayout {
  const trimmed = title.trim();
  if (trimmed.length === 0) return layout;
  return {
    ...layout,
    tabs: layout.tabs.map((tab) => ({ ...tab, root: renameInNode(tab.root, panelId, trimmed) })),
  };
}

/** Close a whole Tab; refused when it is the only Tab (never empty) — FR-036. */
export function closeTab(layout: WorkspaceLayout, tabId: string): WorkspaceLayout {
  if (layout.tabs.length <= 1) return layout;
  if (!layout.tabs.some((t) => t.id === tabId)) return layout;
  const tabs = layout.tabs.filter((t) => t.id !== tabId);
  const activeTabId = tabs.some((t) => t.id === layout.activeTabId)
    ? layout.activeTabId
    : tabs[0].id;
  return { ...layout, tabs, activeTabId };
}

/** Close every Tab except the target, which becomes active — FR-036. */
export function closeOtherTabs(layout: WorkspaceLayout, tabId: string): WorkspaceLayout {
  const target = layout.tabs.find((t) => t.id === tabId);
  if (!target) return layout;
  return { ...layout, tabs: [target], activeTabId: tabId };
}

function resizeNodeAt(node: LayoutNode, path: number[], sizes: number[]): LayoutNode {
  if (path.length === 0) {
    if (!isSplit(node) || sizes.length !== node.children.length) return node;
    const sum = sizes.reduce((a, b) => a + b, 0);
    if (sum <= 0) return node;
    return { ...node, sizes: sizes.map((s) => s / sum) };
  }
  if (!isSplit(node)) return node;
  const [index, ...rest] = path;
  if (index < 0 || index >= node.children.length) return node;
  const children = node.children.map((c, i) => (i === index ? resizeNodeAt(c, rest, sizes) : c));
  return { ...node, children };
}

/**
 * Resize a split node addressed by `path` (indices from the Tab root) to new,
 * normalised fractional `sizes` (FR-038). A length mismatch or non-positive sum
 * is ignored, leaving the layout unchanged.
 */
export function resizeSplit(
  layout: WorkspaceLayout,
  tabId: string,
  path: number[],
  sizes: number[],
): WorkspaceLayout {
  const next = {
    ...layout,
    tabs: layout.tabs.map((tab) =>
      tab.id === tabId ? { ...tab, root: resizeNodeAt(tab.root, path, sizes) } : tab,
    ),
  };
  // If nothing changed (mismatch ignored), return the original reference.
  const target = layout.tabs.find((t) => t.id === tabId);
  const updated = next.tabs.find((t) => t.id === tabId);
  return target && updated && target.root === updated.root ? layout : next;
}

/**
 * The Tab's effective active Panel id (003 / FR-002): the stored `activePanelId`
 * when it still references a Panel in the Tab, otherwise the Tab's first Panel.
 * Self-heals stale/absent ids (e.g. v1 documents or a removed active Panel).
 */
export function effectiveActivePanelId(tab: Tab): string | undefined {
  const panels = collectPanels(tab.root);
  if (panels.length === 0) return undefined;
  if (tab.activePanelId && panels.some((p) => p.id === tab.activePanelId)) {
    return tab.activePanelId;
  }
  return panels[0].id;
}

/**
 * The active "Tab · Panel" label shared by the status bar (FR-004) and the window
 * title (FR-040): the active Tab's title joined with its effective active Panel's
 * title, just the Tab title when the Tab has no Panel, or '' when no Tab is active.
 * Pure — one source of truth so the two surfaces can never drift.
 */
export function activeContextLabel(layout: WorkspaceLayout): string {
  const tab = layout.tabs.find((t) => t.id === layout.activeTabId);
  if (!tab) return '';
  const activeId = effectiveActivePanelId(tab);
  const panel = collectPanels(tab.root).find((p) => p.id === activeId);
  return panel ? `${tab.title} · ${panel.title}` : tab.title;
}

/** A single panel's effective zoom level (absent → 0), clamped on read (012). */
export function panelZoomLevel(panel: Panel): number {
  return clampZoomLevel(panel.zoom ?? 0);
}

/** Apply `fn` to the panel with `panelId` anywhere in a tree; identity elsewhere. */
function mapPanelById(node: LayoutNode, panelId: string, fn: (p: Panel) => Panel): LayoutNode {
  if (isPanel(node)) return node.id === panelId ? fn(node) : node;
  return { ...node, children: node.children.map((c) => mapPanelById(c, panelId, fn)) };
}

/** Set `panelId`'s zoom to `level`; returns the SAME layout reference on no change. */
function setPanelZoom(layout: WorkspaceLayout, panelId: string, level: number): WorkspaceLayout {
  let changed = false;
  const tabs = layout.tabs.map((tab) => {
    const root = mapPanelById(tab.root, panelId, (p) => {
      if (panelZoomLevel(p) === level) return p; // no-op
      changed = true;
      // Store 0 as the level explicitly (so an at-default panel round-trips as 0);
      // callers treat absent and 0 identically via panelZoomLevel.
      return { ...p, zoom: level };
    });
    return root === tab.root ? tab : { ...tab, root };
  });
  return changed ? { ...layout, tabs } : layout;
}

/**
 * Bump ONE panel's zoom by `presses` (>0 in, <0 out), clamped to the shared bounds
 * (012, revised to per-instance). Only that panel changes — every other panel,
 * including others of the same type, is untouched. A no-op at a bound returns the
 * same reference (FR-011). Immutable.
 */
export function bumpZoom(layout: WorkspaceLayout, panelId: string, presses: number): WorkspaceLayout {
  const panel = findPanel(layout, panelId);
  if (!panel) return layout;
  const next = stepZoomLevel(panelZoomLevel(panel), presses);
  return setPanelZoom(layout, panelId, next);
}

/**
 * Reset ONE panel to its default (level 0) — the inherited size (012, FR-009).
 * Idempotent: a panel already at 0 returns the same layout reference.
 */
export function resetZoom(layout: WorkspaceLayout, panelId: string): WorkspaceLayout {
  const panel = findPanel(layout, panelId);
  if (!panel) return layout;
  return setPanelZoom(layout, panelId, 0);
}

/**
 * The Panel that should become active when `removedId` is removed from a Tab's
 * split `root` (012 / FR-005). Deterministic — the panel immediately **preceding**
 * the removed one in depth-first layout order (the same order used by focus-cycle),
 * or the one immediately **following** it when the removed panel was first.
 * Returns `undefined` only when no other Panel remains (or the id is unknown), so
 * the caller can leave the tab to its normal empty-tab handling. Pure; no DOM.
 */
export function panelAfterRemoval(root: LayoutNode, removedId: string): string | undefined {
  const order = collectPanels(root).map((p) => p.id);
  const idx = order.indexOf(removedId);
  if (idx < 0 || order.length <= 1) return undefined;
  return idx === 0 ? order[1] : order[idx - 1];
}

/**
 * Activate a Panel within a Tab (003 / FR-002). Ignored if the Tab or Panel does
 * not exist. The active Panel of the focused Tab is the globally-active Panel.
 */
export function setActivePanel(
  layout: WorkspaceLayout,
  tabId: string,
  panelId: string,
): WorkspaceLayout {
  return {
    ...layout,
    tabs: layout.tabs.map((tab) => {
      if (tab.id !== tabId) return tab;
      if (!collectPanels(tab.root).some((p) => p.id === panelId)) return tab;
      return { ...tab, activePanelId: panelId };
    }),
  };
}
