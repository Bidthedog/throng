import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { FilesService, type MovePair } from '../../src/main/files-service.js';

/**
 * `FilesService.exclusive` is THE file-operation queue (050 R2, FR-019e).
 *
 * The transfer engine runs every paste and drag inside it, so "file operations run one at a time"
 * is one queue rather than two that could interleave — and a rename or move the user starts while a
 * paste runs waits behind that paste, exactly as it already waits behind another move (019 FR-004).
 */

const shell = {
  revealInFileManager: async () => {},
  openFolder: async () => {},
  openExternal: async () => {},
} as unknown as ConstructorParameters<typeof FilesService>[1];

let root: string;
let svc: FilesService;

/** A promise plus the switch that settles it, so a test can hold an op open. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

const settle = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-exclusive-'));
  await mkdir(join(root, 'dest'));
  await writeFile(join(root, 'a.txt'), 'A');
  await writeFile(join(root, 'b.txt'), 'B');
  svc = new FilesService(new NodeFileSystem(async () => {}), shell);
  svc.setRoot(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('FilesService.exclusive (050 R2)', () => {
  it('runs two ops strictly one after the other', async () => {
    const log: string[] = [];
    const g = gate();
    const first = svc.exclusive(async () => {
      log.push('first:start');
      await g.promise;
      log.push('first:end');
      return 1;
    });
    const second = svc.exclusive(async () => {
      log.push('second:start');
      return 2;
    });
    await settle();
    expect(log).toEqual(['first:start']);
    g.open();
    expect(await first).toBe(1);
    expect(await second).toBe(2);
    expect(log).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('a rejecting op does not wedge the next', async () => {
    const failing = svc.exclusive(async () => {
      throw new Error('boom');
    });
    await expect(failing).rejects.toThrow('boom');
    expect(await svc.exclusive(async () => 'next')).toBe('next');
  });

  it('rename and move still queue behind an exclusive op', async () => {
    const g = gate();
    const held = svc.exclusive(async () => {
      await g.promise;
    });
    const renamed = svc.rename('a.txt', 'renamed.txt');
    const moved = svc.move(['b.txt'], 'dest');
    await settle();
    // Nothing may have happened on disk while the exclusive op holds the queue.
    expect(await svc.existsInProject('a.txt')).toBe(true);
    expect(await svc.existsInProject('b.txt')).toBe(true);
    g.open();
    await held;
    expect(await renamed).toEqual({ ok: true });
    expect(await moved).toEqual({ ok: true });
    expect(await svc.existsInProject('renamed.txt')).toBe(true);
    expect(await svc.existsInProject(join('dest', 'b.txt'))).toBe(true);
  });
});

describe('the transfer engine’s hooks into FilesService (050 T013)', () => {
  it('beginMoveBracket / endMoveBracket reach the move callbacks', () => {
    const started: (readonly string[])[] = [];
    const moved: (readonly MovePair[])[] = [];
    svc.setOnMoveStarted((p) => started.push(p));
    svc.setOnMoved((m) => moved.push(m));
    svc.beginMoveBracket(['X:/a']);
    svc.endMoveBracket([{ from: 'X:/a', to: 'Y:/a' }]);
    expect(started).toEqual([['X:/a']]);
    expect(moved).toEqual([[{ from: 'X:/a', to: 'Y:/a' }]]);
  });

  it('activeRoot reports the root the service holds', () => {
    expect(svc.activeRoot()).toBe(root);
    svc.setRoot(null);
    expect(svc.activeRoot()).toBeNull();
  });

  it('holderFor resolves an ABSOLUTE path, and a failing resolver is "not identified"', async () => {
    const asked: [string, number | undefined][] = [];
    svc.setHolderResolver(async (abs, win) => {
      asked.push([abs, win]);
      return { kind: 'terminal', where: 'here', label: 'bash' } as never;
    });
    const abs = join(root, 'a.txt');
    expect(await svc.holderFor(abs, 7)).toEqual({ kind: 'terminal', where: 'here', label: 'bash' });
    expect(asked).toEqual([[abs, 7]]);
    svc.setHolderResolver(async () => {
      throw new Error('gone');
    });
    expect(await svc.holderFor(abs)).toBeUndefined();
  });
});
