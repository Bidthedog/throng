/**
 * Panel type assignment & revert (005 Phase A — pure; FR-006/FR-020). Immutable
 * layout ops that bind a Panel to a confirmed type, or revert a typed Panel back
 * to the untyped form. A Panel's type is fixed only *while it hosts live content*;
 * it is never permanently immutable.
 */
import {
  isPanel,
  type LayoutNode,
  type Panel,
  type PanelConfig,
  type PanelKind,
  type WorkspaceLayout,
} from '../workspace/model.js';

/** Map the Panel with `panelId` through `fn`, rebuilding the split tree immutably. */
function mapPanel(node: LayoutNode, panelId: string, fn: (p: Panel) => Panel): LayoutNode {
  if (isPanel(node)) {
    return node.id === panelId ? fn(node) : node;
  }
  return { ...node, children: node.children.map((c) => mapPanel(c, panelId, fn)) };
}

function updatePanel(
  layout: WorkspaceLayout,
  panelId: string,
  fn: (p: Panel) => Panel,
): WorkspaceLayout {
  return {
    ...layout,
    tabs: layout.tabs.map((tab) => ({ ...tab, root: mapPanel(tab.root, panelId, fn) })),
  };
}

/**
 * Assign `kind`+`config` to a Panel **iff it is currently untyped** (FR-006). A
 * no-op when the Panel is already typed (the type cannot change while content is
 * live) or the Panel is not found. Returns a new layout.
 */
export function setPanelType(
  layout: WorkspaceLayout,
  panelId: string,
  kind: PanelKind,
  config: PanelConfig,
): WorkspaceLayout {
  return updatePanel(layout, panelId, (p) =>
    p.kind === undefined ? { ...p, kind, config } : p,
  );
}

/**
 * Convert an untyped Panel to be owned by `projectId` (024 US4, #114 / FR-012).
 *
 * A tree file dropped on an untyped SUB-WORKSPACE-owned panel must become a project-owned editor, or
 * INV-4 (no cross-project panel in the main layout) would reject it. This rewrites `originProjectId`
 * — the one place a new workspace-model capability is added — and is a no-op once the panel is typed
 * (ownership is fixed while content is live). The caller chains `setPanelType` to open the file.
 * Returns a new layout; the input is untouched.
 */
export function convertPanelToProject(
  layout: WorkspaceLayout,
  panelId: string,
  projectId: string,
): WorkspaceLayout {
  return updatePanel(layout, panelId, (p) =>
    p.kind === undefined ? { ...p, originProjectId: projectId } : p,
  );
}

/**
 * Merge a partial `config` into an already-typed Panel (006). Used to persist an
 * Editor Panel's evolving state (e.g. its `filePath`/encoding/line-ending after a
 * save) into the layout blob so it restores on reopen — without changing the
 * Panel's `kind`. A no-op for an untyped Panel or one that is not found. New layout.
 */
export function updatePanelConfig(
  layout: WorkspaceLayout,
  panelId: string,
  config: PanelConfig,
): WorkspaceLayout {
  return updatePanel(layout, panelId, (p) =>
    p.kind === undefined ? p : { ...p, config: { ...(p.config ?? {}), ...config } },
  );
}

/**
 * Revert a typed Panel back to untyped (`kind`/`config` cleared), called when a
 * Terminal Panel's content ends (FR-020) so the type-selection form returns and
 * the Panel is re-typeable. A no-op when the Panel is not found. New layout.
 */
export function clearPanelType(layout: WorkspaceLayout, panelId: string): WorkspaceLayout {
  return updatePanel(layout, panelId, (p) => {
    if (p.kind === undefined && p.config === undefined) return p;
    const { kind: _kind, config: _config, ...rest } = p;
    return { ...rest, type: 'panel' };
  });
}
