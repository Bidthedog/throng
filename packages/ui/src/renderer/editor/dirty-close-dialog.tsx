import type { ReactElement } from 'react';
import { useDirtyCloseRequest, type DirtyCloseChoice } from './dirty-close-store.js';

/**
 * The save/discard/cancel prompt shown when destroying a dirty editor Panel, or a
 * Tab / project / sub-workspace holding unsaved editors (006, FR-006a). Mounted
 * once in the workspace; driven by {@link useDirtyCloseRequest}.
 */
export function DirtyCloseDialog(): ReactElement | null {
  const req = useDirtyCloseRequest();
  if (!req) return null;
  const choose = (c: DirtyCloseChoice): void => req.resolve(c);
  const list = req.files.filter(Boolean);
  return (
    <div className="modal-overlay" onClick={() => choose('cancel')}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        data-testid="dirty-close-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="modal__title">Unsaved changes</h3>
        <p className="modal__message">
          <strong>{req.targetLabel}</strong> has unsaved changes
          {list.length > 0 ? ` (${list.join(', ')})` : ''}. Save before closing?
        </p>
        <div className="modal__buttons">
          <button type="button" data-testid="dirty-close-cancel" onClick={() => choose('cancel')}>
            Cancel
          </button>
          <button
            type="button"
            className="modal__confirm modal__confirm--danger"
            data-testid="dirty-close-discard"
            onClick={() => choose('discard')}
          >
            Discard &amp; close
          </button>
          <button
            type="button"
            className="modal__confirm"
            data-testid="dirty-close-save"
            onClick={() => choose('save')}
          >
            Save &amp; close
          </button>
        </div>
      </div>
    </div>
  );
}
