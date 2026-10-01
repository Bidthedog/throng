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
import { nextDefaultPanelName } from './unique-name.js';
import { clampZoomLevel, stepZoomLevel } from '../config/zoom.js';

// Typed-panel ops (005) live in the panel-type module but are surfaced here so
// callers reach all layout mutations through one operations surface (FR-006/020).
export { setPanelType, clearPanelType, setTerminalMemory } from '../panel-type/assignment.js';

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

/**
 * The fallback title for a new empty panel (048 FR-127): the next free place in the Blank Panel
 * sequence over every title already in this layout. The daemon then makes it unique application-wide.
 */
function nextBlankTitle(layout: WorkspaceLayout): string {
  return nextDefaultPanelName(layout.tabs.flatMap((tab) => collectPanels(tab.root).map((p) => p.title)));
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
  // A subtree without the target is returned by identity, so an untouched sibling is the SAME node.
  const children = node.children.map((c) => insertAtEdge(c, targetId, incoming, edge));
  return children.every((c, i) => c === node.children[i]) ? node : { ...node, children };
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
        root: makePanel(ids.panel, projectId, nextDefaultPanelName([])),
        activePanelId: ids.panel,
      },
    ],
    activeTabId: ids.tab,
  };
}

/**
 * Where a newly created Tab lands in the strip (FR-053/FR-053a). `'afterActive'`
 * puts it immediately to the right of the active Tab; `'end'` appends it. The
 * caller supplies this (from `tabs.newTabPosition`) so core stays free of config
 * lookups.
 */
export type NewTabPosition = 'afterActive' | 'end';

/**
 * Add a new Tab (one placeholder Panel) and activate it (FR-012a).
 *
 * `position` decides the insertion index (FR-053): `'end'` appends, which is the
 * default and the historical behaviour; `'afterActive'` inserts at
 * `activeIndex + 1`. An `activeTabId` that resolves to no Tab falls back to
 * appending, so the result always satisfies INV-7.
 */
export function addTab(
  layout: WorkspaceLayout,
  ids: NewTabIds,
  position: NewTabPosition = 'end',
): WorkspaceLayout {
  const tab: Tab = {
    id: ids.tab,
    title: `Tab ${layout.tabs.length + 1}`,
    root: makePanel(ids.panel, layout.projectId, nextBlankTitle(layout)),
    activePanelId: ids.panel,
  };
  const activeIndex = layout.tabs.findIndex((t) => t.id === layout.activeTabId);
  const at = position === 'afterActive' && activeIndex >= 0 ? activeIndex + 1 : layout.tabs.length;
  const tabs = [...layout.tabs.slice(0, at), tab, ...layout.tabs.slice(at)];
  return { ...layout, tabs, activeTabId: ids.tab };
}

/**
 * Add an empty placeholder Panel into a Tab (FR-012a). It belongs to the layout's own project unless
 * `originProjectId` names another — a command placing a project's content in a sub-workspace window, whose
 * layout belongs to `subworkspace:<id>` (044, a preview opened there).
 */
export function addPanel(
  layout: WorkspaceLayout,
  tabId: string,
  panelId: string,
  originProjectId: string = layout.projectId,
): WorkspaceLayout {
  const panel = makePanel(panelId, originProjectId, nextBlankTitle(layout));
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

/** The share of the drop axis a panel dropped on a tab's outer edge takes (048 FR-061). */
const OUTER_EDGE_SHARE = 1 / 3;

/**
 * Move a Panel onto a Tab's OUTER edge (048 FR-061–FR-063, FR-067): it runs along the whole edge and
 * takes one third of the drop axis, while the rest of the tab keeps its arrangement and relative
 * proportions.
 *
 * The panel is removed first, by the ordinary collapse rules, from whichever tab holds it (an emptied
 * source tab is dropped by `finalize`). Then, when the target tab's root already runs along the drop
 * axis, the panel joins it as the new first (left/top) or last (right/bottom) member at 1/3 with the
 * others scaled by 2/3; otherwise the root is wrapped as `[panel, root]` / `[root, panel]`.
 *
 * Returns the SAME layout — the caller skips the save — when the panel already spans that edge alone
 * (it is the first/last member of a root split along the axis), for an unknown panel or tab, and when
 * the panel is the target tab's only panel (there is no rest to run beside).
 */
export function movePanelToOuterEdge(
  layout: WorkspaceLayout,
  panelId: string,
  tabId: string,
  edge: Edge,
): WorkspaceLayout {
  const target = layout.tabs.find((t) => t.id === tabId);
  if (!target || !findPanel(layout, panelId)) return layout;

  const orientation = edge === 'left' || edge === 'right' ? 'row' : 'column';
  const first = edge === 'left' || edge === 'top';
  const root = target.root;
  if (isSplit(root) && root.orientation === orientation) {
    const end = root.children[first ? 0 : root.children.length - 1];
    if (isPanel(end) && end.id === panelId) return layout;
  }

  let removed: Panel | null = null;
  const afterRemoval: NullableTab[] = layout.tabs.map((tab) => {
    const result = removeFromNode(tab.root, panelId);
    if (result.removed) removed = result.removed;
    return { ...tab, root: result.node };
  });
  const moved = removed as Panel | null;
  const rest = afterRemoval.find((t) => t.id === tabId)?.root;
  if (!moved || !rest) return layout;

  let placed: LayoutNode;
  if (isSplit(rest) && rest.orientation === orientation) {
    const scaled = rest.sizes.map((s) => s * (1 - OUTER_EDGE_SHARE));
    placed = {
      ...rest,
      children: first ? [moved, ...rest.children] : [...rest.children, moved],
      sizes: first ? [OUTER_EDGE_SHARE, ...scaled] : [...scaled, OUTER_EDGE_SHARE],
    };
  } else {
    placed = {
      type: 'split',
      orientation,
      children: first ? [moved, rest] : [rest, moved],
      sizes: first ? [OUTER_EDGE_SHARE, 1 - OUTER_EDGE_SHARE] : [1 - OUTER_EDGE_SHARE, OUTER_EDGE_SHARE],
    };
  }
  return finalize(
    layout,
    afterRemoval.map((tab) => (tab.id === tabId ? { ...tab, root: placed } : tab)),
  );
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

/**
 * Split an existing Panel's slot and put `panel` beside it (044 FR-010: a preview opens on the RIGHT
 * of its parent editor; FR-015c: Open in Editor puts the editor on the LEFT of a standalone preview).
 *
 * The target's own slot is split, wherever it sits in the tree — the same insertion a drop on a
 * panel's edge makes (`movePanelToEdge`), so the new pair takes exactly the space the target had and
 * every sibling keeps its size. Tabs that do not hold the target are returned by identity.
 *
 * Returns the same layout for an unknown target, or for a `panel` whose id is already in the layout
 * (a panel is never duplicated).
 */
export function addPanelBeside(
  layout: WorkspaceLayout,
  targetId: string,
  edge: 'left' | 'right',
  panel: Panel,
): WorkspaceLayout {
  if (!findPanel(layout, targetId) || findPanel(layout, panel.id)) return layout;
  return {
    ...layout,
    tabs: layout.tabs.map((tab) =>
      collectPanels(tab.root).some((p) => p.id === targetId)
        ? { ...tab, root: insertAtEdge(tab.root, targetId, panel, edge) }
        : tab,
    ),
  };
}

/** The side a split command puts its new panel on (048 FR-001). */
export type SplitDirection = 'down' | 'up' | 'right' | 'left';

const SPLIT_EDGE: Record<SplitDirection, Edge> = { down: 'bottom', up: 'top', right: 'right', left: 'left' };

/**
 * Split one Panel's slot 50/50 and put a new empty placeholder on the `direction` side (048 FR-001).
 *
 * Only the target leaf is replaced — through the same insertion an edge drop makes — so every other
 * panel keeps its node and size by construction. The new panel carries no `zoom` (default zoom), while
 * the target keeps its own (FR-004), and becomes the tab's active panel (FR-002).
 *
 * `newPanel` is caller-supplied, as every id in this module is. Returns the same layout for an unknown
 * tab, a target not in that tab, or a new id already in the layout.
 */
export function splitPanel(
  layout: WorkspaceLayout,
  tabId: string,
  targetPanelId: string,
  direction: SplitDirection,
  newPanel: { id: string; title: string },
): WorkspaceLayout {
  const tab = layout.tabs.find((t) => t.id === tabId);
  if (!tab || !collectPanels(tab.root).some((p) => p.id === targetPanelId)) return layout;
  if (findPanel(layout, newPanel.id)) return layout;
  const panel = makePanel(newPanel.id, layout.projectId, newPanel.title);
  const root = insertAtEdge(tab.root, targetPanelId, panel, SPLIT_EDGE[direction]);
  return {
    ...layout,
    tabs: layout.tabs.map((t) => (t.id === tabId ? { ...t, root, activePanelId: panel.id } : t)),
  };
}

/**
 * Remove every Panel matching `predicate` exactly as closing each by hand would (044 FR-063, FR-064,
 * FR-067): through {@link removePanel}, so a split slot collapses and an emptied Tab closes.
 *
 * The one difference from closing by hand is at the very end. `removePanel` REFUSES to remove the
 * workspace's last panel (002 FR-016) — right for a user's click, wrong here, where the preview has to
 * go because its provider is gone. So a match that is the last panel is REPLACED by a fresh untyped
 * placeholder (`newPanelId()`, the default title), and the workspace keeps the Tab and Panel FR-016
 * requires.
 *
 * `newPanelId` is supplied by the caller, as every id in this module is (`NewTabIds`), and is called
 * only when a replacement is actually needed. Idempotent: the placeholder is untyped, so a second run
 * with the same predicate matches nothing and returns the layout by identity.
 */
export function removePanelsWhere(
  layout: WorkspaceLayout,
  predicate: (panel: Panel) => boolean,
  newPanelId: () => string,
): WorkspaceLayout {
  const matches = layout.tabs.flatMap((tab) => collectPanels(tab.root).filter(predicate));
  let next = layout;
  for (const match of matches) {
    if (totalPanels(next) > 1) {
      next = removePanel(next, match.id);
      continue;
    }
    const id = newPanelId();
    const placeholder = makePanel(id, next.projectId, nextDefaultPanelName([]));
    next = {
      ...next,
      tabs: next.tabs.map((tab) =>
        tab.root.type === 'panel' && tab.root.id === match.id ? { ...tab, root: placeholder, activePanelId: id } : tab,
      ),
    };
  }
  return next;
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

function retitleInNode(node: LayoutNode, panelId: string, title: string): LayoutNode {
  if (isPanel(node)) {
    // Only the fallback title moves: a panel is always SHOWN by what it holds (048 FR-032), so an
    // editor that can name itself after its file still does (the defect behind #176).
    return node.id === panelId ? { ...node, title } : node;
  }
  return { ...node, children: node.children.map((c) => retitleInNode(c, panelId, title)) };
}

/**
 * Change a Panel's fallback title (024, #184) — the "Panel N" it shows when nothing it holds names it.
 *
 * Used when throng itself has to move a name — a clash with a panel in another project or
 * sub-workspace. Any auto-title (an editor's file, a terminal's process) still replaces it on
 * display (048 FR-032).
 */
export function retitlePanel(
  layout: WorkspaceLayout,
  panelId: string,
  title: string,
): WorkspaceLayout {
  const trimmed = title.trim();
  if (trimmed.length === 0) return layout;
  return {
    ...layout,
    tabs: layout.tabs.map((tab) => ({ ...tab, root: retitleInNode(tab.root, panelId, trimmed) })),
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
