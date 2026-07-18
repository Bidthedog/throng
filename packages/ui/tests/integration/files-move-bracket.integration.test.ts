import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IFileSystem } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { FilesService, type MovePair } from '../../src/main/files-service.js';

/**
 * The move BRACKET is a bracket — one that opens must close, and it must close over the move that
 * opened it (019, FR-004 · contracts/move-signal.md §1).
 *
 * `beginMove` sets `movePending` on the docs a move names; `markMoved` clears it on EVERY open doc.
 * That close is only exact while one bracket is open at a time — and nothing made that true.
 * `move` and `rename` are plain `ipcMain.handle`s (files-ipc.ts), each item of a multi-file drag is
 * its own awaited `fs.move`, and a rename landing mid-batch closed the batch's bracket for it. The
 * next `fs.move` in the batch then let the folder watch reach `markDeleted`: a buffer nobody edited
 * force-dirtied, a recovery snapshot written for it, and #87's symptom back on a path the fix was
 * supposed to have closed.
 *
 * The bracket is now EXCLUSIVE: the two operations that own one run one at a time, so "clear every
 * doc" is exactly "clear the docs this bracket opened". No timer decides it (FR-004/FR-011) — it is
 * a queue, and it holds however long the filesystem takes.
 */

const shell = {
  revealInFileManager: async () => {},
  openFolder: async () => {},
} as unknown as ConstructorParameters<typeof FilesService>[1];

type Event = { kind: 'started'; paths: readonly string[] } | { kind: 'moved'; moves: readonly MovePair[] };

/** A filesystem whose `move` can be held open, so a second operation can try to interleave. */
class GatedFs implements IFileSystem {
  private gate: Promise<void> | null = null;

  private open?: () => void;

  moves = 0;

  constructor(private readonly inner: IFileSystem) {}

  /** Hold every `move` until {@link release} is called. */
  hold(): void {
    this.gate = new Promise<void>((resolve) => {
      this.open = resolve;
    });
  }

  release(): void {
    this.open?.();
    this.gate = null;
  }

  async move(src: string, destDir: string): Promise<string> {
    this.moves++;
    if (this.gate) await this.gate;
    return this.inner.move(src, destDir);
  }

  list = (d: string) => this.inner.list(d);
  mkdir = (p: string) => this.inner.mkdir(p);
  stat = (p: string) => this.inner.stat(p);
  realpath = (p: string) => this.inner.realpath(p);
  rename = (p: string, n: string) => this.inner.rename(p, n);
  copy = (s: string, d: string, n?: string) => this.inner.copy(s, d, n);
  delete = (p: string) => this.inner.delete(p);
  trash = (p: string) => this.inner.trash(p);
  exists = (p: string) => this.inner.exists(p);
  readBytes = (p: string) => this.inner.readBytes(p);
  writeBytes = (p: string, b: Uint8Array) => this.inner.writeBytes(p, b);
  size = (p: string) => this.inner.size(p);
}

let root: string;
let fs: GatedFs;
let svc: FilesService;
let events: Event[];

const settle = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-bracket-'));
  await mkdir(join(root, 'dest'));
  await writeFile(join(root, 'a.txt'), 'A');
  await writeFile(join(root, 'b.txt'), 'B');
  await writeFile(join(root, 'other.txt'), 'OTHER');
  fs = new GatedFs(new NodeFileSystem(async () => {}));
  svc = new FilesService(fs, shell);
  svc.setRoot(root);
  events = [];
  svc.setOnMoveStarted((paths) => events.push({ kind: 'started', paths }));
  svc.setOnMoved((moves) => events.push({ kind: 'moved', moves }));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('the move bracket is exclusive (FR-004)', () => {
  it('a rename cannot close a multi-file move’s bracket from underneath it', async () => {
    fs.hold(); // the batch's first `fs.move` is in flight and has not resolved
    const batch = svc.move(['a.txt', 'b.txt'], 'dest');
    await settle();
    expect(events).toEqual([{ kind: 'started', paths: [join(root, 'a.txt'), join(root, 'b.txt')] }]);

    // The user renames a different file while the drag is still landing.
    const renamed = svc.rename('other.txt', 'renamed.txt');
    await settle();

    // The batch's bracket is STILL OPEN, so nothing may have closed it — not the rename's
    // `markMoved`, and not the rename's bracket opening inside it.
    expect(events).toEqual([{ kind: 'started', paths: [join(root, 'a.txt'), join(root, 'b.txt')] }]);

    fs.release();
    expect(await batch).toEqual({ ok: true });
    expect(await renamed).toEqual({ ok: true });

    // Two brackets, one after the other — never nested, never crossed.
    expect(events.map((e) => e.kind)).toEqual(['started', 'moved', 'started', 'moved']);
    expect(events[1]).toEqual({
      kind: 'moved',
      moves: [
        { from: join(root, 'a.txt'), to: join(root, 'dest', 'a.txt') },
        { from: join(root, 'b.txt'), to: join(root, 'dest', 'b.txt') },
      ],
    });
    expect(events[3]).toEqual({
      kind: 'moved',
      moves: [{ from: join(root, 'other.txt'), to: join(root, 'renamed.txt') }],
    });
  });

  it('two concurrent moves announce one at a time, and both still move their files', async () => {
    fs.hold();
    const first = svc.move(['a.txt'], 'dest');
    await settle();
    const second = svc.move(['b.txt'], 'dest');
    await settle();
    expect(fs.moves).toBe(1); // the second batch has not touched the filesystem yet

    fs.release();
    expect(await first).toEqual({ ok: true });
    expect(await second).toEqual({ ok: true });
    expect(events.map((e) => e.kind)).toEqual(['started', 'moved', 'started', 'moved']);
  });
});

describe('a bracket that opens always closes (FR-004)', () => {
  it('rename closes its bracket even when the coordinator’s callback throws', async () => {
    // `move` guards this with `bracketOpen`; `rename` announced the start OUTSIDE the try that owns
    // the finally, so a throwing callback left every matched doc `movePending` for the rest of the
    // session — and a doc that is permanently mid-move can never again be dirtied by a genuine
    // external delete (FR-009/AC7 lost, silently).
    svc.setOnMoveStarted(() => {
      throw new Error('the coordinator blew up');
    });
    const result = await svc.rename('other.txt', 'renamed.txt');

    expect('error' in result).toBe(true);
    expect(events).toEqual([{ kind: 'moved', moves: [] }]); // closed, announcing nothing
  });

  it('a rename that the filesystem refuses closes the bracket announcing nothing', async () => {
    await writeFile(join(root, 'taken.txt'), 'X');
    const result = await svc.rename('other.txt', 'taken.txt'); // collides
    expect('error' in result).toBe(true);
    // Refused before the bracket ever opened — so there is nothing to close, and nothing announced.
    expect(events).toEqual([]);
  });

  it('the no-op rename (same name) announces nothing at all', async () => {
    expect(await svc.rename('other.txt', 'other.txt')).toEqual({ ok: true });
    expect(events).toEqual([]);
  });
});
