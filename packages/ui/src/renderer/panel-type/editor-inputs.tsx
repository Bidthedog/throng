import type { ReactElement } from 'react';

/**
 * The Editor panel type's inputs (006). Unlike Terminal, the Editor type has no
 * configuration — confirming creates a new, empty document. This renders only
 * explanatory copy, made **context-aware** (FR-077): a sub-workspace-owned editor
 * (`rootless`) belongs to no project, so it must not be told to save "within this
 * project".
 */
export function EditorInputs({ rootless = false }: { rootless?: boolean }): ReactElement {
  return (
    <p className="panel-type-form__hint" data-testid="editor-inputs-hint">
      A new empty document opens when you confirm. Save it (Ctrl+S) to choose a
      location{' '}
      {rootless
        ? 'anywhere outside your open projects (this editor belongs to the sub-workspace, not a project).'
        : 'within this project; open files from the Files & Folders tree.'}
    </p>
  );
}
