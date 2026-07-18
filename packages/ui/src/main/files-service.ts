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
  type DirEntry,
  type IFileSystem,
  type IShellIntegration,
} from '@throng/core';

export type OkOrError = { ok: true } | { error: string };
/** One completed move — both paths ABSOLUTE, as the OS spelled them (019, FR-001). */
export interface MovePair {
  readonly from: string;
  readonly to: string;
}
export type ListResult = { entries: DirEntry[] } | { error: string };
export type NewFolderResult = { relPath: string } | { error: string };
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

  private onMoveStarted?: (absPaths: readonly string[]) => void;

  private onMoved?: (moves: readonly MovePair[]) => void;

  constructor(
    private readonly fs: IFileSystem,
    private readonly shell: IShellIntegration,
  ) {}

  /** Notified with the absolute paths that a delete removed (FR-099) — the editor
   *  coordinator marks any open editor of a deleted file dirty. */
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
      return { error: message(e) };
    }
  }

  async rename(relPath: string, newName: string): Promise<OkOrError> {
    return this.bracketed(() => this.renameInBracket(relPath, newName));
  }

  private async renameInBracket(relPath: string, newName: string): Promise<OkOrError> {
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
      if (await this.fs.exists(dest)) {
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
      return { error: message(e) };
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
      return { error: message(e) };
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
      return { error: message(e) };
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
      return { error: message(e) };
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
      return { error: message(e) };
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
      return { error: message(e) };
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

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
