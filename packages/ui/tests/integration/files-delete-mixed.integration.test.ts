import { mkdtemp, rm, writeFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { FilesService } from '../../src/main/files-service.js';

// Reported bug: Ctrl-selecting a MIX of files and folders then Delete only removes
// the folders. Isolate the service-layer delete over a mixed selection.

const shell = {
  revealInFileManager: async () => {},
  openFolder: async () => {},
} as unknown as ConstructorParameters<typeof FilesService>[1];

let root: string;
let trashed: string[];
let svc: FilesService;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-delmix-'));
  await writeFile(join(root, 'file1.txt'), '1');
  await writeFile(join(root, 'file2.txt'), '2');
  await mkdir(join(root, 'dir1'));
  await mkdir(join(root, 'dir2'));
  trashed = [];
  // Fake "trash" so recycle mode is testable off-CI (records the trashed paths).
  const fs = new NodeFileSystem(async (p) => {
    trashed.push(p);
  });
  svc = new FilesService(fs, shell);
  svc.setRoot(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('FilesService delete over a mixed files+folders selection', () => {
  it('permanently deletes ALL selected items (files and folders)', async () => {
    const result = await svc.delete(['file1.txt', 'dir1', 'file2.txt', 'dir2'], 'permanent');
    expect(result).toEqual({ ok: true });
    expect((await readdir(root)).sort()).toEqual([]);
  });

  it('recycles ALL selected items (files and folders)', async () => {
    const result = await svc.delete(['dir1', 'file1.txt', 'dir2', 'file2.txt'], 'recycle');
    expect(result).toEqual({ ok: true });
    expect(trashed.length).toBe(4); // both files + both folders were trashed
  });

  it('files interleaved with folders in any order all delete', async () => {
    const result = await svc.delete(['file1.txt', 'file2.txt', 'dir1', 'dir2'], 'permanent');
    expect(result).toEqual({ ok: true });
    expect((await readdir(root)).length).toBe(0);
  });

  it('a folder deleted BEFORE a selected file inside it does not abort the rest (ENOENT is not a failure)', async () => {
    // Select dir1 AND a file inside dir1 (+ siblings). Deleting dir1 first removes
    // the inner file, so its own delete is a no-op — and file2/dir2 must still go.
    await writeFile(join(root, 'dir1', 'inside.txt'), 'x');
    const result = await svc.delete(['dir1', 'dir1\\inside.txt', 'file2.txt', 'dir2'], 'permanent');
    expect(result).toEqual({ ok: true });
    // file1.txt was NOT selected; everything selected is gone.
    expect((await readdir(root)).sort()).toEqual(['file1.txt']);
  });
});
