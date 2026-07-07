import { type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import './panes.css';
import '../explorer/explorer.css';
import { useProjects } from '../state/projects-store.js';
import { FileTree } from '../explorer/file-tree.js';
import { TreeErrorBoundary } from '../explorer/error-boundary.js';
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
        onPointerDown={() => setActivePane('files')}
      >
        <div className="panel">
          <header className="panel__header">
            <span className="panel__title">Files &amp; Folders</span>
          </header>
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
