import { describe, expect, it } from 'vitest';
import {
  parseRecycleBinListing,
  restoreFromRecycleBin,
  type RecycleBinCandidate,
  type RecycleBinSession,
} from '../../src/main/recycle-bin-restore.js';

/**
 * The Recycle Bin restore's CHOICE, with the bin's enumeration injected — the PowerShell that lists it
 * only runs on Windows (`fileop-undo.e2e.ts` and `delete-mixed.e2e.ts` drive the real bin there).
 */
const TARGET = 'C:\\p\\a.txt';

function bin(candidates: Omit<RecycleBinCandidate, 'index'>[]): { open: () => Promise<RecycleBinSession>; restored: number[]; cancelled: () => boolean } {
  const restored: number[] = [];
  let cancelled = false;
  const session: RecycleBinSession = {
    listing: { scanned: candidates.length, sample: [], candidates: candidates.map((c, index) => ({ ...c, index })) },
    restore: (index) => {
      restored.push(index);
      return Promise.resolve();
    },
    cancel: () => {
      cancelled = true;
    },
  };
  return { open: () => Promise.resolve(session), restored, cancelled: () => cancelled };
}

describe('restoreFromRecycleBin — which recycled copy comes back', () => {
  it('#708: restores the copy deleted last, not an older one of the same path the bin lists first', async () => {
    const b = bin([
      { exact: true, extMatches: true, deletedAtMs: 1_000 }, // "one", deleted first
      { exact: true, extMatches: true, deletedAtMs: 2_000 }, // "two", the delete being undone
    ]);

    await restoreFromRecycleBin(TARGET, 2_050, b.open);

    expect(b.restored).toEqual([1]);
  });

  it('takes the closest deletion at or before deletedAt, so an older undo entry gets its own copy', async () => {
    const b = bin([
      { exact: true, extMatches: true, deletedAtMs: 2_000 },
      { exact: true, extMatches: true, deletedAtMs: 1_000 },
    ]);

    await restoreFromRecycleBin(TARGET, 1_500, b.open);

    expect(b.restored).toEqual([1]);
  });

  it('#708 with extensions hidden: picks by deletion time among copies displayed without their extension', async () => {
    const b = bin([
      { exact: false, extMatches: true, deletedAtMs: 1_000 },
      { exact: false, extMatches: true, deletedAtMs: 2_000 },
    ]);

    await restoreFromRecycleBin(TARGET, 2_050, b.open);

    expect(b.restored).toEqual([1]);
  });

  it('with extensions hidden, a.js displayed as "a" is not taken for a.txt', async () => {
    const b = bin([
      { exact: false, extMatches: false, deletedAtMs: 2_000 }, // a.js
      { exact: false, extMatches: true, deletedAtMs: 1_000 }, // a.txt
    ]);

    await restoreFromRecycleBin(TARGET, 2_050, b.open);

    expect(b.restored).toEqual([1]);
  });

  it('refuses as ambiguous, restoring nothing, when stripped names cannot be told apart (#373)', async () => {
    const b = bin([
      { exact: false, extMatches: false, deletedAtMs: 1_000 },
      { exact: false, extMatches: false, deletedAtMs: 2_000 },
    ]);

    await expect(restoreFromRecycleBin(TARGET, 2_050, b.open)).rejects.toThrow(/ambiguous in recycle bin/);
    expect(b.restored).toEqual([]);
    expect(b.cancelled()).toBe(true);
  });

  it('says what the bin held when nothing matches', async () => {
    const b = bin([]);

    await expect(restoreFromRecycleBin(TARGET, 2_050, b.open)).rejects.toThrow(/not in recycle bin: C:\\p\\a\.txt \(scanned 0/);
    expect(b.cancelled()).toBe(true);
  });
});

describe('parseRecycleBinListing', () => {
  it('reads a one-element candidate list that Windows PowerShell wrote as a bare object', () => {
    const listing = parseRecycleBinListing(
      '{"scanned":3,"sample":"a.txt <- \'C:\\\\p\'","candidates":{"index":0,"exact":true,"extMatches":true,"deletedAtMs":5}}',
    );

    expect(listing).toEqual({
      scanned: 3,
      sample: ["a.txt <- 'C:\\p'"],
      candidates: [{ index: 0, exact: true, extMatches: true, deletedAtMs: 5 }],
    });
  });
});
