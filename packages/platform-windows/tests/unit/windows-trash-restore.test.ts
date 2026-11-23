import { describe, expect, it } from 'vitest';
import { WindowsTrashRestore } from '@throng/platform-windows';

/**
 * #708 — the seam's contract (`ITrashRestore.restore`) says `deletedAt` picks among several deletions of one path. The
 * Windows class is only the seam's shape around UI main's Recycle Bin script, so the one thing it can get wrong is
 * dropping the timestamp on the way through — after which the script cannot honour it, whatever it does.
 */
describe('WindowsTrashRestore', () => {
  it('hands the deletion time to the Recycle Bin restore, not only the path', async () => {
    const calls: unknown[][] = [];
    const restore = new WindowsTrashRestore((...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve();
    });

    await restore.restore('C:\\p\\a.txt', 1_700_000_000_000);

    expect(calls).toEqual([['C:\\p\\a.txt', 1_700_000_000_000]]);
  });
});
