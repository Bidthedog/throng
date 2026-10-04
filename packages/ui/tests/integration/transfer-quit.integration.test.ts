import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClipboardItem } from '@throng/core';
import { TransferQuitGate } from '../../src/main/transfer-quit-gate.js';
import { disposeHarness, exists, FsDecorator, gate, makeHarness, put, settle, type Harness } from './helpers/transfer-harness.js';

/**
 * Quitting while a paste runs (050 R11, FR-019f — T056): the gate the main window's close handler
 * asks FIRST, over the real engine.
 */

/** Holds any `big.bin` copy until released or aborted. */
class Held extends FsDecorator {
  started = gate();
  release = gate();
  override async copyFileCancellable(s: string, d: string, signal: AbortSignal): Promise<void> {
    if (s.endsWith('big.bin')) {
      this.started.open();
      await Promise.race([
        this.release.promise,
        new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })),
      ]);
    }
    return super.copyFileCancellable(s, d, signal);
  }
}

let h: Harness;
let fs: Held;
let prompts: { running: number; queued: number }[];
let quitGate: TransferQuitGate;

beforeEach(async () => {
  h = await makeHarness({ wrapFs: (inner) => (fs = new Held(inner)) });
  await put(join(h.rootA, 'big.bin'), 'BIG');
  await put(join(h.rootA, 'small.txt'), 'small');
  prompts = [];
  quitGate = new TransferQuitGate(h.svc, (counts) => prompts.push(counts));
});
afterEach(async () => {
  fs.release.open();
  await disposeHarness(h);
});

const fromA = (...names: string[]): ClipboardItem[] =>
  names.map((n) => ({ absPath: join(h.rootA, n), projectId: 'A', projectRoot: h.rootA }));

/** One running paste (held on big.bin) and one queued behind it. */
async function busy() {
  const running = h.svc.paste(1, h.rootB, { mode: 'copy', items: fromA('big.bin') });
  await fs.started.promise;
  const queued = h.svc.paste(1, h.rootB, { mode: 'copy', items: fromA('small.txt') });
  return { running, queued };
}

describe('the quit gate (FR-019f)', () => {
  it('not busy: proceeds at once and asks nothing', async () => {
    expect(await quitGate.check()).toBe(true);
    expect(prompts).toEqual([]);
  });

  it('busy: asks with the counts and waits; Wait proceeds once the queue drains', async () => {
    const { running, queued } = await busy();
    let proceeded: boolean | null = null;
    void quitGate.check().then((ok) => (proceeded = ok));
    await settle();
    expect(prompts).toEqual([{ running: 1, queued: 1 }]);
    quitGate.choose('wait');
    await settle();
    expect(proceeded).toBeNull();
    fs.release.open();
    await Promise.all([running.result, queued.result]);
    await settle();
    expect(proceeded).toBe(true);
    expect(await exists(join(h.rootB, 'small.txt'))).toBe(true);
  });

  it('Cancel pastes → Keep finished cancels every job with that choice, asks nothing more, then proceeds', async () => {
    const { running, queued } = await busy();
    const ok = quitGate.check();
    await settle();
    quitGate.choose('keep');
    expect(await ok).toBe(true);
    expect((await running.result).outcome).toBe('kept');
    expect((await queued.result).outcome).toBe('kept');
    expect(h.cancelChoices).toEqual([]);
    expect(await exists(join(h.rootB, 'small.txt'))).toBe(false);
  });

  it('Cancel pastes → Roll back rolls the running job back, then proceeds', async () => {
    const { running } = await busy();
    const ok = quitGate.check();
    await settle();
    quitGate.choose('rollback');
    expect(await ok).toBe(true);
    expect((await running.result).outcome).toBe('rolled-back');
    expect(h.cancelChoices).toEqual([]);
  });

  it('dismissing abandons the close and leaves the jobs running', async () => {
    const { running, queued } = await busy();
    const ok = quitGate.check();
    await settle();
    quitGate.choose('dismiss');
    expect(await ok).toBe(false);
    expect(h.svc.busy()).toEqual({ running: 1, queued: 1 });
    fs.release.open();
    expect((await running.result).outcome).toBe('completed');
    expect((await queued.result).outcome).toBe('completed');
  });
});
