/**
 * FileSearchService — a Find in Files panel's scan: its lifetime, its supersession and its batching
 * (043 T050/T052, contracts/file-search-ipc.md, research R2/R4/R5).
 *
 * ══ WHY UI MAIN ══
 *
 * `ProjectFileIndexService` recorded this decision for the identical workload and both arguments
 * transfer verbatim (research R2): the renderer is sandboxed and single-threaded, so a walk over a
 * 5,000-file project there is precisely the stall FR-041 forbids; and the daemon walks nothing,
 * reads its settings once at startup, and has no reason to hold a snapshot of the filesystem. So
 * nothing in this feature touches `daemon`, `persistence`, `ipc-contract` or `platform-windows`,
 * and this file is the whole of the OS-facing half.
 *
 * ══ WHAT IS REUSED, AND WHAT IS NOT REDERIVED ══
 *
 * Four things, all already shipped, none re-implemented here (research R5, R1):
 *
 *   walk        `walkFiles` — sorted root-relative POSIX paths, an excluded FOLDER never descended
 *               into, an abandoned walk producing NOTHING rather than a truncated set
 *   exclusions  `compileExcluder` over `explorer.excludeGlobs` PLUS the project's own hidden set,
 *               composed exactly as `project-file-index.ts` composes it, both read at SCAN TIME
 *   refusals    `isProbablyBinary` and `editor.maxOpenFileBytes` — the editor's own detection and
 *               the editor's own limit, rather than a second notion of what is searchable
 *   matching    `editorMatches` — the find bar's semantics, so a file search and a buffer search
 *               cannot disagree about what a match is (FR-039)
 *
 * ══ CANCELLATION IS A GENERATION COUNTER, NOT A TOKEN ══
 *
 * `AbortController` appears nowhere in any package's `src/` (research R4). What exists is
 * `WalkOptions.cancelled`, a predicate polled once per directory, closing over a generation counter
 * that is bumped to abandon work in flight. Bumping it IS FR-043c's "superseded, never compounded",
 * for free: the abandoned walk discards its own result, and the surviving run is the only one whose
 * pushes the renderer will accept.
 *
 * ══ THE BATCH BOUND IS OWNED HERE ══
 *
 * No update carries more than `MAX_ROWS_PER_BATCH` rows, and whatever is held is flushed at least
 * every `BATCH_FLUSH_MS` even when short of a full batch, so a slow filesystem still shows progress.
 *
 * The timer is armed ONCE per batch window and deliberately NOT re-armed as rows arrive. That
 * distinction is the whole point: a quiet-period debounce re-armed on every event NEVER FIRES under
 * sustained churn — #186, measured at 180 events over 3 s producing zero reports, which is why
 * `ProjectFileIndexService` pairs its quiet period with a forced ceiling. A scan over a project of
 * small files is exactly that kind of churn, so a re-armed timer would hold every partial batch
 * until the scan ended and turn FR-041's progressive delivery back into a single report.
 *
 * ══ STALENESS ADDS NO WATCHER (FR-045d, research R6) ══
 *
 * {@link FileSearchService.noteDirectoryChanged} is a method somebody else calls. This service
 * watches nothing, holds no root, and has no disposal or failure path for a watch — because
 * `ExplorerWatcher` already recursively watches the active project root and already broadcasts
 * `throng:files:changed` to every window, with exactly one subscriber before this one. A second
 * consumer of that watch costs ZERO new watches, which is what FR-045d asks for and what #272 and
 * #306 exist to protect.
 *
 * The catch R6 states plainly is that NEITHER existing signal reports a content change:
 * `throng:files:changed` carries `{ relDir }` and nothing else — no filename, no event kind — and
 * the project file index is a MEMBERSHIP index, so a modified file produces no delta at all. So the
 * directory signal is a prompt to LOOK, not the answer: on one, this re-stats the result files it
 * holds under that directory and marks the ones whose stamp moved. Per file (FR-045a) — a
 * panel-level "something changed" indicator is explicitly not sufficient.
 */
import {
  BATCH_FLUSH_MS,
  MAX_ROWS_PER_BATCH,
  compileExcluder,
  decode,
  editorMatches,
  hiddenPathGlobs,
  isProbablyBinary,
  isUnderPath,
  normaliseForCompare,
  snippetFor,
  toAbsPath,
  walkFiles,
  type IFileSystem,
  type MatchModes,
  type ResultRow,
  type ScanStatus,
  type SearchScope,
} from '@throng/core';
import { Text } from '@codemirror/state';

/** What a panel is told, on the wire (contracts/file-search-ipc.md, `throng:fileSearch:update`). */
export interface FileSearchUpdate {
  panelId: string;
  /**
   * MANDATORY on every update, never optional.
   *
   * The renderer drops anything from a run it has already superseded, and an update that cannot say
   * which run it belongs to is unattributable — which is the same as unusable. This one field is
   * why supersession needs no cancel handshake.
   */
  generation: number;
  status: ScanStatus;
  /**
   * FR-078a — this is the run's WHOLE state, not a batch: `rows` REPLACES rather than appends, and
   * the totals beside them are authoritative.
   *
   * Sent to exactly one window, exactly when it attaches, and it is the one message the batch bound
   * below does not apply to. Without the flag a re-attaching window — a remount, a tab switched back
   * to — would append a result set it already held and show every row twice.
   */
  snapshot?: true;
  /** A batch, appended in arrival order. At most `MAX_ROWS_PER_BATCH` of them. */
  rows?: ResultRow[];
  totalMatches?: number;
  filesScanned?: number;
  /** FR-045f — ONE count for the whole scan, never a notice or a marker per file. */
  skipped?: number;
  /**
   * FR-045a — the result files that have changed since the scan read them, root-relative POSIX.
   *
   * The WHOLE set each time rather than a delta, and cumulative for the run: it can arrive at any
   * point, including long after `complete`, and a renderer that had to accumulate deltas would hold
   * a set neither end could re-state after a dropped message.
   */
  staleFiles?: string[];
  /**
   * FR-078b — the query these rows came from, sent ONLY to a window that is not driving the search.
   *
   * FR-078 shares the run; this shares what the run is FOR. Without it a window shown another
   * window's results describes them with a query of its own that may be several searches out of
   * date — a box reading `needle` above a list of `haystack` matches — and any commit it offers
   * sends that stale term with the shared run's rows, which FR-054 then refuses file by file as
   * `matchGone` while the matches sit on screen.
   *
   * ABSENT for the originator, and that is the whole safety of it. The window being typed into is
   * the authority on its own box: handing the run's term back to it would fight the user's keystrokes
   * every time a debounced re-run landed mid-word, which is the same hazard that makes
   * `find-in-files-panel.tsx` read `panel.config` once and never again. So the query travels one way
   * — from whichever window last started or retargeted the run, to every other viewer.
   */
  adoptQuery?: { term: string; modes: MatchModes };
}

/** What a file looked like when the scan read it (FR-045a). Both halves — see `IFileSystem`. */
interface FileStamp {
  mtimeMs: number;
  size: number;
}

export interface StartScanRequest {
  panelId: string;
  /** Absolute, canonical. */
  projectRoot: string;
  /** Root-relative POSIX, or `null` for the whole root. */
  scopeSubPath: string | null;
  term: string;
  modes: MatchModes;
}

export type StartScanResult =
  | { started: true }
  | { started: false; reason: 'emptyTerm' | 'noProject' | 'scopeMissing' };

/**
 * One live scan per PANEL, watched by every window displaying it (data-model §R2, R23, FR-078).
 *
 * ══ WHY THE WINDOW USED TO BE PART OF THE IDENTITY, AND WHY IT IS NOT ANY MORE ══
 *
 * A panel id is unique within a workspace, not within the process, and a sub-workspace's synced view
 * is the SAME panel mirrored into a second window under the same id. Keyed by `panelId` alone the
 * two views shared one run and two failures followed: closing the mirrored view aborted the scan the
 * parent was running, and a search typed in the mirror reassigned the run's single `webContentsId`,
 * delivering the parent's updates to the child and leaving the parent `running` for ever with a
 * Cancel control that reached nothing. Keying by `${webContentsId}:${panelId}` answered both.
 *
 * It also made US5 scenario 6 unreachable (#380): the mirror had no run of its own, so it showed an
 * empty panel — indistinguishable from a search that found nothing — and the user retyped a search
 * that was already correct. R23 puts the window identity where it belongs, in {@link ScanRun.viewers},
 * and re-answers both original failures without the key:
 *
 *   closing the mirror aborts the parent   reference counting — `drop` detaches ONE viewer, and only
 *                                          the last one releases the run
 *   a search in the mirror redirects       it no longer redirects: the mirror IS the panel, so a
 *                                          search typed there is a search on that panel and both
 *                                          windows must see it (FR-043c, supersession per panel)
 *
 * What the composite key really protected is untouched, because it is the case that still matters:
 * two DIFFERENT panels, in two windows, over two projects, have two panel ids and two unrelated runs.
 * FR-018 is enforced by the viewer set instead of by the key — a window not in the set receives
 * nothing, and nothing is ever broadcast.
 */
interface ScanRun {
  /** The panel id — the key this run is held under, and what goes back out on the wire. */
  readonly id: string;
  /**
   * Every window currently displaying this panel (FR-078).
   *
   * Populated by `start` and by `attach`, emptied by `drop` and by `release`, and the run dies when
   * it empties — which is FR-023 unchanged, since closing a panel unmounts it in every window.
   *
   * REGISTERED, never inferred: main cannot see which windows have a panel mounted, because the
   * workspace layout lives in the renderer. The sender is always `event.sender`.
   */
  readonly viewers: Set<number>;
  /**
   * The window DRIVING this search — whichever last started or retargeted it (FR-078b).
   *
   * Not "the parent" and not "the first viewer": ownership follows the typing, so a search retyped
   * in a sub-workspace makes that window the owner and the parent the follower. It exists only to
   * decide who is sent `adoptQuery`, and it is deliberately not part of the run's identity — that
   * mistake is the composite key described above, which this field must not quietly reinstate.
   */
  originator: number;
  /** Bumped to supersede. Anything in flight at a lower value discards itself. */
  generation: number;
  status: ScanStatus;
  scope: SearchScope;
  term: string;
  modes: MatchModes;
  /** FR-045f — binary, too large, or its read failed. One number for the whole run. */
  skipped: number;
  filesScanned: number;
  totalMatches: number;
  /**
   * FR-078a — every row this run has emitted, retained for the life of the run.
   *
   * So a window that attaches AFTER the walk finished is sent a snapshot rather than an empty panel.
   * The opposite used to be explicit here — the rows were pushed and forgotten — and the honest cost
   * of changing it is that peak memory becomes one main-side copy plus one per attached window,
   * where it was one per window. With no match ceiling (Assumptions) that is unbounded in the same
   * way the renderer's own copy already is.
   *
   * The bound is the one FR-078a names and no other: the run dies with the panel. Nothing outlives
   * it, nothing is cached beside it, and nothing crosses `Panel.config` — so FR-023 is untouched and
   * a restored panel still comes back with no results.
   */
  rows: ResultRow[];
  /** Rows found but not yet pushed. Drained by size and by the forced ceiling below. */
  pending: ResultRow[];
  /** The forced flush. Armed once per batch window; never re-armed by an arriving row. */
  flushTimer: ReturnType<typeof setTimeout> | null;
  /**
   * The files that CONTRIBUTED results, and what they looked like when they were read (FR-045a).
   *
   * Only contributors, because staleness is a statement about the list on screen: a file the walk
   * opened and found nothing in has no row to be stale. Keyed by root-relative POSIX path — the
   * same identity the rows carry, so the renderer needs no second mapping.
   *
   * A stamp per contributing file, bounded by the file count — and since FR-078a it sits beside
   * {@link ScanRun.rows} rather than being the run's whole memory of its results.
   */
  held: Map<string, FileStamp>;
  /** Cumulative for the run (FR-045a). Cleared when the run is superseded — that is FR-045c. */
  staleFiles: Set<string>;
}

export class FileSearchService {
  /** Keyed by panel id (R23). The windows watching each run are in its own `viewers` set. */
  private readonly runs = new Map<string, ScanRun>();

  /**
   * Windows that have attached to a panel with NO run yet, so the next scan reaches them (FR-078).
   *
   * Not decoration, and not the same thing as an empty viewer set. The reachable sequence is: the
   * panel is open in both windows before anything has been searched, the sub-workspace attaches to a
   * panel that has never run, and the user then types the search in the PARENT. Without this the
   * child would be absent from the run `start` creates and would watch the scan it is displaying go
   * past without seeing a row of it — #380 again, one step earlier.
   *
   * A map of ids rather than a placeholder run, deliberately: a run needs a scope, and inventing one
   * for a panel nobody has searched would put a project root on a run that has none and hand every
   * `for (const run of this.runs.values())` loop an object to skip.
   */
  private readonly waiting = new Map<string, Set<number>>();

  private disposed = false;

  constructor(
    private readonly fs: IFileSystem,
    /**
     * Read AT SCAN TIME and never captured, exactly as the file index reads it.
     *
     * Capturing it at construction is the habit that disqualified the daemon from owning a walk
     * (research R2); importing it here would reproduce the bug one layer up.
     */
    private readonly excludeGlobs: () => readonly string[],
    /** The project's own "Hide in this project" set, keyed by root — read at scan time too. */
    private readonly hiddenPaths: (root: string) => readonly string[],
    /** `editor.maxOpenFileBytes`. The editor's limit, not a second one (FR-045e). */
    private readonly maxFileBytes: () => number,
    /**
     * Deliver to ONE webContents. Called once per VIEWER of a run — never a broadcast (FR-018).
     *
     * The distinction survives FR-078 intact and is the reason the house `broadcastToWindows` was
     * rejected for this channel (R23, Principle I): an update carries one project's root-relative
     * paths and the text around every match, and a sub-workspace window may be holding a different
     * project. Delivering to every window and filtering in the renderer answers FR-018 one layer too
     * late. So the recipients are named, and they are named by the set the panel registered.
     */
    private readonly push: (webContentsId: number, payload: FileSearchUpdate) => void,
  ) {}

  /**
   * Start or SUPERSEDE the scan for one panel (FR-043, FR-043c).
   *
   * The generation is bumped in the same synchronous run as the walk that reads it — nothing
   * suspends between {@link supersede} and the `scan` call below. That is what makes a second start
   * deterministic rather than a race: by the time a start RESOLVES, the run it replaced can no
   * longer push anything, whether or not it had begun reading.
   *
   * The one `await` that precedes the bump is the scope check, and it is there deliberately: a
   * refusal must not supersede anything (043 T115, FR-030a — see below).
   */
  async start(webContentsId: number, request: StartScanRequest): Promise<StartScanResult> {
    if (this.disposed) return { started: false, reason: 'noProject' };
    // An empty term is not a search. Nothing starts, nothing is superseded, and the panel keeps the
    // results of its last real run — FR-009's no-results state is for a term that missed.
    if (request.term.length === 0) return { started: false, reason: 'emptyTerm' };
    if (request.projectRoot.length === 0) return { started: false, reason: 'noProject' };

    const base = toAbsPath(request.projectRoot, request.scopeSubPath ?? '');

    /*
     * A scope that does not EXIST inside this project is `scopeMissing` (FR-030a).
     *
     * This read "that is not a directory" until 043 round five, and it was never true: the check is
     * existence, not kind, so a scope naming a FILE passed it and was then walked as a directory —
     * which is how a file scope used to report "No matches". FR-092 makes a file a legitimate scope,
     * and `targetsOf` is where its kind is asked.
     *
     * `isUnderPath` REFUSES a `..` segment rather than resolving it (033 FR-032), so a scope naming
     * its way out of the root is answered the same way as one that has been deleted: as a scope
     * this project does not have. The three reasons the contract defines are the whole vocabulary,
     * and inventing a fourth for a path the panel cannot produce would be a shape nobody renders.
     *
     * ══ CHECKED BEFORE `supersede`, AND THAT ORDERING IS THE REQUIREMENT (043 T115) ══
     *
     * FR-030a: "results already listed MUST stay listed and fully usable … with no row disabled,
     * hidden or reordered." Superseding first bumped the generation, and a new generation is the
     * ONE thing that tells the renderer a re-run replaced the list — so merely RAISING the
     * condition emptied the panel. Nothing started here, so nothing is superseded, which is exactly
     * the clause the empty-term guard above already states for the other refusal.
     */
    if (!isUnderPath(base, request.projectRoot) || !(await this.fs.exists(base))) {
      this.reportScopeMissing(webContentsId, request);
      return { started: false, reason: 'scopeMissing' };
    }
    if (this.disposed) return { started: false, reason: 'noProject' };

    const run = this.supersede(webContentsId, request);
    const generation = run.generation;
    if (this.stale(run, generation)) return { started: true };

    /*
     * Fire and forget, but never unobserved.
     *
     * A rejection here — the exclusion globs are read AT SCAN TIME, so a malformed setting is the
     * reachable case — used to leave the panel's spinner running for ever with a Cancel control
     * that reached nothing, plus an unhandled rejection in the main process. The panel is told
     * instead, in the only vocabulary the wire has: the scan was abandoned.
     */
    void this.scan(run, generation, base).catch(() => {
      if (this.stale(run, generation) || run.status !== 'running') return;
      run.status = 'cancelled';
      this.clearFlush(run);
      run.pending = [];
      this.emit(run, generation, 'cancelled');
    });
    return { started: true };
  }

  /**
   * A window is now displaying this panel (FR-078) — join the run and be told what it holds.
   *
   * Fire and forget, and idempotent: a second attach from the same window re-sends the snapshot and
   * changes nothing else. Called by the panel component on mount, in EVERY window, which is why
   * `start` is no longer the only way to subscribe.
   *
   * With no run for the panel nothing is sent — the panel keeps rendering `notRun`, which is the
   * truth — but the interest is remembered, so the next scan whoever starts it reaches this window
   * too.
   *
   * ══ THE WEAKENING THIS INTRODUCES, STATED RATHER THAN FOUND LATER ══
   *
   * Before this, a window could only receive results for a scan it had started. Now it can receive
   * results for any `panelId` it names, and a window naming a panel it is not displaying would be
   * sent another project's file paths and match text. The mitigation is that the only caller is the
   * panel component, mounted from the workspace layout — the same authority in both windows — but
   * the guarantee is weaker by exactly the amount FR-078 asks for.
   */
  attach(webContentsId: number, panelId: string): void {
    if (this.disposed || panelId.length === 0) return;
    const run = this.runs.get(panelId);
    if (!run) {
      const waiting = this.waiting.get(panelId) ?? new Set<number>();
      waiting.add(webContentsId);
      this.waiting.set(panelId, waiting);
      return;
    }
    run.viewers.add(webContentsId);
    this.snapshotTo(webContentsId, run);
  }

  /**
   * FR-043 — abandon the run for one panel. Fire and forget; cancelling a finished scan is a no-op.
   *
   * The walk polls `cancelled()` and resolves to NOTHING rather than to what it had reached, so the
   * panel is never handed a truncated set that looks like a complete answer.
   *
   * The run is KEPT: a cancelled scan's partial results stay on screen, and FR-045a's staleness
   * still applies to them. {@link drop} is what releases it.
   *
   * ══ ONLY A VIEWER MAY CANCEL ══
   *
   * A cancel from a window that is not displaying the panel is ignored. Under the composite key that
   * was true by construction — the run simply was not there to find — and it is the half of the key
   * worth keeping: one window's gesture must not reach a scan it is not watching. A window that IS
   * watching may cancel, and both windows are told, because they are watching one scan.
   */
  cancel(webContentsId: number, panelId: string): void {
    const run = this.runs.get(panelId);
    if (!run || !run.viewers.has(webContentsId) || run.status !== 'running') return;
    run.generation += 1;
    run.status = 'cancelled';
    this.clearFlush(run);
    run.pending = [];
    this.emit(run, run.generation, 'cancelled');
  }

  /**
   * 043 FR-091a — empty the panel's run, for EVERY window watching it. Fire and forget.
   *
   * The tree's *Open In → Search* route leaves the panel with an empty query and no results. Doing
   * that only in the window that asked would leave a synced sub-workspace view listing the old rows
   * under an empty box — FR-078a keeps the run here precisely so such a view can be shown it, and
   * FR-078b forbids the box and the list disagreeing. So the run is emptied here and every viewer is
   * told the panel is `notRun`.
   *
   * ══ THE RUN IS KEPT, NOT RELEASED — AND THAT IS THE WHOLE DESIGN ══
   *
   * {@link drop} releases a run and forgets it, which is right for a panel that is gone. Here the
   * panel stays, and a released run would let the NEXT scan open a fresh one at generation 1 — while
   * every renderer watching still holds this run's higher number and drops anything lower as
   * superseded. The panel would never show another result. Moving the SAME run on a generation keeps
   * the numbers monotonic, and the next `start` supersedes it by the ordinary path.
   *
   * The bump is also what stops a scan still walking: `stale()` compares generations, so the walk
   * returns at its next poll and nothing it had reached is ever emitted. `held` and `staleFiles` go
   * with the rows, so a watcher tick over the old results re-stats nothing.
   *
   * Emptying the query is a change to the query, so the clearing window becomes its owner — exactly
   * what FR-078b says of a window that retypes — and every OTHER viewer is sent the empty term.
   *
   * Only a viewer may clear, for {@link cancel}'s reason: one window's gesture must not reach a panel
   * it is not displaying. With no run at all there is nothing on screen anywhere to clear, and the
   * renderer's own reset is the whole of it.
   */
  clear(webContentsId: number, panelId: string): void {
    const run = this.runs.get(panelId);
    if (!run || !run.viewers.has(webContentsId)) return;
    this.clearFlush(run);
    run.generation += 1;
    run.status = 'notRun';
    run.originator = webContentsId;
    run.term = '';
    run.skipped = 0;
    run.filesScanned = 0;
    run.totalMatches = 0;
    run.rows = [];
    run.pending = [];
    run.held.clear();
    run.staleFiles.clear();
    this.emit(run, run.generation, 'notRun');
  }

  /**
   * A directory under `absRoot` changed (FR-045a, FR-045d) — re-stat the result files held under it.
   *
   * ══ THIS ADDS NO WATCHER, AND THAT IS THE REQUIREMENT ══
   *
   * Called from the composition root's EXISTING `ExplorerWatcher` emit — the same callback that
   * broadcasts `throng:files:changed`, which had exactly one subscriber before this one (research
   * R6). Nothing here opens, holds or disposes a watch.
   *
   * ══ WHY A RE-STAT AND NOT THE SIGNAL ITSELF ══
   *
   * The signal cannot answer the question. It carries a directory and nothing else — no filename,
   * no event kind — and the project file index beside it is a MEMBERSHIP index, so a file that was
   * merely EDITED produces no delta anywhere. The directory is a prompt to look; the looking is
   * this. A file whose modification time or size has moved since the scan read it is stale, and so
   * is one that has gone.
   *
   * ══ UNDER, AT ANY DEPTH ══
   *
   * Not just the directory's immediate children. A folder rename or a subtree delete can surface as
   * one event on the PARENT, and every result inside it is then invalidated with nothing said. The
   * cost stays bounded by the files this panel's own results came from — never by the project.
   *
   * Fire-and-forget by contract: the caller is a watcher callback with nowhere to report to, and a
   * failed stat is not a failure of anything the user asked for.
   */
  async noteDirectoryChanged(absRoot: string, relDir: string): Promise<void> {
    if (this.disposed) return;
    const root = normaliseForCompare(absRoot);
    // '' is the root itself, and `dir/` is the prefix every path inside it shares.
    //
    // Compared through `normaliseForCompare`, as every other path comparison in the app is (043
    // T263). A typed scope keeps the user's spelling, so a scope typed `SRC` holds its files as
    // `SRC/…` while the watcher reports the directory as the disk spells it, `src` — and a
    // case-sensitive `startsWith` then found nothing under it, so an edited file was never marked
    // stale. The held key itself is untouched: it is what the rows are keyed on, and what goes back.
    const prefix = relDir.length === 0 ? '' : normaliseForCompare(`${relDir.replace(/\/+$/, '')}/`);

    for (const run of [...this.runs.values()]) {
      // A run belongs to ONE project (FR-018). Another project's directory says nothing about it,
      // and two projects can hold the same relative path.
      if (normaliseForCompare(run.scope.projectRoot) !== root) continue;
      const generation = run.generation;
      // FR-030a / US3 scenario 30, on the same signal and before the per-file work: the scoped
      // directory going is a statement about the SCOPE, and it is true whether or not this run
      // holds any results under the directory that changed.
      await this.noteScopeMissingIfGone(run, generation, relDir);
      const suspect = [...run.held.keys()].filter(
        (relPath) => prefix === '' || normaliseForCompare(relPath).startsWith(prefix),
      );
      if (suspect.length === 0) continue;

      let marked = false;
      for (const relPath of suspect) {
        // The run may have been superseded or dropped while these stats were in flight; whatever it
        // is holding now belongs to a different question.
        if (this.stale(run, generation)) break;
        if (run.staleFiles.has(relPath)) continue; // cumulative — nothing to say twice
        const was = run.held.get(relPath);
        if (!was) continue;
        let now: FileStamp | null = null;
        try {
          now = await this.fs.modifiedAt(toAbsPath(run.scope.projectRoot, relPath));
        } catch {
          // Gone, or unreadable. Either way the rows naming it can no longer be trusted, which is
          // exactly the edge case FR-045a's "deleted or renamed" clause names.
        }
        if (now !== null && now.mtimeMs === was.mtimeMs && now.size === was.size) continue;
        run.staleFiles.add(relPath);
        marked = true;
      }

      if (!marked || this.stale(run, generation)) continue;
      this.emitStale(run, generation);
    }
  }

  /**
   * This panel's own commit has just written this file — so it is not stale TO THIS PANEL (FR-083c).
   *
   * ══ WHAT IS ACTUALLY RECORDED, AND WHY IT IS NOT A SUPPRESSION ══
   *
   * The stamp, re-taken. {@link noteDirectoryChanged} compares each contributing file against what
   * it looked like when the scan read it, so re-stamping is saying "this is what it looks like now,
   * and I am the reason" — after which the tick that follows finds no difference and marks nothing.
   * A flag saying "ignore the next tick for this file" would be a suppression, and would swallow the
   * NEXT writer's change too.
   *
   * That is what makes the second half work without a second mechanism: a file this commit wrote and
   * something ELSE then changed differs from the stamp taken here, and goes stale exactly as it
   * always did.
   *
   * ══ PER PANEL, WHICH IS THE WHOLE REQUIREMENT ══
   *
   * Keyed by `panelId`, so a second panel searching the same project is told its file changed —
   * because it did, by a writer that panel knows nothing about. The panel is the authority on its
   * own writes and on nobody else's.
   *
   * ══ THE ONE RACE, STATED ══
   *
   * A watcher tick can land between the write and this re-stat, and then the file is marked before
   * anything can say who wrote it. The window is one stat wide against a debounce of tens of
   * milliseconds, and the failure is the pre-FR-083c behaviour — an over-reported stale file, which
   * this service already treats as informational and prefers to under-reporting. A file already
   * marked is therefore LEFT marked: the marking may have come from a real second writer, and
   * clearing it on the strength of our own write would lose exactly the signal FR-045a is for.
   */
  async noteOwnWrite(panelId: string, relPath: string): Promise<void> {
    if (this.disposed) return;
    const run = this.runs.get(panelId);
    const was = run?.held.get(relPath);
    // Not a contributor: no row names it, so nothing about it could go stale (FR-045a).
    if (!run || !was || run.staleFiles.has(relPath)) return;

    const generation = run.generation;
    try {
      const now = await this.fs.modifiedAt(toAbsPath(run.scope.projectRoot, relPath));
      // Superseded or released while the stat was in flight — whatever it holds now belongs to a
      // different question, and re-stamping it would answer for a scan that never read this file.
      if (this.stale(run, generation)) return;
      run.held.set(relPath, now);
    } catch {
      // Gone or unreadable a moment after being written. The watcher's own re-stat is the right
      // reporter for that, and it will mark it.
    }
  }

  /**
   * A panel has gone. The service holds no results for it afterwards (data-model §7).
   *
   * ══ WHY THIS NEEDS A CHANNEL OF ITS OWN ══
   *
   * It used to be reachable only from {@link release}, i.e. only when a WINDOW was destroyed, and
   * the renderer's only lever was {@link cancel} — which early-returns for a run that is not
   * running. So the ordinary case (the scan finished, the user closed the panel) released nothing:
   * the run kept its whole `held` map for the life of the window, and `noteDirectoryChanged` walked
   * it on every watcher tick, sequentially awaiting a `modifiedAt` per file. Three closed panels
   * over a broad term and a `git checkout` in the project is three times (files matched) stats per
   * 150 ms debounce, stacking, growing for as long as the window lives — while `emitStale` kept
   * pushing updates naming panels the renderer had already forgotten.
   */
  drop(webContentsId: number, panelId: string): void {
    this.forget(panelId, webContentsId);
    const run = this.runs.get(panelId);
    if (!run || !run.viewers.delete(webContentsId)) return;
    // FR-078 — the LAST detach releases, not the first. `drop` from a sub-workspace view leaves the
    // parent's scan running, which is the failure the composite key was introduced to prevent.
    if (run.viewers.size > 0) return;
    this.releaseRun(run);
  }

  /**
   * A window has gone: it stops watching everything it was watching (R23).
   *
   * It used to release every run the window OWNED, which under the composite key was the same
   * sentence. It is not any more: a run watched by two windows survives one of them dying, and only
   * the runs left with no viewer at all are reclaimed.
   */
  release(webContentsId: number): void {
    for (const panelId of [...this.waiting.keys()]) this.forget(panelId, webContentsId);
    for (const run of [...this.runs.values()]) {
      if (run.viewers.has(webContentsId)) this.drop(webContentsId, run.id);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const run of this.runs.values()) {
      run.generation += 1;
      this.clearFlush(run);
    }
    this.runs.clear();
    this.waiting.clear();
  }

  // ---------------------------------------------------------------------------------------------

  /** Stop remembering a window's interest in a panel that has no run yet. */
  private forget(panelId: string, webContentsId: number): void {
    const waiting = this.waiting.get(panelId);
    if (!waiting) return;
    waiting.delete(webContentsId);
    if (waiting.size === 0) this.waiting.delete(panelId);
  }

  /**
   * The run is over and nothing is watching it — reclaim everything it holds (FR-023, FR-078a).
   *
   * The generation bump is what stops an in-flight walk pushing into a released run, and it matters
   * more now than it did: `rows` outlives each batch, so a walk that kept going would keep growing a
   * list nobody will ever be shown.
   */
  private releaseRun(run: ScanRun): void {
    run.generation += 1;
    this.clearFlush(run);
    run.rows = [];
    run.pending = [];
    run.held.clear();
    run.staleFiles.clear();
    this.runs.delete(run.id);
  }

  /**
   * One window, one message, the whole run (FR-078a) — what a window that attaches is told.
   *
   * `snapshot: true` is what makes it readable: the renderer REPLACES its rows on one and APPENDS on
   * a delta, so a window that re-attaches is not handed a second copy of the list it already has.
   * It is the one update the batch bound does not apply to, and the only one sent to a single named
   * window rather than to the run's whole viewer set.
   *
   * A run that has produced nothing yet is still worth saying: `notRun` never reaches here (there is
   * no run to snapshot), but a `running` scan with no rows so far tells the new window that a search
   * IS happening, which is the difference FR-042 is about.
   */
  private snapshotTo(webContentsId: number, run: ScanRun): void {
    this.push(webContentsId, {
      panelId: run.id,
      generation: run.generation,
      status: run.status,
      snapshot: true,
      rows: [...run.rows],
      totalMatches: run.totalMatches,
      filesScanned: run.filesScanned,
      skipped: run.skipped,
      staleFiles: [...run.staleFiles],
      ...this.queryFor(webContentsId, run),
    });
  }

  /**
   * FR-078b — the `adoptQuery` field for one recipient, or nothing at all for the originator.
   *
   * Spread into a payload rather than assigned, so the field is genuinely ABSENT for the window
   * driving the search instead of present and undefined. That distinction is the contract: the
   * renderer adopts on presence, and a key that always exists would make "is this window following?"
   * a question about a value rather than about a field.
   */
  private queryFor(
    webContentsId: number,
    run: ScanRun,
  ): { adoptQuery: { term: string; modes: MatchModes } } | Record<string, never> {
    if (webContentsId === run.originator) return {};
    return { adoptQuery: { term: run.term, modes: run.modes } };
  }

  /**
   * Say the scope is missing WITHOUT disturbing what the panel is showing (FR-030a, 043 T115).
   *
   * The generation is the run's current one, unchanged, because that is the whole mechanism: the
   * renderer treats a new generation as a re-run and replaces its rows, so a refusal carrying one
   * empties exactly the list FR-030a says must survive. The update carries no rows either — there
   * is nothing to add, and `applyFileSearchUpdate` appends within a generation.
   *
   * A run that is still WALKING keeps its status. Its own terminal update is a truthful statement
   * about the directory it reached, and overwriting `status` here would have it emit `scopeMissing`
   * batches on the way to a `complete` it then contradicts.
   *
   * With no run at all there is nothing on screen to protect, so one is opened for the panel — the
   * behaviour the first-run case has always had, and what gives the update a generation the
   * renderer will accept ahead of the real scan that follows it.
   */
  private reportScopeMissing(webContentsId: number, request: StartScanRequest): void {
    const existing = this.runs.get(request.panelId);
    if (existing) {
      // The window asking is displaying the panel, whether or not it had started anything: a refusal
      // it never hears would leave its scope control with nothing to say (FR-030a).
      existing.viewers.add(webContentsId);
      if (existing.status !== 'running') existing.status = 'scopeMissing';
      this.emit(existing, existing.generation, 'scopeMissing');
      return;
    }
    const run = this.supersede(webContentsId, request);
    run.status = 'scopeMissing';
    this.emit(run, run.generation, 'scopeMissing');
  }

  /**
   * US3 scenario 30 — "when that directory is DELETED", not "when they next search" (043 T115).
   *
   * ══ IT RIDES THE SAME SIGNAL STALENESS DOES, AND ADDS NO WATCHER ══
   *
   * FR-045d forbids a second watch, and {@link noteDirectoryChanged} is already the consumer of the
   * `throng:files:changed` broadcast `ExplorerWatcher` produces. The signal carries a directory and
   * nothing else, so — exactly as with staleness — it is a prompt to LOOK, and the looking is one
   * `exists` on the scope this run was given.
   *
   * ══ WHY THE THREE GUARDS ARE NOT DEFENSIVENESS ══
   *
   * A whole-root search has no scope that can go missing independently of the project itself, which
   * is a different condition with a different owner. A run still WALKING is about to say for itself
   * whether it reached the directory, and raising this over the top of it would be a claim its own
   * terminal update contradicts a moment later. And only a change AT or ABOVE the scope can have
   * removed it — a write inside it is the staleness signal, not this one — which is what keeps this
   * from costing a stat per watcher tick.
   */
  private async noteScopeMissingIfGone(run: ScanRun, generation: number, relDir: string): Promise<void> {
    const scope = run.scope.subPath;
    if (scope === null || scope.length === 0) return;
    if (run.status === 'running' || run.status === 'scopeMissing') return;
    // 043 FR-091a — a CLEARED run describes no scope the user is looking at: the panel's box holds
    // the scope the tree's route filled in, and nothing has been searched there yet. Raising the old
    // scope's absence over it would put a notice on a control about a path it no longer names.
    if (run.status === 'notRun') return;
    // Case-insensitive for T263's reason: the scope is spelled as the user typed it, the changed
    // directory as the disk spells it, and on Windows those name the same folder.
    const changed = normaliseForCompare(relDir);
    const scopeKey = normaliseForCompare(scope);
    if (changed.length > 0 && scopeKey !== changed && !scopeKey.startsWith(`${changed}/`)) return;
    if (await this.fs.exists(toAbsPath(run.scope.projectRoot, scope))) return;
    if (this.stale(run, generation)) return;
    run.status = 'scopeMissing';
    // The SAME generation — see {@link reportScopeMissing}. The rows stay exactly as they are.
    this.emit(run, generation, 'scopeMissing');
  }

  private supersede(webContentsId: number, request: StartScanRequest): ScanRun {
    const scope: SearchScope = {
      projectRoot: request.projectRoot,
      subPath: request.scopeSubPath,
    };
    const existing = this.runs.get(request.panelId);
    if (existing) {
      // Starting IS attaching, as it always was — and now it is only ever an ADDITION. The run's
      // recipient used to be reassigned here, which is how a search typed in a mirrored view took
      // the parent's updates with it.
      existing.viewers.add(webContentsId);
      // FR-078b — and starting is also TAKING OVER the query. Whoever typed this is now the window
      // whose box is authoritative, so every other viewer becomes a follower and is sent the new
      // term with its results. This is the one place ownership moves, and it moves to the typist
      // rather than to the parent.
      existing.originator = webContentsId;
      // Everything the abandoned run accumulated goes with it: a superseded scan contributes no
      // rows and no counts to the one that replaced it (FR-043c).
      this.clearFlush(existing);
      existing.generation += 1;
      existing.status = 'running';
      existing.scope = scope;
      existing.term = request.term;
      existing.modes = request.modes;
      existing.skipped = 0;
      existing.filesScanned = 0;
      existing.totalMatches = 0;
      // FR-078a's retention is per RUN, and a supersession is a new run: a snapshot sent after this
      // must describe the search that is happening, never the one it replaced.
      existing.rows = [];
      existing.pending = [];
      // FR-045c — re-running clears staleness for everything it re-scans. The new walk re-stamps
      // whatever it finds, so starting from empty is that clause rather than an optimisation.
      existing.held.clear();
      existing.staleFiles.clear();
      return existing;
    }
    // Every window that said it was displaying this panel before anything had been searched joins
    // the run it was waiting for (FR-078).
    const viewers = new Set<number>(this.waiting.get(request.panelId) ?? []);
    this.waiting.delete(request.panelId);
    viewers.add(webContentsId);
    const run: ScanRun = {
      id: request.panelId,
      viewers,
      // FR-078b — the window that started it owns the query until another window retypes it.
      originator: webContentsId,
      generation: 1,
      status: 'running',
      scope,
      term: request.term,
      modes: request.modes,
      skipped: 0,
      filesScanned: 0,
      totalMatches: 0,
      rows: [],
      pending: [],
      flushTimer: null,
      held: new Map(),
      staleFiles: new Set(),
    };
    this.runs.set(run.id, run);
    return run;
  }

  private stale(run: ScanRun, generation: number): boolean {
    return this.disposed || run.generation !== generation || this.runs.get(run.id) !== run;
  }

  /**
   * The ONE exclusion predicate this scan walks with (FR-045).
   *
   * Composed exactly as `project-file-index.ts` composes it — the setting plus the project's hidden
   * set — because "the project's existing exclusion rules" means the rules the TREE obeys, and a
   * second rule set here would be a second answer to the same question.
   *
   * The predicate is stated over ROOT-relative paths while the walk hands out paths relative to the
   * SCOPE, so a sub-directory scan re-prefixes before asking. Without that, `node_modules` inside a
   * scoped directory would be excluded and `pkg/node_modules` would not.
   */
  private excluderFor(scope: SearchScope): (relPath: string) => boolean {
    const excluded = compileExcluder([
      ...this.excludeGlobs(),
      ...hiddenPathGlobs(this.hiddenPaths(scope.projectRoot)),
    ]);
    const prefix = scope.subPath ? `${scope.subPath}/` : '';
    return prefix === '' ? excluded : (relPath) => excluded(`${prefix}${relPath}`);
  }

  /**
   * What the scan will read, as root-relative paths paired with their absolute ones.
   *
   * ══ A SCOPE THAT NAMES A FILE (043 FR-092) ══
   *
   * It used to be walked like a folder. `walkFiles` lists its root, `readdir` on a file throws
   * `ENOTDIR`, the walk swallows that exactly as it swallows an unreadable directory — and the scan
   * completed having read nothing, so the panel reported "No matches" about a file that might be
   * full of them. A false negative, with nothing on screen to say the search had not happened.
   *
   * So the scope's KIND is asked once, here, and a file is visited as exactly one entry. Its row path
   * is the scope itself — ROOT-relative, like every other row — which is what lets a double-click, an
   * Open In target and a commit resolve the same file they would from a folder scope.
   *
   * No excluder is consulted for it, deliberately: the walk tests every entry it REACHES against the
   * exclusions and never tests the scope itself, and a user who names one file has answered the
   * question the exclusions exist to ask for them. The per-file rules below — size, read, binary —
   * still run, from the same loop, so a file scope cannot acquire rules of its own by accident.
   *
   * A `stat` that fails falls through to the walk, which is what happened before: the entry went
   * between `start`'s existence check and here, and the walk's own handling of a gone root answers.
   */
  private async targetsOf(
    run: ScanRun,
    generation: number,
    base: string,
  ): Promise<{ relPath: string; abs: string }[]> {
    const scope = run.scope;
    if (scope.subPath) {
      const kind = await this.fs.stat(base).then(
        (s) => s.kind,
        () => null,
      );
      if (kind === 'file') return [{ relPath: scope.subPath, abs: base }];
    }
    const prefix = scope.subPath ? `${scope.subPath}/` : '';
    const paths = await walkFiles(this.fs, base, {
      cancelled: () => this.stale(run, generation),
      excluded: this.excluderFor(scope),
    });
    return paths.map((rel) => ({ relPath: `${prefix}${rel}`, abs: toAbsPath(base, rel) }));
  }

  private async scan(run: ScanRun, generation: number, base: string): Promise<void> {
    const targets = await this.targetsOf(run, generation, base);
    if (this.stale(run, generation)) return;

    const limit = this.maxFileBytes();
    for (const { relPath, abs } of targets) {
      if (this.stale(run, generation)) return;

      /*
       * The refusal set, in the order that keeps it cheap (FR-045e).
       *
       * Size FIRST, because `IFileSystem` has no partial read — `readBytes` slurps the whole file
       * (research R5) — so asking the size before the bytes is what keeps a 2 GiB file off the
       * memory ceiling rather than merely off the results list.
       *
       * `modifiedAt` rather than `size`: it answers the size question AND yields the staleness
       * stamp (FR-045a) from the same stat, so recording one costs nothing extra. Taken BEFORE the
       * read, deliberately — a write landing between the two makes the stamp older than the bytes,
       * so the next re-stat reports a change. Over-reporting a stale file is informational
       * (FR-045b); under-reporting one would leave the list quietly disagreeing with the disk.
       */
      let bytes: Uint8Array;
      let stamp: FileStamp;
      try {
        stamp = await this.fs.modifiedAt(abs);
        if (stamp.size > limit) {
          run.skipped += 1;
          continue;
        }
        bytes = await this.fs.readBytes(abs);
      } catch {
        // A read that fails for ANY reason — permission, a file gone since the walk, a device
        // error. FR-045e requires this separately because it is not a named member of the editor's
        // refusal set: a permission denial surfaces there as a generic I/O fault.
        run.skipped += 1;
        continue;
      }
      if (isProbablyBinary(bytes)) {
        run.skipped += 1;
        continue;
      }
      if (this.stale(run, generation)) return;

      /*
       * `decode` rather than a plain UTF-8 read: it strips a BOM and normalises CRLF to LF, so the
       * offsets these rows carry index the SAME text the commit will decode before it writes
       * (research R9). Its `{encoding, hasBom, lineEnding}` is deliberately NOT kept — the commit
       * re-decodes immediately before each write, because a value recorded at scan time is exactly
       * the stale answer FR-054's re-check exists to refuse.
       */
      const doc = Text.of(decode(bytes).text.split('\n'));
      run.filesScanned += 1;
      const before = run.totalMatches;
      for (const match of editorMatches(doc, run.term, run.modes)) {
        const line = doc.lineAt(match.from);
        run.pending.push({
          relPath,
          line: line.number,
          column: match.from - line.from + 1,
          from: match.from,
          to: match.to,
          snippet: snippetFor(line.text, match.from - line.from, match.to - line.from),
        });
        run.totalMatches += 1;
      }
      // Only CONTRIBUTORS are remembered (FR-045a): staleness is a statement about the list on
      // screen, and a file the walk opened and found nothing in has no row that could go stale.
      if (run.totalMatches > before) run.held.set(relPath, stamp);
      this.drain(run, generation, false);
      this.armFlush(run, generation);
    }

    if (this.stale(run, generation)) return;
    this.clearFlush(run);
    this.drain(run, generation, false);
    run.status = 'complete';
    // The last batch rides the terminal update rather than being pushed just before it: two
    // messages where one will do is two renders of the same final state.
    this.emit(run, generation, 'complete', run.pending.splice(0, run.pending.length));
  }

  /** Push every FULL batch, and — when `force` — whatever short remainder is held. */
  private drain(run: ScanRun, generation: number, force: boolean): void {
    while (run.pending.length >= MAX_ROWS_PER_BATCH) {
      // A file yielding thousands of matches is split across successive batches: the bound is on
      // the MESSAGE, so no single file can produce one that breaches it.
      this.emit(run, generation, 'running', run.pending.splice(0, MAX_ROWS_PER_BATCH));
    }
    if (force && run.pending.length > 0) {
      this.emit(run, generation, 'running', run.pending.splice(0, run.pending.length));
    }
  }

  /**
   * The forced ceiling — armed once per batch window, never re-armed by an arriving row.
   *
   * See the header: re-arming on every row is the #186 shape, where a debounce under sustained
   * churn never fires at all. Here that would mean a project of small files showing nothing until
   * the scan ended.
   */
  private armFlush(run: ScanRun, generation: number): void {
    if (run.flushTimer !== null || run.pending.length === 0) return;
    run.flushTimer = setTimeout(() => {
      run.flushTimer = null;
      if (this.stale(run, generation) || run.status !== 'running') return;
      this.drain(run, generation, true);
      this.armFlush(run, generation);
    }, BATCH_FLUSH_MS);
  }

  private clearFlush(run: ScanRun): void {
    if (run.flushTimer !== null) clearTimeout(run.flushTimer);
    run.flushTimer = null;
  }

  private emit(run: ScanRun, generation: number, status: ScanStatus, rows?: ResultRow[]): void {
    const payload: FileSearchUpdate = {
      panelId: run.id,
      generation,
      status,
      totalMatches: run.totalMatches,
      filesScanned: run.filesScanned,
      skipped: run.skipped,
    };
    if (rows && rows.length > 0) {
      payload.rows = rows;
      // FR-078a — kept as well as sent. The batch that goes out is the batch a later attach is shown
      // as part of the whole, which is why it is recorded HERE rather than where it was cut: an
      // emission that never happened must not appear in a snapshot.
      run.rows.push(...rows);
    }
    this.deliver(run, payload);
  }

  /**
   * One payload, every window watching this run (FR-078) — and no other window, ever.
   *
   * A copy of the viewer set, because a `push` that reaches a destroyed window can lead to a
   * `release` on the way back through the composition root, and mutating the set mid-iteration is
   * how that would surface as a dropped update to an unrelated window.
   */
  private deliver(run: ScanRun, payload: FileSearchUpdate): void {
    for (const viewer of [...run.viewers]) {
      // FR-078b — one payload per recipient now, because `adoptQuery` differs by recipient: the
      // originator must not be sent its own term back. The spread is shallow and `rows` is shared
      // by reference deliberately, which is what it already was when one object went to every
      // window; nothing downstream of `push` mutates a delivered payload.
      this.push(viewer, { ...payload, ...this.queryFor(viewer, run) });
    }
  }

  /**
   * One staleness push (FR-045a) — the WHOLE set, and never any rows.
   *
   * It carries the run's CURRENT generation and CURRENT status, so the renderer neither drops it as
   * superseded nor reads it as a new run: nothing about the results changed, only what is known
   * about the files behind them.
   */
  private emitStale(run: ScanRun, generation: number): void {
    this.deliver(run, {
      panelId: run.id,
      generation,
      status: run.status,
      totalMatches: run.totalMatches,
      filesScanned: run.filesScanned,
      skipped: run.skipped,
      staleFiles: [...run.staleFiles],
    });
  }
}
