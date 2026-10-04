import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PROGRESS_MIN_BYTES, type ClipboardItem, type IFileSystem, type TransferProgress } from '@throng/core';
import { disposeHarness, FsDecorator, makeHarness, put, type Harness, type HarnessOptions } from './helpers/transfer-harness.js';

/**
 * A paste's progress by bytes (050 FR-039, SC-014, research R23 — T110).
 *
 * Every progress event carries `bytesTotal` — null until main has sized the job, the job's total after —
 * and `bytesDone`, which rises per file copied and, for a large file, per chunk of it. At every event the
 * figure is within one file of what is actually on disk in the target, and it ends equal to the total.
 * A cut within a volume is a rename: its bytes count when the item lands. A cross-volume cut counts its
 * copy; the delete that follows adds none.
 */

let h: Harness;

/** Bytes of every file under `dir`, synchronously — read at the instant an event is sent. */
function diskBytes(dir: string): number {
  let total = 0;
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      total += e.isDirectory() ? diskBytes(p) : statSync(p).size;
    }
  } catch {
    // Not there yet.
  }
  return total;
}

/** Each event, with the bytes on disk under `dest` at the moment it was sent. */
let events: { p: TransferProgress; disk: number }[];
let dest: string;

async function setup(opts: HarnessOptions = {}): Promise<void> {
  events = [];
  // No throttle: every byte report becomes an event, so the test can see each one (R23).
  h = await makeHarness({ ...opts, deps: { progressTickMs: 0, ...opts.deps } });
  dest = join(h.rootB, 'dest');
  await put(join(dest, '.keep'), '');
  const record = h.progress;
  const push = record.push.bind(record);
  record.push = (...items) => {
    for (const it of items) events.push({ p: it.p, disk: diskBytes(dest) });
    return push(...items);
  };
}

afterEach(async () => {
  await disposeHarness(h);
});

const fromA = (...names: string[]): ClipboardItem[] =>
  names.map((n) => ({ absPath: join(h.rootA, n), projectId: 'A', projectRoot: h.rootA }));

const paste = (mode: 'copy' | 'cut', ...names: string[]) => h.svc.paste(1, dest, { mode, items: fromA(...names) });

function last(): TransferProgress {
  return events[events.length - 1]!.p;
}

describe('bytesTotal (FR-039)', () => {
  it('is null before the job is sized and the job total after', async () => {
    await setup();
    await put(join(h.rootA, 'a.txt'), 'x'.repeat(100));
    await put(join(h.rootA, 'd', 'b.txt'), 'y'.repeat(250));
    await paste('copy', 'a.txt', 'd').result;
    expect(events[0]!.p.bytesTotal).toBeNull();
    expect(events[0]!.p.bytesDone).toBe(0);
    const sized = events.filter((e) => e.p.bytesTotal !== null);
    expect(sized.length).toBeGreaterThan(0);
    expect(new Set(sized.map((e) => e.p.bytesTotal))).toEqual(new Set([350]));
  });

  it('counts an item selected inside another selected folder once', async () => {
    await setup();
    await put(join(h.rootA, 'd', 'b.txt'), 'y'.repeat(250));
    await paste('copy', 'd', 'd/b.txt').result;
    expect(last().bytesTotal).toBe(250);
    expect(last().bytesDone).toBe(250);
  });
});

describe('bytesDone (FR-039, SC-014)', () => {
  it('rises per file of a folder and stays within one file of the disk', async () => {
    await setup();
    const sizes = [300, 500, 700, 900];
    for (const [i, n] of sizes.entries()) await put(join(h.rootA, 'd', `f${i}.bin`), Buffer.alloc(n, i));
    await paste('copy', 'd').result;
    const done = events.map((e) => e.p.bytesDone);
    // One value per file landed — not one jump at the end of the folder.
    for (const at of [300, 800, 1500, 2400]) expect(done).toContain(at);
    for (const e of events) expect(Math.abs(e.p.bytesDone - e.disk)).toBeLessThanOrEqual(Math.max(...sizes));
    expect(last().bytesDone).toBe(2400);
    expect(last().bytesTotal).toBe(2400);
  });

  it('rises per chunk of a large file', async () => {
    await setup();
    const big = PROGRESS_MIN_BYTES + 1024 * 1024;
    await put(join(h.rootA, 'big.bin'), Buffer.alloc(big, 7));
    await paste('copy', 'big.bin').result;
    const between = new Set(events.map((e) => e.p.bytesDone).filter((b) => b > 0 && b < big));
    expect(between.size).toBeGreaterThan(2);
    for (const e of events) expect(Math.abs(e.p.bytesDone - e.disk)).toBeLessThanOrEqual(big);
    const done = events.map((e) => e.p.bytesDone);
    expect(done).toEqual([...done].sort((a, b) => a - b));
    expect(last().bytesDone).toBe(big);
  });

  it('ends at the total when an item is skipped at a clash', async () => {
    await setup({ answer: () => ({ choice: 'skip', applyToAll: false }) });
    await put(join(h.rootA, 'a.txt'), 'x'.repeat(100));
    await put(join(h.rootA, 'clash.txt'), 'y'.repeat(40));
    await put(join(dest, 'clash.txt'), 'existing');
    await paste('copy', 'clash.txt', 'a.txt').result;
    expect(last().bytesTotal).toBe(140);
    expect(last().bytesDone).toBe(140);
  });

  it('a cut within a volume counts its bytes when the item lands', async () => {
    await setup();
    await put(join(h.rootA, 'a.txt'), 'x'.repeat(100));
    await put(join(h.rootA, 'b.txt'), 'y'.repeat(60));
    await paste('cut', 'a.txt', 'b.txt').result;
    expect(events.map((e) => e.p.bytesDone)).toContain(100);
    expect(last().bytesDone).toBe(160);
    expect(last().bytesTotal).toBe(160);
  });

  it('a cross-volume cut counts its copy; the delete adds none', async () => {
    class OtherVolume extends FsDecorator {
      override async move(src: string): Promise<string> {
        throw Object.assign(new Error(`EXDEV: cross-device link not permitted, rename '${src}'`), { code: 'EXDEV' });
      }
    }
    await setup({ wrapFs: (inner: IFileSystem) => new OtherVolume(inner) });
    await put(join(h.rootA, 'd', 'a.txt'), 'x'.repeat(100));
    await put(join(h.rootA, 'd', 'b.txt'), 'y'.repeat(60));
    await paste('cut', 'd').result;
    expect(Math.max(...events.map((e) => e.p.bytesDone))).toBe(160);
    expect(last().bytesDone).toBe(160);
    expect(last().bytesTotal).toBe(160);
  });
});

describe('"N of M files" (FR-039)', () => {
  it('filesTotal is null before sizing, then counts the files of the plan — a folder its files, not itself', async () => {
    await setup();
    await put(join(h.rootA, 'a.txt'), 'a');
    await put(join(h.rootA, 'd', 'b.txt'), 'b');
    await put(join(h.rootA, 'd', 'e', 'c.txt'), 'c');
    // `d/b.txt` travels inside `d`: counted once.
    await paste('copy', 'a.txt', 'd', 'd/b.txt').result;
    expect(events[0]!.p.filesTotal).toBeNull();
    expect(events[0]!.p.filesDone).toBe(0);
    const sized = events.filter((e) => e.p.filesTotal !== null);
    expect(new Set(sized.map((e) => e.p.filesTotal))).toEqual(new Set([3]));
  });

  it('filesDone rises per file landed, one at a time, and ends at the total', async () => {
    await setup();
    for (const i of [0, 1, 2, 3]) await put(join(h.rootA, 'd', `f${i}.txt`), `${i}`);
    await paste('copy', 'd').result;
    const done = events.map((e) => e.p.filesDone);
    for (const n of [1, 2, 3, 4]) expect(done).toContain(n);
    expect(done).toEqual([...done].sort((a, b) => a - b));
    expect(last()).toMatchObject({ filesDone: 4, filesTotal: 4 });
  });

  it('a skipped file and a renamed cut each count as done', async () => {
    await setup({ answer: () => ({ choice: 'skip', applyToAll: false }) });
    await put(join(h.rootA, 'clash.txt'), 'incoming');
    await put(join(dest, 'clash.txt'), 'existing');
    await put(join(h.rootA, 'd', 'x.txt'), 'x');
    await put(join(h.rootA, 'd', 'y.txt'), 'y');
    await paste('cut', 'clash.txt', 'd').result;
    expect(last()).toMatchObject({ filesDone: 3, filesTotal: 3 });
  });

  it('a failed item counts its files as done', async () => {
    await setup();
    await put(join(h.rootA, 'a.txt'), 'a');
    await put(join(h.rootB, 'dest', 'blocker'), 'a file where a folder is needed');
    await put(join(h.rootA, 'blocker', 'in.txt'), 'in');
    await put(join(h.rootA, 'top.txt'), 'top');
    const r = await paste('copy', 'a.txt', 'blocker/in.txt', 'top.txt').result;
    expect(r.failures).toHaveLength(1);
    expect(last()).toMatchObject({ filesDone: 3, filesTotal: 3 });
  });
});
