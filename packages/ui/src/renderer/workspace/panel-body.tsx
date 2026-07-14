import type { ReactElement } from 'react';
import type { Panel } from '@throng/core';
import { useProjects } from '../state/projects-store.js';
import { useWorkspace } from '../state/workspace-store.js';
import { useSubWorkspaceWindow } from './subworkspace-window-context.js';
import { PanelTypeForm } from '../panel-type/panel-type-form.js';
import { TerminalPanel } from '../terminal/terminal-panel.js';
import { EditorPanel } from '../editor/editor-panel.js';
import { PanelDropTarget, type DropContext } from '../editor/drop-target.js';
import { openFileInPanel } from '../editor/editor-open.js';

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
  const { projects, activeProject, loading } = useProjects();
  const ws = useWorkspace();
  const { layout } = ws;
  const subWin = useSubWorkspaceWindow();
  const hasOrigin = typeof panel.originProjectId === 'string' && panel.originProjectId.length > 0;
  const originProject = projects.find((p) => p.id === panel.originProjectId);
  // FR-001: while the project list is still loading and this panel's origin project has
  // not yet appeared, the panel's OWNERSHIP — project vs sub-workspace, and therefore its
  // working directory — is not yet known. Establishing a session now could connect at the
  // wrong root (or misclassify a mirrored project panel as rootless). Hold a loading state
  // until ownership resolves, then attach.
  const ownershipPending = hasOrigin && originProject === undefined && loading;
  // A Panel created inside a sub-workspace has no owning project (FR-028): its
  // terminal is "rootless" and launches at the user's home directory. Crucially we
  // must NOT fall back to some unrelated active project's root here (that would
  // launch — and lock — the wrong folder). A cloned project Panel keeps its origin.
  const ownedBySub = subWin !== null && originProject === undefined;
  const root = ownedBySub ? null : (originProject?.rootFolder ?? activeProject?.rootFolder ?? null);

  // 018 / US9 — everything main needs to judge a path dropped on this panel. Assembled HERE, once,
  // because this is the one component that knows a panel's ownership. The drop target itself decides
  // nothing (main does); the untyped and editor panels must be judged by exactly the same facts.
  const dropCtx: DropContext = {
    panelId: panel.id,
    tabId,
    projectRoot: root,
    rootless: ownedBySub,
    ownerProjectId: originProject?.id,
    allProjectRoots: projects.map((p) => p.rootFolder),
  };

  if (panel.kind === undefined) {
    // FR-056 — a file dropped on an UNTYPED panel makes it an editor showing that file. The type form
    // has no file input at all, so the route is `setPanelType`, exactly as the explorer's "open in a
    // dedicated editor" already does it. Without this mount the drop would land on nothing.
    return (
      <PanelDropTarget
        ctx={dropCtx}
        onOpen={(absPath) => {
          ws.setPanelType(panel.id, 'editor', { filePath: absPath });
          window.throng?.panel?.notifyTyped?.(panel.id, 'editor', { filePath: absPath });
        }}
      >
        <PanelTypeForm panelId={panel.id} projectRoot={root} rootless={ownedBySub} />
      </PanelDropTarget>
    );
  }
  if (panel.kind === 'terminal') {
    // FR-001: do not establish a session until ownership is known — show a loading state.
    if (ownershipPending) {
      return (
        <div
          className="panel-box__placeholder"
          data-testid={`terminal-loading-${panel.id}`}
          role="status"
        >
          Resolving project…
        </div>
      );
    }
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
    // 018 / US9 — do not load a file until the PROJECT LIST is known.
    //
    // The confinement rule is parameterised by which projects exist. While `loading` is true the list
    // is empty, and "outside every project" is vacuously true of every path on the disk — so a
    // sub-workspace panel restoring at startup, holding a path that lives inside a project, would sail
    // straight through the check this story exists to enforce. Nobody has to do anything for this to
    // happen: the panel simply reopens.
    //
    // Terminals already wait for exactly this fact before attaching, for exactly this reason (their
    // working directory depends on it). The editor's file does too — main double-checks against its own
    // daemon-backed list, but a renderer that asks a question it cannot yet frame deserves to wait.
    if (loading) {
      return (
        <div
          className="panel-box__placeholder"
          data-testid={`editor-loading-${panel.id}`}
          role="status"
        >
          Resolving project…
        </div>
      );
    }
    return (
      <PanelDropTarget
        ctx={dropCtx}
        // THIS panel — the one the file was dropped on. A drop is a gesture at a PLACE, and routing it
        // to whichever editor happened to be active last ignores the only thing the gesture said.
        onOpen={(absPath) => void openFileInPanel(ws, tabId, panel.id, absPath)}
      >
        <EditorPanel
          panel={panel}
          tabId={tabId}
          projectRoot={root}
          rootless={ownedBySub}
          ownerProjectId={originProject?.id}
        />
      </PanelDropTarget>
    );
  }
  return <span className="panel-box__placeholder">Empty Panel</span>;
}
