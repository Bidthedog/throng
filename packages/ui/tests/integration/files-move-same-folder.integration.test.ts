import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { FilesService } from '../../src/main/files-service.js';

// FR-080: dropping a file onto its OWN current folder is a no-op with NO
// "already exists" error; a drop into a DIFFERENT folder still collision-errors.

const shell = {
  revealInFileManager: async () => {},
  openFolder: async () => {},
} as unknown as ConstructorParameters<typeof FilesService>[1];

let root: string;
let svc: FilesService;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-samedir-'));
  await mkdir(join(root, 'sub'));
  await writeFile(join(root, 'sub', 'a.txt'), 'A');
  await writeFile(join(root, 'b.txt'), 'B'); // a collision target at the root
  svc = new FilesService(new NodeFileSystem(async () => {}), shell);
  svc.setRoot(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('FilesService move — same-folder drop (FR-080)', () => {
  it('dropping a file onto its own parent folder is a no-op (no error)', async () => {
    const result = await svc.move(['sub\\a.txt'], 'sub');
    expect(result).toEqual({ ok: true });
    expect(existsSync(join(root, 'sub', 'a.txt'))).toBe(true); // still there, unmoved
  });

  it('dropping the root-level file onto the root folder is a no-op (no error)', async () => {
    const result = await svc.move(['b.txt'], ''); // '' = project root
    expect(result).toEqual({ ok: true });
    expect(existsSync(join(root, 'b.txt'))).toBe(true);
  });

  it('still errors on a real collision when moving into a DIFFERENT folder', async () => {
    await writeFile(join(root, 'sub', 'b.txt'), 'other'); // collision name in sub
    const result = await svc.move(['b.txt'], 'sub'); // move root b.txt into sub (already has b.txt)
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toContain('already exists');
  });

  it('a genuine move into a different, non-colliding folder still works', async () => {
    const result = await svc.move(['b.txt'], 'sub');
    expect(result).toEqual({ ok: true });
    expect(existsSync(join(root, 'sub', 'b.txt'))).toBe(true);
    expect(existsSync(join(root, 'b.txt'))).toBe(false);
  });
});
