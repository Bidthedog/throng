import { useEffect, useState, type ReactElement } from 'react';
import { htmlSafeSourcesFrom, isExcluded, normaliseSafeSource, parseExcludeBox, safeSourceFault } from '@throng/core';

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
 * 074 FR-072a adds a third, "Safe HTML preview sources" (`htmlSafeSources`): the remote https origins an HTML
 * Preview in this project may load stylesheets, fonts and images from, beside the global preference.
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
        className="field project-settings__add-input"
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
        className="icon-button project-settings__add-button"
        testId={buttonTestId}
        title={addTitle}
        onClick={submit}
      />
    </div>
  );
}

export function ProjectSettingsDialog({ onClose }: { onClose: () => void }): ReactElement | null {
  const { activeProject, setProjectHidden, setSearchExcludes, setHtmlSafeSources } = useProjects();
  const settings = useAppSettings();
  const globs = settings.explorer.excludeGlobs;
  const searchGlobs = settings.search.inFiles.excludeGlobs;
  const globalSources = htmlSafeSourcesFrom(settings.editor.previews);
  // The one message the safe-source add box can raise, saying what is wrong with the entry.
  const [sourceProblem, setSourceProblem] = useState<string | null>(null);
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
  const projectSources = activeProject.htmlSafeSources ?? [];

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
   * 060 FR-044 — each section's way to its GLOBAL list. 069 FR-053 (#638): Preferences opens at that very
   * setting, its section unfolded and the setting scrolled into view.
   */
  const editGlobalList = (
    key: 'explorer.excludeGlobs' | 'search.inFiles.excludeGlobs' | 'editor.previews.providers.html.safeSources',
  ): void => {
    onClose();
    window.throng?.openPreferences?.('settings', key);
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

  /** 074 FR-072a — what is wrong with an entry that is not a source, in the user's words. */
  const addSource = (text: string): boolean => {
    const source = normaliseSafeSource(text);
    if (source === null) {
      // Nothing is written behind a refusal; the text stays so it can be corrected.
      setSourceProblem(safeSourceFault(text));
      return false;
    }
    setSourceProblem(null);
    if (!projectSources.includes(source)) void setHtmlSafeSources(activeProject.id, [...projectSources, source]);
    return true;
  };

  const removeSource = (source: string): void => {
    void setHtmlSafeSources(
      activeProject.id,
      projectSources.filter((s) => s !== source),
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
            className="icon-button project-settings__close"
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
              <h4 className="section-heading project-settings__section">Hidden in File Explorer</h4>
              <IconButton
                token="settings"
                className="icon-button project-settings__prefs"
                testId="project-settings-explorer-prefs"
                title="Edit the File Explorer’s excluded globs in Preferences"
                onClick={() => editGlobalList('explorer.excludeGlobs')}
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
                        className="icon-button hidden-path__remove"
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
            {/* 069 FR-053 (#638): the description, then the list on its own line in smaller text. */}
            <div className="project-settings__globals" data-testid="project-settings-globals">
              <p className="project-settings__globals-desc">The global exclusions in Preferences apply as well, to every project:</p>
              <p className="project-settings__globs">{globs.join(', ') || 'none'}</p>
            </div>
          </section>

          <section className="project-settings__group" data-testid="project-settings-search">
            <div className="project-settings__section-head">
              <h4 className="section-heading project-settings__section">Hidden to Find &amp; Replace</h4>
              <IconButton
                token="settings"
                className="icon-button project-settings__prefs"
                testId="project-settings-search-prefs"
                title="Edit the search exclusion list in Preferences"
                onClick={() => editGlobalList('search.inFiles.excludeGlobs')}
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
                      className="icon-button hidden-path__remove"
                      testId={`search-exclude-remove-${glob}`}
                      title={`Stop hiding ${glob} from Find in Files`}
                      onClick={() => unexcludeFromSearch(glob)}
                    />
                  </li>
                ))}
              </ul>
            )}
            <div className="project-settings__globals" data-testid="project-settings-search-globals">
              <p className="project-settings__globals-desc">The search exclusion list in Preferences applies as well, to every project:</p>
              <p className="project-settings__globs">{searchGlobs.join(', ') || 'none'}</p>
            </div>
          </section>

          {/* 074 FR-072a — the third list: remote sources an HTML Preview in this project may load
              stylesheets, fonts and images from, on top of the global preference. */}
          <section className="project-settings__group" data-testid="project-settings-html">
            <div className="project-settings__section-head">
              <h4 className="section-heading project-settings__section">Safe HTML preview sources</h4>
              <IconButton
                token="settings"
                className="icon-button project-settings__prefs"
                testId="project-settings-html-prefs"
                title="Edit the global safe preview sources in Preferences"
                onClick={() => editGlobalList('editor.previews.providers.html.safeSources')}
              />
            </div>
            <AddRow
              inputTestId="html-source-add-input"
              buttonTestId="html-source-add"
              placeholder="https address, e.g. https://cdn.example.com"
              label="Source an HTML preview may load from"
              addTitle="Allow HTML previews to load from this source"
              onAdd={addSource}
              onEdit={() => setSourceProblem(null)}
            />
            {sourceProblem !== null ? (
              <p className="project-settings__notice" data-testid="html-source-notice" role="status">
                {sourceProblem}
              </p>
            ) : null}
            {projectSources.length === 0 ? (
              <p className="project-settings__empty" data-testid="project-settings-html-empty">
                No extra sources are trusted in this project.
              </p>
            ) : (
              <ul className="project-settings__list" data-testid="project-settings-html-list">
                {projectSources.map((source) => (
                  <li key={source} className="search-exclude">
                    <span className="hidden-path__path">{source}</span>
                    <IconButton
                      token="destroy"
                      className="icon-button hidden-path__remove"
                      testId={`html-source-remove-${source}`}
                      title={`Stop allowing HTML previews to load from ${source}`}
                      onClick={() => removeSource(source)}
                    />
                  </li>
                ))}
              </ul>
            )}
            <div className="project-settings__globals" data-testid="project-settings-html-globals">
              <p className="project-settings__globals-desc">
                The global preference HTML: Safe preview sources (Preferences → Editor → Previews → HTML) applies as well,
                to every project:
              </p>
              <p className="project-settings__globs">{globalSources.join(', ') || 'none'}</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
