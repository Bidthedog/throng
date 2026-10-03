import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Holder, IFileSystem } from '@throng/core';
import { disposeHarness, exists, FsDecorator, makeHarness, put, snapshotTree, type Harness } from './helpers/transfer-harness.js';

/**
 * A cut across volumes (050 R4, FR-014, FR-015 — T018).
 *
 * The rename a same-volume move is fails with EXDEV; the engine then copies and removes the source,
 * and the user sees a move. When the source then cannot be removed, the copy stays, the source stays,
 * and the item is a failure — not a move: no bracket pair, no undo.
 */

function errno(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

/**
 * `move` always crosses a volume. The named path can be HELD, as Windows holds a folder that is a
 * terminal's working directory: it can be neither renamed nor removed.
 */
class OtherVolume extends FsDecorator {
  heldPath: string | null = null;
  override async move(src: string): Promise<string> {
    throw errno('EXDEV', `EXDEV: cross-device link not permitted, rename '${src}'`);
  }
  override async rename(p: string, n: string): Promise<string> {
    if (this.heldPath && p === this.heldPath) throw errno('EBUSY', `EBUSY: resource busy or locked, rename '${p}'`);
    return super.rename(p, n);
  }
  override async delete(p: string): Promise<void> {
    if (this.heldPath && p === this.heldPath) throw errno('EBUSY', `EBUSY: resource busy or locked, rmdir '${p}'`);
    return super.delete(p);
  }
}

let h: Harness;
let fs: OtherVolume;

async function setup(holder?: Holder): Promise<void> {
  h = await makeHarness({ wrapFs: (inner: IFileSystem) => (fs = new OtherVolume(inner)) });
  if (holder) h.files.setHolderResolver(async () => holder);
  await put(join(h.rootA, 'a.txt'), 'alpha');
  await put(join(h.rootA, 'docs', 'guide', 'intro.md'), 'intro');
  await put(join(h.rootB, 'dest', 'keep.txt'), 'keep');
}

afterEach(async () => {
  await disposeHarness(h);
});

describe('cross-volume cut (FR-014)', () => {
  it('falls back to copy-then-remove and reports the pairs as a move', async () => {
    await setup();
    const a = join(h.rootA, 'a.txt');
    const docs = join(h.rootA, 'docs');
    const r = await h.svc.paste(1, join(h.rootB, 'dest'), {
      mode: 'cut',
      items: [a, docs].map((absPath) => ({ absPath, projectId: 'A', projectRoot: h.rootA })),
    }).result;
    expect(r.failures).toEqual([]);
    expect(await exists(a)).toBe(false);
    expect(await exists(docs)).toBe(false);
    expect(await snapshotTree(join(h.rootB, 'dest'))).toEqual({
      'keep.txt': 'keep',
      'a.txt': 'alpha',
      'docs/': '',
      'docs/guide/': '',
      'docs/guide/intro.md': 'intro',
    });
    const pairs = [
      { from: a, to: join(h.rootB, 'dest', 'a.txt') },
      { from: docs, to: join(h.rootB, 'dest', 'docs') },
    ];
    expect(h.bracket.at(-1)).toEqual({ kind: 'moved', moves: pairs });
    expect(r.undo).toMatchObject({ kind: 'move', items: pairs });
  });
});

describe('source cannot be removed after the copy (FR-015)', () => {
  it('keeps the copy AND the source, names the source and its holder, and records no move', async () => {
    await setup({ isThrong: true, panelTitle: 'Terminal 2' });
    const a = join(h.rootA, 'a.txt');
    const docs = join(h.rootA, 'docs');
    fs.heldPath = docs;
    const r = await h.svc.paste(1, join(h.rootB, 'dest'), {
      mode: 'cut',
      items: [a, docs].map((absPath) => ({ absPath, projectId: 'A', projectRoot: h.rootA })),
    }).result;
    // The copy stays and the source stays.
    expect(await exists(join(h.rootB, 'dest', 'docs', 'guide', 'intro.md'))).toBe(true);
    expect(await exists(join(docs, 'guide', 'intro.md'))).toBe(true);
    // One failure, naming the source and who holds it.
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatchObject({ name: 'docs', cause: { kind: 'held', holder: { panelTitle: 'Terminal 2' } } });
    expect(r.failures[0]!.message).toMatch(/docs/);
    expect(r.failures[0]!.message).toMatch(/Terminal 2/);
    // Absent from the bracket and from the undo entry: it did not move.
    const onlyA = [{ from: a, to: join(h.rootB, 'dest', 'a.txt') }];
    expect(h.bracket.at(-1)).toEqual({ kind: 'moved', moves: onlyA });
    expect(r.undo).toMatchObject({ kind: 'move', items: onlyA });
  });
});
