import { join } from 'node:path';
import { utimes } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClashAnswer, ClashQuestion, ClipboardItem } from '@throng/core';
import { disposeHarness, exists, makeHarness, put, snapshotTree, type Harness } from './helpers/transfer-harness.js';

/**
 * Name clashes are the user's decision (050 R3, FR-017 – FR-018f, SC-006 — T042).
 *
 * Nothing in the target changes before the answer; Replace, Skip and Keep both each do exactly what
 * they say; "apply to all" lasts for one job; a folder landing on a folder merges and asks only about
 * what actually clashes, at whatever depth.
 */

let h: Harness;
/** Scripted answers, in order; the harness records every question asked. */
let answers: ClashAnswer[];
/** What the target looked like at the moment each question was asked. */
let targetAtQuestion: Record<string, string>[];
let replaceMode: 'recycle' | 'permanent';

async function setup(): Promise<void> {
  answers = [];
  targetAtQuestion = [];
  replaceMode = 'recycle';
  h = await makeHarness({
    answer: async (_q: ClashQuestion) => {
      targetAtQuestion.push(await snapshotTree(join(h.rootB, 'dest')));
      return answers.shift() ?? { choice: 'cancel' };
    },
    deps: { replaceMode: () => replaceMode },
  });
  await put(join(h.rootA, 'a.txt'), 'incoming-a');
  await put(join(h.rootA, 'c.txt'), 'incoming-c');
  await put(join(h.rootB, 'dest', 'a.txt'), 'existing-a');
  await put(join(h.rootB, 'dest', 'c.txt'), 'existing-c');
}

const fromA = (...names: string[]): ClipboardItem[] =>
  names.map((n) => ({ absPath: join(h.rootA, n), projectId: 'A', projectRoot: h.rootA }));

const paste = (mode: 'cut' | 'copy', ...names: string[]) =>
  h.svc.paste(1, join(h.rootB, 'dest'), { mode, items: fromA(...names) }).result;

afterEach(async () => {
  await disposeHarness(h);
});

describe('the question (FR-017, FR-018)', () => {
  it('a file clash asks once, naming both sides, and NOTHING in the target changes before the answer', async () => {
    await setup();
    // The incoming file is the newer one.
    await utimes(join(h.rootB, 'dest', 'a.txt'), new Date(2020, 0, 1), new Date(2020, 0, 1));
    answers = [{ choice: 'skip', applyToAll: false }];
    await paste('copy', 'a.txt');
    expect(h.questions).toHaveLength(1);
    const q = h.questions[0]!;
    expect(q).toMatchObject({
      name: 'a.txt',
      targetDir: join(h.rootB, 'dest'),
      permanentReplace: false,
      existing: { kind: 'file', size: 'existing-a'.length, newer: false },
      incoming: { kind: 'file', size: 'incoming-a'.length, newer: true },
    });
    expect(typeof q.existing.modifiedMs).toBe('number');
    expect(typeof q.requestId).toBe('string');
    expect(targetAtQuestion[0]).toEqual({ 'a.txt': 'existing-a', 'c.txt': 'existing-c' });
  });

  it('under permanent replace the question says so', async () => {
    await setup();
    replaceMode = 'permanent';
    answers = [{ choice: 'skip', applyToAll: false }];
    await paste('copy', 'a.txt');
    expect(h.questions[0]!.permanentReplace).toBe(true);
  });

  it('a job with no clash never asks (FR-018d)', async () => {
    await setup();
    await put(join(h.rootA, 'fresh.txt'), 'fresh');
    const r = await paste('copy', 'fresh.txt');
    expect(r.failures).toEqual([]);
    expect(h.questions).toEqual([]);
  });
});

describe('the answers (FR-018a, FR-018b, FR-018f)', () => {
  it('Replace (recycle) sends the existing item to the Recycle Bin, then lands the incoming one', async () => {
    await setup();
    answers = [{ choice: 'replace', applyToAll: false }];
    const r = await paste('copy', 'a.txt');
    expect(r.failures).toEqual([]);
    expect(h.bin.trashed.map((t) => t.path)).toEqual([join(h.rootB, 'dest', 'a.txt')]);
    expect(await snapshotTree(join(h.rootB, 'dest'))).toEqual({ 'a.txt': 'incoming-a', 'c.txt': 'existing-c' });
  });

  it('Replace (permanent) deletes it for good and leaves the item out of the undo entry', async () => {
    await setup();
    replaceMode = 'permanent';
    answers = [{ choice: 'replace', applyToAll: false }];
    const r = await paste('cut', 'a.txt');
    expect(h.bin.trashed).toEqual([]);
    expect(await snapshotTree(join(h.rootB, 'dest'))).toEqual({ 'a.txt': 'incoming-a', 'c.txt': 'existing-c' });
    expect(r.undo).toBeNull();
  });

  it('Skip leaves both items untouched and the source on the clipboard', async () => {
    await setup();
    answers = [{ choice: 'skip', applyToAll: false }];
    const r = await paste('cut', 'a.txt');
    expect(r.failures).toEqual([]);
    expect(r.placed).toEqual([]);
    expect(await exists(join(h.rootA, 'a.txt'))).toBe(true);
    expect(await snapshotTree(join(h.rootB, 'dest'))).toEqual({ 'a.txt': 'existing-a', 'c.txt': 'existing-c' });
  });

  it('Keep both lands the incoming item as "name copy.ext"', async () => {
    await setup();
    answers = [{ choice: 'keep-both', applyToAll: false }];
    const r = await paste('cut', 'a.txt');
    expect(r.placed).toEqual([join(h.rootB, 'dest', 'a copy.txt')]);
    expect(await exists(join(h.rootA, 'a.txt'))).toBe(false);
    expect(await snapshotTree(join(h.rootB, 'dest'))).toEqual({
      'a.txt': 'existing-a',
      'a copy.txt': 'incoming-a',
      'c.txt': 'existing-c',
    });
    expect(r.undo).toMatchObject({ kind: 'move', items: [{ from: join(h.rootA, 'a.txt'), to: join(h.rootB, 'dest', 'a copy.txt') }] });
  });

  it('apply-to-all answers every later clash in the job, and does not carry into the next job', async () => {
    await setup();
    answers = [{ choice: 'keep-both', applyToAll: true }];
    await paste('copy', 'a.txt', 'c.txt');
    expect(h.questions).toHaveLength(1);
    expect(await exists(join(h.rootB, 'dest', 'c copy.txt'))).toBe(true);

    // Re-pasting the same set asks again — about every item (US5 AS7).
    answers = [
      { choice: 'skip', applyToAll: false },
      { choice: 'skip', applyToAll: false },
    ];
    await paste('copy', 'a.txt', 'c.txt');
    expect(h.questions).toHaveLength(3);
  });
});

describe('folders (FR-018c, FR-018e)', () => {
  async function seedDocs(): Promise<void> {
    await put(join(h.rootA, 'docs', 'guide', 'intro.md'), 'incoming-intro');
    await put(join(h.rootA, 'docs', 'guide', 'img', 'logo.png'), 'PNG');
    await put(join(h.rootA, 'docs', 'top.md'), 'top');
    await put(join(h.rootB, 'dest', 'docs', 'guide', 'intro.md'), 'existing-intro');
    await put(join(h.rootB, 'dest', 'docs', 'mine.md'), 'mine');
  }

  it('a folder landing on a folder MERGES: non-clashing contents land, and only the deep clash is asked', async () => {
    await setup();
    await seedDocs();
    answers = [{ choice: 'skip', applyToAll: false }];
    const r = await paste('copy', 'docs');
    expect(r.failures).toEqual([]);
    expect(h.questions.map((q) => [q.name, q.targetDir])).toEqual([['intro.md', join(h.rootB, 'dest', 'docs', 'guide')]]);
    expect(await snapshotTree(join(h.rootB, 'dest', 'docs'))).toEqual({
      'guide/': '',
      'guide/intro.md': 'existing-intro',
      'guide/img/': '',
      'guide/img/logo.png': 'PNG',
      'top.md': 'top',
      'mine.md': 'mine',
    });
  });

  it('a cut merge removes the source folder only once it is empty', async () => {
    await setup();
    await seedDocs();
    answers = [{ choice: 'skip', applyToAll: false }];
    await paste('cut', 'docs');
    // The skipped file keeps its folders — and the folder its path — alive.
    expect(await snapshotTree(join(h.rootA, 'docs'))).toEqual({ 'guide/': '', 'guide/intro.md': 'incoming-intro' });

    answers = [{ choice: 'replace', applyToAll: false }];
    await paste('cut', 'docs');
    expect(await exists(join(h.rootA, 'docs'))).toBe(false);
    expect(await snapshotTree(join(h.rootB, 'dest', 'docs', 'guide'))).toEqual({
      'intro.md': 'incoming-intro',
      'img/': '',
      'img/logo.png': 'PNG',
    });
  });

  it('a file landing on a folder offers Replace (the folder to the Recycle Bin) and never merges', async () => {
    await setup();
    await put(join(h.rootA, 'thing'), 'a file');
    await put(join(h.rootB, 'dest', 'thing', 'inner.txt'), 'inner');
    answers = [{ choice: 'replace', applyToAll: false }];
    await paste('copy', 'thing');
    expect(h.questions[0]).toMatchObject({ existing: { kind: 'folder', itemCount: 1 }, incoming: { kind: 'file' } });
    expect(h.bin.trashed.map((t) => t.path)).toEqual([join(h.rootB, 'dest', 'thing')]);
    expect(await snapshotTree(join(h.rootB, 'dest'))).toMatchObject({ thing: 'a file' });
  });
});

describe('within one project (US5 AS5)', () => {
  it('the same rules hold for a paste inside the active project', async () => {
    await setup();
    await put(join(h.rootB, 'src', 'a.txt'), 'b-local');
    answers = [{ choice: 'keep-both', applyToAll: false }];
    const r = await h.svc.paste(1, join(h.rootB, 'dest'), {
      mode: 'copy',
      items: [{ absPath: join(h.rootB, 'src', 'a.txt'), projectId: 'B', projectRoot: h.rootB }],
    }).result;
    expect(h.questions).toHaveLength(1);
    expect(r.placed).toEqual([join(h.rootB, 'dest', 'a copy.txt')]);
  });
});
