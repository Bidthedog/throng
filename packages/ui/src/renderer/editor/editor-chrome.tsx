import { useEffect, useRef, type ReactElement } from 'react';
import { effectiveActivePanelId } from '@throng/core';
import { resolveScoped } from '../keybindings/scope.js';
import { useWorkspace } from '../state/workspace-store.js';
import { useProjects } from '../state/projects-store.js';
import { useAppSettings, useKeybindings } from '../config/config-store.js';
import { getActivePane } from '../workspace/active-pane.js';
import { getEditorActions } from './editor-actions.js';
import { saveAllEditors } from './editor-save-all.js';
import { EditorOpenListener } from './editor-open.js';
import { UnsavedOpenDialog } from './unsaved-open-dialog.js';
import { DirtyCloseDialog } from './dirty-close-dialog.js';
import { EditorNoticeDialog } from './editor-notice-dialog.js';
import { MissingFileWatcher } from './missing-file-watcher.js';
import { MovedPathSync } from './moved-path-sync.js';

/**
 * Editor window chrome (006): the editor keybindings (Ctrl+S / Ctrl+Shift+S,
 * active-pane gated) plus the open-from-tree listener and the editor dialogs
 * (unsaved-open, dirty-destroy, notice). Mounted in BOTH the main window and every
 * sub-workspace window so a sub-workspace-owned editor can be saved and destroyed
 * there too (FR-077). Must live inside the window's WorkspaceProvider + providers.
 */
export function EditorChrome({ isSubWorkspace = false }: { isSubWorkspace?: boolean }): ReactElement {
  return (
    <>
      <EditorKeybindings isSubWorkspace={isSubWorkspace} />
      <EditorOpenListener />
      <MissingFileWatcher />
      {/* Every editor panel in this window follows its file into the persisted layout — including
          the ones in background tabs, which are not mounted to hear it themselves (FR-008). */}
      <MovedPathSync />
      <UnsavedOpenDialog />
      <DirtyCloseDialog />
      <EditorNoticeDialog />
    </>
  );
}

/** Ctrl+S / Ctrl+Shift+S for editors, gated on a workspace Panel being active. */
function EditorKeybindings({ isSubWorkspace }: { isSubWorkspace: boolean }): null {
  const keybindings = useKeybindings();
  const ws = useWorkspace();
  const { activeProject } = useProjects();
  const settings = useAppSettings();
  const ref = useRef({ ws, activeProject, settings, isSubWorkspace });
  ref.current = { ws, activeProject, settings, isSubWorkspace };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // Resolve WITH shift to distinguish Ctrl+S (save) from Ctrl+Shift+S (Save-All).
      const live = ref.current.ws.layout;
      const action = resolveScoped(
        keybindings,
        { key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey },
        { tabs: live?.tabs, activeTabId: live?.activeTabId ?? null },
        // Save is deliberately NOT suppressed by a focused find bar: Ctrl+S must save the file
        // you are looking at, wherever the caret happens to be.
        { transientFocus: false },
      );
      if (action !== 'editor.save' && action !== 'editor.saveAll' && action !== 'editor.saveAs') return;
      // Panel-scoped: only when a workspace Panel — not the Files pane — is active.
      if (getActivePane() !== 'workspace') return;
      e.preventDefault();
      const { ws: w, activeProject: proj, settings: st, isSubWorkspace: sub } = ref.current;
      if (action === 'editor.saveAll') {
        void saveAllEditors({
          layout: w.layout ?? null,
          activeProjectId: proj?.id ?? null,
          isSubWorkspace: sub,
          scope: st.editor.saveAllScope,
        });
        return;
      }
      const layout = w.layout;
      const tab = layout?.tabs.find((t) => t.id === layout.activeTabId);
      const panelId = tab ? effectiveActivePanelId(tab) : null;
      const actions = panelId ? getEditorActions(panelId) : undefined;
      if (!actions) return;
      if (action === 'editor.saveAs') void actions.saveAs();
      else void actions.save();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keybindings]);
  return null;
}
