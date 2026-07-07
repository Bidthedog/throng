/**
 * Save-All orchestration for editor panels (006 Phase A, FR-023). Resolves the
 * in-scope editors for `Ctrl+Shift+S` from the current window's layout + editor
 * state using the pure core scope rules, then saves each pathed one via its local
 * action (unpathed editors are skipped — never prompted). Cross-window/sub-ws
 * scope refinements ride the same core resolution.
 */
import {
  collectPanels,
  editorsInScope,
  partitionByPathed,
  type SaveAllScope,
  type ScopeEditor,
  type WorkspaceLayout,
} from '@throng/core';
import { getEditorState } from './editor-state.js';
import { getEditorActions } from './editor-actions.js';

export async function saveAllEditors(params: {
  layout: WorkspaceLayout | null;
  activeProjectId: string | null;
  /** True in a sub-workspace window (its editors are sub-workspace-owned). */
  isSubWorkspace?: boolean;
  scope: SaveAllScope;
}): Promise<void> {
  const { layout, activeProjectId, isSubWorkspace, scope } = params;
  if (!layout) return;

  const scopeEditors: ScopeEditor[] = [];
  for (const tab of layout.tabs) {
    for (const panel of collectPanels(tab.root)) {
      const st = getEditorState(panel.id);
      if (!st) continue; // not an editor panel
      scopeEditors.push({
        panelId: panel.id,
        tabId: tab.id,
        ownerKind: isSubWorkspace ? 'subworkspace' : 'project',
        ownerProjectId: isSubWorkspace ? undefined : panel.originProjectId,
        pathed: st.filePath !== null,
      });
    }
  }

  const ids = editorsInScope(scope, {
    editors: scopeEditors,
    activeTabId: layout.activeTabId,
    activeProjectId,
  });
  const { pathed } = partitionByPathed(ids, scopeEditors);
  for (const panelId of pathed) {
    const actions = getEditorActions(panelId);
    if (actions?.isDirty()) await actions.save();
  }
}
