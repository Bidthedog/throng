import { type ReactElement } from 'react';
import { useProjects } from '../state/projects-store.js';
import './status-bar.css';

/**
 * Main-window status bar (FR-003/004, as narrowed by 026 / #166): a fixed-height bar at the bottom
 * carrying the active project's ROOT FOLDER PATH, and nothing else.
 *
 * It used to carry the project colour dot, the project name, the active `Tab · Panel` context and an
 * ADMIN pill. Every one of those was a second copy of what the frameless title bar already shows —
 * `AppTitleBar` composes its identity from the SAME `activeContextLabel(layout)` call this component
 * used, plus the project name, plus a `[ADMIN]` marker, plus the project colour as the bar's own
 * tint, and `TitleManager` sends the identical string to the OS taskbar. Two rows apart, from one
 * source, is not redundancy that helps.
 *
 * The root folder path stayed because it is the one thing here the title bar deliberately does NOT
 * show (021 removed it from the window title as noise).
 *
 * The bar itself stays at its current height even though it now holds one item: it is the home for
 * status content as the project grows, and reclaiming the row would be a layout change nobody asked
 * for. Read-only; themed via `var(--throng-*)`.
 */
export function StatusBar(): ReactElement {
  const { activeProject } = useProjects();

  return (
    <footer className="throng-status-bar" data-testid="status-bar">
      <span className="throng-status-bar__left" data-testid="status-project">
        {activeProject ? (
          <span className="throng-status-bar__path" data-testid="status-project-path">
            ({activeProject.rootFolder})
          </span>
        ) : null}
      </span>
      <span className="throng-status-bar__right" />
    </footer>
  );
}
