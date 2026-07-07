import type { ReactElement } from 'react';
import { useEditorNotice, dismissEditorNotice } from './editor-notice-store.js';

/**
 * A single-acknowledgement message box for editor notices (006, FR-078) — e.g. a
 * refused out-of-tree save. Mounted once per window (via EditorChrome).
 */
export function EditorNoticeDialog(): ReactElement | null {
  const notice = useEditorNotice();
  if (!notice) return null;
  return (
    <div className="modal-overlay" onClick={dismissEditorNotice}>
      <div
        className={`modal${notice.files && notice.files.length > 0 ? ' modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        data-testid="editor-notice-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="modal__title">{notice.title}</h3>
        <p className="modal__message" data-testid="editor-notice-message">
          {notice.message}
        </p>
        {notice.files && notice.files.length > 0 ? (
          <ul className="editor-notice__files" data-testid="editor-notice-files">
            {notice.files.map((f, i) => (
              <li key={`${f.dir}${f.name}-${i}`} className="editor-notice__file">
                <span className="editor-notice__file-path">
                  <span className="editor-notice__file-dir">{f.dir}</span>
                  <span className="editor-notice__file-name">{f.name}</span>
                </span>
                {f.note ? <span className="editor-notice__file-note">{f.note}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="modal__buttons">
          <button
            type="button"
            className="modal__confirm"
            data-testid="editor-notice-ok"
            autoFocus
            onClick={dismissEditorNotice}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
