import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FileOpUndoEntry } from '@throng/core';
import { disposeHarness, exists, gate, makeHarness, put, settle, snapshotTree, type Harness } from './helpers/transfer-harness.js';

/**
 * Applying a cross-project or `paste` undo entry in main (050 R10, FR-018b, FR-020, FR-021 — T060).
 *
 * Over absolute paths, each confined to some project root, inside the one file-operation queue and the
 * move bracket — so an editor follows an undone move back across projects (US3 AS1).
 */

let h: Harness;

beforeEach(async () => {
  h = await makeHarness({ answer: () => ({ choice: 'replace', applyToAll: false }) });
  await put(join(h.rootA, 'a.txt'), 'alpha');
  await put(join(h.rootA, 'x.txt'), 'incoming-x');
  await put(join(h.rootB, 'dest', 'x.txt'), 'existing-x');
});
afterEach(async () => {
  await disposeHarness(h);
});

const crossMove = (): FileOpUndoEntry => ({
  kind: 'move',
  id: 'm1',
  items: [{ from: join(h.rootA, 'a.txt'), to: join(h.rootB, 'dest', 'a.txt') }],
  projects: { source: 'A', target: 'B' },
  at: 1,
});

async function cutAToB(): Promise<FileOpUndoEntry> {
  const r = await h.svc.paste(1, join(h.rootB, 'dest'), {
    mode: 'cut',
    items: [{ absPath: join(h.rootA, 'a.txt'), projectId: 'A', projectRoot: h.rootA }],
  }).result;
  return r.undo!;
}

describe('a cross-project move (US3)', () => {
  it('undo moves it back from B to A inside the bracket; redo puts it back in B', async () => {
    const entry = await cutAToB();
    h.bracket.length = 0;
    expect(await h.svc.applyUndo(entry, 'undo')).toMatchObject({ ok: true });
    expect(await snapshotTree(h.rootA)).toMatchObject({ 'a.txt': 'alpha' });
    expect(await exists(join(h.rootB, 'dest', 'a.txt'))).toBe(false);
    expect(h.bracket).toEqual([
      { kind: 'started', paths: [join(h.rootB, 'dest', 'a.txt')] },
      { kind: 'moved', moves: [{ from: join(h.rootB, 'dest', 'a.txt'), to: join(h.rootA, 'a.txt') }] },
    ]);
    expect(await h.svc.applyUndo(entry, 'redo')).toMatchObject({ ok: true });
    expect(await exists(join(h.rootB, 'dest', 'a.txt'))).toBe(true);
    expect(await exists(join(h.rootA, 'a.txt'))).toBe(false);
  });

  it('runs in the one queue: it waits behind a running paste', async () => {
    const entry = await cutAToB();
    const g = gate();
    const held = h.files.exclusive(() => g.promise);
    const undone = h.svc.applyUndo(entry, 'undo');
    await settle();
    expect(await exists(join(h.rootA, 'a.txt'))).toBe(false);
    g.open();
    await held;
    expect(await undone).toMatchObject({ ok: true });
  });
});

describe('a paste entry (FR-018b)', () => {
  it('undo removes the pasted item and restores the replaced one; redo re-applies', async () => {
    const r = await h.svc.paste(1, join(h.rootB, 'dest'), {
      mode: 'copy',
      items: [{ absPath: join(h.rootA, 'x.txt'), projectId: 'A', projectRoot: h.rootA }],
    }).result;
    expect(r.undo).toMatchObject({ kind: 'paste' });
    const undone = await h.svc.applyUndo(r.undo!, 'undo');
    expect(undone).toMatchObject({ ok: true });
    expect(await snapshotTree(join(h.rootB, 'dest'))).toEqual({ 'x.txt': 'existing-x' });
    const redone = await h.svc.applyUndo(('entry' in undone && undone.entry) || r.undo!, 'redo');
    expect(redone).toMatchObject({ ok: true });
    expect(await snapshotTree(join(h.rootB, 'dest'))).toEqual({ 'x.txt': 'incoming-x' });
    expect(await snapshotTree(h.rootA)).toMatchObject({ 'x.txt': 'incoming-x' });
    // The redo re-recycled the existing item, at a NEW time — the entry it returns carries it, so the
    // next undo restores the right Recycle Bin record.
    if (!('entry' in redone) || !redone.entry || redone.entry.kind !== 'paste') throw new Error('expected a refreshed entry');
    const again = await h.svc.applyUndo(redone.entry, 'undo');
    expect(again).toMatchObject({ ok: true });
    expect(await snapshotTree(join(h.rootB, 'dest'))).toEqual({ 'x.txt': 'existing-x' });
  });
});

describe('refusals (FR-021, plan *Re-evaluation* I)', () => {
  it('a stale entry — the moved item edited away — is refused with nothing changed', async () => {
    const entry = await cutAToB();
    await put(join(h.rootB, 'dest', 'moved-away.txt'), 'x');
    const { rename } = await import('node:fs/promises');
    await rename(join(h.rootB, 'dest', 'a.txt'), join(h.rootB, 'dest', 'renamed.txt'));
    const before = { a: await snapshotTree(h.rootA), b: await snapshotTree(h.rootB) };
    expect(await h.svc.applyUndo(entry, 'undo')).toHaveProperty('error');
    expect({ a: await snapshotTree(h.rootA), b: await snapshotTree(h.rootB) }).toEqual(before);
  });

  it('a name re-occupied at the destination is refused with nothing changed', async () => {
    const entry = await cutAToB();
    await put(join(h.rootA, 'a.txt'), 'new tenant');
    expect(await h.svc.applyUndo(entry, 'undo')).toHaveProperty('error');
    expect(await snapshotTree(join(h.rootB, 'dest'))).toMatchObject({ 'a.txt': 'alpha' });
    expect(await snapshotTree(h.rootA)).toMatchObject({ 'a.txt': 'new tenant' });
  });

  it('any path outside every project root is refused before any change', async () => {
    await put(join(h.outside, 'o.txt'), 'outside');
    const entry: FileOpUndoEntry = {
      ...crossMove(),
      items: [{ from: join(h.outside, 'o.txt'), to: join(h.rootA, 'a.txt') }],
    };
    // Redo would move outside/o.txt over… nothing: refused for confinement, not for existence.
    await (await import('node:fs/promises')).rm(join(h.rootA, 'a.txt'));
    expect(await h.svc.applyUndo(entry, 'redo')).toMatchObject({ error: expect.stringMatching(/not inside a project/) });
    expect(await exists(join(h.outside, 'o.txt'))).toBe(true);
    expect(await exists(join(h.rootA, 'a.txt'))).toBe(false);
  });

  it('a malformed entry is refused', async () => {
    expect(await h.svc.applyUndo({ kind: 'move' } as unknown as FileOpUndoEntry, 'undo')).toHaveProperty('error');
  });
});

describe('exists (contracts/transfer-ipc §2)', () => {
  it('answers per path, and false for any path outside every project root', async () => {
    await put(join(h.outside, 'o.txt'), 'outside');
    expect(
      await h.svc.exists([join(h.rootA, 'a.txt'), join(h.rootB, 'nope.txt'), join(h.outside, 'o.txt')]),
    ).toEqual([true, false, false]);
  });
});
