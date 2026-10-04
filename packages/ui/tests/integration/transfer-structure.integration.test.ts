import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClashAnswer, ClipboardItem, FileOpUndoEntry } from '@throng/core';
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
 * Keeping structure across folders (050 FR-033, research R16, SC-010 — T083).
 *
 * Items selected from different folders land under the target at their path relative to the deepest
 * folder holding them all. A folder the structure needs is created, journalled, rolled back and undone;
 * one that exists is merged into; the duplicate and no-op rules are judged per item at its landing folder.
 */

/** Holds the copy of `big.bin` until the job is cancelled — a copy "in progress" for as long as needed. */
class HeldBig extends FsDecorator {
  started = gate();
  override async copyFileCancellable(s: string, d: string, signal: AbortSignal): Promise<void> {
    if (s.endsWith('big.bin')) {
      this.started.open();
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    }
    return super.copyFileCancellable(s, d, signal);
  }
}

let h: Harness;
let fs: HeldBig;
let answers: ClashAnswer[];

async function setup(): Promise<void> {
  answers = [];
  h = await makeHarness({
    wrapFs: (inner) => (fs = new HeldBig(inner)),
    // Skip any question no test planned for — a Cancel would leave the job waiting on a choice.
    answer: () => answers.shift() ?? { choice: 'skip' },
  });
  for (const root of [h.rootA, h.rootB]) {
    await put(join(root, 'test', 'test.md'), `nested in ${root === h.rootA ? 'A' : 'B'}`);
    await put(join(root, 'test.md'), `top in ${root === h.rootA ? 'A' : 'B'}`);
  }
  await mkdir(join(h.rootB, 'test2'));
}

afterEach(async () => {
  await disposeHarness(h);
});

const itemsIn = (root: string, projectId: string, ...rel: string[]): ClipboardItem[] =>
  rel.map((r) => ({ absPath: join(root, ...r.split('/')), projectId, projectRoot: root }));

const test2 = (): string => join(h.rootB, 'test2');

function paste(mode: 'cut' | 'copy', items: ClipboardItem[], target = test2()) {
  return h.svc.paste(1, target, { mode, items });
}

async function waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i++) await settle(10);
  expect(cond()).toBe(true);
}

describe('a selection spanning folders keeps its structure (FR-033, SC-010)', () => {
  it.each([
    ['within a project', 'B'],
    ['across projects', 'A'],
  ] as const)('/test/test.md + /test.md pasted into /test2 land at /test2/test/test.md and /test2/test.md (%s)', async (_label, from) => {
    await setup();
    const root = from === 'A' ? h.rootA : h.rootB;
    const r = await paste('copy', itemsIn(root, from, 'test/test.md', 'test.md')).result;
    expect(r.failures).toEqual([]);
    expect(await snapshotTree(test2())).toEqual({
      'test/': '',
      'test/test.md': `nested in ${from}`,
      'test.md': `top in ${from}`,
    });
  });

  it('a drag of the same selection lands the same way', async () => {
    await setup();
    const r = await h.svc.drop(1, [join(h.rootA, 'test', 'test.md'), join(h.rootA, 'test.md')], test2(), 'copy');
    expect(r.failures).toEqual([]);
    expect(await snapshotTree(test2())).toEqual({
      'test/': '',
      'test/test.md': 'nested in A',
      'test.md': 'top in A',
    });
  });

  it('keeps several levels, creating each folder the structure needs', async () => {
    await setup();
    await put(join(h.rootA, 'x', 'y', 'deep.md'), 'deep');
    const r = await paste('cut', itemsIn(h.rootA, 'A', 'x/y/deep.md', 'test.md')).result;
    expect(r.failures).toEqual([]);
    expect(await snapshotTree(test2())).toEqual({ 'x/': '', 'x/y/': '', 'x/y/deep.md': 'deep', 'test.md': 'top in A' });
    // Parents first.
    expect(r.undo).toMatchObject({ kind: 'move', createdDirs: [join(test2(), 'x'), join(test2(), 'x', 'y')] });
  });

  it('an item inside another selected folder travels with that folder', async () => {
    await setup();
    const r = await paste('copy', itemsIn(h.rootA, 'A', 'test', 'test/test.md')).result;
    expect(r.failures).toEqual([]);
    expect(await snapshotTree(test2())).toEqual({ 'test/': '', 'test/test.md': 'nested in A' });
  });
});

describe('duplicate and no-op are judged per item at its landing folder (R16)', () => {
  it('/test/a.md + /b.md copied onto the root land as copies beside themselves', async () => {
    await setup();
    await put(join(h.rootB, 'test', 'a.md'), 'a');
    await put(join(h.rootB, 'b.md'), 'b');
    const r = await paste('copy', itemsIn(h.rootB, 'B', 'test/a.md', 'b.md'), h.rootB).result;
    expect(r.failures).toEqual([]);
    expect(h.questions).toEqual([]);
    const tree = await snapshotTree(h.rootB);
    expect(tree['test/a copy.md']).toBe('a');
    expect(tree['b copy.md']).toBe('b');
    expect(tree['test/test/']).toBeUndefined();
  });

  it('the same selection cut onto the root changes nothing', async () => {
    await setup();
    await put(join(h.rootB, 'test', 'a.md'), 'a');
    await put(join(h.rootB, 'b.md'), 'b');
    const before = await snapshotTree(h.rootB);
    const r = await paste('cut', itemsIn(h.rootB, 'B', 'test/a.md', 'b.md'), h.rootB).result;
    expect(r.failures).toEqual([]);
    expect(r.undo).toBeNull();
    expect(await snapshotTree(h.rootB)).toEqual(before);
  });
});

describe('an existing folder on the way (FR-018c, FR-013)', () => {
  it('is merged into, with a clash question for a file already there', async () => {
    await setup();
    await put(join(test2(), 'test', 'test.md'), 'already here');
    answers.push({ choice: 'skip' });
    const r = await paste('cut', itemsIn(h.rootA, 'A', 'test/test.md', 'test.md')).result;
    expect(r.failures).toEqual([]);
    expect(h.questions).toHaveLength(1);
    expect(h.questions[0]).toMatchObject({ name: 'test.md', targetDir: join(test2(), 'test') });
    expect(await snapshotTree(test2())).toEqual({
      'test/': '',
      'test/test.md': 'already here',
      'test.md': 'top in A',
    });
    // Nothing was created, so the entry names no folder.
    expect(r.undo).toMatchObject({ kind: 'move' });
    expect(r.undo).not.toHaveProperty('createdDirs');
  });

  it('a file where a folder is needed fails that item, named; the rest lands', async () => {
    await setup();
    await put(join(test2(), 'test'), 'a file, not a folder');
    const r = await paste('copy', itemsIn(h.rootA, 'A', 'test/test.md', 'test.md')).result;
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatchObject({ name: 'test.md', dir: 'test' });
    expect(r.failures[0].message).toMatch(/test/);
    expect(await snapshotTree(test2())).toEqual({ test: 'a file, not a folder', 'test.md': 'top in A' });
  });
});

describe('a cut (FR-033)', () => {
  it('moves only the selected items: the folder they leave stays', async () => {
    await setup();
    const r = await paste('cut', itemsIn(h.rootA, 'A', 'test/test.md', 'test.md')).result;
    expect(r.failures).toEqual([]);
    expect(await exists(join(h.rootA, 'test'))).toBe(true);
    expect(await snapshotTree(h.rootA)).toEqual({ 'test/': '' });
    expect(r.undo).toMatchObject({
      kind: 'move',
      items: [
        { from: join(h.rootA, 'test', 'test.md'), to: join(test2(), 'test', 'test.md') },
        { from: join(h.rootA, 'test.md'), to: join(test2(), 'test.md') },
      ],
      createdDirs: [join(test2(), 'test')],
    });
  });
});

describe('roll back (FR-019a)', () => {
  it('removes the folder the paste created', async () => {
    await setup();
    await put(join(h.rootA, 'big.bin'), 'BIG');
    const run = paste('copy', itemsIn(h.rootA, 'A', 'test/test.md', 'big.bin'));
    await fs.started.promise;
    expect(await exists(join(test2(), 'test', 'test.md'))).toBe(true);
    h.svc.cancel(run.jobId);
    await waitFor(() => h.cancelChoices.length === 1);
    h.svc.finishCancel(run.jobId, 'rollback');
    const r = await run.result;
    expect(r.outcome).toBe('rolled-back');
    expect(r.rollbackFailures).toEqual([]);
    expect(await snapshotTree(test2())).toEqual({});
  });
});

describe('undo and redo (FR-020, FR-023)', () => {
  async function cutWithCreatedDir(): Promise<FileOpUndoEntry> {
    const r = await paste('cut', itemsIn(h.rootA, 'A', 'test/test.md', 'test.md')).result;
    expect(r.undo).toMatchObject({ createdDirs: [join(test2(), 'test')] });
    return r.undo!;
  }

  it('undo removes the created folder once empty; redo recreates it', async () => {
    await setup();
    const entry = await cutWithCreatedDir();
    expect(await h.svc.applyUndo(entry, 'undo')).toMatchObject({ ok: true });
    expect(await snapshotTree(test2())).toEqual({});
    expect(await snapshotTree(h.rootA)).toEqual({ 'test/': '', 'test/test.md': 'nested in A', 'test.md': 'top in A' });
    expect(await h.svc.applyUndo(entry, 'redo')).toMatchObject({ ok: true });
    expect(await snapshotTree(test2())).toEqual({ 'test/': '', 'test/test.md': 'nested in A', 'test.md': 'top in A' });
  });

  it('undo leaves a created folder the user has since put a file in, and still succeeds', async () => {
    await setup();
    const entry = await cutWithCreatedDir();
    await put(join(test2(), 'test', 'mine.txt'), 'mine');
    expect(await h.svc.applyUndo(entry, 'undo')).toMatchObject({ ok: true });
    expect(await snapshotTree(test2())).toEqual({ 'test/': '', 'test/mine.txt': 'mine' });
    expect(await exists(join(h.rootA, 'test', 'test.md'))).toBe(true);
  });

  it('a paste entry (something replaced) carries createdDirs too, and its undo removes them', async () => {
    await setup();
    await put(join(test2(), 'test.md'), 'existing top');
    answers.push({ choice: 'replace' });
    const r = await paste('copy', itemsIn(h.rootA, 'A', 'test/test.md', 'test.md')).result;
    expect(r.failures).toEqual([]);
    expect(r.undo).toMatchObject({ kind: 'paste', createdDirs: [join(test2(), 'test')] });
    expect(await h.svc.applyUndo(r.undo!, 'undo')).toMatchObject({ ok: true });
    expect(await snapshotTree(test2())).toEqual({ 'test.md': 'existing top' });
  });
});
