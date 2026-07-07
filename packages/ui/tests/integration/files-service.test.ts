import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { ElectronShellIntegration } from '../../src/main/electron-shell-integration.js';
import { FilesService } from '../../src/main/files-service.js';

describe('FilesService mutations confined to the project root (004 T038/T046)', () => {
  let root: string;
  let svc: FilesService;
  let revealed: Array<{ op: 'reveal' | 'open'; path: string }>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'throng-svc-'));
    revealed = [];
    const fs = new NodeFileSystem((p) => rm(p, { recursive: true, force: true }));
    const shell = new ElectronShellIntegration({
      showItemInFolder: (p) => revealed.push({ op: 'reveal', path: p }),
      openPath: async (p) => {
        revealed.push({ op: 'open', path: p });
        return '';
      },
    });
    svc = new FilesService(fs, shell);
    svc.setRoot(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const write = async (rel: string, c = 'x'): Promise<void> => writeFile(join(root, rel), c);
  const names = async (rel = ''): Promise<string[]> =>
    (await readdir(join(root, rel))).sort();

  it('lists the root and a subfolder', async () => {
    await write('a.txt');
    await mkdir(join(root, 'sub'));
    const res = await svc.list('');
    expect('entries' in res && res.entries.map((e) => e.name).sort()).toEqual(['a.txt', 'sub']);
  });

  it('renames a file and rejects the root + collisions', async () => {
    await write('old.txt');
    await write('taken.txt');
    expect(await svc.rename('old.txt', 'new.txt')).toEqual({ ok: true });
    expect(await names()).toContain('new.txt');
    expect(await svc.rename('', 'x')).toMatchObject({ error: expect.any(String) });
    expect(await svc.rename('new.txt', 'taken.txt')).toMatchObject({ error: expect.any(String) });
    expect(await svc.rename('new.txt', 'a/b')).toMatchObject({ error: expect.any(String) });
  });

  it('moves into a folder, rejecting collisions and descendant drops', async () => {
    await write('f.txt');
    await mkdir(join(root, 'dest'));
    expect(await svc.move(['f.txt'], 'dest')).toEqual({ ok: true });
    expect(await names('dest')).toEqual(['f.txt']);

    await mkdir(join(root, 'tree'));
    await mkdir(join(root, 'tree', 'inner'));
    // Moving a folder into its own descendant is rejected.
    expect(await svc.move(['tree'], 'tree/inner')).toMatchObject({ error: expect.any(String) });
  });

  it('copies with a non-clobbering name on collision', async () => {
    await write('r.txt');
    await mkdir(join(root, 'dest'));
    await writeFile(join(root, 'dest', 'r.txt'), 'existing');
    expect(await svc.copy(['r.txt'], 'dest')).toEqual({ ok: true });
    expect(await names('dest')).toEqual(['r copy.txt', 'r.txt']);
  });

  it('deletes via recycle (default) and permanent', async () => {
    await write('bin.txt');
    await write('gone.txt');
    expect(await svc.delete(['bin.txt'], 'recycle')).toEqual({ ok: true });
    expect(await svc.delete(['gone.txt'], 'permanent')).toEqual({ ok: true });
    expect(await names()).toEqual([]);
    expect(await svc.delete([''], 'recycle')).toMatchObject({ error: expect.any(String) });
  });

  it('creates a new folder with a de-duplicated name', async () => {
    const first = await svc.newFolder('');
    expect(first).toEqual({ relPath: 'New folder' });
    const second = await svc.newFolder('');
    expect(second).toEqual({ relPath: 'New folder (2)' });
  });

  it('creates a new (empty) file with a de-duplicated name, in a subfolder (FR-096)', async () => {
    await mkdir(join(root, 'sub'));
    const first = await svc.newFile('sub');
    expect(first).toEqual({ relPath: 'sub/New file.txt' }); // joinRel uses '/'
    const second = await svc.newFile('sub');
    expect(second).toEqual({ relPath: 'sub/New file (2).txt' });
    expect(await names('sub')).toEqual(['New file (2).txt', 'New file.txt']);
    // It is a real, empty file.
    const res = await svc.list('sub');
    expect('entries' in res && res.entries.every((e) => e.kind === 'file')).toBe(true);
  });

  it('newFile rejects a destination outside the root', async () => {
    expect(await svc.newFile('../escape')).toMatchObject({ error: expect.any(String) });
  });

  it('reveals a file (select in parent) and opens a folder (contents)', async () => {
    await write('f.txt');
    await mkdir(join(root, 'd'));
    expect(await svc.reveal('f.txt')).toEqual({ ok: true });
    expect(await svc.reveal('d')).toEqual({ ok: true });
    expect(revealed.map((r) => r.op)).toEqual(['reveal', 'open']);
  });

  it('rejects targets outside the project root', async () => {
    expect(await svc.list('..')).toMatchObject({ error: expect.any(String) });
    await write('f.txt');
    expect(await svc.move(['f.txt'], '../..')).toMatchObject({ error: expect.any(String) });
  });
});
