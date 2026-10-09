/**
 * 052 FR-001 (R1) — every in-app move reaches the unheld-layout walk, exactly once, from ONE place: the in-app move
 * callbacks' `moved` step. A plain rename never reached it before (#397): the walk hung off `TransferService` only.
 *
 * Layer: integration — the defect is wiring. Real `FilesService`, real `TransferService`, real
 * `createInAppMoveCallbacks`, real files on disk; the daemon is a recorder at its RPC boundary.
 */
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInAppMoveCallbacks } from '../../src/main/in-app-moves.js';
import { walkMovedLayouts } from '../../src/main/moved-layout-walk.js';
import type { MovePair } from '../../src/main/files-service.js';
import { disposeHarness, makeHarness, put, type Harness } from './helpers/transfer-harness.js';

let h: Harness;
let walked: MovePair[][];
let walkThrows: boolean;

beforeEach(async () => {
  h = await makeHarness();
  walked = [];
  walkThrows = false;
  const callbacks = createInAppMoveCallbacks({
    coordinator: { beginMove: () => {}, markMoved: () => {} },
    previews: { beginMove: () => {}, moved: () => [], announcePath: () => {} },
    history: { rewritePaths: () => {}, announce: () => {} },
    broadcastFilesMoved: () => {},
    clipboard: { followMoves: () => {} },
    layouts: {
      followMoves: (moves) => {
        walked.push([...moves]);
        if (walkThrows) throw new Error('daemon gone');
      },
    },
  });
  h.files.setOnMoveStarted(callbacks.started);
  h.files.setOnMoved(callbacks.moved);
});

afterEach(async () => {
  await disposeHarness(h);
});

describe('every in-app move reaches the layout walk once (FR-001)', () => {
  it('a File Explorer rename, and its undo (a rename back)', async () => {
    await put(join(h.rootB, 'a.md'), 'a');
    expect(await h.files.rename('a.md', 'b.md')).toEqual({ ok: true });
    expect(await h.files.rename('b.md', 'a.md')).toEqual({ ok: true });
    expect(walked).toEqual([
      [{ from: join(h.rootB, 'a.md'), to: join(h.rootB, 'b.md') }],
      [{ from: join(h.rootB, 'b.md'), to: join(h.rootB, 'a.md') }],
    ]);
  });

  it('an in-project move (drag-move, and an undo/redo of one)', async () => {
    await put(join(h.rootB, 'a.md'), 'a');
    await put(join(h.rootB, 'dest', '.keep'), '');
    expect(await h.files.move(['a.md'], 'dest')).toEqual({ ok: true });
    expect(walked).toEqual([[{ from: join(h.rootB, 'a.md'), to: join(h.rootB, 'dest', 'a.md') }]]);
  });

  it('a cut-paste across projects, its undo and its redo', async () => {
    await put(join(h.rootA, 'a.md'), 'a');
    const from = join(h.rootA, 'a.md');
    const to = join(h.rootB, 'a.md');
    const r = await h.svc.paste(1, h.rootB, { mode: 'cut', items: [{ absPath: from, projectId: 'A', projectRoot: h.rootA }] }).result;
    await h.svc.applyUndo(r.undo!, 'undo');
    await h.svc.applyUndo(r.undo!, 'redo');
    expect(walked).toEqual([[{ from, to }], [{ from: to, to: from }], [{ from, to }]]);
  });

  it('an in-project move, its undo and its redo (files.move back and forth)', async () => {
    await put(join(h.rootB, 'a.md'), 'a');
    await put(join(h.rootB, 'dest', '.keep'), '');
    const at = join(h.rootB, 'a.md');
    const moved = join(h.rootB, 'dest', 'a.md');
    expect(await h.files.move(['a.md'], 'dest')).toEqual({ ok: true });
    expect(await h.files.move([join('dest', 'a.md')], '')).toEqual({ ok: true });
    expect(await h.files.move(['a.md'], 'dest')).toEqual({ ok: true });
    expect(walked).toEqual([[{ from: at, to: moved }], [{ from: moved, to: at }], [{ from: at, to: moved }]]);
  });

  it('a cut-paste that Replaces an existing file walks the moved pair', async () => {
    await disposeHarness(h);
    h = await makeHarness({ answer: () => ({ choice: 'replace' }) });
    walked = [];
    const callbacks = createInAppMoveCallbacks({
      coordinator: { beginMove: () => {}, markMoved: () => {} },
      previews: { beginMove: () => {}, moved: () => [], announcePath: () => {} },
      history: { rewritePaths: () => {}, announce: () => {} },
      broadcastFilesMoved: () => {},
      clipboard: { followMoves: () => {} },
      layouts: { followMoves: (moves) => void walked.push([...moves]) },
    });
    h.files.setOnMoveStarted(callbacks.started);
    h.files.setOnMoved(callbacks.moved);
    await put(join(h.rootA, 'b.md'), 'moved');
    await put(join(h.rootB, 'b.md'), 'replaced');
    const from = join(h.rootA, 'b.md');
    const to = join(h.rootB, 'b.md');

    await h.svc.paste(1, h.rootB, { mode: 'cut', items: [{ absPath: from, projectId: 'A', projectRoot: h.rootA }] }).result;

    expect(walked).toEqual([[{ from, to }]]);
  });

  it('a copy-paste moves nothing and walks nothing (FR-004)', async () => {
    await put(join(h.rootA, 'c.md'), 'c');
    await h.svc.paste(1, h.rootB, { mode: 'copy', items: [{ absPath: join(h.rootA, 'c.md'), projectId: 'A', projectRoot: h.rootA }] }).result;
    expect(walked).toEqual([]);
  });

  it('a walk that throws never fails the move that triggered it, and is only logged (FR-009)', async () => {
    walkThrows = true;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await put(join(h.rootB, 'a.md'), 'a');
    // The rename answers ok: the explorer raises nothing, because nothing failed that the user asked for.
    expect(await h.files.rename('a.md', 'b.md')).toEqual({ ok: true });
    expect(walked).toHaveLength(1);
    expect(logged).toHaveBeenCalledWith('[in-app-moves] layouts.followMoves threw:', expect.any(Error));
    logged.mockRestore();
  });

  // A roll-back closes the bracket with the pairs that still stand (`transfer-cancel.integration.test.ts`), and the
  // walk is handed exactly what `moved` is handed — proven above for every route — so it needs no case of its own.
});

describe('walkMovedLayouts — what main asks the daemon (R2, R4)', () => {
  const run = async (held: { projectIds: string[]; subWorkspaceIds: string[] }, changedSubs: string[]) => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const notified: string[] = [];
    const result = await walkMovedLayouts(
      {
        call: <T>(method: string, params: unknown) => {
          calls.push({ method, params });
          return Promise.resolve({ changedProjectIds: [], changedSubWorkspaceIds: changedSubs, skipped: 0 } as T);
        },
        held: () => Promise.resolve({ projectIds: new Set(held.projectIds), subWorkspaceIds: new Set(held.subWorkspaceIds) }),
        notifySubWorkspaceChanged: (id) => notified.push(id),
      },
      [{ from: 'D:/a/x.md', to: 'D:/a/y.md' }],
    );
    return { calls, notified, result };
  };

  it('one followMoves carrying the held set; each changed sub-workspace is announced', async () => {
    const { calls, notified } = await run({ projectIds: ['A'], subWorkspaceIds: ['s1'] }, ['s2']);
    expect(calls).toEqual([
      {
        method: 'workspace.followMoves',
        params: { moves: [{ from: 'D:/a/x.md', to: 'D:/a/y.md' }], held: { projectIds: ['A'], subWorkspaceIds: ['s1'] } },
      },
    ]);
    expect(notified).toEqual(['s2']);
  });

  // FR-008 — a loaded-but-inactive project is not held: only the active project and open sub-workspace windows are.
  it('a loaded-but-inactive project is not in the held set main builds', async () => {
    const { heldRecords } = await import('../../src/main/moved-layout-walk.js');
    const held = heldRecords(
      [
        { id: 'active', isActive: true },
        { id: 'loaded-inactive', isActive: false },
        { id: 'unloaded' },
      ],
      ['s1'],
    );
    expect([...held.projectIds]).toEqual(['active']);
    expect([...held.subWorkspaceIds]).toEqual(['s1']);
  });
});
