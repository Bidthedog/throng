import { readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { loopTurnsDuring } from '../../src/testing/pty-host-contract.js';

describe('loopTurnsDuring, the contract\'s proof that a probe does not block', () => {
  it('sees a fast non-blocking read, however short it is', async () => {
    const { result, turns } = await loopTurnsDuring(async () => {
      await readdir(tmpdir());
      return stat(tmpdir());
    });
    expect(result.isDirectory()).toBe(true);
    expect(turns).toBeGreaterThan(0);
  });

  it('reports none for work that holds the loop', async () => {
    const { turns } = await loopTurnsDuring(async () => {
      const until = performance.now() + 30;
      while (performance.now() < until);
    });
    expect(turns).toBe(0);
  });
});
