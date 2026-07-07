import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { runFileSystemContract, type FileSystemHarness } from '@throng/core/testing';
import { NodeFileSystem } from '../../src/main/node-file-system.js';

// `trash` is injected; here recycling is simulated by a real delete so the
// contract's "removed from the live folder" assertion holds without an OS bin.
const makeHarness = async (): Promise<FileSystemHarness> => {
  const root = await mkdtemp(join(tmpdir(), 'throng-fs-'));
  const fs = new NodeFileSystem((p) => rm(p, { recursive: true, force: true }));
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
    },
  };
};

runFileSystemContract('NodeFileSystem (004 T011/T012)', makeHarness);
