/**
 * 029 — the shared failure-cause concept.
 *
 * Four v1.0.0 bugs (#204, #182, #196, #181) are one defect: a failure deep in the stack reaches the
 * user as whatever raw string was thrown. They are fixed by one idea rather than four, because they
 * all need the same thing — a *reason* derived from the error, distinct from the error itself:
 *
 *   • a terminal that cannot start needs it to decide whether to keep its panel type (FR-003);
 *   • a blocked rename needs it to say what is holding the file (FR-011);
 *   • a missing project root needs it to name the folder (FR-015);
 *   • a dead daemon needs it reported once instead of as a series of unrelated errors (FR-007).
 *
 * The cause also OWNS THE WORDING (FR-019e) and supplies the suppression key (FR-019), so the same
 * object settles the copy and the de-duplication. That is why this lives in core rather than in any
 * one consumer: the daemon classifies, main classifies and reports, the renderer renders.
 *
 * Pure — no OS, no DOM, no I/O. Errno strings are data here, not platform calls, which is what keeps
 * Principle II satisfied while still knowing what `EBUSY` means.
 */

/**
 * The CLOSED set (FR-011a).
 *
 * Closed is the whole design. A closed set has a completion signal and can be tested to exhaustion;
 * an open-ended instruction to "classify errors" is a sweep with no end, and #195 is where sweeps
 * belong. Anything unmatched keeps today's raw message EXACTLY (FR-011b) — which is also what
 * guarantees no regression, because a classifier that declines to guess cannot make anything worse.
 */
export type FailureKind =
  | 'held'
  | 'path-missing'
  | 'permission-denied'
  | 'not-empty'
  | 'daemon-stopped';

/**
 * What kind of operation failed. Decides how an ambiguous `EPERM` resolves.
 *
 * `lock`   — rename, move, delete: the target being HELD is the likely meaning.
 * `access` — read, list, create: an ACL refusal is the likely meaning.
 */
export type FailureOperation = 'lock' | 'access';

/** Who is holding a file or folder. Absent means "not identified" — a real state (FR-012). */
export interface Holder {
  isThrong: boolean;
  /** The panel whose terminal holds it (FR-013). */
  panelTitle?: string;
  /** Set ONLY when that panel is in a different window from the one reporting (FR-013a). */
  windowTitle?: string;
  processName?: string;
  pid?: number;
}

export interface FailureCause {
  kind: FailureKind;
  /** What it happened to, in prose — a folder name, a project name. NEVER a path (FR-017). */
  subject: string;
  holder?: Holder;
  /** The original error text. Demoted, never discarded (FR-018). */
  raw: string;
}

export interface ClassifyOptions {
  subject: string;
  operation: FailureOperation;
  holder?: Holder;
}

function errnoOf(error: unknown): string | undefined {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function rawOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Classify a raw error into a cause, or `null` when it matches none of the five.
 *
 * `null` is not a failure of this function — it is FR-011b, and the caller reports the raw message
 * unchanged.
 */
export function classifyFailure(error: unknown, opts: ClassifyOptions): FailureCause | null {
  const code = errnoOf(error);
  if (code === undefined) return null;

  const kind = kindOf(code, opts.operation);
  if (kind === null) return null;

  return { kind, subject: opts.subject, holder: opts.holder, raw: rawOf(error) };
}

function kindOf(code: string, operation: FailureOperation): FailureKind | null {
  switch (code) {
    case 'EBUSY':
      return 'held';
    case 'ENOENT':
      return 'path-missing';
    case 'EACCES':
      return 'permission-denied';
    case 'ENOTEMPTY':
      return 'not-empty';
    /*
     * The one genuinely ambiguous code. Windows returns EPERM both for a held handle and for an ACL
     * refusal, and the errno cannot separate them — so the OPERATION decides, because the caller
     * knows what it attempted and this function does not.
     *
     * Getting it backwards is the exact harm #196 reports: "operation not permitted" reads as a
     * permissions problem and sends the user to check an ACL for a lock.
     */
    case 'EPERM':
      return operation === 'lock' ? 'held' : 'permission-denied';
    default:
      return null;
  }
}

/** How a holder is described in prose. Empty when it could not be identified. */
function holderPhrase(holder: Holder | undefined): string {
  if (!holder) return '';
  if (!holder.isThrong) {
    return holder.processName ? ` — ${holder.processName}${holder.pid ? ` (pid ${holder.pid})` : ''}` : '';
  }
  /*
   * FR-013b: naming throng without naming WHICH panel is barely more actionable than the errno, so
   * an unresolved panel says so rather than trailing off.
   */
  if (!holder.panelTitle) return ' — throng could not identify which panel';
  const where = holder.windowTitle ? `, in the sub-workspace "${holder.windowTitle}"` : '';
  return ` — the terminal "${holder.panelTitle}"${where}`;
}

/**
 * How the sentence should refer to the thing it is about.
 *
 * 030 FR-020/FR-023 — a notice PRESENTS its subject in its heading, and the message below it then
 * "states only what went wrong". A sentence that opens by re-quoting the name the heading has just
 * given reads as a stutter, and FR-023 forbids it outright.
 *
 * This is one option rather than a second set of sentences on purpose. Five causes have five
 * sentences and no more: a parallel "short form" table would be the wording living in two places,
 * which is precisely what FR-019e puts it here to prevent.
 */
export interface CauseMessageOptions {
  /**
   * The reporter has already named the subject, so this sentence must not.
   *
   * Set ONLY when the presented subject IS this cause's subject. They can differ — renaming a file
   * can fail because its containing folder is held — and blanking a name the reader has not been
   * given would replace an ambiguity with a nothing.
   */
  subjectPresented?: boolean;
}

/**
 * The user-facing sentence for a cause.
 *
 * The CAUSE owns this, not the reporter (FR-019e). Without that rule the wording depends on which
 * failure won a race — on the missing-root path the file tree and a terminal both fail, in a
 * non-deterministic order — so the same fault would read differently run to run and FR-015 could
 * never be guaranteed. Five causes, five sentences.
 */
export function causeMessage(cause: FailureCause, opts: CauseMessageOptions = {}): string {
  const { subject, holder } = cause;
  // "It" where the heading has already said which — the sentence is otherwise character-identical,
  // because it is the same sentence.
  const it = opts.subjectPresented ? 'It' : `"${subject}"`;
  switch (cause.kind) {
    case 'held':
      return holder?.isThrong
        ? `${it} is open in throng${holderPhrase(holder)}.`
        : `${it} is open in another program${holderPhrase(holder)}.`;
    case 'path-missing':
      return `${it} could not be found. It may have been moved, renamed or deleted.`;
    case 'permission-denied':
      return opts.subjectPresented
        ? 'You do not have permission to change it.'
        : `You do not have permission to change "${subject}".`;
    case 'not-empty':
      return `${it} still contains items.`;
    case 'daemon-stopped':
      // No subject in this sentence at all: the daemon is named because it IS the subject, and a
      // notice about it presents `{ kind: 'none' }` — there is no daemon member of `NoticeSubject`.
      return `throng's daemon has stopped. Restart it from the status bar to continue.`;
  }
}

/**
 * A stable key for "the user has already been told about this" (FR-019).
 *
 * Derived from kind + subject, and deliberately NOT from the message text: the two failures measured
 * on the missing-root path produce different messages for one cause (`ENOENT … realpath` from the
 * explorer, `Cannot lock …` from a terminal), so a text key would collapse neither. Nor from the
 * reporter, which is what would let one cause raise a notice per casualty.
 */
export function causeKey(cause: FailureCause): string {
  return `${cause.kind}:${cause.subject}`;
}

/**
 * Does a terminal that failed to start with this cause KEEP its panel type? (FR-003)
 *
 * The distinction is transient-environmental versus configuration-that-can-no-longer-be-satisfied:
 *
 *   • a missing FOLDER is transient — the folder comes back, and destroying the panel's
 *     configuration because it was briefly away is #204;
 *   • a missing FLAVOUR is a configuration the user must re-choose, and reverting to the
 *     type-selection form is correct and deliberately asserted by
 *     `packages/ui/tests/e2e/terminal-persistence.e2e.ts:81`.
 *
 * Expressed as one predicate so both consumers ask rather than each deciding — two copies of this
 * rule would drift, and the direction they drift in is "revert everything", which is the bug.
 */
export function startFailurePreservesPanelType(cause: FailureCause | null): boolean {
  if (!cause) return false; // unclassified: today's behaviour, unchanged
  return (
    cause.kind === 'held' ||
    cause.kind === 'path-missing' ||
    cause.kind === 'permission-denied' ||
    /*
     * A STOPPED DAEMON is the most transient failure in the list, and leaving it out was #204 with a
     * different trigger.
     *
     * The daemon rejects an attach it cannot serve with the errno as the whole message and no cause,
     * so this arrived unclassified and the panel reverted — stripping `kind` and `config` and
     * PERSISTING that. Open throng while its daemon is down and every configured terminal becomes an
     * empty Panel Type form, for good. The Retry control was destructive for the same reason: it
     * took the configuration it existed to protect.
     *
     * Nothing about the panel's configuration is wrong here. The daemon comes back, and the terminal
     * must still be a terminal when it does.
     */
    cause.kind === 'daemon-stopped'
  );
}

/**
 * Is this raw failure text the TRANSPORT failing, rather than a real error about a real thing?
 *
 * ══ WHY THIS IS A SHARED RULE AND NOT A LOCAL GUESS ══
 *
 * `DaemonClient` rejects a lost connection with the errno as the whole message — `ENOENT`, or
 * `daemon-unreachable`, or `invalid-response`. Those are the least informative strings in the
 * application and the most misleading: `ENOENT` for a named pipe is the same code a missing FILE
 * produces, so a user reading it goes hunting for a file that was never involved.
 *
 * Two places need to recognise them, and they must agree. The renderer needs it to say "the daemon
 * has stopped" instead of showing the token; UI main needs it to decide that a failed ATTACH was
 * transient, so a panel keeps its configuration (FR-001) instead of being reverted. Two copies of
 * this rule would drift, and the direction they drift in costs the user their terminal setup.
 *
 * ══ WHY IT IS THE MESSAGE AND NOT THE DAEMON'S STATE ══
 *
 * Asking "is the daemon down?" instead looks equivalent and is not. It relabels EVERY failure raised
 * anywhere while the daemon happens to be down — including `FilesService`, which runs in main and
 * needs no daemon at all. Measured consequence: renaming a file onto an existing name would report
 * "throng's daemon has stopped" instead of "a file with this name already exists". That breaks
 * FR-011b, which requires anything matching none of the five kinds to keep today's behaviour
 * EXACTLY, and it re-creates the wrong-words-for-the-actual-failure defect this feature exists to
 * remove.
 *
 * A spoken sentence never matches these patterns, which is what makes the narrow rule safe.
 */
export function isTransportFailure(raw: string): boolean {
  const text = raw.trim();
  // A named pipe in the text, or an ENOENT that mentions one — unambiguous.
  if (/\\\\[.?]\\pipe\\/i.test(text) || /\bENOENT\b.*\bpipe\b/i.test(text)) return true;
  // The client's own vocabulary for "I could not talk to it".
  if (/^(daemon-unreachable|invalid-response)$/i.test(text)) return true;
  // A BARE errno token — no path, no sentence. Nothing that speaks to a user looks like this.
  return /^E[A-Z]{3,}$/.test(text);
}
