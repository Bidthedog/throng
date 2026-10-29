/**
 * Unload a project (046 US4, contracts/unload.md §6) — the ONE function both the project list's row menu
 * and the Resource Monitor's Unload Project run (055 FR-063), so the two cannot disagree about what
 * unloading does: which editors are disposed, which sub-workspaces' panels are spared, whether unsaved
 * work blocks it, what terminals do.
 *
 * Extracted from `projects-panel.tsx` with its behaviour unchanged. `variant` is the opposite-action
 * row's action; `undefined` (the plain Unload Project row) runs the configured default. No dialog either
 * way (FR-111).
 */
import { useMemo } from 'react';
import { useAppSettings } from '../config/config-store.js';
import { allEditorStates, useDirtyProjectKey } from '../editor/editor-state.js';
import { disposeEditor } from '../editor/use-editor.js';
import { useProjects } from '../state/projects-store.js';
import { useDetach } from '../workspace/detach-context.js';
import { unloadProject as runUnload, type UnloadCollaborators } from './unload-project.js';

export type UnloadVariant = 'keepRunning' | 'endTerminals';

export function useUnloadProject(): (project: { readonly id: string; readonly name: string }, variant?: UnloadVariant) => void {
  const { unloadProject, reportFailure } = useProjects();
  const settings = useAppSettings();
  // The sub-workspaces WITH their Tabs, so Unload can spare a panel one of them holds. `null` only outside
  // the main window.
  const detach = useDetach();
  // Projects with any unsaved editor light the shared unsaved dot (006, US8).
  const dirtyKey = useDirtyProjectKey();
  const dirtyProjects = useMemo(() => new Set(dirtyKey ? dirtyKey.split(',') : []), [dirtyKey]);

  return (project, variant) => {
    // NOT `ws.layout`, which only ever holds the ACTIVE project's layout (the main Workspace Pane never
    // mixes projects). Unloading a project that is loaded but not active must still find and dispose its
    // editors, and `allEditorStates()` keeps an entry per panel for exactly that case: an editor's state
    // SURVIVES its panel unmounting when you switch away from its project, and is removed only on an
    // explicit destroy.
    const editorPanelIds = allEditorStates()
      .filter((s) => s.ownerProjectId === project.id)
      .map((s) => s.panelId);
    const collaborators: UnloadCollaborators = {
      settings: { projects: { unloadTerminalAction: settings.projects.unloadTerminalAction } },
      isDirty: (id) => dirtyProjects.has(id),
      subWorkspaces: detach?.subWorkspaces ?? [],
      editorPanelIds,
      unloadProject,
      // The REAL teardown (state, actions, language, view state, search, caret, links, metrics, and
      // `window.throng.editor.destroy` → EditorCoordinator.destroy), not a bare `Map.delete`.
      disposeEditor,
      reportFailure,
    };
    void runUnload(project.id, project.name, variant, collaborators);
  };
}
