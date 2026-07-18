import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IFileSystem } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { ElectronShellIntegration } from '../../src/main/electron-shell-integration.js';
import { FilesService, type MovePair } from '../../src/main/files-service.js';

describe('FilesService mutations confined to the project root (004 T038/T046)', () => {
  let root: string;
  let svc: FilesService;
  let revealed: Array<{ op: 'reveal' | 'open'; path: string }>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'throng-svc-'));
    revealed = [];
    const fs = new NodeFileSystem((p) => rm(p, { recursive: true, force: true }));
    const shell = new ElectronShellIntegration({
      showItemInFolder: (p) => revealed.push({ op: 'reveal', path: p }),
      openPath: async (p) => {
        revealed.push({ op: 'open', path: p });
        return '';
      },
    });
    svc = new FilesService(fs, shell);
    svc.setRoot(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const write = async (rel: string, c = 'x'): Promise<void> => writeFile(join(root, rel), c);
  const names = async (rel = ''): Promise<string[]> =>
    (await readdir(join(root, rel))).sort();

  it('lists the root and a subfolder', async () => {
    await write('a.txt');
    await mkdir(join(root, 'sub'));
    const res = await svc.list('');
    expect('entries' in res && res.entries.map((e) => e.name).sort()).toEqual(['a.txt', 'sub']);
  });

  it('renames a file and rejects the root + collisions', async () => {
    await write('old.txt');
    await write('taken.txt');
    expect(await svc.rename('old.txt', 'new.txt')).toEqual({ ok: true });
    expect(await names()).toContain('new.txt');
    expect(await svc.rename('', 'x')).toMatchObject({ error: expect.any(String) });
    expect(await svc.rename('new.txt', 'taken.txt')).toMatchObject({ error: expect.any(String) });
    expect(await svc.rename('new.txt', 'a/b')).toMatchObject({ error: expect.any(String) });
  });

  it('moves into a folder, rejecting collisions and descendant drops', async () => {
    await write('f.txt');
    await mkdir(join(root, 'dest'));
    expect(await svc.move(['f.txt'], 'dest')).toEqual({ ok: true });
    expect(await names('dest')).toEqual(['f.txt']);

    await mkdir(join(root, 'tree'));
    await mkdir(join(root, 'tree', 'inner'));
    // Moving a folder into its own descendant is rejected.
    expect(await svc.move(['tree'], 'tree/inner')).toMatchObject({ error: expect.any(String) });
  });

  it('copies with a non-clobbering name on collision', async () => {
    await write('r.txt');
    await mkdir(join(root, 'dest'));
    await writeFile(join(root, 'dest', 'r.txt'), 'existing');
    expect(await svc.copy(['r.txt'], 'dest')).toEqual({ ok: true });
    expect(await names('dest')).toEqual(['r copy.txt', 'r.txt']);
  });

  it('deletes via recycle (default) and permanent', async () => {
    await write('bin.txt');
    await write('gone.txt');
    expect(await svc.delete(['bin.txt'], 'recycle')).toEqual({ ok: true });
    expect(await svc.delete(['gone.txt'], 'permanent')).toEqual({ ok: true });
    expect(await names()).toEqual([]);
    expect(await svc.delete([''], 'recycle')).toMatchObject({ error: expect.any(String) });
  });

  it('creates a new folder with a de-duplicated name', async () => {
    const first = await svc.newFolder('');
    expect(first).toEqual({ relPath: 'New folder' });
    const second = await svc.newFolder('');
    expect(second).toEqual({ relPath: 'New folder (2)' });
  });

  it('creates a new (empty) file with a de-duplicated name, in a subfolder (FR-096)', async () => {
    await mkdir(join(root, 'sub'));
    const first = await svc.newFile('sub');
    expect(first).toEqual({ relPath: 'sub/New file.txt' }); // joinRel uses '/'
    const second = await svc.newFile('sub');
    expect(second).toEqual({ relPath: 'sub/New file (2).txt' });
    expect(await names('sub')).toEqual(['New file (2).txt', 'New file.txt']);
    // It is a real, empty file.
    const res = await svc.list('sub');
    expect('entries' in res && res.entries.every((e) => e.kind === 'file')).toBe(true);
  });

  it('newFile rejects a destination outside the root', async () => {
    expect(await svc.newFile('../escape')).toMatchObject({ error: expect.any(String) });
  });

  it('reveals a file (select in parent) and opens a folder (contents)', async () => {
    await write('f.txt');
    await mkdir(join(root, 'd'));
    expect(await svc.reveal('f.txt')).toEqual({ ok: true });
    expect(await svc.reveal('d')).toEqual({ ok: true });
    expect(revealed.map((r) => r.op)).toEqual(['reveal', 'open']);
  });

  it('rejects targets outside the project root', async () => {
    expect(await svc.list('..')).toMatchObject({ error: expect.any(String) });
    await write('f.txt');
    expect(await svc.move(['f.txt'], '../..')).toMatchObject({ error: expect.any(String) });
  });
});

/**
 * The move SIGNAL (019 / #87, contracts/move-signal.md §1) — the half the E2E cannot see.
 *
 * `delete` has announced itself since 004 (`removed[]` → `this.onDeleted?.(removed)`,
 * files-service.ts:140-165). `move` announces nothing, so an in-app move is invisible to the
 * editor coordinator and the folder watch is left to infer a DELETION from the file's absence —
 * which force-dirties the buffer and invites the save that undoes the move.
 *
 * These pin the three things the E2E cannot reach:
 *   • the bracket OPENS before the first `fs.move` and always CLOSES (a bracket that leaks leaves
 *     a document `movePending` forever, and it can then never be dirtied by a genuine external
 *     delete — the AC7 behaviour, lost silently);
 *   • what is announced is what ACTUALLY moved, never what was asked for (`move` returns on the
 *     first disallowed item, `:100-105`, so a half-succeeded batch is the ordinary case);
 *   • a rename is a move (FR-006) and has #87's hole identically (`:62-82`).
 */
describe('FilesService announces the moves it actually performed (019 / #87)', () => {
  let root: string;
  let fs: NodeFileSystem;
  let svc: FilesService;
  /** One ordered log of the callbacks AND the filesystem calls, so "before" is a fact. */
  let log: string[];
  let started: string[][];
  let moved: MovePair[][];

  const shell = new ElectronShellIntegration({
    showItemInFolder: () => {},
    openPath: async () => '',
  });

  /** `fs`, with its mutations logged — and, optionally, made to fail. */
  const spyFs = (fail?: (src: string) => Error | undefined): IFileSystem => {
    const spy: IFileSystem = Object.create(fs);
    spy.move = async (src: string, destDir: string): Promise<string> => {
      log.push(`fs.move:${basename(src)}`);
      const boom = fail?.(src);
      if (boom) throw boom;
      return fs.move(src, destDir);
    };
    spy.rename = async (path: string, newName: string): Promise<string> => {
      log.push(`fs.rename:${basename(path)}`);
      const boom = fail?.(path);
      if (boom) throw boom;
      return fs.rename(path, newName);
    };
    return spy;
  };

  const serviceOver = (backing: IFileSystem): FilesService => {
    const s = new FilesService(backing, shell);
    s.setRoot(root);
    s.setOnMoveStarted((paths) => {
      log.push('onMoveStarted');
      started.push([...paths]);
    });
    s.setOnMoved((pairs) => {
      log.push('onMoved');
      moved.push([...pairs]);
    });
    return s;
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'throng-mvsig-'));
    log = [];
    started = [];
    moved = [];
    fs = new NodeFileSystem((p) => rm(p, { recursive: true, force: true }));
    // Over the LOGGING fs: "the signal came before the move" is only a fact if both are on one
    // clock. The moves themselves are real — the spy delegates.
    svc = serviceOver(spyFs());
    await mkdir(join(root, 'dest'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const write = async (rel: string, c = 'x'): Promise<void> => writeFile(join(root, rel), c);

  it('opens the bracket BEFORE the first fs.move and closes it after the last (FR-004)', async () => {
    await write('a.txt');
    await write('b.txt');

    expect(await svc.move(['a.txt', 'b.txt'], 'dest')).toEqual({ ok: true });

    // The order IS the requirement: a watcher that sees the file gone before the signal
    // arrives infers a delete, and #87 is back.
    expect(log).toEqual(['onMoveStarted', 'fs.move:a.txt', 'fs.move:b.txt', 'onMoved']);
    expect(started).toEqual([[join(root, 'a.txt'), join(root, 'b.txt')]]);
    expect(moved).toEqual([
      [
        { from: join(root, 'a.txt'), to: join(root, 'dest', 'a.txt') },
        { from: join(root, 'b.txt'), to: join(root, 'dest', 'b.txt') },
      ],
    ]);
  });

  it('announces only what ACTUALLY moved when the batch half-succeeds', async () => {
    await write('a.txt');
    await write('b.txt');
    await writeFile(join(root, 'dest', 'b.txt'), 'occupied'); // b collides; move returns there

    expect(await svc.move(['a.txt', 'b.txt'], 'dest')).toMatchObject({ error: expect.any(String) });

    // Both were ASKED for; only `a.txt` moved. Announcing the request would re-point an editor
    // onto a path its file never reached.
    expect(started).toEqual([[join(root, 'a.txt'), join(root, 'b.txt')]]);
    expect(moved).toEqual([[{ from: join(root, 'a.txt'), to: join(root, 'dest', 'a.txt') }]]);
  });

  it('closes the bracket on the early error return and on a thrown failure', async () => {
    await write('a.txt');
    const thrower = serviceOver(spyFs(() => new Error('EPERM: locked')));

    expect(await thrower.move(['a.txt'], 'dest')).toMatchObject({ error: expect.any(String) });

    // The `finally` is the whole point: a bracket that never closes leaves the doc movePending
    // forever, and a genuine external delete could then never dirty it again.
    expect(log).toEqual(['onMoveStarted', 'fs.move:a.txt', 'onMoved']);
    expect(moved).toEqual([[]]); // nothing moved — and it says so, rather than saying nothing
  });

  it('announces no move for a same-folder drop (:98-99)', async () => {
    await write('same.txt');

    expect(await svc.move(['same.txt'], '')).toEqual({ ok: true });

    // The bracket may open and close (it costs nothing and cannot mis-fire), but nothing MOVED,
    // so no pair is announced and no editor is re-pointed.
    expect(moved).toEqual([[]]);
    expect(log).not.toContain('fs.move:same.txt');
  });

  it('announces a rename as the move it is (FR-006)', async () => {
    await write('old.txt');

    expect(await svc.rename('old.txt', 'new.txt')).toEqual({ ok: true });

    expect(log).toEqual(['onMoveStarted', 'fs.rename:old.txt', 'onMoved']);
    expect(started).toEqual([[join(root, 'old.txt')]]);
    expect(moved).toEqual([[{ from: join(root, 'old.txt'), to: join(root, 'new.txt') }]]);
  });

  it('announces nothing for the no-op rename (:72)', async () => {
    await write('same.txt');

    expect(await svc.rename('same.txt', 'same.txt')).toEqual({ ok: true });

    expect(log).toEqual([]);
    expect(started).toEqual([]);
    expect(moved).toEqual([]);
  });

  it('closes the bracket when a rename throws', async () => {
    await write('old.txt');
    const thrower = serviceOver(spyFs(() => new Error('EPERM: locked')));

    expect(await thrower.rename('old.txt', 'new.txt')).toMatchObject({ error: expect.any(String) });

    expect(log).toEqual(['onMoveStarted', 'fs.rename:old.txt', 'onMoved']);
    expect(moved).toEqual([[]]);
  });
});
