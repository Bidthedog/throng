import { useEffect, type ReactElement } from 'react';
import { isExcluded } from '@throng/core';

import { IconButton } from '../common/icon-button.js';
import { useAppSettings } from '../config/config-store.js';
import { useProjects } from '../state/projects-store.js';
import './project-settings.css';

/**
 * The project settings dialog (018 / US8, FR-041 … FR-047a).
 *
 * "Hide in this project" was a ONE-WAY DOOR. The path went into the project's `hiddenPaths` and the
 * only way back out was to hand-edit the database — the feature had no inverse, and no surface that
 * even listed what a project was hiding. This is that surface.
 *
 * It is renderer-only. `setHidden` already REPLACES the whole list, so un-hiding is a filter over what
 * the renderer is already holding: no new IPC operation, no daemon method, no schema change.
 *
 * NOTE ON SCOPE (FR-045): these are PROJECT settings, and they deliberately do not go anywhere near the
 * Preferences window's settings registry — which is user-scoped, audited for completeness, and wired to
 * feature 015's reset/revert machinery. Introducing a scope concept into that registry to house two
 * project-scoped keys would cost far more than the dialog it saved.
 */
export function ProjectSettingsDialog({ onClose }: { onClose: () => void }): ReactElement | null {
  const { activeProject, setProjectHidden } = useProjects();
  const settings = useAppSettings();
  const globs = settings.explorer.excludeGlobs;

  // FR-046 — the project can be deleted, or switched away from, while this is open. A dialog that
  // carried on editing a project that no longer exists would write to a dead id; one that kept
  // rendering the previous project's paths would be lying about whose settings are on screen.
  const projectId = activeProject?.id ?? null;
  useEffect(() => {
    if (projectId === null) onClose();
  }, [projectId, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!activeProject) return null;

  const hidden = activeProject.hiddenPaths;

  const unhide = (path: string): void => {
    // The whole list, minus one — `setHidden` replaces rather than removes, so the filter IS the
    // operation. Reading it any other way would drop every other hidden path on the floor.
    void setProjectHidden(
      activeProject.id,
      hidden.filter((p) => p !== path),
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose} data-testid="project-settings-overlay">
      <div
        className="modal project-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-settings-title"
        data-testid="project-settings-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* FR-042 — NAME the project. With several projects open and one dialog, "which project's
            settings am I looking at?" must never be a question the user has to answer by inference. */}
        <h3 className="modal__title" id="project-settings-title">
          {activeProject.name} — project settings
        </h3>

        <h4 className="project-settings__section">Hidden files &amp; folders</h4>
        {hidden.length === 0 ? (
          <p className="project-settings__empty" data-testid="project-settings-empty">
            Nothing is hidden in this project.
          </p>
        ) : (
          <ul className="project-settings__list" data-testid="project-settings-list">
            {hidden.map((path) => {
              // FR-047a — hidden AND glob-excluded. Removing this one will NOT bring the file back:
              // the glob filters a stage earlier, when the directory is read. Saying nothing would
              // leave the user clicking a button that visibly does nothing, which is a worse defect
              // than the one this dialog exists to fix.
              const alsoExcluded = isExcluded(path, globs);
              return (
                <li
                  key={path}
                  className={`hidden-path${alsoExcluded ? ' hidden-path--also-excluded' : ''}`}
                >
                  <span className="hidden-path__path">{path}</span>
                  {alsoExcluded ? (
                    <span className="hidden-path__note">
                      also matched by a global exclusion — removing it here will not bring it back
                    </span>
                  ) : null}
                  {/* A per-row remove affordance is NOT a dialog decision button, so the
                      constitution's one exception to the themeable-icon rule does not cover it
                      (FR-043a). It is an icon from the active pack, and it says what it does on
                      hover. */}
                  <IconButton
                    token="destroy"
                    className="hidden-path__remove"
                    testId={`hidden-path-remove-${path}`}
                    title={`Stop hiding ${path}`}
                    onClick={() => unhide(path)}
                  />
                </li>
              );
            })}
          </ul>
        )}

        {/* FR-047 — the hidden list is NOT the whole story. Two independent filters are at work, and a
            user who believes this list is exhaustive will not understand why a file they never hid is
            still missing. */}
        <p className="project-settings__globals" data-testid="project-settings-globals">
          The global exclusions in Preferences apply as well, to every project:{' '}
          <span className="project-settings__globs">{globs.join(', ') || 'none'}</span>
        </p>

        <div className="modal__buttons">
          <button type="button" data-testid="project-settings-close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
