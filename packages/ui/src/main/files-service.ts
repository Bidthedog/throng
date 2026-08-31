/**
 * FilesService — the UI-main file-explorer operations behind the `files.*`
 * preload bridge (004, T014/T046, contracts/files-bridge.md). Operates on
 * ROOT-RELATIVE paths, resolves them against the active project root, and
 * enforces project-root confinement on RESOLVED REAL paths (no symlink escape,
 * FR-022/FR-037) using the pure core rules. The renderer is sandboxed and reaches
 * the filesystem only through this service. All failures are returned as
 * `{ error }` (non-fatal, FR-025), never thrown across the bridge.
 */
import { basename, dirname, join } from 'node:path';
import {
  dedupeName,
  isDropAllowed,
  isWithinRoot,
  joinRel,
  classifyFailure,
  causeMessage,
  type DirEntry,
  type FailureCause,
  type FailureOperation,
  type Holder,
  type IFileSystem,
  type IShellIntegration,
} from '@throng/core';

/**
 * A failure, as it crosses the bridge (029, FR-018).
 *
 * ══ WHY THE CAUSE TRAVELS AND IS NOT RE-DERIVED ══
 *
 * `error` is the sentence the user reads, already spoken — classification happens HERE because this
 * is where the errno exists and where the holder can be looked up. But a spoken sentence is a
 * one-way door: `EBUSY` is gone from it, and with it the causeKey that decides whether a cascade of
 * failures is one notice or five, and the raw text a bug report needs.
 *
 * Sending the cause alongside is what keeps all three facts — the sentence, the key and the raw —
 * without asking the renderer to reverse-engineer any of them out of prose. Absent when the failure
 * matched none of the five kinds (FR-011b), in which case `error` is the untouched original.
 */
export interface FailureEnvelope {
  readonly error: string;
  readonly cause?: FailureCause;
}

export type OkOrError = { ok: true } | FailureEnvelope;
/** One completed move — both paths ABSOLUTE, as the OS spelled them (019, FR-001). */
export interface MovePair {
  readonly from: string;
  readonly to: string;
}
export type ListResult = { entries: DirEntry[] } | FailureEnvelope;
export type NewFolderResult = { relPath: string } | FailureEnvelope;
export type DeleteMode = 'recycle' | 'permanent';

const NO_ROOT = 'No active project.';
const OUTSIDE = 'Target is outside the project root.';
const SEP = /[\\/]/;

export class FilesService {
  private root: string | null = null;

  /**
   * The tail of the move QUEUE — one bracket at a time (019, FR-004).
   *
   * `beginMove` opens the bracket on the docs a move names; `markMoved` closes it on every open doc,
   * which is exact only while one bracket is open at a time. Nothing made that true: `move` and
   * `rename` are plain `ipcMain.handle`s (files-ipc.ts), and each item of a multi-file drag is its
   * own awaited `fs.move` — so a rename landing mid-batch closed the BATCH's bracket, and the next
   * `fs.move` in it let the folder watch reach `markDeleted`. A buffer nobody edited went dirty, a
   * recovery snapshot was written for it, and #87's symptom was back by a path its own fix left open.
   *
   * The two operations that own a bracket therefore run one at a time. This is not a lock against
   * concurrent filesystem access (the OS owns that) — it is what makes "the bracket is open" a fact
   * with one meaning. And it is a QUEUE, not a timeout: it holds for exactly as long as the move
   * takes and not a millisecond more, because FR-004/FR-011 want an ordering, never a clock.
   */
  private moveQueue: Promise<unknown> = Promise.resolve();

  private onDeleted?: (absPaths: string[]) => void;
  /** 024 US3 (#85): a deleted file came back, so an editor left dirty by the delete can recover. */
  private onRestored?: (absPaths: string[]) => void;

  private onMoveStarted?: (absPaths: readonly string[]) => void;

  private onMoved?: (moves: readonly MovePair[]) => void;

  constructor(
    private readonly fs: IFileSystem,
    private readonly shell: IShellIntegration,
  ) {}

  /**
   * Resolve who is holding an absolute path (029, FR-013).
   *
   * Injected rather than imported so this service stays ignorant of terminals and windows, and so
   * the not-yet-implemented third-party lookup and the non-Windows build take the SAME branch —
   * returning nothing — which is what stops either rotting unnoticed (FR-012, FR-014).
   */
  private resolveHolder:
    | ((absPath: string, reportingWindowId?: number) => Promise<Holder | undefined>)
    | null = null;

  setHolderResolver(
    resolve: (absPath: string, reportingWindowId?: number) => Promise<Holder | undefined>,
  ): void {
    this.resolveHolder = resolve;
  }

  /**
   * Where the RAW error text goes when a classified message replaces it (029, FR-018).
   *
   * FR-018 asks for the raw text in BOTH places, and the two are not redundant: Copy serves the user
   * writing a bug report right now, the log serves everyone after the notice has been dismissed —
   * which is the state a support conversation actually starts in.
   *
   * Injected rather than importing the log, for the same reason the holder resolver is: this service
   * knows about a filesystem and nothing else. It is also what makes the behaviour testable without
   * an Electron process.
   *
   * NOT relied upon implicitly. Both the UI main process and the daemon call `attachConsole()`, so a
   * bare `console.warn` here would in fact reach the log file today — and would silently stop the day
   * someone removed that call, taking a stated MUST with it and telling nobody.
   */
  private logRaw: ((message: string) => void) | null = null;

  setDiagnosticLog(log: (message: string) => void): void {
    this.logRaw = log;
  }

  /**
   * Is some Panel, in some window, showing this absolute path? The bound on {@link revealDocument}.
   *
   * Injected rather than imported, so this service stays ignorant of editors and windows — the same
   * seam, for the same reason, as {@link setHolderResolver}.
   */
  private isDocumentOpen: ((absPath: string) => boolean) | null = null;

  setOpenDocumentCheck(isOpen: (absPath: string) => boolean): void {
    this.isDocumentOpen = isOpen;
  }

  /**
   * Classify a failure, and record the raw text it replaced.
   *
   * Only when a cause was found. An UNCLASSIFIED failure is reported verbatim (FR-011b), so its raw
   * text is already in front of the user and logging it would add a line saying what the notice says.
   */
  private failed(e: unknown, operation: FailureOperation = 'access', holder?: Holder): FailureEnvelope {
    const envelope = failure(e, operation, holder);
    if (envelope.cause) this.logRaw?.(`[files] ${envelope.cause.raw}`);
    return envelope;
  }

  /**
   * Who is holding the item at `relPath`, best effort. Never throws — this is a failure path.
   *
   * `reportingWindowId` is the window that will SHOW the answer, which decides whether a holder in
   * another window gets that window named (FR-013a). Absent when the caller has no window — every
   * panel then reads as "here", which is the same answer a single-window session gives.
   */
  private async holderFor(relPath: string, reportingWindowId?: number): Promise<Holder | undefined> {
    if (!this.resolveHolder || !this.root) return undefined;
    try {
      return await this.resolveHolder(this.absOf(relPath), reportingWindowId);
    } catch {
      // Identifying a holder is inherently racy — the process can go between the failure and the
      // lookup. A lookup that fails degrades to "not identified", which is a stated outcome
      // (FR-012), never a second error on top of the first.
      return undefined;
    }
  }

  /** Notified with the absolute paths that a delete removed (FR-099) — the editor
   *  coordinator marks any open editor of a deleted file dirty. */
  setOnRestored(cb: (absPaths: string[]) => void): void {
    this.onRestored = cb;
  }

  setOnDeleted(cb: (absPaths: string[]) => void): void {
    this.onDeleted = cb;
  }

  /**
   * The move BRACKET (019 / #87, contracts/move-signal.md §1).
   *
   * `delete` has always announced itself; `move` announced nothing, so an in-app move reached the
   * editor coordinator only as the absence of a file — which the folder watch reads as a DELETE,
   * force-dirtying a buffer nobody edited and inviting the save that silently undoes the move.
   *
   * `onMoveStarted` fires BEFORE the first `fs.move`, and `onMoved` in a `finally` after the last:
   * the window in which the file is gone but the coordinator has not been told cannot exist, so no
   * clock is needed to outlast it (FR-004 — and FR-011 condemns exactly that shape one story over).
   */
  setOnMoveStarted(cb: (absPaths: readonly string[]) => void): void {
    this.onMoveStarted = cb;
  }

  /** Notified with the pairs that ACTUALLY moved — never the ones that were asked for (FR-001). */
  setOnMoved(cb: (moves: readonly MovePair[]) => void): void {
    this.onMoved = cb;
  }

  /** Point the service at a project's absolute root folder (or null = no project). */
  setRoot(absRoot: string | null): void {
    this.root = absRoot;
  }

  async list(relDir: string): Promise<ListResult> {
    if (!this.root) return { error: NO_ROOT };
    try {
      const abs = this.absOf(relDir);
      if (!(await this.within(abs))) return { error: OUTSIDE };
      return { entries: await this.fs.list(abs) };
    } catch (e) {
      return this.failed(e);
    }
  }

  async rename(relPath: string, newName: string, reportingWindowId?: number): Promise<OkOrError> {
    return this.bracketed(() => this.renameInBracket(relPath, newName, reportingWindowId));
  }

  private async renameInBracket(
    relPath: string,
    newName: string,
    reportingWindowId?: number,
  ): Promise<OkOrError> {
    if (!this.root) return { error: NO_ROOT };
    if (relPath === '') return { error: 'The project root cannot be renamed.' };
    const name = newName.trim();
    if (name.length === 0 || SEP.test(name)) return { error: 'Invalid name.' };
    // A rename IS a move (FR-006), and it had #87's hole identically: the file leaves the path every
    // open editor of it is pointing at. Same bracket, same callbacks — because it is the same fact,
    // and a second signal for it would be a second thing to keep in step.
    const moved: MovePair[] = [];
    let bracketOpen = false;
    try {
      const abs = this.absOf(relPath);
      if (!(await this.within(abs))) return { error: OUTSIDE };
      // Renaming to the current name is a success no-op — the exists-check would
      // otherwise wrongly report "already exists" (FR-070, belt-and-braces). It moved
      // nothing, so it announces nothing.
      if (name === basename(abs)) return { ok: true };
      const dest = join(dirname(abs), name);
      // 026 / #194 — A CASE-ONLY RENAME IS A RENAME, and it used to be refused as a collision with
      // ITSELF. The guard above is case-SENSITIVE, so `Job specs` → `Job Specs` correctly is not a
      // no-op; `exists(dest)` on the very next line then resolves case-INSENSITIVELY on NTFS, finds
      // this same item, and reports "already exists" about the thing being renamed.
      //
      // Source and destination always share a directory here (`dest` is built from `dirname(abs)`),
      // so they can differ only in the leaf — which makes a case-insensitive leaf match exactly the
      // question "is the destination this item?". Asking it BEFORE the existence probe is the whole
      // fix. A genuinely different sibling still fails the probe below (FR-003).
      //
      // Compared case-insensitively rather than via `realpath` deliberately: no syscall, so it
      // cannot race, and it does not conflate a symlink with its target the way realpath would.
      //
      // NOTE for anyone reading #194's implementation hint: the two-step rename via a temporary name
      // it recommends is NOT needed. Measured on this platform, `fs.rename` performs a case-only
      // rename directly for both files and folders. A temp-name dance would open a window in which
      // the user's file exists under neither name, which is strictly worse (research R1).
      const isSelfRename = name.toLowerCase() === basename(abs).toLowerCase();
      if (!isSelfRename && (await this.fs.exists(dest))) {
        return { error: 'A file or folder with this name already exists.' };
      }
      // Inside the try that owns the `finally`, exactly as `move` does it. It sat outside, so a
      // coordinator callback that threw took the bracket's close with it — and every doc it had
      // opened stayed `movePending` for the rest of the session, unable ever again to be dirtied by
      // a genuine external delete (FR-009/AC7, lost in silence).
      bracketOpen = true;
      this.onMoveStarted?.([abs]);
      moved.push({ from: abs, to: await this.fs.rename(abs, name) });
      return { ok: true };
    } catch (e) {
      /*
       * The holder is looked up ONLY when the failure can actually name one.
       *
       * `held` is the one kind whose sentence mentions a holder. Asking unconditionally cost a
       * `terminal.list { refreshCwd }` round trip plus a PEB read per running terminal on EVERY
       * rename failure — including `ENOENT` and unrecognised ones, where the answer is discarded.
       * Worse, the `await` sits inside the `catch`, so it also delayed the `finally` that closes the
       * move bracket by that round trip: every open document stayed `movePending` for longer than
       * the operation took, for an answer nobody would read.
       */
      const holder = holdsTheAnswer(e) ? await this.holderFor(relPath, reportingWindowId) : undefined;
      return this.failed(e, 'lock', holder);
    } finally {
      if (bracketOpen) this.onMoved?.(moved);
    }
  }

  async move(srcRelPaths: readonly string[], destRelDir: string): Promise<OkOrError> {
    return this.bracketed(() => this.moveInBracket(srcRelPaths, destRelDir));
  }

  private async moveInBracket(srcRelPaths: readonly string[], destRelDir: string): Promise<OkOrError> {
    if (!this.root) return { error: NO_ROOT };
    // What ACTUALLY moved, accumulated as each `fs.move` resolves — never the requested list.
    // This method returns on the first disallowed item below, so a half-succeeded batch is the
    // ordinary case, not an edge one: announcing the request would re-point an editor onto a path
    // its file never reached. The lesson `delete` already learnt with `removed[]` (:140-165).
    const moved: MovePair[] = [];
    let bracketOpen = false;
    try {
      const destAbs = this.absOf(destRelDir);
      if (!(await this.within(destAbs))) return { error: OUTSIDE };
      const rootReal = await this.fs.realpath(this.root);
      const destReal = await this.fs.realpath(destAbs);
      // The bracket opens BEFORE the first `fs.move` (FR-004) — the moment after which a watch
      // could see a file gone. It is deliberately opened over every requested source, before the
      // per-item checks below decide which of them actually go: a doc the move never reaches
      // simply has its `movePending` cleared again when the bracket closes, whereas a doc left
      // OUTSIDE the bracket for a move that did happen is #87.
      bracketOpen = true;
      this.onMoveStarted?.(srcRelPaths.filter((rel) => rel !== '').map((rel) => this.absOf(rel)));
      for (const rel of srcRelPaths) {
        if (rel === '') return { error: 'The project root cannot be moved.' };
        const srcAbs = this.absOf(rel);
        const srcReal = await this.fs.realpath(srcAbs);
        // Dropping an item onto its OWN current folder is a no-op — never the
        // "already exists" error (FR-080). A drop into a different folder still
        // collision-checks below.
        const srcParentReal = await this.fs.realpath(dirname(srcAbs));
        if (srcParentReal === destReal) continue;
        if (!isDropAllowed(srcReal, destReal, rootReal)) {
          return { error: 'Cannot move there.' };
        }
        if (await this.fs.exists(join(destAbs, basename(srcAbs)))) {
          return { error: `"${basename(srcAbs)}" already exists in the destination.` };
        }
        moved.push({ from: srcAbs, to: await this.fs.move(srcAbs, destAbs) });
      }
      return { ok: true };
    } catch (e) {
      return this.failed(e, 'lock');
    } finally {
      // ALWAYS close a bracket that opened — on success, on the early error return above, and on
      // a throw. One that never closes leaves a document `movePending` for the rest of the
      // session, and it could then never be dirtied again by a genuine external delete: AC7's
      // behaviour, lost silently.
      if (bracketOpen) this.onMoved?.(moved);
    }
  }

  async copy(srcRelPaths: readonly string[], destRelDir: string): Promise<OkOrError> {
    if (!this.root) return { error: NO_ROOT };
    try {
      const destAbs = this.absOf(destRelDir);
      if (!(await this.within(destAbs))) return { error: OUTSIDE };
      const siblings = (await this.fs.list(destAbs)).map((e) => e.name);
      for (const rel of srcRelPaths) {
        if (rel === '') return { error: 'The project root cannot be copied.' };
        const srcAbs = this.absOf(rel);
        if (!(await this.within(srcAbs))) return { error: OUTSIDE };
        const name = dedupeName(basename(srcAbs), siblings, 'copy');
        await this.fs.copy(srcAbs, destAbs, name);
        siblings.push(name);
      }
      return { ok: true };
    } catch (e) {
      return this.failed(e, 'lock');
    }
  }

  async delete(relPaths: readonly string[], mode: DeleteMode): Promise<OkOrError> {
    if (!this.root) return { error: NO_ROOT };
    // Delete EVERY item independently: one failure (a locked file, or an item
    // already removed because a selected parent folder was deleted first) must not
    // abort the rest of a mixed files+folders selection. Items already gone are a
    // success (nothing to do); real failures are collected and reported once.
    const failures: string[] = [];
    const removed: string[] = [];
    for (const rel of relPaths) {
      if (rel === '') {
        failures.push('the project root');
        continue;
      }
      const abs = this.absOf(rel);
      try {
        // Existence first: an item already removed (a selected parent folder was
        // deleted before it) is a no-op, not a failure — and `within` runs realpath
        // which would otherwise throw on the now-missing path.
        if (!(await this.fs.exists(abs))) continue;
        if (!(await this.within(abs))) {
          failures.push(basename(abs));
          continue;
        }
        if (mode === 'recycle') await this.fs.trash(abs);
        else await this.fs.delete(abs);
        removed.push(abs);
      } catch {
        failures.push(basename(abs));
      }
    }
    // Let the editor coordinator mark any open editor of a removed file dirty (FR-099).
    if (removed.length > 0) this.onDeleted?.(removed);
    if (failures.length === 0) return { ok: true };
    return {
      error: `Could not delete ${failures.length} item${failures.length === 1 ? '' : 's'} (${failures.join(', ')}).`,
    };
  }

  /**
   * Does this root-relative path exist inside the project? (024 US3, #85.)
   *
   * The undo engine has to know whether the world still matches the entry it is about to replay —
   * whether the file is still where it was, and whether something has since taken the name it wants
   * to restore. The renderer is sandboxed and cannot look, so it asks here, and the answer is
   * CONFINED: a path outside the project is "no", not a probe that reveals what lives there.
   */
  async existsInProject(relPath: string): Promise<boolean> {
    if (!this.root) return false;
    try {
      const abs = this.absOf(relPath);
      if (!(await this.fs.exists(abs))) return false;
      return await this.within(abs);
    } catch {
      return false;
    }
  }

  /**
   * Put a deleted item back where it came from (024 US3, #85 — undo of a delete).
   *
   * Confined exactly as every other operation is: the path is checked against the project root
   * BEFORE the restore, so an undo entry carrying a path from outside the project — a stale stack, a
   * project whose root has since changed — cannot write anywhere it likes. `deletedAt` disambiguates
   * when the Recycle Bin holds several versions of one path; the closest at-or-before wins.
   *
   * A refusal is a MESSAGE, never a silent no-op: the item may have been purged from the Recycle
   * Bin, or restored by hand already, and a user who pressed undo and saw nothing happen would
   * reasonably conclude undo is broken rather than that the file is gone.
   */
  async restoreDeleted(relPath: string, deletedAt: number): Promise<OkOrError> {
    if (!this.root) return { error: NO_ROOT };
    if (relPath === '') return { error: OUTSIDE };
    const abs = this.absOf(relPath);
    // `within` resolves real paths, and the item does NOT exist yet — so confinement is checked
    // against the containing directory, which does.
    if (!(await this.within(dirname(abs)))) return { error: OUTSIDE };
    try {
      await this.fs.restoreFromTrash(abs, deletedAt);
      // Tell the editor layer the file is back, so an editor the DELETE marked dirty can recover
      // rather than staying dirty over a file that is sitting on disk again.
      this.onRestored?.([abs]);
      return { ok: true };
    } catch (error) {
      return {
        error: `Could not restore "${basename(abs)}" — it may no longer be in the Recycle Bin. (${(error as Error).message})`,
      };
    }
  }

  async newFolder(destRelDir: string): Promise<NewFolderResult> {
    if (!this.root) return { error: NO_ROOT };
    try {
      const destAbs = this.absOf(destRelDir);
      if (!(await this.within(destAbs))) return { error: OUTSIDE };
      const siblings = (await this.fs.list(destAbs)).map((e) => e.name);
      const name = dedupeName('New folder', siblings, 'numbered');
      await this.fs.mkdir(join(destAbs, name));
      return { relPath: joinRel(destRelDir, name) };
    } catch (e) {
      return this.failed(e);
    }
  }

  /** Create a new empty file under `destRelDir` (a de-duplicated name), then the
   *  caller enters inline rename on it (FR-096). */
  async newFile(destRelDir: string): Promise<NewFolderResult> {
    if (!this.root) return { error: NO_ROOT };
    try {
      const destAbs = this.absOf(destRelDir);
      if (!(await this.within(destAbs))) return { error: OUTSIDE };
      const siblings = (await this.fs.list(destAbs)).map((e) => e.name);
      const name = dedupeName('New file.txt', siblings, 'numbered');
      await this.fs.writeBytes(join(destAbs, name), new Uint8Array());
      return { relPath: joinRel(destRelDir, name) };
    } catch (e) {
      return this.failed(e);
    }
  }

  /**
   * Reveal a document by its ABSOLUTE path, confined by what is open rather than by a root (#273).
   *
   * ══ WHY THIS EXISTS BESIDE `reveal` ══
   *
   * Every other operation here is root-relative, and resolves against the one root the main
   * window's explorer last set. That is right for the explorer, which is the only caller that has a
   * relative path and is the only surface mounted in the main window — and wrong for every panel
   * menu, because a Panel's file is not necessarily under that root, or under ANY root:
   *
   *   - A Panel torn out of project B into a sub-workspace window keeps project B's file while the
   *     main window has moved on to project A. A relative path then resolves under A: a wrong
   *     result, silently, and the same relative path may well exist there.
   *   - A Panel CREATED inside a sub-workspace is ROOTLESS — it can open a file from anywhere on the
   *     workstation and belongs to no project at all. There is no root to be relative to, so the
   *     caller could not build a relative path even if it wanted one. "Open in OS Explorer" was
   *     therefore enabled and did NOTHING for such a panel.
   *
   * Both callers already hold the absolute path. Making them destroy it to satisfy a root-relative
   * API is what produced the two defects, so this takes the path they have.
   *
   * ══ WHAT CONFINES IT, SINCE A ROOT CANNOT ══
   *
   * The open-document registry: a path may be revealed exactly while some Panel, in some window, is
   * showing it. That is a tighter bound than a project root rather than a looser one — a root
   * permits every file beneath it including ones nothing has opened, while this permits only files
   * the user is already looking at. It is also the only bound that can express a rootless panel's
   * legitimate reach without permitting the whole filesystem.
   *
   * Injected, for the reason `resolveHolder` is: this service knows about a filesystem and nothing
   * else. Absent (never wired, as in a test that does not care) the answer is NO — a confinement
   * check that fails open is not a confinement check.
   */
  async revealDocument(absPath: string): Promise<OkOrError> {
    if (!absPath) return { error: OUTSIDE };
    if (!this.isDocumentOpen?.(absPath)) return { error: OUTSIDE };
    try {
      const { kind } = await this.fs.stat(absPath);
      if (kind === 'file') await this.shell.revealInFileManager(absPath);
      else await this.shell.openFolder(absPath);
      return { ok: true };
    } catch (e) {
      return this.failed(e);
    }
  }

  /** Open in OS file explorer: file → reveal-and-select; folder/root → open contents. */
  async reveal(relPath: string): Promise<OkOrError> {
    if (!this.root) return { error: NO_ROOT };
    try {
      const abs = this.absOf(relPath);
      if (!(await this.within(abs))) return { error: OUTSIDE };
      const { kind } = await this.fs.stat(abs);
      if (kind === 'file') await this.shell.revealInFileManager(abs);
      else await this.shell.openFolder(abs);
      return { ok: true };
    } catch (e) {
      return this.failed(e);
    }
  }

  /**
   * Run `op` after every bracket queued before it, and before every one queued after (FR-004).
   *
   * The chain is never broken by a failure: `op` already returns `{ error }` rather than throwing
   * (FR-025), and the `catch` here is the belt-and-braces that guarantees one rejected link cannot
   * wedge every move for the rest of the session.
   */
  private bracketed<T>(op: () => Promise<T>): Promise<T> {
    const run = this.moveQueue.then(op, op);
    this.moveQueue = run.catch(() => undefined);
    return run;
  }

  private absOf(rel: string): string {
    return rel ? join(this.root as string, rel) : (this.root as string);
  }

  private async within(abs: string): Promise<boolean> {
    const rootReal = await this.fs.realpath(this.root as string);
    const real = await this.fs.realpath(abs);
    return isWithinRoot(rootReal, real);
  }
}

/**
 * What the user is told when a file operation fails (029, FR-011).
 *
 * ══ WHY THE OPERATION IS A PARAMETER ══
 *
 * This returned `e.message` verbatim, which is #196: `EBUSY: resource busy or locked, rename 'C:\…'`
 * names no cause, and `EPERM: operation not permitted` names the WRONG one — it reads as a
 * permissions problem when the folder is simply open somewhere else.
 *
 * `EPERM` means both on Windows and the errno cannot separate them, so the caller says which kind of
 * operation it attempted. That judgement has to live at the call site because only the call site
 * knows; guessing centrally is how #196's exact harm gets reproduced in a new place.
 *
 * A failure matching none of the five kinds is returned UNCHANGED (FR-011b) — which is what makes
 * this incapable of making anything worse than it already is.
 */
function failure(
  e: unknown,
  operation: FailureOperation = 'access',
  holder?: Holder,
): FailureEnvelope {
  const raw = e instanceof Error ? e.message : String(e);
  const cause = classifyFailure(e, { subject: subjectOf(raw), operation, holder });
  return cause ? { error: causeMessage(cause), cause } : { error: raw };
}

/**
 * Would knowing the holder change what this failure SAYS? (029, FR-013.)
 *
 * Only `held` renders a holder — `causeMessage` puts it after "is open in…", and every other kind's
 * sentence has nowhere to put one. On a lock-class operation that is exactly `EBUSY` and `EPERM`,
 * which is why the two are named here rather than the kind being re-derived: this runs BEFORE
 * classification, on the failure path, to decide whether classification needs an expensive answer.
 */
function holdsTheAnswer(error: unknown): boolean {
  const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
  return code === 'EBUSY' || code === 'EPERM';
}

/**
 * The subject a raw errno message is about — the last segment of the first path it quotes.
 *
 * FR-017 asks for prose that NAMES the folder, and in a raw errno the only place that name survives
 * is inside the path. Extracting it is the difference between "a path appears in the string" and
 * "the sentence names the thing".
 */
function subjectOf(raw: string): string {
  const quoted = /'([^']+)'|"([^"]+)"/.exec(raw);
  const path = quoted?.[1] ?? quoted?.[2];
  if (!path) return 'this item';
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
