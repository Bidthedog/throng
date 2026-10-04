import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClashAnswer, ClipboardItem } from '@throng/core';
import { disposeHarness, makeHarness, put, type Harness } from './helpers/transfer-harness.js';

/**
 * The undo entry a job returns, built from what the job DID (050 R10, FR-018b, FR-020 – FR-023 — T044).
 */

let h: Harness;
let answers: ClashAnswer[];

async function setup(): Promise<void> {
  answers = [];
  let n = 0;
  h = await makeHarness({
    answer: () => answers.shift() ?? { choice: 'cancel' },
    deps: { newId: () => `id-${++n}`, now: () => 1000 },
  });
  await put(join(h.rootA, 'a.txt'), 'incoming-a');
  await put(join(h.rootA, 'b.txt'), 'b');
  await put(join(h.rootB, 'dest', 'a.txt'), 'existing-a');
  await put(join(h.rootB, 'src', 'local.txt'), 'local');
}

const fromA = (...names: string[]): ClipboardItem[] =>
  names.map((n) => ({ absPath: join(h.rootA, n), projectId: 'A', projectRoot: h.rootA }));

afterEach(async () => {
  await disposeHarness(h);
});

describe('the undo entry (R10)', () => {
  it('a COPY that replaced something returns a paste entry, so it is undoable (FR-018b, FR-022)', async () => {
    await setup();
    answers = [{ choice: 'replace', applyToAll: false }];
    const r = await h.svc.paste(1, join(h.rootB, 'dest'), { mode: 'copy', items: fromA('a.txt', 'b.txt') }).result;
    expect(r.undo).toEqual({
      kind: 'paste',
      id: expect.any(String),
      moved: [],
      copied: [
        { from: join(h.rootA, 'a.txt'), to: join(h.rootB, 'dest', 'a.txt') },
        { from: join(h.rootA, 'b.txt'), to: join(h.rootB, 'dest', 'b.txt') },
      ],
      replaced: [{ path: join(h.rootB, 'dest', 'a.txt'), trashedAt: 1000 }],
      projects: { source: 'A', target: 'B' },
      at: 1000,
    });
  });

  it('a CUT that replaced something returns a paste entry of its moves and the replaced item', async () => {
    await setup();
    answers = [{ choice: 'replace', applyToAll: false }];
    const r = await h.svc.paste(1, join(h.rootB, 'dest'), { mode: 'cut', items: fromA('a.txt') }).result;
    expect(r.undo).toMatchObject({
      kind: 'paste',
      moved: [{ from: join(h.rootA, 'a.txt'), to: join(h.rootB, 'dest', 'a.txt') }],
      copied: [],
      replaced: [{ path: join(h.rootB, 'dest', 'a.txt'), trashedAt: 1000 }],
    });
  });

  it('a cut with one failure returns a move entry of exactly the moved items (FR-023)', async () => {
    await setup();
    const r = await h.svc.paste(1, join(h.rootB, 'dest'), { mode: 'cut', items: fromA('gone.txt', 'b.txt') }).result;
    expect(r.failures).toHaveLength(1);
    expect(r.undo).toEqual({
      kind: 'move',
      id: expect.any(String),
      items: [{ from: join(h.rootA, 'b.txt'), to: join(h.rootB, 'dest', 'b.txt') }],
      projects: { source: 'A', target: 'B' },
      at: 1000,
    });
  });

  it('a cross-project entry carries a fresh id and both projects; a within-project one carries no projects', async () => {
    await setup();
    const cross = await h.svc.paste(1, join(h.rootB, 'dest'), { mode: 'cut', items: fromA('b.txt') }).result;
    const within = await h.svc.paste(1, join(h.rootB, 'dest'), {
      mode: 'cut',
      items: [{ absPath: join(h.rootB, 'src', 'local.txt'), projectId: 'B', projectRoot: h.rootB }],
    }).result;
    expect(cross.undo).toMatchObject({ kind: 'move', projects: { source: 'A', target: 'B' } });
    expect(within.undo).toMatchObject({ kind: 'move' });
    expect(within.undo).not.toHaveProperty('projects');
    expect(cross.undo!.id).toBeTruthy();
    expect(within.undo!.id).toBeTruthy();
    expect(cross.undo!.id).not.toBe(within.undo!.id);
  });

  it('a copy that replaced nothing records nothing (FR-022)', async () => {
    await setup();
    const r = await h.svc.paste(1, join(h.rootB, 'dest'), { mode: 'copy', items: fromA('b.txt') }).result;
    expect(r.undo).toBeNull();
  });
});
