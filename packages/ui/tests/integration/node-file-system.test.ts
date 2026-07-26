import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { runFileSystemContract, type FileSystemHarness } from '@throng/core/testing';
import { NodeFileSystem } from '../../src/main/node-file-system.js';

// `trash`/`restoreFromTrash` are injected. Here the OS recycle bin is SIMULATED by a real per-harness
// trash directory: trash moves the item there (recording its original path), restore moves it back,
// and a purged item (not in the sim bin) is unrecoverable — so the contract's "removed from the live
// folder" and "restored to its original path" assertions both hold without a real OS bin.
const makeHarness = async (): Promise<FileSystemHarness> => {
  const root = await mkdtemp(join(tmpdir(), 'throng-fs-'));
  const bin = await mkdtemp(join(tmpdir(), 'throng-bin-'));
  const trashed = new Map<string, string>(); // originalPath → path inside the sim bin
  let n = 0;
  const fs = new NodeFileSystem(
    async (p) => {
      const dest = join(bin, `item-${n++}`);
      await rename(p, dest);
      trashed.set(p, dest);
    },
    async (originalPath) => {
      const dest = trashed.get(originalPath);
      if (!dest) throw new Error('item no longer recoverable');
      await mkdir(dirname(originalPath), { recursive: true });
      await rename(dest, originalPath);
      trashed.delete(originalPath);
    },
  );
  const abs = (rel: string): string => join(root, rel);
  return {
    fs,
    root,
    abs,
    write: async (rel, contents = '') => {
      await mkdir(dirname(abs(rel)), { recursive: true });
      await writeFile(abs(rel), contents);
    },
    mkdir: async (rel) => {
      await mkdir(abs(rel), { recursive: true });
    },
    symlink: async (targetRel, linkRel) => {
      await symlink(abs(targetRel), abs(linkRel));
    },
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
      await rm(bin, { recursive: true, force: true });
    },
  };
};

runFileSystemContract('NodeFileSystem (004 T011/T012)', makeHarness);
