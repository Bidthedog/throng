/**
 * ReplaceCommitService — the one operation in 043 that writes (T086, data-model §6,
 * contracts/file-search-ipc.md `throng:fileSearch:commit`, research R7/R8/R9).
 *
 * ══ WHY THE WHOLE OPERATION IS ONE MAIN-SIDE TURN ══
 *
 * The renderer cannot answer "does this file have an open editor" without a race, and it cannot
 * answer it at all for a file in a BACKGROUND tab: only the active tab's panels are mounted, so
 * that document has an authority and no view and no replica (R7). A commit driven from the renderer
 * would skip such a file's buffer edit and also decline its disk write — because `isOpen()`
 * correctly reports it open — leaving it untouched with no error anywhere. That is a data-shaped
 * defect invisible to any test that opens one tab.
 *
 * So the partition, the pre-write re-check and the write all happen here, in one turn, and the
 * buffer half goes through {@link EditorCoordinator.bulkReplace} rather than through any view.
 *
 * ══ THE THREE RULES THAT LOOK LIKE BELT AND BRACES AND ARE NOT ══
 *
 * 1. **`isOpen` is re-checked immediately before each `writeBytes`** (R8). Nothing makes
 *    ask-then-write atomic: a `load()` can register a path between the partition and the write, and
 *    every `await` in this file is a window. `EditorCoordinator.save` already re-runs `openOrFocus`
 *    before a Save-As write for this same hazard, and this follows it.
 * 2. **Every match is re-verified against CURRENT content immediately before its write** (FR-054),
 *    unconditionally — not only for files a scan marked stale. Staleness marking informs the user;
 *    this is what protects the file, and it runs regardless of what the marking says.
 * 3. **The direct write is `decode` → replace → `encode`** with the same `{encoding, hasBom,
 *    lineEnding}` the decode reported (R9). A plain read/write would rewrite every CRLF as LF and
 *    drop the BOM — silently, in files the user never opened.
 */
import { Text } from '@codemirror/state';
import {
  MAX_COMMIT_SNIPPET_CHARS,
  applyReplacements,
  decode,
  encode,
  isDecodableUtf8,
  isProbablyBinary,
  postCommitSnippets,
  resolveSaveConfinement,
  toAbsPath,
  verifyEdits,
  type AppSettings,
  type EncodeOptions,
  type IFileSystem,
  type Match,
  type MatchModes,
  type SnippetView,
} from '@throng/core';

/** One file's worth of intended writes, as the panel listed them (data-model §6). */
export interface CommitTarget {
  readonly relPath: string;
  /** Offsets as SCANNED. Re-verified against current content before anything is written. */
  readonly edits: readonly Match[];
}

export interface CommitRequest {
  /**
   * WHICH panel is committing (FR-083c).
   *
   * Sent by the renderer since the channel existed, and read only now, because only now does
   * anything depend on it: a file this panel's own commit changed must not be marked stale in this
   * panel's own results, and must still go stale in any other panel's. "The project" is not a fine
   * enough answer — two panels can be searching one project — so the writer is named.
   */
  readonly panelId: string;
  readonly projectRoot: string;
  readonly term: string;
  readonly modes: MatchModes;
  /** May be empty — a valid deletion (FR-046a), with no branch of its own anywhere below. */
  readonly replacement: string;
  readonly targets: readonly CommitTarget[];
  /** FR-057b — the user has read the file count and agreed. */
  readonly confirmedIrreversible: boolean;
}

/** FR-054a — the match could no longer be found, so nothing was written at that position. */
export interface RefusedCommit {
  readonly relPath: string;
  readonly reason: 'matchGone';
}

/**
 * FR-086 asked for this document to be saved and the save did not happen (FR-058).
 *
 * SEPARATE from {@link FailedCommit}, and that is the whole point of it: the replacement SUCCEEDED —
 * it is in the buffer, it is undoable, and the file is named in `changedInBuffer`. Reporting it as a
 * failed replacement would tell the user their text was not replaced, which is false. What did not
 * happen is the save, so that is what is said, and the document is left in exactly the state FR-053c
 * describes: dirty, with the replacement pending.
 */
export interface UnsavedCommit {
  readonly relPath: string;
  /** `EditorService`'s own `SaveReason`, said in the vocabulary the notice already words. */
  readonly reason: string;
}

export interface FailedCommit {
  readonly relPath: string;
  /**
   * `encoding` — the file is not valid UTF-8, so this service will not write it.
   *
   * `isProbablyBinary` answers "is this a blob" with a NUL scan, and a single-byte legacy encoding
   * (Windows-1252, Latin-1) has no NULs to find. Decoding one non-fatally replaces every byte it
   * cannot read with `U+FFFD` and writing it back stores `EF BF BD` — the whole file's accented
   * text destroyed, in a file the user never opened, with no undo. Refusing it is the only safe
   * answer; transcoding would be a second guess at the same bytes.
   */
  readonly reason: 'readOnly' | 'locked' | 'io' | 'missing' | 'outOfTree' | 'binary' | 'encoding';
}

/**
 * What happened, in four arrays — reported ONCE, by whatever owns the operation (FR-058).
 *
 * Four rather than a flat list of per-file results, because the user's question is not "what
 * happened to each file" but "what changed, what did not, and why" — and the answer to the first
 * half divides on a line that matters: `changedOnDisk` is irreversible (FR-057a) and
 * `changedInBuffer` is an ordinary undo away.
 */
export interface CommitOutcome {
  readonly changedInBuffer: readonly string[];
  readonly changedOnDisk: readonly string[];
  readonly refused: readonly RefusedCommit[];
  readonly failed: readonly FailedCommit[];
  /**
   * FR-086 — documents that were clean, were replaced, and could NOT then be saved.
   *
   * A subset of `changedInBuffer` rather than a fifth kind of file: every entry here also appears
   * there, because the replacement landed. Empty on the ordinary path, and empty for every document
   * that was already dirty — FR-086a asks for no save at all in that case, so there is nothing that
   * could fail.
   */
  readonly notSaved: readonly UnsavedCommit[];
  /**
   * FR-086 — documents that were clean, were replaced, and WERE then saved.
   *
   * Also a subset of `changedInBuffer`, and it is not `notSaved` inverted. Absence from `notSaved`
   * means "saved OR no save was owed", which cannot separate a file that is now on disk from one
   * still holding the user's own unsaved work beside the replacement — and that separation is
   * exactly what the summary has to count. Before FR-086 every buffer file was unsaved, so the
   * notice could say so of all of them; now it cannot, and a fact it can add up is the honest fix.
   */
  readonly saved: readonly string[];
  /**
   * WHICH of the requested edits were written, per file, at the offsets the caller asked with (#378).
   *
   * The four arrays above name FILES, and for FR-051's marking that was already a compromise: a file
   * with one refused match left every one of its rows unmarked, because nothing could say which had
   * landed. For #378 it is not a compromise but the defect. A panel replacing a scan's rows one at a
   * time must rebase the rows it has not committed yet past the ones it has, and a file-level answer
   * cannot tell it how far — so it kept naming scanned offsets, and in a file of ADJACENT matches
   * whose replacement contains the term, a stale offset still holds a match: the one the previous
   * replacement inserted. The second commit then wrote over the middle of the first.
   *
   * Empty for a file that wrote nothing. Never a count: two rows naming one match are one write.
   */
  readonly applied: readonly AppliedCommit[];
}

/** One file's worth of writes that landed, in the caller's own coordinates (#378). */
export interface AppliedCommit {
  readonly relPath: string;
  readonly edits: readonly AppliedEdit[];
}

/**
 * One write that landed: the offset the CALLER asked with, and what that line SAYS now (FR-083b).
 *
 * The snippet rides on the edit rather than in a parallel array, because the two must not be able to
 * come apart: a caller reads its row back by `from`, and a snippet list indexed separately would be
 * one filtered array away from labelling every row with its neighbour's text.
 *
 * `undefined` past {@link MAX_COMMIT_SNIPPET_CHARS} — the write still happened, and the panel falls
 * back to the replacement it recorded. That constant states the consequence.
 */
export interface AppliedEdit extends Match {
  readonly snippet?: SnippetView;
}

export type CommitResult =
  | { committed: false; reason: 'needsConfirmation'; unopenedFileCount: number }
  | { committed: true; outcome: CommitOutcome };

/**
 * What this service needs from the editor side, and nothing more.
 *
 * A narrow interface rather than the concrete `EditorCoordinator`, so the dependency is stated as
 * two questions — "is it open" and "apply this edit through its authority" — rather than as a class
 * with sixty methods. `EditorCoordinator` satisfies it structurally.
 */
export interface BulkEditTarget {
  isOpen(absPath: string): boolean;
  /**
   * Apply a commit's edits to an OPEN document through its authority (FR-052, FR-057).
   *
   * Returns `null` when no open document holds the path — which the caller treats as "it closed
   * under us", not as a failure.
   */
  bulkReplace(req: {
    absPath: string;
    term: string;
    modes: MatchModes;
    replacement: string;
    edits: readonly Match[];
  }): {
    applied: readonly Match[];
    /**
     * Where those writes landed in the text as it was BEFORE the edit — `EditVerification`'s own
     * array, paired index-for-index with `applied` (FR-083b).
     *
     * Reported alongside `applied` rather than folded into it because the two are in different
     * coordinate systems and the re-derivation needs both: `applied` names the row, `applicable`
     * names the position, and `after` is the text that position moved in.
     */
    applicable: readonly Match[];
    refused: number;
    /** The document AFTER the dispatch — the one new text FR-083b's snippets are derived from. */
    after: Text;
    /** WHICH document, so {@link BulkEditTarget.save} can name it rather than re-resolve the path. */
    documentId: string;
    /** Was it clean immediately BEFORE this edit (FR-086)? Sampled by the authority; see its note. */
    wasClean: boolean;
  } | null;
  /**
   * Save one document through the authority (FR-086) — the SAME `EditorCoordinator.save` a Ctrl+S
   * goes through, and deliberately nothing narrower.
   *
   * Keeping the authority the only writer is the requirement rather than an implementation taste:
   * this is the path that marks the document saved, drops its recovery temp, records its own write
   * against the disk-changed notice, and mirrors `dirty: false` to EVERY window showing the document
   * — a save is an operation on the document, not on a view (Constitution XI). A `writeBytes` here
   * would do none of those, and would be the second original that rule forbids.
   */
  save(payload: { panelId: string }): Promise<
    { ok: true } | { ok: false; reason: string; error: string }
  >;
}

/**
 * The one thing the commit owes the SCAN side: that it wrote this file, and which panel did (FR-083c).
 *
 * A narrow interface rather than `FileSearchService`, following {@link BulkEditTarget}'s precedent
 * and for the same reason — the dependency is one sentence, not a class with a walk and a watcher in
 * it. `FileSearchService` satisfies it structurally.
 *
 * Optional on the constructor because a commit is still a commit with nothing listening: a unit-level
 * caller, or a commit for a panel whose run has been released, has no staleness to correct.
 */
export interface OwnWriteWitness {
  noteOwnWrite(panelId: string, relPath: string): Promise<void>;
}

export class ReplaceCommitService {
  constructor(
    private readonly fs: IFileSystem,
    private readonly editors: BulkEditTarget,
    /**
     * Read at COMMIT time and by name, never captured.
     *
     * `search.inFiles.warnIrreversibleCommit` (FR-057c) is a safety preference: a user who turns it
     * on mid-session must be warned by the very next commit, and one who turns it off must not have
     * to restart to be believed.
     */
    private readonly settings: () => AppSettings,
    /**
     * FR-083c — told after each direct write, so this panel's own commit does not mark its own
     * results stale. Absent for a caller with no scan behind it.
     */
    private readonly ownWrites?: OwnWriteWitness,
    /**
     * FR-083b's size bound, as a parameter with the constant as its default.
     *
     * Injected only so a test can spend it without building a commit large enough to reach
     * {@link MAX_COMMIT_SNIPPET_CHARS} for real — which would be a slow test asserting the same
     * thing. Nothing in the application passes it.
     */
    private readonly snippetBudget: number = MAX_COMMIT_SNIPPET_CHARS,
  ) {}

  async commit(request: CommitRequest): Promise<CommitResult> {
    const confinement = resolveSaveConfinement(
      { ownerKind: 'project' },
      { ownerRoot: request.projectRoot, allProjectRoots: [request.projectRoot] },
    );

    const changedInBuffer: string[] = [];
    const changedOnDisk: string[] = [];
    const refused: RefusedCommit[] = [];
    const failed: FailedCommit[] = [];
    const notSaved: UnsavedCommit[] = [];
    const saved: string[] = [];
    const applied: AppliedCommit[] = [];

    const planned = request.targets
      .filter((t) => t.edits.length > 0)
      .map((t) => ({ target: t, absPath: toAbsPath(request.projectRoot, t.relPath) }));

    /*
     * FR-057b/c/d — the gate, BEFORE anything is written and computed from the partition rather
     * than from anything the renderer said.
     *
     * `warnIrreversibleCommit` is read by name here so `settings-inertness-043.test.ts` can see the
     * wire, and the whole section is named in this file for the same reason.
     */
    const inFiles = this.settings().search.inFiles;
    const unopened = planned.filter(({ absPath }) => !this.editors.isOpen(absPath));
    if (!request.confirmedIrreversible && inFiles.warnIrreversibleCommit && unopened.length > 0) {
      return { committed: false, reason: 'needsConfirmation', unopenedFileCount: unopened.length };
    }

    /*
     * ONE budget for the whole commit (FR-083b), spent as the files are written.
     *
     * Per commit rather than per file, because the payload that crosses the process boundary is the
     * commit's, and a per-file bound over a thousand files bounds nothing.
     */
    let budget = this.snippetBudget;

    for (const { target, absPath } of planned) {
      /*
       * Re-asked here rather than reused from the partition above (R8). Between the two there has
       * been at least one `await` per preceding target, and a `load()` in any of those windows makes
       * this file open — at which point a disk write would land behind a live buffer.
       */
      const record = (outcome: PathOutcome): void => {
        if (outcome.kind === 'failed') {
          failed.push({ relPath: target.relPath, reason: outcome.reason });
          return;
        }
        if (outcome.refusedAny) refused.push({ relPath: target.relPath, reason: 'matchGone' });
        if (outcome.applied.length > 0) {
          applied.push({ relPath: target.relPath, edits: outcome.applied });
          budget -= snippetChars(outcome.applied);
          (outcome.kind === 'buffer' ? changedInBuffer : changedOnDisk).push(target.relPath);
        }
        // FR-086 — the replacement landed and the save did not. Said here rather than in `failed`,
        // because the replacement did not fail; see {@link UnsavedCommit}.
        if (outcome.kind === 'buffer' && outcome.notSaved !== undefined) {
          notSaved.push({ relPath: target.relPath, reason: outcome.notSaved });
        }
        // FR-086 — and the positive fact, which the summary needs and cannot infer. A buffer file
        // that is NOT here is one the user still has to save: either it was already dirty with work
        // of their own (FR-086a) or its save failed and is in `notSaved` above.
        if (outcome.kind === 'buffer' && outcome.didSave === true) saved.push(target.relPath);
      };

      if (this.editors.isOpen(absPath)) {
        record(await this.applyInBuffer(request, target, absPath, budget));
        continue;
      }

      const outcome = await this.writeDirect(request, target, absPath, confinement.allowed, budget);
      /*
       * Rule 4 of the contract: a file that became OPEN under the commit takes the BUFFER path.
       *
       * `writeDirect`'s last `isOpen` is three awaits after the first one, so this is not a rare
       * branch — it is the ordinary outcome of the user opening the file while the commit runs.
       * Reporting it as an I/O failure told them a perfectly writable file could not be written and
       * left it with neither path taken.
       */
      record(
        outcome.kind === 'becameOpen'
          ? await this.applyInBuffer(request, target, absPath, budget)
          : outcome,
      );
    }

    return {
      committed: true,
      outcome: { changedInBuffer, changedOnDisk, refused, failed, notSaved, saved, applied },
    };
  }

  /**
   * The buffer path (FR-052, FR-057) — the file has an open document, so its authority owns the edit.
   *
   * Reached from TWO places, which is the whole reason it is a method: the partition finds the file
   * open, and `writeDirect` finds it open at its last check. The second is not an error case.
   *
   * ══ AND WHY IT IS THE PLACE FR-086'S SAVE LIVES ══
   *
   * `bulkReplace` reports whether the document was CLEAN in the same turn it edited it — the only
   * moment that question has a useful answer, since the edit itself dirties the document. This method
   * is what acts on that answer, because it is the one place that knows both facts at once: that
   * something landed, and that nothing of the user's own was pending before it.
   */
  private async applyInBuffer(
    request: CommitRequest,
    target: CommitTarget,
    absPath: string,
    budget: number,
  ): Promise<PathOutcome> {
    const applied = this.editors.bulkReplace({
      absPath,
      term: request.term,
      modes: request.modes,
      replacement: request.replacement,
      edits: target.edits,
    });
    if (applied === null) {
      // It closed between the check and the call. Nothing was written anywhere, and the honest
      // report is that this file did not change.
      return { kind: 'failed', reason: 'io' };
    }
    const outcome: PathOutcome = {
      kind: 'buffer',
      // FR-083b — from the AUTHORITY's text after the dispatch, which is the only place the buffer
      // path's new text exists. Nothing is re-read and nothing is re-searched.
      applied: withSnippets(
        applied.applied,
        applied.applicable,
        applied.after,
        request.replacement.length,
        budget,
      ),
      refusedAny: applied.refused > 0,
    };

    /*
     * FR-086 / FR-086a — the one narrowing of "a commit saves nothing", and its two guards.
     *
     * `applied.length === 0`: nothing landed, so there is nothing of this commit's to write out.
     * Saving anyway would touch the file for a decision the commit did not make — and, through
     * FR-083c, mark it stale in the panel that just decided nothing about it.
     *
     * `!wasClean`: the user had unsaved work of their own in this buffer, and FR-053b stands word for
     * word — a commit never writes it out. That is why the dirty case is EXCLUDED rather than
     * deprioritised: the replacement joins their work in the buffer and both wait for their save.
     */
    if (outcome.applied.length === 0 || !applied.wasClean) return outcome;

    const saved = await this.editors.save({ panelId: applied.documentId });
    if (!saved.ok) {
      // The replacement is still in the buffer and still undoable. What did not happen is the save,
      // so that is what is reported — never as a failed replacement (FR-058, {@link UnsavedCommit}).
      return { ...outcome, notSaved: saved.reason };
    }
    /*
     * FR-083c — this panel's own write, told to the scan side immediately, exactly as `writeDirect`
     * does it. The requirement names this save in as many words: a file changed only by this panel's
     * own commit, "including a save made under FR-086", is not marked stale by that commit.
     *
     * Before FR-086 the buffer path changed no file and so had nothing to declare. It does now.
     */
    await this.ownWrites?.noteOwnWrite(request.panelId, target.relPath);
    return { ...outcome, didSave: true };
  }

  /**
   * The direct disk write (FR-053, FR-056, R9): `decode` → replace → `encode`, with confinement and
   * one last `isOpen` before the bytes go out.
   */
  private async writeDirect(
    request: CommitRequest,
    target: CommitTarget,
    absPath: string,
    allowed: (candidate: string) => boolean,
    budget: number,
  ): Promise<PathOutcome | { kind: 'becameOpen' }> {
    let realPath: string;
    try {
      if (!(await this.fs.exists(absPath))) return { kind: 'failed', reason: 'missing' };
      realPath = await this.fs.realpath(absPath);
    } catch (e) {
      return { kind: 'failed', reason: reasonFor(e) };
    }

    // Confinement on the RESOLVED path, because a rule applied to a symlink rather than to its
    // target is not a rule — `EditorService.resolveEntry`'s precedent, and the reason `..` in a
    // relPath cannot walk a commit out of the project it was scanned in.
    if (!allowed(realPath)) return { kind: 'failed', reason: 'outOfTree' };

    try {
      const bytes = await this.fs.readBytes(realPath);
      if (isProbablyBinary(bytes)) return { kind: 'failed', reason: 'binary' };
      /*
       * The NUL scan above is not a text test, and this is the file it lets through.
       *
       * A Windows-1252 or Latin-1 file has no NULs, so it passes as text; `decode` then runs a
       * NON-FATAL decoder that turns every byte it cannot read into `U+FFFD`, and `encode` writes
       * `EF BF BD` back over it. Every accented character in the file is destroyed — not just the
       * ones near a match — in a file nobody opened, with no in-app undo by design (FR-057a). R9
       * relied on interleaved NULs to catch UTF-16; a single-byte encoding has no such tell, so the
       * question has to be asked outright and answered by REFUSING the file (FR-058).
       */
      if (!isDecodableUtf8(bytes)) return { kind: 'failed', reason: 'encoding' };
      const file = decode(bytes);

      // FR-054, unconditionally, against the text as it is NOW — which is why the bytes are read
      // here and the scan's own metadata was deliberately discarded rather than carried. The
      // replacement goes in because a match this same commit has already moved is RE-RESOLVED
      // rather than refused, and the shift it caused is a function of the replacement's length.
      const checked = verifyEdits(
        file.text,
        request.term,
        request.modes,
        target.edits,
        request.replacement,
      );
      if (checked.applicable.length === 0) {
        return { kind: 'disk', applied: [], refusedAny: checked.gone.length > 0 };
      }

      const next = applyReplacements(file.text, checked.applicable, request.replacement);
      // The SAME metadata the decode reported. Not the app's defaults, and not anything recorded at
      // scan time: this file's own bytes are the only authority on how it must be written back.
      const opts: EncodeOptions = {
        encoding: file.encoding,
        hasBom: file.hasBom,
        lineEnding: file.lineEnding,
      };
      // FR-056 — a file that MIXES endings keeps every one of them. Without this, the dominant
      // ending is re-applied to every line and a three-line edit arrives as a whole-file diff.
      if (file.mixedLineEndings) opts.mixedLineEndings = file.mixedLineEndings;
      const out = encode(next, opts);

      // R8's last check, with nothing between it and the write.
      if (this.editors.isOpen(absPath)) return { kind: 'becameOpen' };
      await this.fs.writeBytes(realPath, out);
      /*
       * FR-083c — immediately, with nothing between it and the write.
       *
       * Here rather than once at the end of the commit, because the thing being raced is a debounced
       * watcher tick: a Replace All over many files would otherwise leave the first file's write
       * unaccounted for while the rest were still being written, and every one of those is a tick's
       * worth of window. Awaited for the same reason.
       *
       * The BUFFER path needs it too, but only since FR-086: a buffer edit changes no file, so no
       * watcher saw it — until a save writes one out. It is declared there for the same reason and in
       * the same place relative to the write, in {@link ReplaceCommitService.applyInBuffer}. It could
       * not be done inside `EditorCoordinator.save` itself: that method knows the document, and
       * FR-083c is a question about which FIND PANEL wrote the file, which only this service knows.
       */
      await this.ownWrites?.noteOwnWrite(request.panelId, target.relPath);
      return {
        kind: 'disk',
        // FR-083b — `next` is this file's whole new text, already in hand, so the snippets cost no
        // second read. Derived AFTER the write, so nothing describes text that never reached disk.
        applied: withSnippets(
          checked.applied,
          checked.applicable,
          Text.of(next.split('\n')),
          request.replacement.length,
          budget,
        ),
        refusedAny: checked.gone.length > 0,
      };
    } catch (e) {
      return { kind: 'failed', reason: reasonFor(e) };
    }
  }
}

/**
 * What happened to ONE file, in the vocabulary the four outcome arrays are built from.
 *
 * `buffer` and `disk` are separate kinds rather than a flag because the distinction is the one the
 * user is told about: `changedOnDisk` is irreversible (FR-057a), `changedInBuffer` is one undo away.
 */
type PathOutcome =
  | { kind: 'failed'; reason: FailedCommit['reason'] }
  /** `applied` empty IS "nothing was written" — one fact, rather than a flag that can disagree. */
  | {
      kind: 'buffer' | 'disk';
      applied: readonly AppliedEdit[];
      refusedAny: boolean;
      /**
       * FR-086 asked for a save here and it did not happen — the reason, or absent.
       *
       * Absent covers BOTH "it saved" and "no save was owed", which is the right grain FOR THIS
       * FIELD: the caller's question here is only ever whether it must tell the user something
       * extra, and there is nothing to tell in either of those cases. Only the buffer path can carry
       * it.
       */
      notSaved?: string;
      /**
       * FR-086 saved this document, positively — and this is NOT `notSaved`'s absence inverted.
       *
       * The two are different questions and the summary needs both. `notSaved` absent means "saved
       * OR nothing was owed", which cannot tell a file that is now on disk from one that is still
       * dirty with the user's own work beside the replacement. The notice has to count exactly that
       * distinction, so it is stated rather than inferred.
       */
      didSave?: true;
    };

/**
 * Attach each write's re-derived snippet to the edit the caller asked with (FR-083b).
 *
 * The pairing is `postCommitSnippets`' contract — its answer is index-for-index with `applicable`,
 * and `applicable` is index-for-index with `applied` — so this is the one place the two coordinate
 * systems are joined, on both paths.
 */
function withSnippets(
  applied: readonly Match[],
  applicable: readonly Match[],
  after: Text,
  replacementLength: number,
  budget: number,
): AppliedEdit[] {
  const snippets = postCommitSnippets(after, applicable, replacementLength, budget);
  return applied.map((edit, i) => {
    const snippet = snippets[i];
    // Spread rather than mutate: `applied` entries come from `verifyEdits`, and the caller's array
    // is not this function's to write into.
    return snippet === undefined ? { from: edit.from, to: edit.to } : { ...edit, snippet };
  });
}

/** How much of the commit's budget one file's answer spent. */
function snippetChars(edits: readonly AppliedEdit[]): number {
  let spent = 0;
  for (const { snippet } of edits) {
    if (snippet) spent += snippet.before.length + snippet.matched.length + snippet.after.length;
  }
  return spent;
}

/** An OS error, said in the vocabulary FR-058 reports (data-model §6). */
function reasonFor(e: unknown): FailedCommit['reason'] {
  const code = (e as { code?: string } | null)?.code;
  if (code === 'ENOENT') return 'missing';
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'readOnly';
  if (code === 'EBUSY' || code === 'ETXTBSY') return 'locked';
  return 'io';
}
