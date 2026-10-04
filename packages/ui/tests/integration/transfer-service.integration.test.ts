import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClipboardItem, IFileSystem } from '@throng/core';
import {
  disposeHarness,
  exists,
  FsDecorator,
  gate,
  makeHarness,
  put,
  settle,
  snapshotTree,
  type Harness,
} from './helpers/transfer-harness.js';

/**
 * The transfer engine's spine (050 R2, R4, R7 — T016): every paste and drag is a JOB over absolute
 * paths, run one at a time inside `FilesService.exclusive`, each item attempted whatever happened to
 * the one before it, and reported back as one result built from what actually happened.
 */

let h: Harness;

const item = (absPath: string, projectId = 'A', projectRoot?: string): ClipboardItem => ({
  absPath,
  projectId,
  projectRoot: projectRoot ?? (projectId === 'A' ? h.rootA : h.rootB),
});

async function seedA(): Promise<void> {
  await put(join(h.rootA, 'a.txt'), 'alpha file');
  await put(join(h.rootA, 'docs', 'readme.md'), 'top');
  await put(join(h.rootA, 'docs', 'guide', 'intro.md'), 'intro');
  await put(join(h.rootA, 'docs', 'guide', 'img', 'logo.png'), 'PNG');
  await put(join(h.rootB, 'dest', 'keep.txt'), 'keep');
}

beforeEach(async () => {
  h = await makeHarness();
  await seedA();
});
afterEach(async () => {
  await disposeHarness(h);
});

describe('copy across projects (US1)', () => {
  it('lands a file and a folder with identical bytes and structure at every depth, A untouched', async () => {
    const before = await snapshotTree(h.rootA);
    const { result } = h.svc.paste(1, join(h.rootB, 'dest'), {
      mode: 'copy',
      items: [item(join(h.rootA, 'a.txt')), item(join(h.rootA, 'docs'))],
    });
    const r = await result;
    expect(r.failures).toEqual([]);
    expect(r.outcome).toBe('completed');
    expect(await snapshotTree(join(h.rootB, 'dest'))).toEqual({
      'keep.txt': 'keep',
      'a.txt': 'alpha file',
      'docs/': '',
      'docs/readme.md': 'top',
      'docs/guide/': '',
      'docs/guide/intro.md': 'intro',
      'docs/guide/img/': '',
      'docs/guide/img/logo.png': 'PNG',
    });
    expect(await snapshotTree(h.rootA)).toEqual(before);
    expect(r.placed).toEqual([join(h.rootB, 'dest', 'a.txt'), join(h.rootB, 'dest', 'docs')]);
    expect(r.undo).toBeNull(); // FR-022
    expect(r.sourceProjectId).toBe('A');
    expect(r.targetProjectId).toBe('B');
    // A copy moves nothing, so it opens no bracket.
    expect(h.bracket).toEqual([]);
    // The paste's result is also pushed to its owner window.
    expect(h.done).toEqual([{ windowId: 1, r }]);
  });
});

describe('cut across projects (US2)', () => {
  it('moves them, reporting exactly the moved pairs in ONE bracket, and returns a move entry', async () => {
    const a = join(h.rootA, 'a.txt');
    const docs = join(h.rootA, 'docs');
    const { result } = h.svc.paste(1, join(h.rootB, 'dest'), { mode: 'cut', items: [item(a), item(docs)] });
    const r = await result;
    expect(r.failures).toEqual([]);
    expect(await exists(a)).toBe(false);
    expect(await exists(docs)).toBe(false);
    expect(await snapshotTree(join(h.rootB, 'dest', 'docs'))).toEqual({
      'readme.md': 'top',
      'guide/': '',
      'guide/intro.md': 'intro',
      'guide/img/': '',
      'guide/img/logo.png': 'PNG',
    });
    const pairs = [
      { from: a, to: join(h.rootB, 'dest', 'a.txt') },
      { from: docs, to: join(h.rootB, 'dest', 'docs') },
    ];
    expect(h.bracket).toEqual([
      { kind: 'started', paths: [a, docs] },
      { kind: 'moved', moves: pairs },
    ]);
    expect(r.undo).toMatchObject({ kind: 'move', items: pairs });
    expect(r.placed).toEqual(pairs.map((p) => p.to));
  });
});

describe('confinement (FR-010)', () => {
  it('a source outside every project root fails that item only', async () => {
    const stray = join(h.outside, 'stray.txt');
    await put(stray, 'stray');
    const r = await h.svc.paste(1, join(h.rootB, 'dest'), {
      mode: 'copy',
      items: [item(stray), item(join(h.rootA, 'a.txt'))],
    }).result;
    expect(r.failures).toEqual([expect.objectContaining({ name: 'stray.txt', message: expect.stringMatching(/not inside a project/) })]);
    expect(await exists(join(h.rootB, 'dest', 'stray.txt'))).toBe(false);
    expect(await exists(join(h.rootB, 'dest', 'a.txt'))).toBe(true);
  });

  it('a target outside the ACTIVE root fails the whole job before any change', async () => {
    const beforeA = await snapshotTree(h.rootA);
    const beforeB = await snapshotTree(h.rootB);
    const r = await h.svc.paste(1, join(h.rootA, 'docs'), {
      mode: 'cut',
      items: [item(join(h.rootA, 'a.txt'))],
    }).result;
    expect(r.failures).toHaveLength(1);
    expect(r.placed).toEqual([]);
    expect(r.undo).toBeNull();
    expect(await snapshotTree(h.rootA)).toEqual(beforeA);
    expect(await snapshotTree(h.rootB)).toEqual(beforeB);
    expect(h.bracket).toEqual([]);
  });
});

describe('continue past failure (FR-013)', () => {
  it('a missing source fails that item, the rest still land, and the result names it once', async () => {
    const r = await h.svc.paste(1, join(h.rootB, 'dest'), {
      mode: 'cut',
      items: [item(join(h.rootA, 'gone.txt')), item(join(h.rootA, 'a.txt'))],
    }).result;
    expect(r.failures).toEqual([expect.objectContaining({ name: 'gone.txt' })]);
    expect(r.failures[0]!.cause?.kind).toBe('path-missing');
    expect(await exists(join(h.rootB, 'dest', 'a.txt'))).toBe(true);
    // FR-023 — the entry covers exactly what moved.
    expect(r.undo).toMatchObject({
      kind: 'move',
      items: [{ from: join(h.rootA, 'a.txt'), to: join(h.rootB, 'dest', 'a.txt') }],
    });
  });

  it('a cut in which every item fails records nothing', async () => {
    const r = await h.svc.paste(1, join(h.rootB, 'dest'), {
      mode: 'cut',
      items: [item(join(h.rootA, 'gone.txt'))],
    }).result;
    expect(r.undo).toBeNull();
  });
});

describe('pasting into the folder an item came from (FR-018c)', () => {
  it('a copy takes "name copy.ext" with no clash question', async () => {
    const r = await h.svc.paste(1, join(h.rootB, 'dest'), {
      mode: 'copy',
      items: [item(join(h.rootB, 'dest', 'keep.txt'), 'B')],
    }).result;
    expect(r.failures).toEqual([]);
    expect(h.questions).toEqual([]);
    expect(r.placed).toEqual([join(h.rootB, 'dest', 'keep copy.txt')]);
    expect(await snapshotTree(join(h.rootB, 'dest'))).toEqual({ 'keep.txt': 'keep', 'keep copy.txt': 'keep' });
  });

  it('a cut is a no-op', async () => {
    const r = await h.svc.paste(1, join(h.rootB, 'dest'), {
      mode: 'cut',
      items: [item(join(h.rootB, 'dest', 'keep.txt'), 'B')],
    }).result;
    expect(r.failures).toEqual([]);
    expect(r.placed).toEqual([]);
    expect(r.undo).toBeNull();
    expect(h.questions).toEqual([]);
    expect(await snapshotTree(join(h.rootB, 'dest'))).toEqual({ 'keep.txt': 'keep' });
  });
});

describe('one job at a time (FR-019d, FR-019e)', () => {
  it('jobs run FIFO inside FilesService.exclusive; a drag waits behind a paste and emits no progress', async () => {
    const g = gate();
    let held = true;
    // Hold the FIRST file copy open, so job 1 is mid-run when jobs 2 and 3 arrive.
    class Held extends FsDecorator {
      override async copyFileCancellable(s: string, d: string, signal: AbortSignal): Promise<void> {
        if (held) {
          held = false;
          await g.promise;
        }
        return super.copyFileCancellable(s, d, signal);
      }
    }
    await disposeHarness(h);
    h = await makeHarness({ wrapFs: (fs: IFileSystem) => new Held(fs) });
    await seedA();

    const order: string[] = [];
    const first = h.svc.paste(1, join(h.rootB, 'dest'), { mode: 'copy', items: [item(join(h.rootA, 'a.txt'))] });
    void first.result.then(() => order.push('first'));
    await settle();
    const second = h.svc.paste(1, join(h.rootB, 'dest'), { mode: 'copy', items: [item(join(h.rootA, 'docs'))] });
    void second.result.then(() => order.push('second'));
    const drag = h.svc.drop(1, [join(h.rootB, 'dest', 'keep.txt')], h.rootB, 'cut');
    void drag.then(() => order.push('drag'));
    // A rename the user starts now waits too — it is the same queue.
    const renamed = h.files.rename(join('dest', 'keep.txt'), 'kept.txt');
    void renamed.then(() => order.push('rename'));
    await settle();

    expect(order).toEqual([]);
    expect(await exists(join(h.rootB, 'dest', 'docs'))).toBe(false);
    // The queued paste is visible as queued, one job ahead of it.
    expect(h.progress.filter((e) => e.p.jobId === second.jobId)[0]?.p).toMatchObject({
      state: 'queued',
      queuedBehind: 1,
    });

    g.open();
    await Promise.all([first.result, second.result, drag, renamed]);
    expect(order).toEqual(['first', 'second', 'drag', 'rename']);
    expect(await exists(join(h.rootB, 'keep.txt'))).toBe(true);
    // The rename found the file already gone (the drag moved it first) — it ran after, not during.
    expect(await renamed).toHaveProperty('error');

    // A drag is not a paste: no progress, no pushed `done` (its result is the invoke's answer).
    const dragResult = await drag;
    expect(h.progress.some((e) => e.p.jobId === dragResult.jobId)).toBe(false);
    expect(h.done.some((e) => e.r.jobId === dragResult.jobId)).toBe(false);
    expect(dragResult.kind).toBe('drag');
  });
});
