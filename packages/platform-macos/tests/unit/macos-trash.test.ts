import { describe, expect, it } from 'vitest';
import { MacosTrash, PUT_BACK_HINT, outcomeOf } from '../../src/macos-trash.js';

const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

/** A Trash that records moves, with the file system's answers injected. */
function trashWith(opts: { move?: (from: string, to: string) => Promise<void>; present?: Set<string> } = {}) {
  const present = opts.present ?? new Set<string>();
  const moves: [string, string][] = [];
  let n = 0;
  const trash = new MacosTrash({
    trashItem: async (path) => {
      n += 1;
      present.delete(path);
      const into = `/Users/dev/.Trash/${path.slice(path.lastIndexOf('/') + 1)} ${n}`;
      present.add(into);
      return into;
    },
    move:
      opts.move ??
      (async (from, to) => {
        moves.push([from, to]);
        present.delete(from);
        present.add(to);
      }),
    exists: async (path) => present.has(path),
    now: () => 1000 * n,
  });
  return { trash, moves, present };
}

describe('MacosTrash (070 FR-022, research R6)', () => {
  it('puts an item back where it was, from where the Trash says it went', async () => {
    const { trash, moves } = trashWith();
    await trash.trash('/Users/dev/p/a.txt');
    await trash.restore('/Users/dev/p/a.txt', Date.now());
    expect(moves).toEqual([['/Users/dev/.Trash/a.txt 1', '/Users/dev/p/a.txt']]);
  });

  it('picks the deletion closest at or before the one asked about, when one path was deleted twice', async () => {
    const { trash, moves, present } = trashWith();
    await trash.trash('/Users/dev/p/a.txt'); // at 1000
    present.delete('/Users/dev/p/a.txt');
    await trash.trash('/Users/dev/p/a.txt'); // at 2000
    await trash.restore('/Users/dev/p/a.txt', 1500);
    expect(moves[0]?.[0]).toBe('/Users/dev/.Trash/a.txt 1');
  });

  it('refuses, with a reason, to restore what it never trashed', async () => {
    await expect(trashWith().trash.restore('/Users/dev/p/never.txt', Date.now())).rejects.toThrow(/no longer in the Trash/);
  });

  it('never replaces what now stands at the original path', async () => {
    const { trash, present } = trashWith();
    await trash.trash('/Users/dev/p/a.txt');
    present.add('/Users/dev/p/a.txt');
    await expect(trash.restore('/Users/dev/p/a.txt', Date.now())).rejects.toThrow(/already exists/);
  });

  it('says the item is in the Trash and Finder’s Put Back restores it, when macOS refuses the move (EPERM, EACCES)', async () => {
    for (const code of ['EPERM', 'EACCES']) {
      const { trash } = trashWith({ move: () => Promise.reject(errno(code)) });
      await trash.trash('/Users/dev/p/a.txt');
      const failure = await trash.restore('/Users/dev/p/a.txt', Date.now()).then(
        () => null,
        (error: unknown) => error as NodeJS.ErrnoException,
      );
      expect(failure?.message).toContain(PUT_BACK_HINT);
      expect(failure?.message).toContain('a.txt');
      expect(failure?.code).toBe(code);
    }
  });

  it('passes any other failure on as it is', async () => {
    const { trash } = trashWith({ move: () => Promise.reject(errno('EIO')) });
    await trash.trash('/Users/dev/p/a.txt');
    await expect(trash.restore('/Users/dev/p/a.txt', Date.now())).rejects.toThrow('EIO');
  });
});

/**
 * Each `osascript` costs about a third of a second, so deleting 200 files one run each took a minute. Calls made in the
 * same turn of the event loop share one run, and each caller still hears its own item's outcome.
 */
describe('MacosTrash batching', () => {
  function batchingTrash(refuse: ReadonlySet<string> = new Set()) {
    const runs: string[][] = [];
    const moves: [string, string][] = [];
    const trash = new MacosTrash({
      trashItems: async (paths) => {
        runs.push([...paths]);
        return paths.map((p) => (refuse.has(p) ? new Error(`macOS would not move ${p}`) : `/Users/dev/.Trash/${p.split('/').at(-1)}`));
      },
      move: async (from, to) => {
        moves.push([from, to]);
      },
      exists: async (path) => path.startsWith('/Users/dev/.Trash/'),
      now: () => 1000,
    });
    return { trash, runs, moves };
  }

  it('trashes the items asked for in one turn with one run, and settles each caller on its own item', async () => {
    const { trash, runs } = batchingTrash(new Set(['/p/locked.txt']));
    const outcomes = await Promise.allSettled(['/p/a.txt', '/p/locked.txt', '/p/b.txt'].map((p) => trash.trash(p)));
    expect(runs).toEqual([['/p/a.txt', '/p/locked.txt', '/p/b.txt']]);
    expect(outcomes.map((o) => o.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect((outcomes[1] as PromiseRejectedResult).reason).toEqual(new Error('macOS would not move /p/locked.txt'));
  });

  it('keeps a restore record for each item of a batch, and none for the one refused', async () => {
    const { trash, moves } = batchingTrash(new Set(['/p/locked.txt']));
    await Promise.allSettled(['/p/a.txt', '/p/locked.txt', '/p/b.txt'].map((p) => trash.trash(p)));
    await trash.restore('/p/b.txt', 2000);
    await trash.restore('/p/a.txt', 2000);
    expect(moves).toEqual([
      ['/Users/dev/.Trash/b.txt', '/p/b.txt'],
      ['/Users/dev/.Trash/a.txt', '/p/a.txt'],
    ]);
    await expect(trash.restore('/p/locked.txt', 2000)).rejects.toThrow(/no longer in the Trash/);
  });

  it('starts a new run for items asked for after the last one was sent', async () => {
    const { trash, runs } = batchingTrash();
    await trash.trash('/p/a.txt');
    await trash.trash('/p/b.txt');
    expect(runs).toEqual([['/p/a.txt'], ['/p/b.txt']]);
  });

  it('rejects every caller of a run that failed as a whole', async () => {
    const trash = new MacosTrash({ trashItems: () => Promise.reject(new Error('osascript is missing')) });
    const outcomes = await Promise.allSettled(['/p/a', '/p/b'].map((p) => trash.trash(p)));
    expect(outcomes.map((o) => (o.status === 'rejected' ? (o.reason as Error).message : 'ok'))).toEqual([
      'osascript is missing',
      'osascript is missing',
    ]);
  });
});

describe('the Trash\u2019s answer (070 R6)', () => {
  it('is the path the Trash gave the item', () => {
    expect(outcomeOf({ ok: true, path: '/Users/dev/.Trash/a 2.txt' })).toBe('/Users/dev/.Trash/a 2.txt');
  });

  it('keeps the system\u2019s words when it refused, and its code when it gave none', () => {
    expect((outcomeOf({ ok: false, code: 513, message: 'You don\u2019t have permission.' }) as Error).message).toMatch(/permission/);
    expect((outcomeOf({ ok: false, code: 513, message: '' }) as Error).message).toMatch(/error 513/);
  });

  it('is a failure, never a guess, when the path is not one or Foundation could not be loaded', () => {
    expect(outcomeOf({ ok: true, path: 'relative' })).toBeInstanceOf(Error);
    expect((outcomeOf(null) as Error).message).toMatch(/Foundation/);
  });
});
