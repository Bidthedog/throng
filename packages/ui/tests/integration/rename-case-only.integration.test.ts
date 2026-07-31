import { mkdtemp, mkdir, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { FilesService, type MovePair } from '../../src/main/files-service.js';

/**
 * 026 / #194 — a case-only rename is a rename, and must succeed.
 *
 * `Job specs` → `Job Specs` is refused with "A file or folder with this name already exists."
 * The no-op guard in `renameInBracket` is case-SENSITIVE, so the new name is correctly not treated
 * as unchanged — and then the very next `fs.exists(dest)` probe resolves case-INSENSITIVELY on
 * NTFS, finds the item itself, and reports a collision with itself.
 *
 * NOTE ON THE ISSUE'S OTHER SUSPECT. #194 also names `validateRename`
 * (`packages/core/src/explorer/naming.ts:20`) as a renderer-side cause. It is not one on this
 * branch: nothing in `packages/ui` or `packages/daemon` calls it (the tree's `onRename` goes
 * straight to `window.throng.files.rename`), so the only live rejection is the one asserted here.
 * That does not make the core helper harmless — it is exported public API with the same
 * case-insensitive self-collision — but a test asserting it is the cause would be asserting a
 * fiction. Left to the fix to decide whether to correct or retire it.
 *
 * These cases run against the REAL filesystem deliberately. The defect only exists because NTFS
 * is case-insensitive; a fake fs with a case-sensitive map would pass while the app stays broken.
 *
 * RED on master: the two case-only renames below return the "already exists" error.
 */

const shell = {
  revealInFileManager: async () => {},
  openFolder: async () => {},
} as unknown as ConstructorParameters<typeof FilesService>[1];

describe('case-only rename (026 / #194)', () => {
  let root: string;
  let svc: FilesService;
  let started: string[][];
  let moved: MovePair[][];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'throng-case-'));
    started = [];
    moved = [];
    svc = new FilesService(new NodeFileSystem((p) => rm(p, { recursive: true, force: true })), shell);
    svc.onMoveStarted = (paths) => started.push([...paths]);
    svc.onMoved = (moves) => moved.push([...moves]);
    svc.setRoot(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  });

  /** Names as the OS actually holds them — `readdir` reports the on-disk casing. */
  const names = async (rel = ''): Promise<string[]> => (await readdir(join(root, rel))).sort();

  it('renames a FOLDER to a different casing of the same name', async () => {
    await mkdir(join(root, 'Job specs'));
    expect(await svc.rename('Job specs', 'Job Specs')).toEqual({ ok: true });
    expect(await names()).toEqual(['Job Specs']);
  });

  it('renames a FILE to a different casing of the same name', async () => {
    await writeFile(join(root, 'readme.md'), 'x');
    expect(await svc.rename('readme.md', 'README.md')).toEqual({ ok: true });
    expect(await names()).toEqual(['README.md']);
  });

  it('still treats a byte-identical name as a silent success no-op that moves nothing', async () => {
    await writeFile(join(root, 'same.txt'), 'x');
    expect(await svc.rename('same.txt', 'same.txt')).toEqual({ ok: true });
    expect(await names()).toEqual(['same.txt']);
    // It moved nothing, so it announced nothing — the bracket never opened (FR-070).
    expect(started).toEqual([]);
    expect(moved).toEqual([]);
  });

  it('still rejects a collision with a DIFFERENT sibling, in any casing', async () => {
    await writeFile(join(root, 'one.txt'), 'x');
    await writeFile(join(root, 'two.txt'), 'x');
    expect(await svc.rename('one.txt', 'two.txt')).toMatchObject({
      error: 'A file or folder with this name already exists.',
    });
    expect(await svc.rename('one.txt', 'TWO.TXT')).toMatchObject({
      error: 'A file or folder with this name already exists.',
    });
    expect(await names()).toEqual(['one.txt', 'two.txt']);
  });

  it('fires the move bracket, because the path DOES change from the app’s point of view', async () => {
    // #87's machinery re-points open editors off the old path. A case-only rename still changes
    // the path, so an editor open on it must follow — which it cannot do if the bracket is skipped.
    await writeFile(join(root, 'notes.txt'), 'x');
    expect(await svc.rename('notes.txt', 'Notes.txt')).toEqual({ ok: true });
    expect(started).toEqual([[join(root, 'notes.txt')]]);
    expect(moved).toEqual([[{ from: join(root, 'notes.txt'), to: join(root, 'Notes.txt') }]]);
  });
});
