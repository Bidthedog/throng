// Layer: integration. Copying from outside any project, undoing it and partial failure are only observable on a real filesystem.
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FileOpUndoEntry, IFileSystem } from '@throng/core';
import { disposeHarness, exists, FsDecorator, makeHarness, put, snapshotTree, type Harness } from './helpers/transfer-harness.js';

let h: Harness;
let dest: string;

beforeEach(async () => {
  h = await makeHarness();
  dest = join(h.rootB, 'dest');
  await put(join(dest, 'keep.txt'), 'keep');
  await put(join(h.outside, 'a.txt'), 'alpha');
  await put(join(h.outside, 'folder', 'b.txt'), 'bravo');
});
afterEach(async () => {
  await disposeHarness(h);
});

describe('an inbound transfer from outside every project (067 FR-002, FR-008 to FR-011)', () => {
  it('copies a file and a folder and leaves the originals, undoably', async () => {
    const { result } = h.svc.inbound(1, [join(h.outside, 'a.txt'), join(h.outside, 'folder')], dest, 'copy');
    const r = await result;
    expect(r.failures).toEqual([]);
    expect(await snapshotTree(dest)).toEqual({ 'keep.txt': 'keep', 'a.txt': 'alpha', 'folder/': '', 'folder/b.txt': 'bravo' });
    expect(await exists(join(h.outside, 'a.txt'))).toBe(true);

    const undone = await h.svc.applyUndo(r.undo as FileOpUndoEntry, 'undo');
    expect(undone).toMatchObject({ ok: true });
    expect(await snapshotTree(dest)).toEqual({ 'keep.txt': 'keep' });

    expect(await h.svc.applyUndo(r.undo as FileOpUndoEntry, 'redo')).toMatchObject({ ok: true });
    expect(await exists(join(dest, 'a.txt'))).toBe(true);
  });

  it('moves on a cut, and undo puts the item back outside the project', async () => {
    const source = join(h.outside, 'a.txt');
    const r = await h.svc.inbound(1, [source], dest, 'cut').result;
    expect(r.failures).toEqual([]);
    expect(await exists(source)).toBe(false);
    expect(await exists(join(dest, 'a.txt'))).toBe(true);

    expect(await h.svc.applyUndo(r.undo as FileOpUndoEntry, 'undo')).toMatchObject({ ok: true });
    expect(await exists(source)).toBe(true);
    expect(await exists(join(dest, 'a.txt'))).toBe(false);
  });

  it('asks about a name collision as an internal paste does', async () => {
    await disposeHarness(h);
    h = await makeHarness({ answer: () => ({ choice: 'skip', applyToAll: false }) });
    dest = join(h.rootB, 'dest');
    await put(join(dest, 'a.txt'), 'older');
    await put(join(h.outside, 'a.txt'), 'alpha');
    const r = await h.svc.inbound(1, [join(h.outside, 'a.txt')], dest, 'copy').result;
    expect(h.questions).toHaveLength(1);
    expect(r.placed).toEqual([]);
  });

  it('keeps what arrived when another item fails, reports that failure, and undo reverses only what arrived', async () => {
    await disposeHarness(h);
    h = await makeHarness({
      wrapFs: (fs: IFileSystem) =>
        new (class extends FsDecorator {
          override async copyFileCancellable(
            from: string,
            to: string,
            signal: AbortSignal,
            onBytes?: (copied: number) => void,
          ): Promise<void> {
            if (from.endsWith('b.txt')) throw Object.assign(new Error('locked'), { code: 'EBUSY' });
            await fs.copyFileCancellable(from, to, signal, onBytes);
          }
        })(fs),
    });
    dest = join(h.rootB, 'dest');
    await put(join(dest, 'keep.txt'), 'keep');
    await put(join(h.outside, 'a.txt'), 'alpha');
    await put(join(h.outside, 'b.txt'), 'bravo');

    const r = await h.svc.inbound(1, [join(h.outside, 'a.txt'), join(h.outside, 'b.txt')], dest, 'copy').result;
    expect(r.failures).toHaveLength(1);
    expect(await exists(join(dest, 'a.txt'))).toBe(true);

    await h.svc.applyUndo(r.undo as FileOpUndoEntry, 'undo');
    expect(await snapshotTree(dest)).toEqual({ 'keep.txt': 'keep' });
  });

  it('refuses a target outside the active project (FR-007)', async () => {
    const r = await h.svc.inbound(1, [join(h.outside, 'a.txt')], h.outside, 'copy').result;
    expect(r.placed).toEqual([]);
    expect(r.failures).toHaveLength(1);
  });

  it('refuses a folder pasted into its own descendant', async () => {
    await put(join(dest, 'inner', 'c.txt'), 'c');
    const inner = join(dest, 'inner');
    const r = await h.svc.inbound(1, [dest], inner, 'copy').result;
    expect(r.failures).toHaveLength(1);
    expect(await exists(join(inner, 'dest'))).toBe(false);
  });

  it('copies in a folder that is another project\'s root, and leaves that project as it was (MT-01)', async () => {
    await put(join(h.rootA, 'sub', 'c.txt'), 'c');
    const r = await h.svc.inbound(1, [h.rootA], dest, 'copy').result;
    expect(r.failures).toEqual([]);
    expect(await snapshotTree(join(dest, 'alpha'))).toEqual({ 'sub/': '', 'sub/c.txt': 'c' });
    expect(await exists(join(h.rootA, 'sub', 'c.txt'))).toBe(true);
  });

  it('refuses a cut of a project root, which would take the folder from under its project', async () => {
    await put(join(h.rootA, 'c.txt'), 'c');
    const r = await h.svc.inbound(1, [h.rootA], dest, 'cut').result;
    expect(r.failures.map((f) => f.message)).toEqual(['The project root cannot be moved.']);
    expect(await exists(join(h.rootA, 'c.txt'))).toBe(true);
    expect(await exists(join(dest, 'alpha'))).toBe(false);
  });

  it('refuses the target project\'s own root pasted into itself', async () => {
    const r = await h.svc.inbound(1, [h.rootB], dest, 'copy').result;
    expect(r.failures.map((f) => f.message)).toEqual(['"beta" cannot be pasted into itself.']);
    expect(await exists(join(dest, 'beta'))).toBe(false);
  });
});
