/**
 * NodeFileSystem — the UI-main concrete {@link IFileSystem} (004, T011, research
 * D1/D9). Reads/mutates/resolves filesystem entries with `fs.promises`; the OS
 * detail stays behind the IFileSystem abstraction (Principle II). The Recycle-Bin
 * `trash` call is injected (Electron `shell.trashItem` in the composition root)
 * so this stays testable without the Electron runtime.
 */
import { basename, dirname, join } from 'node:path';
import {
  cp,
  lstat,
  mkdir,
  opendir,
  readdir,
  readFile,
  realpath as fsRealpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import type { DirEntry, IFileSystem } from '@throng/core';

/** Move a path to the OS Recycle Bin / Trash (Electron `shell.trashItem`). */
export type TrashItem = (path: string) => Promise<void>;

export class NodeFileSystem implements IFileSystem {
  constructor(private readonly trashItem: TrashItem) {}

  async list(dir: string): Promise<DirEntry[]> {
    const dirents = await readdir(dir, { withFileTypes: true });
    return Promise.all(
      dirents.map(async (d): Promise<DirEntry> => {
        const isSymlink = d.isSymbolicLink();
        const full = join(dir, d.name);
        let kind: 'file' | 'folder';
        if (d.isDirectory()) kind = 'folder';
        else if (d.isFile()) kind = 'file';
        else if (isSymlink) kind = await symlinkKind(full);
        else kind = 'file';
        const entry: DirEntry = { name: d.name, kind, isSymlink };
        // Only peek into a real folder for the chevron hint; never follow a link
        // out of the tree (FR-037) and keep it cheap (one entry, not a full read).
        entry.hasChildren = kind === 'folder' && !isSymlink ? await folderHasChildren(full) : false;
        return entry;
      }),
    );
  }

  async mkdir(path: string): Promise<void> {
    await mkdir(path);
  }

  async stat(path: string): Promise<{ kind: 'file' | 'folder'; isSymlink: boolean }> {
    const l = await lstat(path);
    const isSymlink = l.isSymbolicLink();
    if (isSymlink) return { kind: await symlinkKind(path), isSymlink: true };
    return { kind: l.isDirectory() ? 'folder' : 'file', isSymlink: false };
  }

  realpath(path: string): Promise<string> {
    return fsRealpath(path);
  }

  async rename(path: string, newName: string): Promise<string> {
    const dest = join(dirname(path), newName);
    await rename(path, dest);
    return dest;
  }

  async move(src: string, destDir: string): Promise<string> {
    const dest = join(destDir, basename(src));
    await rename(src, dest);
    return dest;
  }

  async copy(src: string, destDir: string, newName?: string): Promise<string> {
    const dest = join(destDir, newName ?? basename(src));
    await cp(src, dest, { recursive: true });
    return dest;
  }

  async delete(path: string): Promise<void> {
    await rm(path, { recursive: true, force: true });
  }

  async trash(path: string): Promise<void> {
    await this.trashItem(path);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await lstat(path);
      return true;
    } catch {
      return false;
    }
  }

  async readBytes(path: string): Promise<Uint8Array> {
    // Return a plain Uint8Array view (a Node Buffer IS a Uint8Array).
    return readFile(path);
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    await writeFile(path, bytes);
  }

  async size(path: string): Promise<number> {
    return (await stat(path)).size;
  }
}

/** Resolve a symlink's target kind (following it) for the icon; broken → file. */
async function symlinkKind(path: string): Promise<'file' | 'folder'> {
  try {
    const s = await stat(path);
    return s.isDirectory() ? 'folder' : 'file';
  } catch {
    return 'file';
  }
}

/** Cheaply test whether a directory has at least one entry (reads one dirent). */
async function folderHasChildren(path: string): Promise<boolean> {
  try {
    const dh = await opendir(path);
    try {
      const first = await dh.read();
      return first !== null;
    } finally {
      await dh.close();
    }
  } catch {
    return false;
  }
}
