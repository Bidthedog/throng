/**
 * The two questions a running transfer asks the user, hosted once per window (050 R9, contracts/
 * ui-surfaces §1 and §3), mounted in `app.tsx` inside the confirmation provider:
 *
 *   - the CLASH question — a pasted or dragged item's name is already taken (FR-017, FR-018);
 *   - the CANCEL CHOICE — the user cancelled, so keep what is finished or roll it all back (FR-019a).
 *
 * Both go through `useChoose` (`confirm-dialog.tsx`): there is one dialog slot with a focus trap, Escape
 * and text-labelled decision buttons, and a second modal kind for the same job would be the duplication
 * that model exists to prevent. Main BLOCKS on the answer — nothing is overwritten without one — so a
 * question that could never be answered would hang the paste; the dismissal paths below all answer the
 * conservative way.
 */
import { useEffect, type ReactElement } from 'react';
import { formatGrouped, formatSubject, type ClashQuestion, type ClashSide } from '@throng/core';
import { useChoose } from '../confirm-dialog.js';

const leaf = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** One side of the comparison: a file's size and time, or a folder's item count; the newer one marked. */
function Side({ side, label, testId }: { side: ClashSide; label: string; testId: string }): ReactElement {
  return (
    <div className={side.newer ? 'clash-side clash-side--newer' : 'clash-side'} data-testid={testId}>
      <div className="clash-side__label">{label}</div>
      {side.kind === 'folder' ? (
        <div>{formatGrouped(side.itemCount ?? 0)} items</div>
      ) : (
        <>
          <div>{formatGrouped(side.size ?? 0)} bytes</div>
          {side.modifiedMs !== undefined ? <div>{new Date(side.modifiedMs).toLocaleString()}</div> : null}
        </>
      )}
      {side.newer ? <strong className="clash-newer">Newer</strong> : null}
    </div>
  );
}

function ClashDetails({
  question,
  applyToAll,
}: {
  question: ClashQuestion;
  /** Written by the checkbox, read when the answer is given — see the note at the call site. */
  applyToAll: { value: boolean };
}): ReactElement {
  return (
    <div className="clash-details" data-testid="clash-details">
      {/* Incoming → existing: the arrow says which way the paste goes; the boxes carry the words. */}
      <div className="clash-sides">
        <Side side={question.incoming} label="Incoming" testId="clash-side-incoming" />
        <span className="clash-arrow" aria-hidden="true">
          →
        </span>
        <Side side={question.existing} label="Existing" testId="clash-side-existing" />
      </div>
      <label className="clash-apply-all">
        <input
          type="checkbox"
          data-testid="clash-apply-all"
          defaultChecked={false}
          onChange={(e) => {
            applyToAll.value = e.currentTarget.checked;
          }}
        />{' '}
        Apply to all remaining clashes
      </label>
    </div>
  );
}

export function ClashPrompt(): ReactElement | null {
  const choose = useChoose();

  useEffect(() => {
    const transfer = window.throng?.transfer;
    if (!transfer) return undefined;

    const offClash = transfer.onClash((question) => {
      /*
       * The checkbox state lives in a plain object the checkbox writes to, rather than being read
       * back from the DOM once the choice settles: the dialog unmounts in the same turn the choice
       * resolves, and a ref read after that finds nothing.
       */
      const applyToAll = { value: false };
      void choose({
        title: 'Name already exists',
        message: (
          <>
            &quot;<strong>{question.name}</strong>&quot; already exists in{' '}
            {formatSubject({ kind: 'folder', name: leaf(question.targetDir) })}.
          </>
        ),
        testIds: { overlay: 'clash-overlay', dialog: 'clash-dialog', message: 'clash-message' },
        details: <ClashDetails question={question} applyToAll={applyToAll} />,
        choices: [
          { label: 'Cancel', value: 'cancel', testId: 'clash-cancel' },
          { label: 'Skip', value: 'skip', testId: 'clash-skip' },
          { label: 'Keep both', value: 'keep-both', testId: 'clash-keep-both' },
          {
            // FR-018f — under a permanent replace the old item is gone for good, and the button says so.
            label: question.permanentReplace ? 'Replace (cannot be undone)' : 'Replace',
            value: 'replace',
            danger: question.permanentReplace,
            testId: 'clash-replace',
          },
        ],
        initialFocusValue: 'replace', // Enter answers Replace (FR-018)
      }).then((value) => {
        // Escape — or a question displaced by another — is CANCEL: it ends the run, and the cancel
        // choice that follows keeps everything unless the user says otherwise.
        if (value === 'replace' || value === 'skip' || value === 'keep-both') {
          transfer.resolveClash(question.requestId, { choice: value, applyToAll: applyToAll.value });
        } else {
          transfer.resolveClash(question.requestId, { choice: 'cancel' });
        }
      });
    });

    const offCancel = transfer.onCancelChoice(({ jobId }) => {
      void choose({
        title: 'Cancel paste?',
        message: 'Keep the items already pasted, or roll the whole paste back?',
        testIds: { overlay: 'paste-cancel-overlay', dialog: 'paste-cancel-dialog', message: 'paste-cancel-message' },
        choices: [
          { label: 'Keep finished', value: 'keep', testId: 'paste-keep' },
          { label: 'Roll back', value: 'rollback', testId: 'paste-rollback' },
        ],
        // Enter is the answer that undoes nothing: a stray key must not delete a user's pasted items.
        initialFocusValue: 'keep',
      }).then((value) => {
        // Escape is Keep finished — the answer that loses nothing.
        transfer.finishCancel(jobId, value === 'rollback' ? 'rollback' : 'keep');
      });
    });

    return () => {
      offClash();
      offCancel();
    };
  }, [choose]);

  return null;
}
