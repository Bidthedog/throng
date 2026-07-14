import { useEffect, useRef, type ReactElement } from 'react';

import { useChoose } from '../confirm-dialog.js';
import { useDirtyCloseRequest, type DirtyCloseChoice } from './dirty-close-store.js';

/**
 * The save/discard/cancel prompt shown when destroying a dirty editor Panel, or a Tab / project /
 * sub-workspace holding unsaved editors (006, FR-006a).
 *
 * 018 / FR-048a — THIS IS A CONFIRMATION, and it goes through the one confirmation model now.
 *
 * The specification counted five notice idioms and missed this one: a modal, blocking dialog whose
 * text-labelled buttons state the consequence being consented to. That is a confirmation by every
 * behavioural test. It differed from the binary `confirm()` in ARITY and in nothing else — so the
 * model took an ordered set of choices, and a second component for "the same thing but with three
 * buttons" stopped being necessary.
 *
 * Every identifier its suites drive is preserved (FR-053).
 */
export function DirtyCloseDialog(): ReactElement | null {
  const req = useDirtyCloseRequest();
  const choose = useChoose();
  // The request carries a one-shot promise; asking twice for the same one would strand a dialog.
  const asked = useRef<typeof req>(null);

  useEffect(() => {
    if (!req || asked.current === req) return;
    asked.current = req;

    const list = req.files.filter(Boolean);
    void choose({
      title: 'Unsaved changes',
      message:
        `${req.targetLabel} has unsaved changes` +
        (list.length > 0 ? ` (${list.join(', ')})` : '') +
        '. Save before closing?',
      testIds: { dialog: 'dirty-close-dialog' },
      choices: [
        { label: 'Cancel', value: 'cancel', testId: 'dirty-close-cancel' },
        { label: 'Discard & close', value: 'discard', danger: true, testId: 'dirty-close-discard' },
        { label: 'Save & close', value: 'save', testId: 'dirty-close-save' },
      ],
    }).then((v) => {
      // A dismissal (overlay click / Escape) is a CANCEL — the safe answer. It must never be read as
      // consent to discard someone's unsaved work.
      req.resolve((v ?? 'cancel') as DirtyCloseChoice);
    });
  }, [req, choose]);

  return null;
}
