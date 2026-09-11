/**
 * The renderer's half of a replace commit (043 T094, T096, FR-049, FR-050, FR-051, FR-057b,
 * FR-058) — choose the matches, ask the question main told it to ask, report the answer once.
 *
 * ══ WHAT IS DELIBERATELY NOT HERE ══
 *
 * The open/unopened partition, the pre-write re-check and the write itself. All three happen inside
 * `throng:fileSearch:commit`, in one main-side turn, because the renderer cannot answer "does this
 * file have an open editor" without a race and cannot answer it AT ALL for a file in a background
 * tab (research R7). Even the CONFIRMATION is main's decision: this module does not read
 * `search.inFiles.warnIrreversibleCommit` and does not count unopened files — it asks, and if the
 * answer is `needsConfirmation` it puts main's own file count to the user and asks again.
 *
 * That is why the whole of this file is a function and not a hook. It takes `confirm` and `notify`
 * as arguments the way `clear-editor-panel-type.ts` takes its confirm, which is what lets the
 * component tier drive the dialog and the notice for real rather than assert that something was
 * called.
 */
import {
  formatGrouped,
  type MatchModes,
  type ResultRow,
  type SeverityNotificationSettings,
  type SnippetView,
} from '@throng/core';
import type { ConfirmOptions } from '../confirm-dialog.js';
import type { NoticeInput, NoticeSeverity } from '../common/notification.js';
import {
  getFindInFilesPanel,
  markFindInFilesCommitted,
  rebase,
  type CommittedEdit,
  type CommittedEdits,
} from './find-in-files-store.js';

/** One file's worth of matches, in the shape the commit channel takes. */
interface CommitTargetPayload {
  relPath: string;
  edits: { from: number; to: number }[];
}

interface RefusedCommit {
  relPath: string;
  reason: 'matchGone';
}

interface FailedCommit {
  relPath: string;
  reason: string;
}

/** 043 FR-086 — the replacement landed in this document's buffer and the save that owed it did not. */
interface UnsavedCommit {
  relPath: string;
  reason: string;
}

interface CommitOutcome {
  changedInBuffer: string[];
  changedOnDisk: string[];
  refused: RefusedCommit[];
  failed: FailedCommit[];
  /**
   * FR-086 — a subset of `changedInBuffer`, not a fifth kind of file: the replacement is in the
   * buffer either way, and this says only that it has not reached disk as FR-086 asked.
   *
   * Optional, and defaulted rather than checked in {@link asCommitResult}, deliberately — unlike
   * `applied`, a missing one IS a smaller answer. It means "nothing failed to save", which is the
   * ordinary case, and reading it as such loses the user nothing.
   */
  notSaved?: UnsavedCommit[];
  /**
   * FR-086 — which buffer files this commit saved. Optional and defaulted for the same reason as
   * `notSaved`: absent means none were, which is what every commit before FR-086 reported.
   *
   * Not derivable from `notSaved`, which is why it is on the wire at all: absence there means
   * "saved OR nothing was owed", and the headline has to tell those apart to say how many files the
   * user still has to save.
   */
  saved?: string[];
  /**
   * #378 — which of the edits this call sent were written, at the offsets it sent them.
   *
   * 043 FR-083b widens each edit with the snippet its line reads AFTER the commit, derived by main
   * from the new text. Optional per edit, because the payload is bounded
   * (`MAX_COMMIT_SNIPPET_CHARS`) and a write past the bound comes back without one.
   */
  applied: {
    relPath: string;
    edits: { from: number; to: number; snippet?: SnippetView }[];
  }[];
}

type CommitResult =
  | { committed: false; reason: 'needsConfirmation'; unopenedFileCount: number }
  | { committed: true; outcome: CommitOutcome };

export interface CommitReplaceDeps {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  notify: (notice: NoticeInput) => void;
  /**
   * How long the outcome notice stays, and whether it is shown at all (FR-082) — the user's own
   * `search.inFiles.summaryNotice*` preferences, passed in rather than read here.
   *
   * ══ REQUIRED, NOT OPTIONAL ══
   *
   * FR-082 is that for this notice the global `notifications.*` settings are **not consulted at
   * all**, on any of the three outcomes. An optional field would make that promise something a call
   * site could quietly break by omission — and the failure would be invisible, because a notice
   * falling back to its severity's global still appears and still says the right words. Required, the
   * compiler asks the question of every caller, which is how `NoticeInput.subject` enforces the same
   * kind of contract one layer up.
   *
   * Passed in rather than read from the config store because this module is a function and not a
   * hook, deliberately (see the header): the component tier drives the real dialog and the real
   * notice through it. The panel is where `useAppSettings()` already lives.
   */
  display: SeverityNotificationSettings;
  /** Absent in a window whose preload bridge is not installed; a commit then does nothing. */
  invoke?: (request: unknown) => Promise<unknown>;
  /** FR-014 — the locale the file count is grouped in, when the caller knows one. */
  locale?: string;
}

export interface CommitReplaceRequest {
  panelId: string;
  projectRoot: string;
  term: string;
  modes: MatchModes;
  replacement: string;
  /** Exactly the matches this granularity selected (FR-049). */
  rows: readonly ResultRow[];
}

/** The card's test id, so one condition has one findable surface (FR-058). */
export const COMMIT_NOTICE_TEST_ID = 'fif-commit-outcome';

const NOTHING_COMMITTED: CommittedEdits = new Map();

/** What this call is about to send, and how to read its answer back in the rows' own terms. */
interface PlannedCommit {
  readonly targets: CommitTargetPayload[];
  /**
   * Per file, the row each SENT offset came from.
   *
   * Main answers in the coordinates it was asked in, and the panel's rows are in the scan's — so
   * without this the outcome could not be attributed to the rows on screen once a rebase has moved
   * them apart.
   */
  readonly sent: Map<string, Map<number, ResultRow>>;
}

/**
 * Group the chosen rows into one target per file, each file's matches in the order they were listed
 * — and REBASE each one past the commits this panel has already made in that file (#378).
 *
 * ══ WHY THE SHIFT IS APPLIED HERE AND NOT AT THE POINT OF THE WRITE ══
 *
 * A row is an offset into the text as ONE scan found it, and the panel goes on naming those offsets
 * for as long as the list stands — through a Replace Match, then another, then a Replace All over
 * what is left (FR-049, FR-050). Every one of those commits moves the rows after it.
 *
 * Main cannot recover that from the file. `verifyEdits` re-resolves a moved match along the only
 * ladder this operation could have moved it on, which is right for the ordinary case and provably
 * insufficient for adjacent matches whose replacement contains the term: `abab` with `ab` → `zzabzz`
 * leaves `zzabzzab`, where row 2's scanned `(2,4)` still holds a match — the one the replacement
 * just inserted. Identical bytes at identical offsets to an untouched file, so the write went into
 * the middle of the previous replacement.
 *
 * The panel is the only thing that knows a commit happened, so the panel is where the arithmetic
 * belongs. This does NOT move the decision: main still partitions, still re-verifies against current
 * content and still re-checks `isOpen` before every write, in one turn. It is told WHERE the row is,
 * not what to do about it — and a rebased offset that no longer holds a match is refused exactly as
 * a scanned one would be.
 *
 * Exported because it is the whole of "which matches did this granularity select", and a unit-level
 * caller should be able to ask that without a rendered panel.
 */
export function targetsFor(
  rows: readonly ResultRow[],
  committed: CommittedEdits = NOTHING_COMMITTED,
): CommitTargetPayload[] {
  return planCommit(rows, committed).targets;
}

function planCommit(rows: readonly ResultRow[], committed: CommittedEdits): PlannedCommit {
  const byFile = new Map<string, CommitTargetPayload>();
  const sent = new Map<string, Map<number, ResultRow>>();
  for (const row of rows) {
    const edit = rebase(committed, row);
    const held = byFile.get(row.relPath);
    if (held) held.edits.push(edit);
    else byFile.set(row.relPath, { relPath: row.relPath, edits: [edit] });
    let index = sent.get(row.relPath);
    if (!index) sent.set(row.relPath, (index = new Map()));
    index.set(edit.from, row);
  }
  return { targets: [...byFile.values()], sent };
}

/**
 * Commit `rows`, confirming first if main says the write is irreversible (FR-057b).
 *
 * Resolves once the outcome has been reported. A cancelled confirmation resolves having done
 * nothing and having said nothing — there is no outcome, because nothing was attempted.
 */
export async function commitReplace(
  request: CommitReplaceRequest,
  deps: CommitReplaceDeps,
): Promise<void> {
  /*
   * The ledger is read from the store rather than passed in, for the same reason the panel does not
   * pass its results in: it is this panel's own record of what it has written, and a caller that had
   * to supply it could supply a stale one. A panel that has gone (or a unit-level caller with no
   * panel at all) has committed nothing, which is exactly the right answer for it.
   */
  const committed = getFindInFilesPanel(request.panelId)?.committed ?? NOTHING_COMMITTED;
  const { targets, sent } = planCommit(request.rows, committed);
  if (targets.length === 0 || !deps.invoke) return;

  const payload = {
    panelId: request.panelId,
    projectRoot: request.projectRoot,
    term: request.term,
    modes: request.modes,
    // Empty is valid and deletes (FR-046a). No branch, here or anywhere below.
    replacement: request.replacement,
    targets,
    confirmedIrreversible: false,
  };

  let result: CommitResult;
  try {
    result = asCommitResult(await deps.invoke(payload));
  } catch (error) {
    deps.notify(failureNotice(error, deps.display));
    return;
  }

  if (!result.committed && result.reason === 'needsConfirmation') {
    const files = result.unopenedFileCount;
    const agreed = await deps.confirm({
      title: 'Replace in files that are not open',
      message: `${formatGrouped(files, deps.locale)} ${files === 1 ? 'file' : 'files'} will be changed on disk with no way to undo it inside throng.`,
      // The condition, and the remedy the user has: version control. Not a prohibition — they may
      // absolutely do this, and the count is what lets them decide.
      warningMessage: 'Files with no open editor are written directly. Only version control can undo it.',
      confirmLabel: 'Replace on disk',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!agreed) return;
    try {
      result = asCommitResult(await deps.invoke({ ...payload, confirmedIrreversible: true }));
    } catch (error) {
      deps.notify(failureNotice(error, deps.display));
      return;
    }
  }

  if (!result.committed) return;
  const outcome = result.outcome;

  /*
   * FR-051 and #378 — mark exactly the matches that were written, and record what each displaced.
   *
   * This used to be per FILE, and it had to be: the outcome named files, so a file that was written
   * AND partially refused (FR-054a) left every one of its rows unmarked rather than claim a match had
   * landed when it had not. `applied` names the writes themselves, so the under-claim is gone — and
   * so is the reason #378 existed, because the ledger this builds is what the next commit's rebase
   * is spent on. An outcome that reported files could never have been that ledger.
   *
   * Read back through `sent`, because the offsets in the answer are the ones this call ASKED with,
   * and the panel's rows are in the scan's coordinates.
   */
  const landed: CommittedEdit[] = [];
  for (const file of outcome.applied) {
    const index = sent.get(file.relPath);
    for (const edit of file.edits) {
      const row = index?.get(edit.from);
      if (!row) continue;
      landed.push({
        relPath: row.relPath,
        from: row.from,
        // The shift THIS write caused, recorded now: the user may edit the replacement box before
        // the next commit, and what moved the text is what was written, not what is in the box.
        shift: request.replacement.length - (row.to - row.from),
        // FR-083 — and the same sentence is the reason for this one. The row renders what LANDED,
        // so the text that landed is recorded beside the distance it moved.
        replacement: request.replacement,
        // FR-083b — main's re-derivation from the new file text, when the payload had room for it.
        ...(edit.snippet === undefined ? {} : { snippet: edit.snippet }),
      });
    }
  }
  markFindInFilesCommitted(request.panelId, landed);

  deps.notify(noticeFor(outcome, deps.display));
}

/**
 * The answer, checked rather than asserted.
 *
 * `ipcMain.handle` returns whatever the service returned, and a cast says only what this file HOPES
 * arrived. An unrecognised shape then falls straight through `if (!result.committed) return;` — no
 * marking, no notice, no visible change at all, which is indistinguishable from a commit the user
 * never triggered.
 *
 * Throwing rather than returning a sentinel keeps one path: a channel that rejects and a channel
 * that answers nonsense are the same condition to the user — the replacement did not happen and
 * nothing said why — and they are reported by the same `catch`.
 */
function asCommitResult(value: unknown): CommitResult {
  const shape = value as Partial<CommitResult> | null | undefined;
  if (typeof shape !== 'object' || shape === null || typeof shape.committed !== 'boolean') {
    throw new Error('the replace channel answered in a shape this window does not recognise');
  }
  if (shape.committed === true) {
    const outcome = (shape as { outcome?: Partial<CommitOutcome> }).outcome;
    const arrays = [
      outcome?.changedInBuffer,
      outcome?.changedOnDisk,
      outcome?.refused,
      outcome?.failed,
      /*
       * `applied` is checked with the other four rather than defaulted, because a missing one is not
       * a smaller answer — it is a silent return of #378. The panel would mark nothing, its ledger
       * would stay empty, and the NEXT commit would name offsets from a scan two writes ago. Loud is
       * the only safe reading.
       */
      outcome?.applied,
    ];
    if (!arrays.every((a) => Array.isArray(a))) {
      throw new Error('the replace channel reported a commit with no outcome to read');
    }
  }
  return shape as CommitResult;
}

/**
 * A commit that could not be carried out AT ALL (FR-058).
 *
 * The same card as a completed commit, deliberately: one condition, one surface. A commit reports
 * once, whether it landed, landed partly, or never started — a second notice type would be spec
 * 032's defect in miniature, and the user cannot act on the difference anyway.
 *
 * It says what is WRONG rather than what the user may not do, and it names the reason it was given
 * — an `EPERM`, a missing handler, a channel that changed under the window — because that is the
 * only part of this a person can act on.
 */
function failureNotice(error: unknown, display: SeverityNotificationSettings): NoticeInput {
  const said = error instanceof Error ? error.message : String(error);
  return {
    severity: 'error',
    subject: { kind: 'none' },
    testId: COMMIT_NOTICE_TEST_ID,
    title: 'Replace in files',
    message: 'Nothing was replaced — the replacement could not be carried out.',
    details: said.trim().length > 0 ? [said] : [],
    // The same card as a completed commit means the same display setting (FR-082). This one is not
    // one of the three outcomes — there is no outcome — but it is the same notice, and a commit that
    // could not be carried out AT ALL is the last report a user should silently lose to a mode
    // chosen for a different notice.
    display,
  };
}

/**
 * ONE notice carrying all four arrays (FR-058, and CLAUDE.md's one-condition-one-notice).
 *
 * A commit is a single condition with a single owner. Raising a notice per array is spec 032's
 * defect exactly: one state, several wordings, in several places — and the user cannot act on the
 * arrays separately, so splitting them buys nothing and costs the ability to read the whole result.
 */
function noticeFor(outcome: CommitOutcome, display: SeverityNotificationSettings): NoticeInput {
  const inBuffer = outcome.changedInBuffer.length;
  const onDisk = outcome.changedOnDisk.length;
  // FR-086 — a document the commit was supposed to save and could not. It is still in
  // `changedInBuffer` (the replacement landed), so this only decides what that line SAYS.
  const notSaved = new Map((outcome.notSaved ?? []).map((u) => [u.relPath, u.reason]));
  const severity: NoticeSeverity =
    outcome.failed.length > 0
      ? 'error'
      : outcome.refused.length > 0 || notSaved.size > 0
        ? 'warning'
        : 'success';

  // FR-086 — which of the buffer files this commit SAVED. Counted rather than inferred from
  // `notSaved`'s absence, which cannot separate "saved" from "was already dirty".
  const savedSet = new Set(outcome.saved ?? []);
  const persisted = onDisk + savedSet.size;
  const stillPending = inBuffer - savedSet.size;

  const details: string[] = [];
  for (const p of outcome.changedInBuffer) {
    const why = notSaved.get(p);
    details.push(
      why !== undefined
        ? `${p} — changed in its editor, and could not be saved: ${failureWording(why)}`
        : savedSet.has(p)
          ? `${p} — changed in its editor and saved`
          : `${p} — changed in its editor, not saved`,
    );
  }
  for (const p of outcome.changedOnDisk) details.push(`${p} — changed on disk`);
  for (const r of outcome.refused) details.push(`${r.relPath} — not changed: the match had gone`);
  for (const f of outcome.failed) details.push(`${f.relPath} — not changed: ${failureWording(f.reason)}`);

  return {
    severity,
    subject: { kind: 'none' },
    testId: COMMIT_NOTICE_TEST_ID,
    title: 'Replace in files',
    /*
     * The headline states WHAT HAPPENED. FR-053c's mixed state is the normal outcome rather than an
     * anomaly, so the two halves are named separately instead of being summed into one number that
     * would hide which of them is already on disk.
     *
     * FR-086 MOVED THE LINE THOSE HALVES DIVIDE ON. This used to read "N in open editors and not yet
     * saved", which was true of every buffer file because a commit saved nothing. It now saves the
     * ones that were clean, so that wording became false for the ordinary case — the commonest
     * outcome would have reported files as unsaved that this very commit had just written.
     *
     * So the split is by what the user must still DO rather than by which path wrote the file: what
     * is on disk now (written directly, or replaced and saved) against what still holds unsaved work.
     * A file is in the second half only when the user's own edits were already there (FR-086a) or
     * the save failed (`notSaved`) — in both of those a save is genuinely still owed.
     */
    message: `${formatGrouped(inBuffer + onDisk)} of ${formatGrouped(
      inBuffer + onDisk + outcome.refused.length + outcome.failed.length,
    )} files changed — ${formatGrouped(persisted)} on disk, ${formatGrouped(
      stillPending,
    )} in open editors with unsaved changes.`,
    details,
    /*
     * ALL THREE OUTCOMES, from ONE setting (FR-082).
     *
     * `severity` above is still computed per outcome and still decides the colour, the icon and the
     * log level. What it no longer decides is how long the notice stays: that comes from the user's
     * Find in Files preference, whether this commit succeeded, was partly refused, or failed.
     *
     * The cost is recorded in the requirement rather than left to be discovered here — a user whose
     * global preference is that errors stay until dismissed does not get that behaviour from a failed
     * replace. It is one summary of one operation, and having it answer to three different globals
     * depending on how the operation went is the arrangement FR-082 rejected.
     */
    display,
  };
}

function failureWording(reason: string): string {
  switch (reason) {
    case 'missing':
      return 'the file is no longer there';
    case 'readOnly':
      return 'the file is read-only';
    case 'locked':
      return 'the file is in use by another program';
    // Two spellings of ONE condition, said once: the commit's own `FailedCommit` reason, and the
    // hyphenated `SaveReason` an FR-086 save comes back with.
    case 'outOfTree':
    case 'out-of-tree':
      return 'it is outside this project';
    case 'no-location':
      return 'the editor has nowhere to save it yet';
    case 'binary':
      return 'it is not a text file';
    case 'encoding':
      // Named rather than folded into "it could not be written", because the user CAN act on it:
      // opening the file in an editor that can read its encoding is the way to replace in it.
      return 'it is not UTF-8 text, so replacing in it would destroy characters';
    default:
      return 'it could not be written';
  }
}
