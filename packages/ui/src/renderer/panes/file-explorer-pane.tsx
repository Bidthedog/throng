import {
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import './panes.css';
import '../explorer/explorer.css';
import { useProjects } from '../state/projects-store.js';
import { FileTree } from '../explorer/file-tree.js';
import { TreeErrorBoundary } from '../explorer/error-boundary.js';
import { IconButton } from '../common/icon-button.js';
import { ProjectSettingsDialog } from '../project-settings/project-settings-dialog.js';
import { setActivePane, useActivePane } from '../workspace/active-pane.js';

/**
 * Inner content of the right-hand File Explorer Pane (FR-004/006): a draggable
 * leading (inner-left) resize edge, then — when a project is active — the
 * project-scoped file/folder tree (004), otherwise the empty placeholder. The
 * enclosing <section>, collapse button and rail live in app.tsx so the collapse
 * control keeps a fixed position across expand/collapse.
 */
export function FileExplorerPane({
  onResizeStart,
  resizing,
}: {
  onResizeStart: (e: ReactPointerEvent) => void;
  resizing: boolean;
}): ReactElement {
  const { activeProject, setProjectHidden } = useProjects();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The Files & Folders pane becomes the active pane on click, gating panel
  // shortcuts (Ctrl+S no-ops here) and showing a highlight (FR-015/SC-006).
  const filesActive = useActivePane() === 'files';
  return (
    <>
      <div
        className={`resize-handle resize-handle--leading${resizing ? ' resize-handle--active' : ''}`}
        data-testid="explorer-resize"
        onPointerDown={onResizeStart}
        aria-hidden
      />
      <div
        className={`pane-explorer__body${filesActive ? ' pane-explorer__body--active' : ''}`}
        data-testid="files-pane"
        data-active-pane={filesActive}
        // Principle I: the active-pane highlight follows the open project's colour (021 — the same rule
        // the workspace panels use). Set the colour inline only while this pane is the active one AND a
        // project is open; otherwise the CSS falls through to the shared `activePanelBorder` token.
        style={
          filesActive && activeProject?.colour
            ? ({ '--active-pane-colour': activeProject.colour } as CSSProperties)
            : undefined
        }
        onPointerDown={() => setActivePane('files')}
      >
        <div className="panel">
          <header className="panel__header">
            <span className="panel__title">Files &amp; Folders</span>
            <span className="panel__header-actions">
              {/* 018 / US8 (FR-041) — the way into the project settings dialog, and the only way back
                  out of "Hide in this project", which until now was a one-way door.

                  DISABLED, not absent, when there is no project: the spec originally allowed either,
                  but a control that vanishes teaches the user nothing, while one that is visibly
                  unavailable explains itself in its hover title. */}
              <IconButton
                token="settings"
                className="panel__action panel__action--icon panel__action--neutral"
                testId="project-settings-open"
                title={
                  activeProject
                    ? `Project settings — ${activeProject.name}`
                    : 'Project settings — no project is active'
                }
                disabled={!activeProject}
                onClick={() => setSettingsOpen(true)}
              />
            </span>
          </header>
          {settingsOpen ? <ProjectSettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
          {activeProject ? (
            // key on the project id so a project switch fully remounts the tree
            // with the new root (FR-002).
            <TreeErrorBoundary key={activeProject.id}>
              <FileTree
                rootFolder={activeProject.rootFolder}
                projectId={activeProject.id}
                hiddenPaths={activeProject.hiddenPaths}
                onHide={(relPath) =>
                  void setProjectHidden(activeProject.id, [...activeProject.hiddenPaths, relPath])
                }
              />
            </TreeErrorBoundary>
          ) : (
            <div className="pane-explorer__empty" data-testid="file-explorer-empty">
              <p>No files to display yet.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
