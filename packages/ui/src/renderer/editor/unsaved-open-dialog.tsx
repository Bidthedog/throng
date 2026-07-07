import type { ReactElement } from 'react';
import { useUnsavedOpenRequest, type UnsavedOpenChoice } from './unsaved-open-store.js';

/**
 * The four-choice unsaved-on-open prompt (006 Phase B, US9). When a file is opened
 * into an editor holding unsaved changes, the user chooses: discard & open, save &
 * open, keep the changes and open in a NEW editor, or cancel. Mounted once in the
 * workspace; driven by {@link useUnsavedOpenRequest}.
 */
export function UnsavedOpenDialog(): ReactElement | null {
  const req = useUnsavedOpenRequest();
  if (!req) return null;
  const choose = (c: UnsavedOpenChoice): void => req.resolve(c);
  return (
    <div className="modal-overlay" onClick={() => choose('cancel')}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        data-testid="unsaved-open-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="modal__title">Unsaved changes</h3>
        <p className="modal__message">
          <strong>{req.editorName}</strong> has unsaved changes. How do you want to open{' '}
          <strong>{req.fileName}</strong>?
        </p>
        <div className="modal__buttons">
          <button type="button" data-testid="unsaved-open-cancel" onClick={() => choose('cancel')}>
            Cancel
          </button>
          <button type="button" data-testid="unsaved-open-new" onClick={() => choose('new')}>
            Open in new editor
          </button>
          <button type="button" data-testid="unsaved-open-discard" onClick={() => choose('discard')}>
            Discard &amp; open
          </button>
          <button
            type="button"
            className="modal__confirm"
            data-testid="unsaved-open-save"
            onClick={() => choose('save')}
          >
            Save &amp; open
          </button>
        </div>
      </div>
    </div>
  );
}
