import { type ReactElement } from 'react';
import { activeContextLabel } from '@throng/core';
import { useProjects } from '../state/projects-store.js';
import { useWorkspace } from '../state/workspace-store.js';
import { useCapabilities } from '../panel-type/use-capabilities.js';
import './status-bar.css';

/**
 * Main-window status bar (FR-003/004): a fixed-height bar at the bottom. The LEFT
 * holds the active project (dot + name + path) and the active Tab · Panel context;
 * the RIGHT shows a red "ADMIN" pill when throng is running elevated (FR-025e) —
 * gated by the SAME daemon-capabilities signal that enables the per-terminal "Run
 * as admin" checkbox (FR-025a). Read-only; updates immediately as project/tab/panel
 * change. Themed via `var(--throng-*)`.
 */
export function StatusBar(): ReactElement {
  const { activeProject } = useProjects();
  const { layout } = useWorkspace();
  const { elevated } = useCapabilities();

  const context = layout ? activeContextLabel(layout) : '';

  return (
    <footer className="throng-status-bar" data-testid="status-bar">
      <span className="throng-status-bar__left" data-testid="status-project">
        {activeProject ? (
          <span
            className="throng-status-bar__dot"
            data-testid="status-project-dot"
            style={{ backgroundColor: activeProject.colour }}
            aria-hidden
          />
        ) : null}
        {activeProject?.name ?? 'No project'}
        {activeProject ? (
          <span className="throng-status-bar__path" data-testid="status-project-path">
            ({activeProject.rootFolder})
          </span>
        ) : null}
        <span className="throng-status-bar__context" data-testid="status-context">
          {context}
        </span>
      </span>
      <span className="throng-status-bar__right">
        {elevated ? (
          <span
            className="throng-status-bar__admin"
            data-testid="status-admin-pill"
            title="throng is running as administrator"
          >
            ADMIN
          </span>
        ) : null}
      </span>
    </footer>
  );
}
