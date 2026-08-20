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

/**
 * What a delete TELLS the rest of the application (FR-099).
 *
 * MIGRATED FROM `editor-file-deleted.e2e.ts:102` (035 T056) — `test('deleting an open file marks the
 * editor dirty; save re-creates it; re-select shows the error')`.
 *
 * ══ EVERY PART OF THAT TEST WAS COVERED EXCEPT THE JOIN ══
 *
 *   the delete reaches the filesystem, over a mixed selection
 *     → the four cases above
 *   Delete is addressed to the SELECTION rather than to the clicked row
 *     → `unit/explorer-subtree-menu.test.ts`
 *   an editor whose file has gone is force-dirtied, keeps its buffer, and a save re-creates it
 *     → `integration/editor-file-deleted.integration.test.ts:56-98`, five cases
 *
 * The join is `main.ts:1273` — `filesService.setOnDeleted((paths) => editorCoordinator.markDeleted(paths))`
 * — and `setOnDeleted` had no test at any layer. Without the announcement every one of those five
 * coordinator cases is unreachable in the running application: the file goes, and the editor holding
 * it never hears, so it keeps presenting remembered text as the file and a save writes it back to a
 * path the user deliberately emptied.
 *
 * These assert the SERVICE's half of that wire. The coordinator's half is the file named above.
 */
describe('a delete announces what it removed (FR-099, migrated from editor-file-deleted.e2e.ts:102)', () => {
  /** Register the listener `main.ts` gives the service, and collect what it is told. */
  function announced(): string[] {
    const seen: string[] = [];
    svc.setOnDeleted((paths) => seen.push(...paths));
    return seen;
  }

  it('names every path it removed, absolute, over a mixed selection', async () => {
    const seen = announced();

    await svc.delete(['file1.txt', 'dir1', 'file2.txt'], 'permanent');

    expect(seen.map((p) => p.replace(/\\/g, '/')).sort()).toEqual(
      [join(root, 'dir1'), join(root, 'file1.txt'), join(root, 'file2.txt')]
        .map((p) => p.replace(/\\/g, '/'))
        .sort(),
    );
  });

  it('announces a RECYCLE too — the file is just as gone from the editor’s point of view', async () => {
    /*
     * The mode changes where the bytes went, not whether the path still reads. An editor told only
     * about permanent deletes would keep presenting a recycled file as though it were still there,
     * which is the FR-099 failure with an extra step.
     */
    const seen = announced();

    await svc.delete(['file1.txt'], 'recycle');

    expect(seen.map((p) => p.replace(/\\/g, '/'))).toEqual([
      join(root, 'file1.txt').replace(/\\/g, '/'),
    ]);
  });

  it('says NOTHING when nothing was removed', async () => {
    // A delete that removed nothing is not news, and announcing an empty list would wake every
    // document in the app to be told about no files.
    const seen = announced();

    await svc.delete(['does-not-exist.txt'], 'permanent');

    expect(seen).toEqual([]);
  });

  it('announces only what actually went, when part of the selection was already gone', async () => {
    /*
     * The case the fourth test above is about, seen from the other side: an ENOENT part-way through
     * does not abort the rest, so the announcement must carry the survivors of the operation rather
     * than the selection it was asked for. Announcing the whole selection would tell an editor its
     * file had gone when the delete never reached it.
     */
    const seen = announced();

    await svc.delete(['file1.txt', 'does-not-exist.txt', 'file2.txt'], 'permanent');

    const names = seen.map((p) => p.replace(/\\/g, '/').split('/').pop());
    expect(names.sort()).toEqual(['file1.txt', 'file2.txt']);
  });
});
