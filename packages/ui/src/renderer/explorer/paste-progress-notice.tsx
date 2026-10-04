/**
 * The paste's ONE notice (050 FR-013, FR-019, FR-019d; contracts/ui-surfaces §2), mounted once per
 * window in `app.tsx` beside the other prompt hosts.
 *
 * ══ ONE CONDITION, ONE NOTICE ══
 *
 * "Pasting…" and "3 items could not be pasted" are the same run seen at two moments, so they are ONE
 * card that changes (`update`), not a progress strip followed by an error toast. The card lives in the
 * window's notice area, which is what keeps it on screen and cancellable whichever project is showing —
 * it is not part of any explorer — and it is persistent while the run is live (a `display` override of
 * *until dismissed*): a timed card could vanish before its Cancel was reached.
 *
 * ══ MAIN DECIDES WHEN A CARD SHOWS (FR-031) ══
 *
 * Main pushes progress from the moment a job starts and marks the event `display: true` once a card is
 * worth showing: a QUEUED run at once (it must be cancellable before it starts — FR-019d), a large one
 * after it has worked for a while. This raises the card on the first such event and keeps no clock of
 * its own. A run that never gets one raises nothing (a clean run) or just its failure report.
 */
import { useEffect, type ReactElement, type ReactNode } from 'react';
import { formatGrouped, formatSubject, type TransferProgress } from '@throng/core';
import { IconButton } from '../common/icon-button.js';
import { useNotify, type NoticeInput } from '../common/notification.js';
import { pasteFailureNotice } from './paste-failure-notice.js';

/** The card stays until the run ends: the user's notice timings must not take a live Cancel away. */
const PERSISTENT = { mode: 'dismiss', timeoutMs: 30_000 } as const;

const leaf = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

interface Run {
  /** `''` until the card is raised. */
  noticeId: string;
  /** The run's top-level item count, for the failure headline's `K of N`. */
  total: number;
  last: TransferProgress;
}

/** A byte count the way a user reads one: `512 B`, `5 MB`, `1.5 GB`, digit-grouped. */
function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${formatGrouped(unit === 0 ? Math.round(value) : Math.round(value * 10) / 10)} ${units[unit]}`;
}

/** The bar: filled by bytes done of total, or animated without a fill while the total is unknown. */
function ProgressBar({
  bytesDone,
  bytesTotal,
}: {
  bytesDone: number;
  bytesTotal: number | null;
}): ReactElement {
  if (bytesTotal === null || bytesTotal <= 0) {
    return (
      <div
        className="paste-progress__bar paste-progress__bar--indeterminate"
        role="progressbar"
        aria-label="Paste progress"
        aria-valuemin={0}
        aria-valuemax={100}
      />
    );
  }
  const percent = Math.min(100, Math.max(0, Math.floor((bytesDone / bytesTotal) * 100)));
  return (
    <div
      className="paste-progress__bar"
      role="progressbar"
      aria-label="Paste progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div className="paste-progress__fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

function earlier(n: number): string {
  return `Waiting for ${formatGrouped(n)} earlier paste${n === 1 ? '' : 's'}`;
}

export function PasteProgressNotice(): ReactElement | null {
  const { notify, update, dismiss } = useNotify();

  useEffect(() => {
    const transfer = window.throng?.transfer;
    if (!transfer) return undefined;
    const runs = new Map<string, Run>();

    const cancelControl = (jobId: string): ReactElement => (
      // A themed ICON with a hover title (the constitution's action-control rule) — this is a
      // control on a notice, not a dialog decision button, so it carries no text label.
      // Its own `cancel` token (FR-039) — never the dismiss glyph, so re-skinning one leaves the other.
      <span className="paste-progress__cancel">
        <IconButton
          token="cancel"
          className="notice__action"
          testId="paste-cancel"
          title="Cancel paste"
          onClick={() => transfer.cancel(jobId)}
        />
      </span>
    );

    /** The card's content for a progress report: message and body, nothing about identity. */
    const content = (p: TransferProgress): Pick<NoticeInput, 'message' | 'body'> => {
      const folder = formatSubject({ kind: 'folder', name: leaf(p.targetDir) });
      if (p.state === 'queued') {
        return {
          message: 'Paste queued',
          body: (
            <div className="paste-progress__body">
              <span>{earlier(p.queuedBehind)}</span>
              {cancelControl(p.jobId)}
            </div>
          ),
        };
      }
      if (p.state === 'awaiting-cancel-choice' || p.state === 'rolling-back') {
        // The choice dialog is up (or the undo is under way): nothing left to cancel from here.
        return { message: 'Cancelling paste…', body: undefined };
      }
      const { bytesDone, bytesTotal } = p;
      const sizes =
        bytesTotal === null
          ? formatSize(bytesDone)
          : `${formatSize(bytesDone)} of ${formatSize(bytesTotal)}`;
      const body: ReactNode = (
        <div className="paste-progress__body">
          <div className="paste-progress__main">
            <span className="paste-progress__text">
              {/* FILES, not top-level items: a folder is one item and may hold thousands of files. */}
              {p.filesTotal === null
                ? ''
                : `${formatGrouped(p.filesDone)} of ${formatGrouped(p.filesTotal)} files · `}
              {sizes}
              {p.current ? ` — ${formatSubject({ kind: 'file', name: leaf(p.current) })}` : ''}
            </span>
            <ProgressBar bytesDone={bytesDone} bytesTotal={bytesTotal} />
          </div>
          {cancelControl(p.jobId)}
        </div>
      );
      return { message: `Pasting into ${folder}`, body };
    };

    const raise = (run: Run): void => {
      const p = run.last;
      run.noticeId = notify({
        severity: 'info',
        subject: { kind: 'folder', name: leaf(p.targetDir) },
        testId: 'paste-progress',
        instanceKey: p.jobId,
        display: PERSISTENT,
        // Cancel is the card's only action while the run is live (FR-019): a Dismiss would take the
        // progress and the Cancel with it, and the failure report with it at the end.
        dismissible: false,
        ...content(p),
      });
    };

    const offProgress = transfer.onProgress((p) => {
      if (p.kind !== 'paste' || p.state === 'done') return;
      let run = runs.get(p.jobId);
      if (!run) {
        run = { noticeId: '', total: p.total, last: p };
        runs.set(p.jobId, run);
      }
      run.last = p;
      run.total = p.total;

      if (run.noticeId) {
        // A card that has gone mid-run (cleared from elsewhere) is raised again: progress and Cancel
        // must stay visible for as long as the run lasts (FR-019).
        if (update(run.noticeId, content(p))) return;
        run.noticeId = '';
        raise(run);
        return;
      }
      // Main decides when a card is worth showing (FR-031) — a queued run at once (FR-019d), a large
      // one after it has worked for a while — and says so with `display: true`. No clock here.
      if (p.display) raise(run);
    });

    const offDone = transfer.onDone((result) => {
      if (result.kind !== 'paste') return;
      const run = runs.get(result.jobId);
      runs.delete(result.jobId);

      const failure = pasteFailureNotice(result, run?.total);
      if (run?.noticeId) {
        // The SAME card: progress becomes the report, or goes away when there is nothing to report.
        if (failure) {
          const found = update(run.noticeId, {
            ...failure,
            body: undefined,
            // The failure uses the user's own setting for an error again, not the live-run override.
            display: undefined,
            // …and, being a report rather than a live run, it can be dismissed like any other.
            dismissible: true,
          });
          // The card went before the run did: the report must still reach the user (FR-013).
          if (!found) notify({ ...failure, instanceKey: result.jobId });
        } else {
          dismiss(run.noticeId);
        }
      } else if (failure) {
        // Over before a card was ever shown: there was no progress notice to become the report.
        notify({ ...failure, instanceKey: result.jobId });
      }
    });

    return () => {
      offProgress();
      offDone();
    };
  }, [notify, update, dismiss]);

  return null;
}
