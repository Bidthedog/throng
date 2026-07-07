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
export type ListResult = { entries: DirEntry[] } | { error: string };
export type NewFolderResult = { relPath: string } | { error: string };
export type DeleteMode = 'recycle' | 'permanent';

const NO_ROOT = 'No active project.';
const OUTSIDE = 'Target is outside the project root.';
const SEP = /[\\/]/;

export class FilesService {
  private root: string | null = null;

  private onDeleted?: (absPaths: string[]) => void;

  constructor(
    private readonly fs: IFileSystem,
    private readonly shell: IShellIntegration,
  ) {}

  /** Notified with the absolute paths that a delete removed (FR-099) — the editor
   *  coordinator marks any open editor of a deleted file dirty. */
  setOnDeleted(cb: (absPaths: string[]) => void): void {
    this.onDeleted = cb;
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
    if (!this.root) return { error: NO_ROOT };
    if (relPath === '') return { error: 'The project root cannot be renamed.' };
    const name = newName.trim();
    if (name.length === 0 || SEP.test(name)) return { error: 'Invalid name.' };
    try {
      const abs = this.absOf(relPath);
      if (!(await this.within(abs))) return { error: OUTSIDE };
      // Renaming to the current name is a success no-op — the exists-check would
      // otherwise wrongly report "already exists" (FR-070, belt-and-braces).
      if (name === basename(abs)) return { ok: true };
      const dest = join(dirname(abs), name);
      if (await this.fs.exists(dest)) {
        return { error: 'A file or folder with this name already exists.' };
      }
      await this.fs.rename(abs, name);
      return { ok: true };
    } catch (e) {
      return { error: message(e) };
    }
  }

  async move(srcRelPaths: readonly string[], destRelDir: string): Promise<OkOrError> {
    if (!this.root) return { error: NO_ROOT };
    try {
      const destAbs = this.absOf(destRelDir);
      if (!(await this.within(destAbs))) return { error: OUTSIDE };
      const rootReal = await this.fs.realpath(this.root);
      const destReal = await this.fs.realpath(destAbs);
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
        await this.fs.move(srcAbs, destAbs);
      }
      return { ok: true };
    } catch (e) {
      return { error: message(e) };
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
