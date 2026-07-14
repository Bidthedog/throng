import { useEffect, useRef, type ReactElement } from 'react';

import { useChoose } from '../confirm-dialog.js';
import { useUnsavedOpenRequest, type UnsavedOpenChoice } from './unsaved-open-store.js';

/**
 * The four-choice unsaved-on-open prompt (006 Phase B, US9). When a file is opened into an editor
 * holding unsaved changes, the user chooses: discard & open, save & open, keep the changes and open
 * in a NEW editor, or cancel.
 *
 * 018 / FR-048a — the widest of the three n-way decision modals, and the clearest demonstration that
 * arity was the only thing separating them from the binary confirmation. Four buttons instead of
 * two, and otherwise the same dialog: modal, blocking, text-labelled, consequence-stating.
 *
 * Every identifier its suites drive is preserved (FR-053).
 */
export function UnsavedOpenDialog(): ReactElement | null {
  const req = useUnsavedOpenRequest();
  const choose = useChoose();
  const asked = useRef<typeof req>(null);

  useEffect(() => {
    if (!req || asked.current === req) return;
    asked.current = req;

    void choose({
      title: 'Unsaved changes',
      message: `${req.editorName} has unsaved changes. How do you want to open ${req.fileName}?`,
      testIds: { dialog: 'unsaved-open-dialog' },
      choices: [
        { label: 'Cancel', value: 'cancel', testId: 'unsaved-open-cancel' },
        { label: 'Open in new editor', value: 'new', testId: 'unsaved-open-new' },
        { label: 'Discard & open', value: 'discard', testId: 'unsaved-open-discard' },
        { label: 'Save & open', value: 'save', testId: 'unsaved-open-save' },
      ],
    }).then((v) => {
      // Dismissal is CANCEL — never a discard. The safe answer is the one that loses no work.
      req.resolve((v ?? 'cancel') as UnsavedOpenChoice);
    });
  }, [req, choose]);

  return null;
}
