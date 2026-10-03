import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { PROGRESS_MIN_BYTES, PROGRESS_WORK_MS, type ClashAnswer, type ClipboardItem, type TransferProgress } from '@throng/core';
import { disposeHarness, FsDecorator, gate, makeHarness, put, settle, type Harness } from './helpers/transfer-harness.js';

/**
 * When a paste's progress shows (050 FR-031, research R14, SC-009 — T077).
 *
 * Main decides and says so on every progress event as `display`: a paste of more than 5 MB, once it has
 * spent 1 s of its OWN work — time a clash question or the cancel choice is open does not count. A
 * queued paste shows at once. A drag never reports progress at all.
 */

/** Holds the copy of `big.bin` for `holdMs` once it starts, so the job is "working" for that long. */
class HeldBig extends FsDecorator {
  holdMs = 0;
  started = gate();
  release = gate();
  override async copyFileCancellable(s: string, d: string, signal: AbortSignal): Promise<void> {
    if (s.endsWith('big.bin')) {
      this.started.open();
      await Promise.race([
        new Promise<void>((r) => setTimeout(r, this.holdMs)),
        new Promise<void>((r) => signal.addEventListener('abort', () => r(), { once: true })),
        this.release.promise,
      ]);
    }
    return super.copyFileCancellable(s, d, signal);
  }
}

let h: Harness;
let fs: HeldBig;
/** Each progress event with when it arrived. */
let timeline: { at: number; p: TransferProgress }[];
let answer: (q: unknown) => Promise<ClashAnswer>;

const BIG = Buffer.alloc(PROGRESS_MIN_BYTES + 1024 * 1024, 7);

async function setup(): Promise<void> {
  timeline = [];
  answer = async () => ({ choice: 'skip' });
  h = await makeHarness({
    wrapFs: (inner) => (fs = new HeldBig(inner)),
    answer: (q) => answer(q),
  });
  // Record arrival time alongside the harness's own record.
  const record = h.progress;
  const push = record.push.bind(record);
  record.push = (...items) => {
    for (const it of items) timeline.push({ at: performance.now(), p: it.p });
    return push(...items);
  };
  await put(join(h.rootA, 'small.txt'), 'small');
  await put(join(h.rootA, 'clash.txt'), 'incoming');
  await put(join(h.rootA, 'big.bin'), BIG);
  await put(join(h.rootB, 'dest', 'clash.txt'), 'existing');
}

afterEach(async () => {
  await disposeHarness(h);
});

const fromA = (...names: string[]): ClipboardItem[] =>
  names.map((n) => ({ absPath: join(h.rootA, n), projectId: 'A', projectRoot: h.rootA }));

const paste = (...names: string[]) => h.svc.paste(1, join(h.rootB, 'dest'), { mode: 'copy', items: fromA(...names) });

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Every event for `jobId` carries `display`, and once true it never goes back. */
function expectMonotonic(jobId: string): void {
  const flags = timeline.filter((e) => e.p.jobId === jobId).map((e) => e.p.display);
  expect(flags.every((f) => typeof f === 'boolean')).toBe(true);
  const first = flags.indexOf(true);
  if (first >= 0) expect(flags.slice(first).every((f) => f)).toBe(true);
}

describe('a paste of 5 MB or less (FR-031)', () => {
  it('never shows, even with a clash question held open for 2 s', async () => {
    await setup();
    answer = async () => {
      await delay(2000);
      return { choice: 'skip' };
    };
    const run = paste('clash.txt', 'small.txt');
    const r = await run.result;
    expect(r.failures).toEqual([]);
    expect(h.questions).toHaveLength(1);
    expect(timeline.length).toBeGreaterThan(0);
    expect(timeline.map((e) => e.p.display)).not.toContain(true);
    expectMonotonic(run.jobId);
  });

  it('never shows however long its own work takes', async () => {
    await setup();
    // A small file that is slow to copy: the size, not the time, keeps the card away.
    await put(join(h.rootA, 'big.bin'), 'tiny now');
    fs.holdMs = PROGRESS_WORK_MS + 300;
    const r = await paste('big.bin').result;
    expect(r.failures).toEqual([]);
    expect(timeline.map((e) => e.p.display)).not.toContain(true);
  });
});

describe('a paste of more than 5 MB (FR-031, SC-009)', () => {
  it('shows only after 1 s of work, and keeps showing', async () => {
    await setup();
    fs.holdMs = PROGRESS_WORK_MS + 500;
    const t0 = performance.now();
    const run = paste('big.bin');
    await fs.started.promise;
    // Work is under way but well short of the second: not yet.
    await delay(PROGRESS_WORK_MS / 2);
    expect(timeline.map((e) => e.p.display)).not.toContain(true);
    await run.result;
    const shown = timeline.find((e) => e.p.display);
    expect(shown, 'a display: true event').toBeDefined();
    expect(shown!.at - t0).toBeGreaterThanOrEqual(PROGRESS_WORK_MS - 5);
    // It came while the copy was still going — not as a by-product of the job finishing.
    expect(shown!.p.state).toBe('running');
    expectMonotonic(run.jobId);
  });

  it('does not count the time a clash question is open', async () => {
    await setup();
    let answeredAt = 0;
    answer = async () => {
      await delay(1500);
      answeredAt = performance.now();
      return { choice: 'skip' };
    };
    fs.holdMs = PROGRESS_WORK_MS + 500;
    const run = paste('clash.txt', 'big.bin');
    await run.result;
    expect(h.questions).toHaveLength(1);
    const shown = timeline.find((e) => e.p.display);
    expect(shown, 'a display: true event').toBeDefined();
    // 1.5 s of question did not count: the card waited for (almost) a full second of work after it.
    expect(shown!.at - answeredAt).toBeGreaterThanOrEqual(PROGRESS_WORK_MS - 100);
    expectMonotonic(run.jobId);
  });

  it('a clash question longer than a second, then a short copy, never shows', async () => {
    await setup();
    answer = async () => {
      await delay(1500);
      return { choice: 'skip' };
    };
    fs.holdMs = 300;
    const run = paste('clash.txt', 'big.bin');
    await run.result;
    expect(timeline.map((e) => e.p.display)).not.toContain(true);
  });

  it('does not count the time the cancel choice is open', async () => {
    await setup();
    fs.holdMs = 60_000;
    const run = paste('big.bin', 'small.txt');
    await fs.started.promise;
    await delay(200);
    h.svc.cancel(run.jobId);
    for (let i = 0; i < 200 && h.cancelChoices.length === 0; i++) await settle(10);
    expect(h.cancelChoices).toHaveLength(1);
    await delay(1500);
    h.svc.finishCancel(run.jobId, 'keep');
    expect((await run.result).outcome).toBe('kept');
    expect(timeline.map((e) => e.p.display)).not.toContain(true);
  });
});

describe('a queued paste (FR-019d)', () => {
  it('shows at once, and stays shown when it runs', async () => {
    await setup();
    fs.holdMs = 60_000;
    const first = paste('big.bin');
    await fs.started.promise;
    const second = paste('small.txt');
    const queued = timeline.filter((e) => e.p.jobId === second.jobId);
    expect(queued[0]?.p).toMatchObject({ state: 'queued', display: true });
    fs.release.open();
    await first.result;
    await second.result;
    expectMonotonic(second.jobId);
    expect(timeline.filter((e) => e.p.jobId === second.jobId && e.p.state === 'running').length).toBeGreaterThan(0);
  });
});

describe('a drag (FR-019e)', () => {
  it('never reports progress, however large and slow', async () => {
    await setup();
    fs.holdMs = PROGRESS_WORK_MS + 300;
    const r = await h.svc.drop(1, [join(h.rootA, 'big.bin')], join(h.rootB, 'dest'), 'copy');
    expect(r.failures).toEqual([]);
    expect(h.progress).toHaveLength(0);
  });
});
