import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClashAnswer, ClipboardItem, IFileSystem } from '@throng/core';
import { FileClipboardService } from '../../src/main/file-clipboard.js';
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
 * Cancel, keep finished, roll back, and the queue (050 R7, FR-019a – FR-019d, SC-007, SC-008 — T046).
 */

/**
 * Holds the copy of any file named `big.bin` until the job's signal aborts — a copy that is "in
 * progress" for as long as the test wants — then lets the real seam see the aborted signal.
 *
 * A cut of `big.bin` is made to cross a volume (EXDEV), so it too is a copy in progress: a same-volume
 * rename is atomic and there is nothing in it to cancel.
 */
class HeldBigCopy extends FsDecorator {
  started = gate();
  override async copyFileCancellable(s: string, d: string, signal: AbortSignal): Promise<void> {
    if (s.endsWith('big.bin')) {
      this.started.open();
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    }
    return super.copyFileCancellable(s, d, signal);
  }
  override async move(s: string, d: string): Promise<string> {
    if (s.endsWith('big.bin')) {
      throw Object.assign(new Error(`EXDEV: cross-device link not permitted, rename '${s}'`), { code: 'EXDEV' });
    }
    return super.move(s, d);
  }
}

let h: Harness;
let fs: HeldBigCopy;
let answers: ClashAnswer[];
let clipboard: FileClipboardService;

async function setup(wrap?: (inner: IFileSystem) => IFileSystem): Promise<void> {
  answers = [];
  clipboard = new FileClipboardService(() => {});
  h = await makeHarness({
    wrapFs: (inner) => {
      fs = new HeldBigCopy(inner);
      return wrap ? wrap(fs) : fs;
    },
    answer: () => answers.shift() ?? { choice: 'cancel' },
    deps: { clipboard },
  });
  h.files.setOnMoved((moves) => {
    h.bracket.push({ kind: 'moved', moves });
    clipboard.followMoves(moves);
  });
  await put(join(h.rootA, 'one.txt'), 'one');
  await put(join(h.rootA, 'big.bin'), 'BIG'.repeat(1000));
  await put(join(h.rootA, 'three.txt'), 'three');
  await put(join(h.rootA, 'docs', 'inner.md'), 'inner');
  await put(join(h.rootB, 'dest', 'one.txt'), 'existing-one');
  await put(join(h.rootB, 'dest', 'docs', 'mine.md'), 'mine');
}

const fromA = (...names: string[]): ClipboardItem[] =>
  names.map((n) => ({ absPath: join(h.rootA, n), projectId: 'A', projectRoot: h.rootA }));

async function waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i++) await settle(10);
  expect(cond()).toBe(true);
}

/** Cut (or copy) from A as the user does, and paste into B/dest. */
function pasteFromA(mode: 'cut' | 'copy', ...names: string[]) {
  clipboard.setFromRelative(mode, names, h.rootA, 'A');
  return h.svc.paste(1, join(h.rootB, 'dest'), clipboard.get()!);
}

afterEach(async () => {
  await disposeHarness(h);
});

describe('cancel during a large file (FR-019a, SC-008)', () => {
  it('aborts the copy in progress, leaves no partial file and the source intact, then waits for the choice', async () => {
    await setup();
    const run = pasteFromA('copy', 'big.bin', 'three.txt');
    await fs.started.promise;
    h.svc.cancel(run.jobId);
    await waitFor(() => h.cancelChoices.length === 1);
    expect(h.cancelChoices).toEqual([{ windowId: 1, jobId: run.jobId }]);
    expect(h.progress.at(-1)!.p).toMatchObject({ jobId: run.jobId, state: 'awaiting-cancel-choice' });
    expect(await exists(join(h.rootB, 'dest', 'big.bin'))).toBe(false);
    expect(await exists(join(h.rootA, 'big.bin'))).toBe(true);
    // SC-008 — the next item never began.
    expect(await exists(join(h.rootB, 'dest', 'three.txt'))).toBe(false);
    h.svc.finishCancel(run.jobId, 'keep');
    expect((await run.result).outcome).toBe('kept');
  });
});

describe('Keep finished (FR-019a, FR-019b, FR-019c)', () => {
  it('keeps what landed, skips what had not started, and undoes exactly what landed', async () => {
    await setup();
    const run = pasteFromA('cut', 'three.txt', 'big.bin', 'docs');
    await fs.started.promise;
    h.svc.cancel(run.jobId);
    await waitFor(() => h.cancelChoices.length === 1);
    h.svc.finishCancel(run.jobId, 'keep');
    const r = await run.result;
    expect(r.outcome).toBe('kept');
    expect(r.placed).toEqual([join(h.rootB, 'dest', 'three.txt')]);
    expect(r.undo).toMatchObject({ kind: 'move', items: [{ from: join(h.rootA, 'three.txt'), to: join(h.rootB, 'dest', 'three.txt') }] });
    expect(await exists(join(h.rootA, 'big.bin'))).toBe(true);
    expect(await exists(join(h.rootA, 'docs', 'inner.md'))).toBe(true);
    // FR-019c — the clipboard holds exactly the items that did not move, at their original paths.
    expect(clipboard.get()).toEqual({ mode: 'cut', items: fromA('big.bin', 'docs') });
  });
});

describe('Roll back (FR-019a, FR-019b, SC-007)', () => {
  it('a cut: every moved item returns, every replaced item is restored, the merge folder comes back', async () => {
    await setup();
    const beforeA = await snapshotTree(h.rootA);
    const beforeB = await snapshotTree(h.rootB);
    answers = [{ choice: 'replace', applyToAll: false }];
    const run = pasteFromA('cut', 'one.txt', 'docs', 'three.txt', 'big.bin');
    await fs.started.promise;
    h.svc.cancel(run.jobId);
    await waitFor(() => h.cancelChoices.length === 1);
    h.svc.finishCancel(run.jobId, 'rollback');
    const r = await run.result;
    expect(r.outcome).toBe('rolled-back');
    expect(r.undo).toBeNull();
    expect(r.rollbackFailures).toEqual([]);
    expect(r.placed).toEqual([]);
    expect(await snapshotTree(h.rootA)).toEqual(beforeA);
    expect(await snapshotTree(h.rootB)).toEqual(beforeB);
    // Nothing moved, so the bracket closes with no pairs, and the clipboard keeps every item.
    expect(h.bracket.at(-1)).toEqual({ kind: 'moved', moves: [] });
    expect(clipboard.get()).toEqual({ mode: 'cut', items: fromA('one.txt', 'docs', 'three.txt', 'big.bin') });
  });

  it('a copy: every copy it placed is removed; the clipboard is unchanged', async () => {
    await setup();
    const beforeB = await snapshotTree(h.rootB);
    const run = pasteFromA('copy', 'three.txt', 'docs', 'big.bin');
    const snapshot = clipboard.get();
    await fs.started.promise;
    h.svc.cancel(run.jobId);
    await waitFor(() => h.cancelChoices.length === 1);
    h.svc.finishCancel(run.jobId, 'rollback');
    expect((await run.result).outcome).toBe('rolled-back');
    expect(await snapshotTree(h.rootB)).toEqual(beforeB);
    expect(clipboard.get()).toBe(snapshot);
  });

  // 052 T030 (FR-001, edge case *The move fails or is rolled back*) — a cut roll back that cannot put one item back
  // closes the move bracket with THAT pair still standing, so every consumer of `moved` — the unheld-layout walk
  // among them (`in-app-moves-follow-layouts`) — ends at the path the file actually has.
  it('a cut roll back that cannot return one item closes the bracket with that pair standing', async () => {
    await setup((inner) => {
      class NoMoveBack extends FsDecorator {
        override async move(s: string, d: string): Promise<string> {
          if (s.startsWith(h.rootB) && s.endsWith('three.txt')) throw new Error('The file is in use.');
          return super.move(s, d);
        }
      }
      return new NoMoveBack(inner);
    });
    const run = pasteFromA('cut', 'three.txt', 'big.bin');
    await fs.started.promise;
    h.svc.cancel(run.jobId);
    await waitFor(() => h.cancelChoices.length === 1);
    h.svc.finishCancel(run.jobId, 'rollback');
    const r = await run.result;
    expect(r.rollbackFailures).toEqual([expect.objectContaining({ name: 'three.txt' })]);
    expect(h.bracket.at(-1)).toEqual({
      kind: 'moved',
      moves: [{ from: join(h.rootA, 'three.txt'), to: join(h.rootB, 'dest', 'three.txt') }],
    });
  });

  it('names every item roll back could not restore (edge case *Roll back cannot finish*)', async () => {
    await setup((inner) => {
      class NoRestore extends FsDecorator {
        override async restoreFromTrash(): Promise<void> {
          throw new Error('The item is no longer in the Recycle Bin.');
        }
      }
      return new NoRestore(inner);
    });
    answers = [{ choice: 'replace', applyToAll: false }];
    const run = pasteFromA('copy', 'one.txt', 'big.bin');
    await fs.started.promise;
    h.svc.cancel(run.jobId);
    await waitFor(() => h.cancelChoices.length === 1);
    h.svc.finishCancel(run.jobId, 'rollback');
    const r = await run.result;
    expect(r.rollbackFailures).toEqual([expect.objectContaining({ name: 'one.txt' })]);
    expect(r.rollbackFailures[0]!.message).toMatch(/Recycle Bin/);
  });
});

describe('Cancel from the clash prompt (FR-019a)', () => {
  it('behaves exactly as Cancel from progress: the choice is asked, and Keep finished keeps', async () => {
    await setup();
    const run = pasteFromA('cut', 'three.txt', 'one.txt', 'docs');
    // `one.txt` clashes; no scripted answer → the prompt answers Cancel.
    await waitFor(() => h.cancelChoices.length === 1);
    expect(await exists(join(h.rootA, 'docs'))).toBe(true);
    h.svc.finishCancel(run.jobId, 'keep');
    const r = await run.result;
    expect(r.outcome).toBe('kept');
    expect(r.placed).toEqual([join(h.rootB, 'dest', 'three.txt')]);
    expect(await snapshotTree(join(h.rootB, 'dest'))).toMatchObject({ 'one.txt': 'existing-one' });
  });

  it('a window lost while the choice is pending answers Keep finished (R9)', async () => {
    await setup();
    const run = pasteFromA('copy', 'three.txt', 'one.txt');
    await waitFor(() => h.cancelChoices.length === 1);
    h.svc.ownerGone(1);
    const r = await run.result;
    expect(r.outcome).toBe('kept');
    expect(r.placed).toEqual([join(h.rootB, 'dest', 'three.txt')]);
  });
});

describe('the queue (FR-019d)', () => {
  it('a queued job cancelled before it starts never runs and asks nothing', async () => {
    await setup();
    const first = pasteFromA('copy', 'big.bin');
    await fs.started.promise;
    const second = h.svc.paste(1, join(h.rootB, 'dest'), { mode: 'copy', items: fromA('three.txt') });
    h.svc.cancel(second.jobId);
    const r2 = await second.result;
    expect(r2).toMatchObject({ outcome: 'kept', placed: [], undo: null, failures: [] });
    expect(h.done.map((d) => d.r.jobId)).toEqual([second.jobId]);
    h.svc.cancel(first.jobId);
    await waitFor(() => h.cancelChoices.length === 1);
    expect(h.cancelChoices.map((c) => c.jobId)).toEqual([first.jobId]);
    h.svc.finishCancel(first.jobId, 'keep');
    await first.result;
    await settle();
    expect(await exists(join(h.rootB, 'dest', 'three.txt'))).toBe(false);
  });

  it('a queued job pastes the clipboard as it was when its paste was REQUESTED, not when it runs', async () => {
    await setup();
    const first = pasteFromA('copy', 'big.bin');
    await fs.started.promise;
    const second = pasteFromA('copy', 'three.txt');
    clipboard.setFromRelative('copy', ['docs'], h.rootA, 'A');
    h.svc.cancel(first.jobId);
    await waitFor(() => h.cancelChoices.length === 1);
    h.svc.finishCancel(first.jobId, 'keep');
    const r2 = await second.result;
    expect(r2.placed).toEqual([join(h.rootB, 'dest', 'three.txt')]);
    expect(await snapshotTree(join(h.rootB, 'dest', 'docs'))).toEqual({ 'mine.md': 'mine' });
  });
});
