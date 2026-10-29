import { useEffect, useState, type ReactElement } from 'react';
import { isExcluded, parseExcludeBox } from '@throng/core';

import { IconButton } from '../common/icon-button.js';
import { useFocusTrap } from '../common/focus-trap.js';
import { useAppSettings } from '../config/config-store.js';
import { useProjects } from '../state/projects-store.js';
import './project-settings.css';

/**
 * The project settings dialog (018 / US8, FR-041 … FR-047a; 060 #532 FR-035 / FR-036).
 *
 * "Hide in this project" was a ONE-WAY DOOR. The path went into the project's `hiddenPaths` and the
 * only way back out was to hand-edit the database — the feature had no inverse, and no surface that
 * even listed what a project was hiding. This is that surface.
 *
 * 060 #532 gives it two sections, because a project now hides things from two places: the File
 * Explorer (`hiddenPaths`, which also governs Quick Open and the file index) and Find & Replace
 * (`searchExcludeGlobs`, which governs only the search). Each section is a heading, an add row, a list
 * in its OWN scroll container, and a note naming the global list that also applies to it.
 *
 * Both writes REPLACE the stored list (`setHidden`, `setSearchExcludes`), so adding is the list plus one
 * and removing is a filter over what the renderer is already holding: no new IPC operation beyond the
 * one the search list needed.
 *
 * NOTE ON SCOPE (FR-045): these are PROJECT settings, and they deliberately do not go anywhere near the
 * Preferences window's settings registry — which is user-scoped, audited for completeness, and wired to
 * feature 015's reset/revert machinery. Introducing a scope concept into that registry to house two
 * project-scoped keys would cost far more than the dialog it saved.
 */

/**
 * A project-relative path as the explorer stores it: forward slashes, no leading `./` or `/`, no
 * trailing slash. A path pasted from Windows Explorer or a terminal arrives in any of those spellings,
 * and `hiddenPaths` is compared as a string, so storing it as typed would hide nothing.
 */
function normaliseRelPath(text: string): string {
  return text
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

/**
 * The add row both sections share: a text input and an add icon button, `Enter` adding.
 *
 * Uncontrolled by its parent on purpose — what is typed is the row's own business until it is
 * submitted, and `onAdd` answers whether the text was taken. A refusal keeps the text so it can be
 * corrected; an acceptance, or a no-op such as a duplicate, empties the box.
 */
function AddRow({
  inputTestId,
  buttonTestId,
  placeholder,
  label,
  addTitle,
  onAdd,
  onEdit,
}: {
  inputTestId: string;
  buttonTestId: string;
  placeholder: string;
  label: string;
  addTitle: string;
  /** Resolves `true` when the text should be cleared (taken, or harmlessly a no-op). */
  onAdd: (text: string) => boolean;
  onEdit?: () => void;
}): ReactElement {
  const [text, setText] = useState('');
  const submit = (): void => {
    if (text.trim() === '') return;
    if (onAdd(text)) setText('');
  };
  return (
    <div className="project-settings__add">
      <input
        type="text"
        className="project-settings__add-input"
        data-testid={inputTestId}
        value={text}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => {
          setText(e.target.value);
          onEdit?.();
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          submit();
        }}
      />
      <IconButton
        token="add"
        className="project-settings__add-button"
        testId={buttonTestId}
        title={addTitle}
        onClick={submit}
      />
    </div>
  );
}

export function ProjectSettingsDialog({ onClose }: { onClose: () => void }): ReactElement | null {
  const { activeProject, setProjectHidden, setSearchExcludes } = useProjects();
  const settings = useAppSettings();
  const globs = settings.explorer.excludeGlobs;
  const searchGlobs = settings.search.inFiles.excludeGlobs;
  // The one notice the search add box can raise (CLAUDE.md: one condition, one notice).
  const [invalidEntries, setInvalidEntries] = useState<string[]>([]);
  // Same modality as the confirmation dialog: while this is up, Tab belongs to it (018 US6/US8
  // follow-up). It is `aria-modal`, and that has to be true of the keyboard as well as the screen.
  const trap = useFocusTrap<HTMLDivElement>(Boolean(activeProject));

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
  const searchHidden = activeProject.searchExcludeGlobs ?? [];

  const unhide = (path: string): void => {
    // The whole list, minus one — `setHidden` replaces rather than removes, so the filter IS the
    // operation. Reading it any other way would drop every other hidden path on the floor.
    void setProjectHidden(
      activeProject.id,
      hidden.filter((p) => p !== path),
    );
  };

  const hide = (text: string): boolean => {
    const path = normaliseRelPath(text);
    // An empty path (`/`, `./`) names the project root, which is not something to hide.
    if (path === '') return false;
    if (!hidden.includes(path)) void setProjectHidden(activeProject.id, [...hidden, path]);
    return true;
  };

  const unexcludeFromSearch = (glob: string): void => {
    void setSearchExcludes(
      activeProject.id,
      searchHidden.filter((g) => g !== glob),
    );
  };

  /*
   * 060 FR-044 — each section's way to its GLOBAL list. Preferences opens at its Settings tab only:
   * nothing yet opens it at one setting, and building that is more than this shortcut is worth.
   */
  const editGlobalList = (): void => {
    onClose();
    window.throng?.openPreferences?.('settings');
  };

  const excludeFromSearch = (text: string): boolean => {
    const parsed = parseExcludeBox(text);
    if (parsed.invalid.length > 0) {
      // Nothing is written behind a refusal: a half-valid line the user can correct is better than a
      // partial add they have to notice.
      setInvalidEntries(parsed.invalid);
      return false;
    }
    setInvalidEntries([]);
    const fresh = parsed.globs.filter((g, i) => !searchHidden.includes(g) && parsed.globs.indexOf(g) === i);
    if (fresh.length > 0) void setSearchExcludes(activeProject.id, [...searchHidden, ...fresh]);
    return true;
  };

  return (
    <div className="modal-overlay" onClick={onClose} data-testid="project-settings-overlay">
      <div
        className="modal project-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-settings-title"
        data-testid="project-settings-dialog"
        ref={trap.ref}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trap.onKeyDown}
      >
        {/* FR-042 — NAME the project. With several projects open and one dialog, "which project's
            settings am I looking at?" must never be a question the user has to answer by inference. */}
        {/* 060 FR-044 — closed from a ✕ in the title row, where a dialog's dismiss control is looked
            for; it replaced the Close button at the foot. */}
        <div className="project-settings__header">
          <h3 className="modal__title" id="project-settings-title">
            {activeProject.name} — project settings
          </h3>
          <IconButton
            token="dismiss"
            className="project-settings__close"
            testId="project-settings-close"
            title="Close project settings"
            onClick={onClose}
          />
        </div>

        {/* FR-036 — the sections share what is left of the viewport and each list scrolls inside its
            own box, so neither section pushes the other, or Close, out of reach. */}
        <div className="project-settings__sections">
          <section className="project-settings__group" data-testid="project-settings-explorer">
            <div className="project-settings__section-head">
              <h4 className="project-settings__section">Hidden in File Explorer</h4>
              <IconButton
                token="settings"
                className="project-settings__prefs"
                testId="project-settings-explorer-prefs"
                title="Edit the File Explorer’s excluded globs in Preferences"
                onClick={editGlobalList}
              />
            </div>
            <AddRow
              inputTestId="hidden-path-add-input"
              buttonTestId="hidden-path-add"
              placeholder="Project-relative path, e.g. build/out"
              label="Path to hide in the File Explorer"
              addTitle="Hide this path in the File Explorer"
              onAdd={hide}
            />
            {hidden.length === 0 ? (
              <p className="project-settings__empty" data-testid="project-settings-empty">
                Nothing is hidden in this project.
              </p>
            ) : (
              <ul className="project-settings__list" data-testid="project-settings-list">
                {hidden.map((path) => {
                  // FR-047a — hidden AND glob-excluded. Removing this one will NOT bring the file
                  // back: the glob filters a stage earlier, when the directory is read. Saying nothing
                  // would leave the user clicking a button that visibly does nothing, which is a worse
                  // defect than the one this dialog exists to fix.
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
            {/* FR-047 — the hidden list is NOT the whole story. Two independent filters are at work,
                and a user who believes this list is exhaustive will not understand why a file they
                never hid is still missing. */}
            <p className="project-settings__globals" data-testid="project-settings-globals">
              The global exclusions in Preferences apply as well, to every project:{' '}
              <span className="project-settings__globs">{globs.join(', ') || 'none'}</span>
            </p>
          </section>

          <section className="project-settings__group" data-testid="project-settings-search">
            <div className="project-settings__section-head">
              <h4 className="project-settings__section">Hidden to Find &amp; Replace</h4>
              <IconButton
                token="settings"
                className="project-settings__prefs"
                testId="project-settings-search-prefs"
                title="Edit the search exclusion list in Preferences"
                onClick={editGlobalList}
              />
            </div>
            <AddRow
              inputTestId="search-exclude-add-input"
              buttonTestId="search-exclude-add"
              placeholder="Glob or path, e.g. **/fixtures"
              label="Pattern to hide from Find in Files"
              addTitle="Hide this pattern from Find in Files"
              onAdd={excludeFromSearch}
              onEdit={() => setInvalidEntries([])}
            />
            {invalidEntries.length > 0 ? (
              <p className="project-settings__notice" data-testid="search-exclude-notice" role="status">
                Not a valid pattern: {invalidEntries.join(', ')}
              </p>
            ) : null}
            {searchHidden.length === 0 ? (
              <p className="project-settings__empty" data-testid="project-settings-search-empty">
                Nothing is hidden from Find &amp; Replace in this project.
              </p>
            ) : (
              <ul className="project-settings__list" data-testid="project-settings-search-list">
                {searchHidden.map((glob) => (
                  <li key={glob} className="search-exclude">
                    <span className="hidden-path__path">{glob}</span>
                    <IconButton
                      token="destroy"
                      className="hidden-path__remove"
                      testId={`search-exclude-remove-${glob}`}
                      title={`Stop hiding ${glob} from Find in Files`}
                      onClick={() => unexcludeFromSearch(glob)}
                    />
                  </li>
                ))}
              </ul>
            )}
            <p className="project-settings__globals" data-testid="project-settings-search-globals">
              The search exclusion list in Preferences applies as well, to every project:{' '}
              <span className="project-settings__globs">{searchGlobs.join(', ') || 'none'}</span>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
