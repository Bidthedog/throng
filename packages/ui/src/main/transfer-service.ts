/**
 * TransferService — the ONE engine every paste and every drag runs through (050, research R2, R4, R7).
 *
 * ══ WHY A SECOND SERVICE BESIDE FilesService ══
 *
 * `FilesService` resolves everything against ONE root, so a source in another project is unreachable
 * through it by construction. A cross-project paste needs sources from any root and a target in the
 * active one, both checked on real paths (FR-010) — and progress, cancel, queueing, clash prompts and
 * roll back all need state that outlives one IPC call. So a paste is a JOB over ABSOLUTE paths, held
 * here, and run inside `FilesService.exclusive` so file operations stay one queue (FR-019e).
 *
 * ══ THE JOURNAL ══
 *
 * Every change a job makes is written down as it happens — copies placed, items moved, items replaced.
 * The result (`placed`), the undo entry, the move bracket's close and roll back are all built from it,
 * never from the request: a half-finished job reports what it DID (FR-023, 019 FR-001).
 */
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import {
  clashKind,
  classifyTopLevel,
  isWithinRoot,
  keepBothName,
  newerOf,
  parseFileOpStack,
  plannedMoves,
  validateFileOp,
  type FailureCause,
  type ClashChoice,
  type ClashSide,
  type ClashAnswer,
  type ClashQuestion,
  type ClipboardItem,
  type FileClipboard,
  type FileOpUndoEntry,
  type Holder,
  type IFileSystem,
  type TransferFailure,
  type TransferJobState,
  type TransferProgress,
  type TransferResult,
} from '@throng/core';
import { failure, holdsTheAnswer, type MovePair } from './files-service.js';

export type TransferMode = 'cut' | 'copy';
export type TransferKind = 'paste' | 'drag';

/** What the engine needs from `FilesService` (050 T013): its queue, its bracket, its root, its holders. */
export interface TransferFiles {
  exclusive<T>(op: () => Promise<T>): Promise<T>;
  beginMoveBracket(absPaths: readonly string[]): void;
  endMoveBracket(moves: readonly MovePair[]): void;
  activeRoot(): string | null;
  holderFor(absPath: string, reportingWindowId?: number): Promise<Holder | undefined>;
}

/** Pushes to the window that owns a job (contracts/transfer-ipc §2). */
export interface TransferEvents {
  progress(windowId: number, progress: TransferProgress): void;
  /** False when the owner window is gone, which answers Keep finished (R9). */
  cancelChoice(windowId: number, jobId: string): boolean | void;
  done(windowId: number, result: TransferResult): void;
}

/** Asks the owner window about one clash and waits for the answer (R9). */
export interface ClashAsker {
  ask(windowId: number, question: ClashQuestion): Promise<ClashAnswer>;
}

export interface TransferDeps {
  fs: IFileSystem;
  files: TransferFiles;
  /** Every project, fresh — sources may come from any of their roots (FR-010). */
  projects: () => Promise<readonly { id: string; rootFolder: string }[]>;
  events: TransferEvents;
  clash: ClashAsker;
  /** The application clipboard: a cut paste leaves on it what did not move (R7). */
  clipboard?: { afterRun(snapshot: FileClipboard, notMoved: readonly ClipboardItem[]): void };
  /** `explorer.replaceMode`, read live (FR-018f). Absent = the default, `recycle`. */
  replaceMode?: () => 'recycle' | 'permanent';
  now?: () => number;
  newId?: () => string;
}

type JournalOp =
  /** A copy this job created. `undoable: false` = left out of the undo entry. */
  | { op: 'placed'; from: string; to: string; undoable: boolean }
  /** An item this job moved. */
  | { op: 'moved'; from: string; to: string; undoable: boolean }
  /** An existing item a Replace disposed of; `trashedAt` null = deleted permanently (FR-018f). */
  | { op: 'replaced'; path: string; trashedAt: number | null; kind: 'file' | 'folder' }
  /** A cut merge's source folder, removed once empty (R4). */
  | { op: 'removedDir'; path: string };

/** Cancel, from the progress control or the clash prompt: the run stops before the next change. */
class JobCancelled extends Error {
  constructor() {
    super('The paste was cancelled.');
    this.name = 'AbortError';
  }
}

interface Job {
  id: string;
  kind: TransferKind;
  mode: TransferMode;
  sources: readonly string[];
  targetDir: string;
  ownerWindowId: number;
  snapshot: FileClipboard;
  state: TransferJobState;
  done: number;
  current: string | null;
  controller: AbortController;
  /** "Apply to all remaining clashes" — this job only (Key Entities *Clash decision*). */
  decisionAll?: ClashChoice;
  /** Set while the job waits for Keep finished / Roll back. */
  choose?: (choice: 'keep' | 'rollback') => void;
  /** Set by {@link TransferService.cancelAll}: the cancel choice is already made. */
  presetChoice?: 'keep' | 'rollback';
  journal: JournalOp[];
  failures: TransferFailure[];
  /** Top-level paths something landed at, in order (FR-025b). */
  placedTop: string[];
  /** Top-level sources that left in full (a cut) — what the clipboard lets go of. */
  movedTop: Set<string>;
  sourceProjectId: string;
  targetProjectId: string;
  result: Promise<TransferResult>;
  resolve: (r: TransferResult) => void;
}

/** What a job resolves before it changes anything. */
interface Context {
  roots: { id: string; real: string }[];
  targetReal: string;
}

const NOT_IN_PROJECT = 'is not inside a project.';

export type ApplyUndoResult =
  | { ok: true; entry?: FileOpUndoEntry }
  | { error: string; cause?: FailureCause };

/** Every path an entry names — each must be inside some project root before it is applied. */
function undoPaths(entry: FileOpUndoEntry): string[] {
  switch (entry.kind) {
    case 'move':
      return entry.items.flatMap((i) => [i.from, i.to]);
    case 'rename':
      return [entry.from, entry.to];
    case 'paste':
      return [
        ...[...entry.moved, ...entry.copied].flatMap((i) => [i.from, i.to]),
        ...entry.replaced.map((r) => r.path),
      ];
    case 'delete':
      return entry.items.map((i) => i.originalPath);
  }
}

function errnoOf(e: unknown): string | undefined {
  return e instanceof Error ? (e as NodeJS.ErrnoException).code : undefined;
}

export class TransferService {
  private readonly queue: Job[] = [];

  private idleWaiters: (() => void)[] = [];

  private readonly now: () => number;

  private readonly newId: () => string;

  constructor(private readonly deps: TransferDeps) {
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? randomUUID;
  }

  /**
   * Paste the clipboard as it is NOW into `targetDir` (absolute). Returns at once with the job id; the
   * result follows on `done` (and on the returned promise). The snapshot is taken here, at the request,
   * not when the job reaches the front of the queue (FR-019d).
   */
  paste(
    ownerWindowId: number,
    targetDir: string,
    snapshot: NonNullable<FileClipboard>,
  ): { jobId: string; result: Promise<TransferResult> } {
    const job = this.enqueue('paste', snapshot.mode, snapshot.items.map((i) => i.absPath), targetDir, ownerWindowId, snapshot);
    return { jobId: job.id, result: job.result };
  }

  /** A drag: the same engine, no progress and no cancel (FR-019e). Resolves when the job ends. */
  drop(ownerWindowId: number, sources: readonly string[], targetDir: string, mode: TransferMode): Promise<TransferResult> {
    return this.enqueue('drag', mode, sources, targetDir, ownerWindowId, null).result;
  }

  private enqueue(
    kind: TransferKind,
    mode: TransferMode,
    sources: readonly string[],
    targetDir: string,
    ownerWindowId: number,
    snapshot: FileClipboard,
  ): Job {
    let resolve!: (r: TransferResult) => void;
    const result = new Promise<TransferResult>((r) => {
      resolve = r;
    });
    const job: Job = {
      id: this.newId(),
      kind,
      mode,
      sources: [...sources],
      targetDir,
      ownerWindowId,
      snapshot,
      state: 'queued',
      done: 0,
      current: null,
      controller: new AbortController(),
      journal: [],
      failures: [],
      placedTop: [],
      movedTop: new Set(),
      sourceProjectId: '',
      targetProjectId: '',
      result,
      resolve,
    };
    this.queue.push(job);
    if (this.queue.length > 1) this.emitProgress(job);
    void this.deps.files.exclusive(() => this.run(job)).then(
      (r) => {
        if (r) this.finish(job, r);
      },
      (e: unknown) => this.finish(job, this.resultOf(job, [this.jobFailure(job, (e as Error).message)])),
    );
    return job;
  }

  /**
   * Cancel a paste (contracts/transfer-ipc §2). Queued: it is removed and never runs — nothing to keep
   * or roll back, so nothing is asked (FR-019d). Running: the item in progress is aborted at once and
   * the job then waits for Keep finished or Roll back (FR-019a). A drag has no cancel (FR-019e).
   */
  cancel(jobId: string): void {
    const job = this.queue.find((j) => j.id === jobId);
    if (!job || job.kind !== 'paste') return;
    if (job.state === 'queued') {
      job.controller.abort();
      this.finish(job, { ...this.resultOf(job, []), outcome: 'kept' });
      return;
    }
    if (job.state === 'running') job.controller.abort();
  }

  /** The owner window's answer to the cancel choice (FR-019a). */
  finishCancel(jobId: string, choice: 'keep' | 'rollback'): void {
    const job = this.queue.find((j) => j.id === jobId);
    if (job?.state !== 'awaiting-cancel-choice') return;
    job.choose?.(choice);
  }

  /**
   * The owner window is gone: whatever it was being asked, the answer is the one that loses nothing
   * — Keep finished (R9).
   */
  /**
   * Apply a cross-project or `paste` undo entry (R10, contracts/transfer-ipc §2 `applyUndo`).
   *
   * Over absolute paths, each confined to SOME project root before anything changes, inside the one
   * file-operation queue, with every move inside the move bracket — so an editor follows an undone
   * move back across projects (US3 AS1). A stale entry is refused by the core `validate` rule with
   * nothing changed (024 FR-008, FR-021).
   *
   * A `paste` redo recycles the replaced items again, at a new time; the entry returned carries those
   * times, and the caller stores it in place of the old one so the next undo restores the right
   * Recycle Bin record.
   */
  applyUndo(entry: FileOpUndoEntry, direction: 'undo' | 'redo', windowId?: number): Promise<ApplyUndoResult> {
    return this.deps.files.exclusive(() => this.applyUndoNow(entry, direction, windowId));
  }

  private async applyUndoNow(entry: FileOpUndoEntry, direction: 'undo' | 'redo', windowId?: number): Promise<ApplyUndoResult> {
    const { fs } = this.deps;
    const valid = parseFileOpStack(JSON.stringify({ undo: [entry], redo: [] })).undo[0];
    if (!valid || (valid.kind !== 'move' && valid.kind !== 'rename' && valid.kind !== 'paste')) {
      return { error: 'This undo entry cannot be applied.' };
    }
    const paths = undoPaths(valid);
    const roots = await this.realRoots();
    for (const p of paths) {
      if (!(await this.confined(roots, p))) return { error: `"${basename(p)}" ${NOT_IN_PROJECT}` };
    }
    const present = new Map<string, boolean>();
    for (const p of paths) present.set(p, await fs.exists(p));
    const verdict = validateFileOp(valid, direction, (p) => present.get(p) ?? false);
    if (!verdict.ok) return { error: verdict.reason };

    const moves = plannedMoves(valid, direction);
    const moved: MovePair[] = [];
    if (moves.length > 0) this.deps.files.beginMoveBracket(moves.map((m) => m.from));
    let current: string | undefined;
    try {
      if (valid.kind !== 'paste') {
        for (const m of moves) {
          current = m.from;
          await this.moveBack(m.from, m.to);
          moved.push(m);
        }
        return { ok: true };
      }
      if (direction === 'undo') {
        for (const m of moves) {
          current = m.from;
          await this.moveBack(m.from, m.to);
          moved.push(m);
        }
        for (const c of valid.copied) {
          current = c.to;
          await fs.delete(c.to);
        }
        for (const r of valid.replaced) {
          current = r.path;
          await fs.restoreFromTrash(r.path, r.trashedAt);
        }
        return { ok: true };
      }
      // Redo: the replaced items make way again, then everything lands as the paste first had it.
      const replaced: { path: string; trashedAt: number }[] = [];
      for (const r of valid.replaced) {
        current = r.path;
        await fs.trash(r.path);
        replaced.push({ path: r.path, trashedAt: this.now() });
      }
      for (const m of moves) {
        current = m.from;
        await this.moveBack(m.from, m.to);
        moved.push(m);
      }
      for (const c of valid.copied) {
        current = c.from;
        await this.copyWalk(new AbortController().signal, c.from, c.to);
      }
      return { ok: true, entry: { ...valid, replaced } };
    } catch (e) {
      const holder = holdsTheAnswer(e) && current ? await this.deps.files.holderFor(current, windowId) : undefined;
      const envelope = failure(e, 'lock', holder);
      return envelope.cause ? { error: envelope.error, cause: envelope.cause } : { error: envelope.error };
    } finally {
      if (moves.length > 0) this.deps.files.endMoveBracket(moved);
    }
  }

  /** Does each path exist? False for any path outside every project root (contracts/transfer-ipc §2). */
  async exists(absPaths: readonly string[]): Promise<boolean[]> {
    const roots = await this.realRoots();
    const out: boolean[] = [];
    for (const p of absPaths) {
      out.push((await this.deps.fs.exists(p)) && (await this.confined(roots, p)));
    }
    return out;
  }

  private async realRoots(): Promise<string[]> {
    const out: string[] = [];
    for (const p of await this.deps.projects()) {
      try {
        out.push(await this.deps.fs.realpath(p.rootFolder));
      } catch {
        // A project whose root is gone confines nothing.
      }
    }
    return out;
  }

  /**
   * Is `path` strictly inside some project root, on real paths (004 FR-037)? A path that does not
   * exist yet is judged by its nearest existing ancestor, which is what it would be created under.
   */
  private async confined(roots: readonly string[], path: string): Promise<boolean> {
    let probe = path;
    let rest = '';
    for (;;) {
      try {
        const real = await this.deps.fs.realpath(probe);
        const full = rest ? join(real, rest) : real;
        return roots.some((r) => isWithinRoot(r, full) && !isWithinRoot(full, r));
      } catch {
        const parent = dirname(probe);
        if (parent === probe) return false;
        rest = rest ? join(basename(probe), rest) : basename(probe);
        probe = parent;
      }
    }
  }

  /** How many pastes and drags are running and waiting — the quit gate's question (FR-019f). */
  busy(): { running: number; queued: number } {
    const queued = this.queue.filter((j) => j.state === 'queued').length;
    return { running: this.queue.length - queued, queued };
  }

  /** Resolves once no job is running or waiting. */
  whenIdle(): Promise<void> {
    if (this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /**
   * Cancel every paste with one choice, made once for all of them — quitting's *Cancel pastes*
   * (FR-019f). Queued ones simply never run; running ones stop and keep or roll back without being
   * asked again. A drag has no cancel and is waited for (FR-019e).
   */
  cancelAll(choice: 'keep' | 'rollback'): void {
    for (const job of [...this.queue]) {
      if (job.kind !== 'paste') continue;
      job.presetChoice = choice;
      if (job.state === 'awaiting-cancel-choice') job.choose?.(choice);
      else this.cancel(job.id);
    }
  }

  ownerGone(windowId: number): void {
    for (const job of this.queue) {
      if (job.ownerWindowId === windowId && job.state === 'awaiting-cancel-choice') job.choose?.('keep');
    }
  }

  /** Returns null for a job cancelled while queued — already finished by {@link cancel}. */
  private async run(job: Job): Promise<TransferResult | null> {
    if (job.state === 'done') return null;
    job.state = 'running';
    this.emitProgress(job);
    const prepared = await this.prepare(job);
    if ('error' in prepared) return this.resultOf(job, [this.jobFailure(job, prepared.error)]);
    const ctx = prepared;
    // Only a cut moves anything, so only a cut opens the bracket — over every source, before the first
    // change (019 FR-004); it closes in the `finally` with exactly what moved.
    const bracketOpen = job.mode === 'cut';
    if (bracketOpen) this.deps.files.beginMoveBracket(job.sources);
    let outcome: TransferResult['outcome'] = 'completed';
    let rollbackFailures: TransferFailure[] = [];
    try {
      for (const src of job.sources) {
        // SC-008 — Cancel stops before the next item begins.
        if (job.controller.signal.aborted) break;
        job.current = src;
        this.emitProgress(job);
        await this.transferTop(job, ctx, src);
        job.done++;
        job.current = null;
        this.emitProgress(job);
      }
      if (job.controller.signal.aborted) {
        job.current = null;
        if ((await this.askCancelChoice(job)) === 'rollback') {
          job.state = 'rolling-back';
          this.emitProgress(job);
          rollbackFailures = await this.rollback(job);
          outcome = 'rolled-back';
        } else {
          outcome = 'kept';
        }
      }
    } finally {
      // The clipboard first, while its items still carry the paths the snapshot was taken with: the
      // bracket's close re-points pending items to where they went (FR-009), after which a clipboard
      // holding only moved items would no longer equal the snapshot, and `afterRun` would leave the
      // moved files on it, greyed in their new home (FR-006).
      this.clipboardAfter(job);
      if (bracketOpen) this.deps.files.endMoveBracket(this.movedPairs(job));
    }
    const result = this.resultOf(job, job.failures);
    if (outcome === 'completed') return result;
    // After a roll back there is nothing to undo (FR-019b), and the run placed only what roll back
    // could not take away — a top-level path some still-standing copy or move landed at or under.
    const standing = job.journal.flatMap((o) => (o.op === 'placed' || o.op === 'moved' ? [o.to] : []));
    const placed = result.placed.filter((p) => standing.some((to) => isWithinRoot(p, to)));
    return outcome === 'kept'
      ? { ...result, outcome }
      : { ...result, outcome, placed, undo: null, rollbackFailures };
  }

  /** Ask the owner window Keep finished or Roll back, and wait (FR-019a). */
  private askCancelChoice(job: Job): Promise<'keep' | 'rollback'> {
    return new Promise((resolve) => {
      job.state = 'awaiting-cancel-choice';
      job.choose = (choice) => {
        job.choose = undefined;
        job.state = 'running';
        resolve(choice);
      };
      // Quit already chose for every job (FR-019f): asking again per job would be a second question.
      if (job.presetChoice) {
        job.choose(job.presetChoice);
        return;
      }
      this.emitProgress(job);
      // Nobody left to ask: the conservative answer (R9).
      if (this.deps.events.cancelChoice(job.ownerWindowId, job.id) === false) job.choose('keep');
    });
  }

  /**
   * Undo the run from its journal, newest first (R7): placed copies removed, moved items moved back,
   * the source folder of a cut merge recreated, replaced items restored from the Recycle Bin. A step
   * that fails stays in the journal — so the bracket and the clipboard still see it as done — and is
   * named in the run's one notice (edge case *Roll back cannot finish*, SC-007).
   */
  private async rollback(job: Job): Promise<TransferFailure[]> {
    const { fs } = this.deps;
    const failures: TransferFailure[] = [];
    const kept: JournalOp[] = [];
    for (const op of [...job.journal].reverse()) {
      try {
        switch (op.op) {
          case 'placed':
            await fs.delete(op.to);
            break;
          case 'moved':
            await this.moveBack(op.to, op.from);
            break;
          case 'removedDir':
            await fs.mkdir(op.path);
            break;
          case 'replaced':
            if (op.trashedAt === null) throw new Error(`"${basename(op.path)}" was deleted permanently and cannot be restored.`);
            await fs.restoreFromTrash(op.path, op.trashedAt);
            break;
        }
      } catch (e) {
        kept.unshift(op);
        const path = op.op === 'placed' || op.op === 'moved' ? op.to : op.path;
        failures.push({ name: basename(path), dir: basename(dirname(path)), message: (e as Error).message });
      }
    }
    job.journal = kept;
    // A source counts as moved only while something of its move is still standing.
    for (const src of [...job.movedTop]) {
      const standing = kept.some((o) => (o.op === 'moved' && o.from === src) || (o.op === 'removedDir' && o.path === src));
      if (!standing) job.movedTop.delete(src);
    }
    return failures;
  }

  /** Put a moved item back where it came from — across a volume by copy-then-remove (R4). */
  private async moveBack(from: string, to: string): Promise<void> {
    const { fs } = this.deps;
    if (await fs.exists(to)) throw new Error(`"${basename(to)}" could not be put back: the name is taken again.`);
    if (dirname(from) === dirname(to)) {
      // A rename (or the reverse of one): same folder, new name.
      await fs.rename(from, basename(to));
      return;
    }
    if (basename(from) === basename(to)) {
      try {
        await fs.move(from, dirname(to));
        return;
      } catch (e) {
        if (errnoOf(e) !== 'EXDEV') throw e;
      }
    }
    try {
      await this.copyWalk(new AbortController().signal, from, to);
    } catch (e) {
      await fs.delete(to).catch(() => undefined);
      throw e;
    }
    await fs.delete(from);
  }

  /** A cut paste leaves exactly its items that did not move (FR-006, FR-019c, R7). */
  private clipboardAfter(job: Job): void {
    const { snapshot } = job;
    if (!this.deps.clipboard || snapshot === null || snapshot.mode !== 'cut' || job.movedTop.size === 0) return;
    this.deps.clipboard.afterRun(
      snapshot,
      snapshot.items.filter((it) => !job.movedTop.has(it.absPath)),
    );
  }

  /** Fresh roots, and the target confined to the ACTIVE root (FR-010) — before anything changes. */
  private async prepare(job: Job): Promise<Context | { error: string }> {
    const { fs } = this.deps;
    const roots: Context['roots'] = [];
    for (const p of await this.deps.projects()) {
      try {
        roots.push({ id: p.id, real: await fs.realpath(p.rootFolder) });
      } catch {
        // A project whose root is gone confines nothing.
      }
    }
    const active = this.deps.files.activeRoot();
    if (!active) return { error: 'No active project.' };
    let targetReal: string;
    let activeReal: string;
    try {
      activeReal = await fs.realpath(active);
      targetReal = await fs.realpath(job.targetDir);
    } catch {
      return { error: 'The folder to paste into could not be found.' };
    }
    if (!isWithinRoot(activeReal, targetReal)) return { error: 'Target is outside the project root.' };
    job.targetProjectId = roots.find((r) => isWithinRoot(r.real, targetReal))?.id ?? '';
    return { roots, targetReal };
  }

  /** One selected item: classified, confined, then placed. Its failure never stops the job (FR-013). */
  private async transferTop(job: Job, ctx: Context, src: string): Promise<void> {
    const { fs } = this.deps;
    try {
      const srcReal = await fs.realpath(src);
      const root = ctx.roots.find((r) => isWithinRoot(r.real, srcReal));
      if (!root) {
        this.failNamed(job, src, `"${basename(src)}" ${NOT_IN_PROJECT}`);
        return;
      }
      if (!job.sourceProjectId) job.sourceProjectId = root.id;
      if (isWithinRoot(srcReal, root.real)) {
        this.failNamed(job, src, 'The project root cannot be pasted.');
        return;
      }
      const parentReal = await fs.realpath(dirname(src));
      switch (classifyTopLevel(parentReal, ctx.targetReal, srcReal, job.mode)) {
        case 'same-folder-duplicate': {
          // A cut back into its own folder is a no-op; a copy is a duplicate, never a clash (FR-018c).
          if (job.mode === 'cut') return;
          const siblings = (await fs.list(job.targetDir)).map((e) => e.name);
          const dest = join(job.targetDir, keepBothName(basename(src), siblings));
          await this.copyTree(job, src, dest, true);
          job.placedTop.push(dest);
          return;
        }
        case 'into-own-descendant':
          this.failNamed(job, src, `"${basename(src)}" cannot be pasted into itself.`);
          return;
        case 'ordinary': {
          const { landed, moved } = await this.place(job, src, job.targetDir);
          if (landed) job.placedTop.push(landed);
          if (moved) job.movedTop.add(src);
        }
      }
    } catch (e) {
      // A cancelled item is not a failed one: its partial copy is already gone (R5, R7).
      if (job.controller.signal.aborted) return;
      await this.fail(job, src, e);
    }
  }

  /**
   * Put `src` into `destDir` under its own name. `landed` is where something landed (null: nothing
   * did); `moved` is true only when a cut's item left its source in full.
   *
   * A name already taken is the user's decision, asked BEFORE anything happens to either item
   * (FR-017, SC-006) — except a folder landing on a folder, which merges and asks about each clashing
   * child at whatever depth it sits (FR-018c, FR-018e).
   */
  private async place(job: Job, src: string, destDir: string): Promise<{ landed: string | null; moved: boolean }> {
    const { fs } = this.deps;
    const dest = join(destDir, basename(src));
    if (!(await fs.exists(dest))) return { landed: dest, moved: await this.land(job, src, dest, true) };

    const incoming = (await fs.stat(src)).kind;
    const existing = (await fs.stat(dest)).kind;
    if (clashKind(incoming, existing) === 'merge') return this.merge(job, src, dest);

    switch (await this.decide(job, src, dest, incoming, existing)) {
      case 'skip':
        // Both items untouched; the source stays on the clipboard (FR-018a).
        return { landed: null, moved: false };
      case 'keep-both': {
        const siblings = (await fs.list(destDir)).map((e) => e.name);
        const named = join(destDir, keepBothName(basename(src), siblings));
        return { landed: named, moved: await this.land(job, src, named, true) };
      }
      case 'replace': {
        const recycled = await this.dispose(job, dest, existing);
        // A permanently replaced item cannot come back, so its replacement leaves the undo entry
        // out of it too (FR-018f).
        return { landed: dest, moved: await this.land(job, src, dest, recycled) };
      }
    }
  }

  /**
   * A folder onto a folder: every child is placed in turn, clashes asked where they occur. On a cut
   * the source folder goes only once it is empty — a skipped child keeps it, and its path, alive
   * (R4, FR-006).
   */
  private async merge(job: Job, src: string, dest: string): Promise<{ landed: string | null; moved: boolean }> {
    const { fs } = this.deps;
    let landedAny = false;
    for (const child of await fs.list(src)) {
      if (job.controller.signal.aborted) break;
      const { landed } = await this.place(job, join(src, child.name), dest);
      if (landed) landedAny = true;
    }
    let moved = false;
    if (job.mode === 'cut' && !job.controller.signal.aborted && (await fs.list(src)).length === 0) {
      await fs.delete(src);
      job.journal.push({ op: 'removedDir', path: src });
      moved = true;
    }
    return { landed: landedAny ? dest : null, moved };
  }

  /** The answer for one clash: the job's stored "apply to all", or the owner window's (R9). */
  private async decide(
    job: Job,
    src: string,
    dest: string,
    incoming: 'file' | 'folder',
    existing: 'file' | 'folder',
  ): Promise<ClashChoice> {
    if (job.decisionAll) return job.decisionAll;
    const [existingSide, incomingSide] = await Promise.all([this.side(dest, existing), this.side(src, incoming)]);
    const newer = newerOf(existingSide, incomingSide);
    const signal = job.controller.signal;
    // Cancel pressed on the progress notice while a question is open ends the wait too.
    const cancelled = new Promise<ClashAnswer>((resolve) => {
      if (signal.aborted) resolve({ choice: 'cancel' });
      signal.addEventListener('abort', () => resolve({ choice: 'cancel' }), { once: true });
    });
    const answer = await Promise.race([cancelled, this.deps.clash.ask(job.ownerWindowId, {
      jobId: job.id,
      requestId: this.newId(),
      name: basename(dest),
      targetDir: dirname(dest),
      existing: { ...existingSide, newer: newer === 'existing' },
      incoming: { ...incomingSide, newer: newer === 'incoming' },
      permanentReplace: this.replaceMode() === 'permanent',
    })]);
    if (answer.choice === 'cancel') {
      // Cancel from the prompt is Cancel (FR-019a): the run stops here, nothing about this item done.
      job.controller.abort();
      throw new JobCancelled();
    }
    if (answer.applyToAll) job.decisionAll = answer.choice;
    return answer.choice;
  }

  /** One side of the prompt: size and time for a file, item count for a folder (FR-018). */
  private async side(path: string, kind: 'file' | 'folder'): Promise<Omit<ClashSide, 'newer'>> {
    const { fs } = this.deps;
    if (kind === 'folder') return { kind, itemCount: (await fs.list(path)).length };
    const { mtimeMs, size } = await fs.modifiedAt(path);
    return { kind, size, modifiedMs: mtimeMs };
  }

  /**
   * Dispose of the item a Replace takes the place of, by `explorer.replaceMode` (FR-018b, FR-018f).
   * Through the filesystem seam directly, not `FilesService.delete`: an open editor on it meets the
   * change as it would any other program's, and keeps unsaved work (R6). True when it can come back.
   */
  private async dispose(job: Job, path: string, kind: 'file' | 'folder'): Promise<boolean> {
    if (this.replaceMode() === 'permanent') {
      await this.deps.fs.delete(path);
      job.journal.push({ op: 'replaced', path, trashedAt: null, kind });
      return false;
    }
    await this.deps.fs.trash(path);
    job.journal.push({ op: 'replaced', path, trashedAt: this.now(), kind });
    return true;
  }

  private replaceMode(): 'recycle' | 'permanent' {
    return this.deps.replaceMode?.() ?? 'recycle';
  }

  /**
   * Move or copy `src` to the free path `dest`. True when a cut's item actually moved. `undoable`
   * false keeps it out of the undo entry (FR-018f).
   */
  private async land(job: Job, src: string, dest: string, undoable: boolean): Promise<boolean> {
    if (job.mode === 'copy') {
      await this.copyTree(job, src, dest, undoable);
      return false;
    }
    if (basename(dest) === basename(src)) {
      try {
        const to = await this.deps.fs.move(src, dirname(dest));
        job.journal.push({ op: 'moved', from: src, to, undoable });
        return true;
      } catch (e) {
        // A rename cannot cross a volume (FR-014); anything else is a real failure.
        if (errnoOf(e) !== 'EXDEV') throw e;
      }
    }
    return this.copyThenRemove(job, src, dest, undoable);
  }

  /**
   * A move the rename cannot do: copy, then remove the source (R4). Presented exactly as a move —
   * same bracket pair, same undo — once the source is gone (FR-014).
   *
   * When the source cannot be removed the copy STAYS and the source stays (FR-015): the item is a
   * failure naming the source and its holder, and it never becomes a move. The source is first renamed
   * aside, which fails cleanly while anything holds it; a recursive delete straight away would empty a
   * held folder before failing on the folder itself, leaving the source neither moved nor in place.
   */
  private async copyThenRemove(job: Job, src: string, dest: string, undoable: boolean): Promise<boolean> {
    const { fs } = this.deps;
    await this.copyTree(job, src, dest, false);
    const aside = `${basename(src)}.throng-moving-${job.id}`;
    let asidePath: string;
    try {
      asidePath = await fs.rename(src, aside);
    } catch (e) {
      await this.fail(job, src, e);
      return false;
    }
    try {
      await fs.delete(asidePath);
    } catch (e) {
      await fs.rename(asidePath, basename(src)).catch(() => undefined);
      await this.fail(job, src, e);
      return false;
    }
    const at = job.journal.findIndex((o) => o.op === 'placed' && o.to === dest);
    job.journal.splice(at, 1, { op: 'moved', from: src, to: dest, undoable });
    return true;
  }

  /**
   * Copy a file or a whole folder to `dest`, file by file through the cancellable seam (R5), keeping
   * the directory structure at every depth (FR-018e). A copy that fails part-way is removed in full,
   * so a failed or cancelled item never leaves half of itself behind.
   */
  private async copyTree(job: Job, src: string, dest: string, undoable: boolean): Promise<void> {
    try {
      await this.copyWalk(job.controller.signal, src, dest);
    } catch (e) {
      await this.deps.fs.delete(dest).catch(() => undefined);
      throw e;
    }
    job.journal.push({ op: 'placed', from: src, to: dest, undoable });
  }

  private async copyWalk(signal: AbortSignal, src: string, dest: string): Promise<void> {
    const { fs } = this.deps;
    const { kind, isSymlink } = await fs.stat(src);
    if (isSymlink) {
      // A link is copied as a link — never followed out of its project (004 FR-037).
      await fs.copy(src, dirname(dest), basename(dest));
      return;
    }
    if (kind === 'file') {
      await fs.copyFileCancellable(src, dest, signal);
      return;
    }
    await fs.mkdir(dest);
    for (const child of await fs.list(src)) {
      signal.throwIfAborted();
      await this.copyWalk(signal, join(src, child.name), join(dest, child.name));
    }
  }

  /** The pairs that moved and are still moved — what the bracket closes with (019 FR-001). */
  private movedPairs(job: Job): MovePair[] {
    return job.journal.flatMap((o) => (o.op === 'moved' ? [{ from: o.from, to: o.to }] : []));
  }

  /**
   * The undo entry, from the journal — exactly what the job did (R10, FR-023).
   *
   * - Something went to the Recycle Bin: a `paste` entry, whose undo removes what landed and restores
   *   what was replaced — which makes even a copy undoable (FR-018b).
   * - Otherwise a cut that moved anything: a plain `move`, as a move within a project always was.
   * - Otherwise nothing: a copy is not undoable (FR-022).
   *
   * A fresh `id` on every entry; `projects` only across projects, where the entry lives in both
   * projects' stacks and is matched there by that id (FR-020).
   */
  private buildUndo(job: Job): FileOpUndoEntry | null {
    const pairs = (op: 'moved' | 'placed'): { from: string; to: string }[] =>
      job.journal.flatMap((o) => (o.op === op && o.undoable ? [{ from: o.from, to: o.to }] : []));
    const moved = pairs('moved');
    const replaced = job.journal.flatMap((o) =>
      o.op === 'replaced' && o.trashedAt !== null ? [{ path: o.path, trashedAt: o.trashedAt }] : [],
    );
    const cross =
      job.sourceProjectId && job.targetProjectId && job.sourceProjectId !== job.targetProjectId
        ? { projects: { source: job.sourceProjectId, target: job.targetProjectId } }
        : {};
    if (replaced.length > 0) {
      const copied = job.mode === 'copy' ? pairs('placed') : [];
      return { kind: 'paste', id: this.newId(), moved, copied, replaced, ...cross, at: this.now() };
    }
    if (job.mode !== 'cut' || moved.length === 0) return null;
    return { kind: 'move', id: this.newId(), items: moved, ...cross, at: this.now() };
  }

  private resultOf(job: Job, failures: TransferFailure[]): TransferResult {
    return {
      jobId: job.id,
      kind: job.kind,
      outcome: 'completed',
      placed: [...job.placedTop],
      undo: this.buildUndo(job),
      failures: [...failures],
      rollbackFailures: [],
      sourceProjectId: job.sourceProjectId,
      targetProjectId: job.targetProjectId,
    };
  }

  /** A failure of the whole job, before any change: named after the folder it would have landed in. */
  private jobFailure(job: Job, message: string): TransferFailure {
    return { name: basename(job.targetDir), message };
  }

  private failNamed(job: Job, path: string, message: string): void {
    job.failures.push({ name: basename(path), dir: basename(dirname(path)), message });
  }

  /** Classify an item's failure by the 029 classes, naming its holder where that is the answer. */
  private async fail(job: Job, path: string, e: unknown): Promise<void> {
    const holder = holdsTheAnswer(e) ? await this.deps.files.holderFor(path, job.ownerWindowId) : undefined;
    const envelope = failure(e, 'lock', holder);
    job.failures.push({
      name: basename(path),
      dir: basename(dirname(path)),
      message: envelope.error,
      ...(envelope.cause ? { cause: envelope.cause } : {}),
    });
  }

  private finish(job: Job, result: TransferResult): void {
    job.state = 'done';
    const at = this.queue.indexOf(job);
    if (at >= 0) this.queue.splice(at, 1);
    if (job.kind === 'paste') this.deps.events.done(job.ownerWindowId, result);
    job.resolve(result);
    // Every paste still waiting is now one place nearer the front.
    for (const waiting of this.queue) if (waiting.state === 'queued') this.emitProgress(waiting);
    if (this.queue.length === 0) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const w of waiters) w();
    }
  }

  private emitProgress(job: Job): void {
    if (job.kind !== 'paste') return;
    this.deps.events.progress(job.ownerWindowId, {
      jobId: job.id,
      kind: job.kind,
      state: job.state,
      done: job.done,
      total: job.sources.length,
      current: job.current,
      queuedBehind: job.state === 'queued' ? this.queue.indexOf(job) : 0,
      targetDir: job.targetDir,
    });
  }
}
