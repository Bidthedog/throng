import type { ReactElement } from 'react';
import type { Panel } from '@throng/core';
import { useProjects } from '../state/projects-store.js';
import { useWorkspace } from '../state/workspace-store.js';
import { useSubWorkspaceWindow } from './subworkspace-window-context.js';
import { PanelTypeForm } from '../panel-type/panel-type-form.js';
import { TerminalPanel } from '../terminal/terminal-panel.js';
import { EditorPanel } from '../editor/editor-panel.js';

/**
 * Panel body dispatcher (005 / FR-001/003/014). Routes a Panel's body by its
 * assigned type, replacing the old inert "Empty Panel" placeholder:
 *
 *  - **untyped** (`kind === undefined`) → the type-selection form (FR-001).
 *  - **`terminal`** → the inline xterm.js terminal view (FR-014).
 *  - **unknown kind** → a neutral placeholder fallback.
 *
 * The header/drag/destroy shell stays in `PanelPlaceholder`; only the body swaps.
 * The project root is the Panel's origin project (works in the main window and in
 * a sub-workspace where a Panel may belong to another project — FR-008).
 */
export function PanelBody({ panel, tabId }: { panel: Panel; tabId: string }): ReactElement {
  const { projects, activeProject } = useProjects();
  const { layout } = useWorkspace();
  const subWin = useSubWorkspaceWindow();
  const originProject = projects.find((p) => p.id === panel.originProjectId);
  // A Panel created inside a sub-workspace has no owning project (FR-028): its
  // terminal is "rootless" and launches at the user's home directory. Crucially we
  // must NOT fall back to some unrelated active project's root here (that would
  // launch — and lock — the wrong folder). A cloned project Panel keeps its origin.
  const ownedBySub = subWin !== null && originProject === undefined;
  const root = ownedBySub ? null : (originProject?.rootFolder ?? activeProject?.rootFolder ?? null);

  if (panel.kind === undefined) {
    return <PanelTypeForm panelId={panel.id} projectRoot={root} rootless={ownedBySub} />;
  }
  if (panel.kind === 'terminal') {
    // Display labels for the app-close warning details (FR-015). A sub-workspace-
    // owned Panel shows the sub-workspace's own name.
    const meta = {
      projectName: originProject?.name ?? (ownedBySub ? subWin?.name : activeProject?.name),
      tabName: layout?.tabs.find((t) => t.id === tabId)?.title,
      panelName: panel.title,
    };
    return <TerminalPanel panel={panel} projectRoot={root} rootless={ownedBySub} meta={meta} />;
  }
  if (panel.kind === 'editor') {
    return (
      <EditorPanel
        panel={panel}
        tabId={tabId}
        projectRoot={root}
        rootless={ownedBySub}
        ownerProjectId={originProject?.id}
      />
    );
  }
  return <span className="panel-box__placeholder">Empty Panel</span>;
}
