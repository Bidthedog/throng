import { useEffect, type ReactElement } from 'react';

import { useNotify } from '../common/notification.js';
import { dismissEditorNotice, useEditorNotice } from './editor-notice-store.js';

/**
 * Editor notices — a refused out-of-tree save, a file that vanished from disk, a load that failed
 * (006, FR-078).
 *
 * 018 / FR-051 — THIS WAS THE NINTH IDIOM, and the specification's original count of five missed it
 * entirely: a modal, blocking, single-acknowledgement message box, with its own component and its
 * own markup. What it says is "this went wrong", which is precisely the job the notification model
 * exists to do — so it does it now, and there is one way to be told a thing failed instead of six.
 *
 * The component survives only as an ADAPTER: it watches the store it always watched, and reports
 * what it finds. Every identifier its five end-to-end suites drive is preserved (FR-053).
 *
 * It reports as an ERROR, so it PERSISTS until dismissed. That is the whole point of severity
 * governing persistence: a notice telling you your file is gone must not quietly time out while you
 * are looking somewhere else.
 */
export function EditorNoticeDialog(): ReactElement | null {
  const notice = useEditorNotice();
  const { notify } = useNotify();

  useEffect(() => {
    if (!notice) return;
    notify({
      severity: 'error',
      /*
       * 030 FR-019 — the file, where there is exactly ONE.
       *
       * An editor notice may be about a whole batch ("these files changed on disk"), and the batch
       * is already rendered as the structured list below: `NoticeSubject` names one thing, and the
       * many-things mechanism is the affected list US3 introduces (FR-029/FR-031b). So a single-file
       * notice names its file and a multi-file one states that it has no single subject rather than
       * picking one of them arbitrarily — which would be a guess, and FR-027 forbids guesses.
       *
       * The subject does not reach this notice's HEADING either way: it carries an explicit `title`
       * ("File changed on disk"), which wins. It reaches the log record, where the question "which
       * file?" has nothing else to answer it.
       */
      subject:
        notice.files?.length === 1
          ? { kind: 'file', name: notice.files[0]!.name, dir: notice.files[0]!.dir }
          : { kind: 'none' },
      title: notice.title,
      message: notice.message,
      testId: 'editor-notice-dialog',
      testIds: { message: 'editor-notice-message', dismiss: 'editor-notice-ok' },
      // The structured file list is kept EXACTLY as it was — same markup, same classes — because the
      // suites count `.editor-notice__file` elements and read the split directory/name.
      body:
        notice.files && notice.files.length > 0 ? (
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
        ) : undefined,
      // Acknowledging the notice clears the store, exactly as the OK button used to.
      onDismiss: dismissEditorNotice,
    });
  }, [notice, notify]);

  return null;
}
