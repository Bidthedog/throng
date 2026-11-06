import { cp, lstat, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import process from 'node:process';
import { logExpected, type ITrashRestore } from '@throng/core';

export interface TrashEntry {
  readonly infoPath: string;
  readonly filesPath: string;
  readonly originalPath: string;
  readonly deletedAtMs: number;
}

/** Parse a `.trashinfo`, or null when it does not say where the item came from. */
export function parseTrashInfo(text: string, topDir: string | null): { originalPath: string; deletedAtMs: number } | null {
  if (!/^\[Trash Info\]/m.test(text)) return null;
  const rawPath = /^Path=(.*)$/m.exec(text)?.[1];
  if (!rawPath) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch (error) {
    logExpected('linux-trash: decode trashinfo path', 'any program can write the trash, and a .trashinfo with a malformed path is skipped', error);
    return null;
  }
  // The home trash stores an absolute path. A volume's trash may store one relative to the volume.
  const originalPath = decoded.startsWith('/') ? decoded : topDir === null ? null : join(topDir, decoded);
  if (originalPath === null) return null;
  const date = /^DeletionDate=(.*)$/m.exec(text)?.[1];
  const parsed = date ? Date.parse(date) : Number.NaN;
  return { originalPath, deletedAtMs: Number.isNaN(parsed) ? 0 : parsed };
}

export interface LinuxTrashDeps {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly home?: () => string;
  readonly uid?: number;
}

const exists = (p: string): Promise<boolean> =>
  lstat(p).then(
    () => true,
    () => false,
  );

/**
 * Restore from the freedesktop trash (062 FR-024, research R8). Electron can trash but cannot restore.
 *
 * An item goes to the trash of the filesystem it lives on: the home trash, or `$topdir/.Trash-$uid` or
 * `$topdir/.Trash/$uid` on another volume. So the search starts from the original path and walks up to the mount.
 */
export class LinuxTrash implements ITrashRestore {
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly home: () => string;
  private readonly uid: number;

  constructor(deps: LinuxTrashDeps = {}) {
    this.env = deps.env ?? process.env;
    this.home = deps.home ?? homedir;
    this.uid = deps.uid ?? process.getuid?.() ?? 0;
  }

  async restore(originalPath: string, deletedAt: number): Promise<void> {
    // A project opened through a symlink: the record holds the real location, and the trash is on the real volume.
    const realParent = await realpath(dirname(originalPath)).catch((error: unknown) => {
      logExpected('linux-trash: resolve parent', 'the folder the item was deleted from may itself be gone; its path is used as written', error);
      return dirname(originalPath);
    });
    const realPath = join(realParent, basename(originalPath));
    const entries: TrashEntry[] = [];
    for (const { trashDir, topDir } of await this.trashDirsFor(realPath)) {
      entries.push(...(await this.readEntries(trashDir, topDir)));
    }
    const matches = entries.filter((e) => e.originalPath === originalPath || e.originalPath === realPath);
    if (matches.length === 0) throw new Error(`"${originalPath}" is no longer in the Trash.`);
    // The closest at or before the deletion asked about, else the newest.
    const atOrBefore = matches.filter((e) => e.deletedAtMs <= deletedAt).sort((a, b) => b.deletedAtMs - a.deletedAtMs);
    const newest = [...matches].sort((a, b) => b.deletedAtMs - a.deletedAtMs);
    const entry = atOrBefore[0] ?? newest[0]!;
    if (await exists(originalPath)) throw new Error(`"${originalPath}" already exists, so it cannot be restored over.`);
    await this.moveBack(entry.filesPath, originalPath);
    await rm(entry.infoPath, { force: true });
  }

  /** `rename` first; a move across filesystems, possible only if the parent's mount changed, falls back to a copy. */
  private async moveBack(from: string, to: string): Promise<void> {
    try {
      await rename(from, to);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      await cp(from, to, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
      await rm(from, { recursive: true, force: true });
    }
  }

  private homeTrash(): string {
    const dataHome = this.env.XDG_DATA_HOME?.startsWith('/') ? this.env.XDG_DATA_HOME : join(this.home(), '.local', 'share');
    return join(dataHome, 'Trash');
  }

  private async trashDirsFor(originalPath: string): Promise<{ trashDir: string; topDir: string | null }[]> {
    const dirs: { trashDir: string; topDir: string | null }[] = [{ trashDir: this.homeTrash(), topDir: null }];
    for (const top of await this.candidateTopDirs(originalPath)) {
      dirs.push({ trashDir: join(top, `.Trash-${this.uid}`), topDir: top });
      dirs.push({ trashDir: join(top, '.Trash', String(this.uid)), topDir: top });
    }
    return dirs;
  }

  /** Every ancestor on the same device as the path's parent: the highest of them is the mount. */
  private async candidateTopDirs(originalPath: string): Promise<string[]> {
    const tops: string[] = [];
    let dir = dirname(originalPath);
    let device: number | undefined;
    for (;;) {
      const info = await stat(dir).catch((error: unknown) => {
        logExpected('linux-trash: stat ancestor', 'ancestors of a deleted item may no longer exist; the walk skips them', error);
        return null;
      });
      if (info !== null) {
        if (device === undefined) device = info.dev;
        if (info.dev !== device) break;
        tops.push(dir);
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return tops;
  }

  private async readEntries(trashDir: string, topDir: string | null): Promise<TrashEntry[]> {
    const infoDir = join(trashDir, 'info');
    const names = await readdir(infoDir).catch((error: unknown): string[] => {
      logExpected('linux-trash: list trash info', 'a volume without a trash folder has no entries', error);
      return [];
    });
    const entries = await Promise.all(
      names
        .filter((name) => name.endsWith('.trashinfo'))
        .map(async (name): Promise<TrashEntry | null> => {
          const infoPath = join(infoDir, name);
          const text = await readFile(infoPath, 'utf8').catch((error: unknown) => {
            logExpected('linux-trash: read trash info', 'another program may empty or restore the entry while it is being read', error);
            return '';
          });
          const parsed = parseTrashInfo(text, topDir);
          if (parsed === null) return null;
          const filesPath = join(trashDir, 'files', name.slice(0, -'.trashinfo'.length));
          return (await exists(filesPath)) ? { infoPath, filesPath, ...parsed } : null;
        }),
    );
    return entries.filter((e): e is TrashEntry => e !== null);
  }
}
