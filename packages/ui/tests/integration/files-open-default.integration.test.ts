// Layer: integration. Whether a path escapes the project and exists is decided against a real folder.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilesService } from '../../src/main/files-service.js';
import { NodeFileSystem } from '../../src/main/node-file-system.js';

let root: string;
let service: FilesService;
const shell = { openWithDefaultProgram: vi.fn(async () => ({ ok: true as const })) };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-open-default-'));
  await mkdir(join(root, 'dir'));
  await writeFile(join(root, 'a.pdf'), 'x');
  shell.openWithDefaultProgram.mockClear();
  shell.openWithDefaultProgram.mockResolvedValue({ ok: true });
  service = new FilesService(new NodeFileSystem(async () => {}, async () => {}), shell as never);
  service.setRoot(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('FilesService.openInDefaultProgram (067 FR-018)', () => {
  it('opens the file through the seam', async () => {
    expect(await service.openInDefaultProgram('a.pdf')).toEqual({ ok: true });
    expect(shell.openWithDefaultProgram).toHaveBeenCalledWith(join(root, 'a.pdf'));
  });
  it('reports the OS refusal as its error', async () => {
    shell.openWithDefaultProgram.mockResolvedValue({ ok: false, osReason: 'no application' } as never);
    expect(await service.openInDefaultProgram('a.pdf')).toMatchObject({ error: expect.stringContaining('no application') });
  });
  it('refuses a path outside the project', async () => {
    expect(await service.openInDefaultProgram('../elsewhere')).toHaveProperty('error');
    expect(shell.openWithDefaultProgram).not.toHaveBeenCalled();
  });
});
