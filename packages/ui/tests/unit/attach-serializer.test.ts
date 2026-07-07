import { describe, it, expect } from 'vitest';
import { createSerializer } from '../../src/main/attach-serializer.js';

/**
 * Bug: opening a project mounts every Terminal Panel at once, so their
 * `terminal.attach` RPCs fire in parallel — but each starts its OWN 2000ms timeout
 * clock immediately, while the daemon cold-starts PTYs one at a time (synchronous
 * node-pty spawn). The 4th/5th attach therefore times out waiting behind the earlier
 * cold-starts, even though nothing is actually wrong. Serializing the attaches makes
 * each terminal's timeout window start when ITS load starts, not when the batch fired.
 */

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('attach serializer (per-terminal timeout window)', () => {
  it('runs tasks one at a time — a task does not start until the previous settles', async () => {
    const serialize = createSerializer();
    const log: string[] = [];
    const resolvers: Array<() => void> = [];
    const task = (id: number) => () =>
      new Promise<number>((resolve) => {
        log.push(`start${id}`);
        resolvers[id] = () => {
          log.push(`end${id}`);
          resolve(id);
        };
      });

    // Fire three concurrently (as the mounting Panels do).
    const p1 = serialize(task(1));
    const p2 = serialize(task(2));
    const p3 = serialize(task(3));

    await flush();
    expect(log).toEqual(['start1']); // only #1 has begun; #2/#3 wait their turn

    resolvers[1]();
    await p1;
    await flush();
    expect(log).toEqual(['start1', 'end1', 'start2']);

    resolvers[2]();
    await p2;
    await flush();
    expect(log).toEqual(['start1', 'end1', 'start2', 'end2', 'start3']);

    resolvers[3]();
    await p3;
    expect(log).toEqual(['start1', 'end1', 'start2', 'end2', 'start3', 'end3']);
  });

  it('keeps draining the queue after a task rejects (one failure does not stall the rest)', async () => {
    const serialize = createSerializer();
    const order: string[] = [];

    const p1 = serialize(() => {
      order.push('t1');
      return Promise.reject(new Error('boom'));
    });
    const p2 = serialize(() => {
      order.push('t2');
      return Promise.resolve('ok');
    });

    await expect(p1).rejects.toThrow('boom');
    await expect(p2).resolves.toBe('ok');
    expect(order).toEqual(['t1', 't2']);
  });

  it('delivers each task result to its own caller', async () => {
    const serialize = createSerializer();
    const [a, b] = await Promise.all([
      serialize(() => Promise.resolve('A')),
      serialize(() => Promise.resolve('B')),
    ]);
    expect(a).toBe('A');
    expect(b).toBe('B');
  });
});
