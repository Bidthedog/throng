import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 051 R7 — the project-root lock waits on timers, never on the thread. Its release used to spin on
 * `Atomics.wait` for up to 3 s while Windows let go of the holder's cwd handle, and that ran on every
 * project's LAST terminal end — stopping every other terminal for as long.
 *
 * The holder process and the rename probe are faked; the real lock is `windows-directory-lock`'s
 * contract test.
 */

const spawn = vi.fn();
const renameSync = vi.fn();
const statSync = vi.fn();

vi.mock('node:child_process', () => ({ spawn: (...a: unknown[]) => spawn(...a) }));
vi.mock('node:fs', async (orig) => ({
  ...(await orig<typeof import('node:fs')>()),
  renameSync: (...a: unknown[]) => renameSync(...a),
  statSync: (...a: unknown[]) => statSync(...a),
}));

const { WindowsDirectoryLock } = await import('../../src/windows-directory-lock.js');

const busy = () => Object.assign(new Error('EBUSY'), { code: 'EBUSY' });

afterEach(() => {
  spawn.mockReset();
  renameSync.mockReset();
  statSync.mockReset();
});

function heldLock() {
  statSync.mockReturnValue({ isDirectory: () => true });
  const kill = vi.fn();
  spawn.mockReturnValue({ pid: 4242, kill });
  return { lock: new WindowsDirectoryLock(), kill };
}

/** Counts 5 ms timer ticks over the life of `work`: the thread was free if they keep coming. */
async function ticksDuring(work: Promise<unknown>): Promise<number> {
  let ticks = 0;
  const timer = setInterval(() => (ticks += 1), 5);
  await work;
  clearInterval(timer);
  return ticks;
}

describe('051 R7 — WindowsDirectoryLock without a busy-wait', () => {
  it('acquire is async and lets the event loop run while the holder settles', async () => {
    const { lock } = heldLock();
    const acquiring = lock.acquire('C:/proj');
    expect(acquiring).toBeInstanceOf(Promise);
    expect(await ticksDuring(acquiring)).toBeGreaterThan(0);
    await expect(acquiring).resolves.toEqual({ path: 'C:/proj' });
  });

  it('a contended release retries on timers until the folder is free, and the loop keeps running', async () => {
    const { lock, kill } = heldLock();
    const handle = await lock.acquire('C:/proj');
    let refusals = 6;
    renameSync.mockImplementation(() => {
      if (refusals-- > 0) throw busy();
    });
    const releasing = lock.release(handle);
    expect(releasing).toBeInstanceOf(Promise);
    const ticks = await ticksDuring(releasing);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(renameSync).toHaveBeenCalledTimes(7);
    expect(ticks).toBeGreaterThanOrEqual(6);
  });

  it('gives up after about three seconds on a handle Windows never lets go of', async () => {
    vi.useFakeTimers();
    try {
      const { lock } = heldLock();
      const acquiring = lock.acquire('C:/proj');
      await vi.advanceTimersByTimeAsync(50);
      const handle = await acquiring;
      renameSync.mockImplementation(() => {
        throw busy();
      });
      let done = false;
      void lock.release(handle).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(2900);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a missing folder rejects with ENOENT, as before', async () => {
    statSync.mockImplementation(() => {
      throw new Error('nope');
    });
    await expect(new WindowsDirectoryLock().acquire('C:/gone')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('the source holds no Atomics.wait', () => {
    const src = readFileSync(fileURLToPath(new URL('../../src/windows-directory-lock.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/Atomics\.wait/);
  });
});
