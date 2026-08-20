import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFileIndex } from '../../src/renderer/navigate/use-file-index.js';

/**
 * `useFileIndex` — the seam between the index channel and the pure fold (033 FR-005/FR-069/FR-075).
 *
 * ══ WHY THIS FILE DID NOT EXIST, AND WHY THAT WAS A HOLE ══
 *
 * Both sides of this hook were well covered and the hook itself was covered by nothing.
 * `core/tests/unit/file-index-view.test.ts` has ten cases on `applyIndexUpdate`, the pure fold;
 * `integration/project-file-index.integration.test.ts` proves a create, a rename and a delete each
 * reach a subscriber as a delta inside SC-005's two seconds. Between them sits every rule in this
 * hook's own comments — which push belongs to this subscription, when a bare `building` is a walk
 * starting versus main disowning the index, and whether a flag change may keep the list it has —
 * and none of them had a test.
 *
 * That is the same shape as two other holes this branch measured: the publisher tested, the
 * consumer not, and the seam load-bearing (see `component/config-store-adoption.test.ts`). It is
 * why `quick-open-perf.e2e.ts:381` could not simply be deleted against the integration test that
 * "covers" it — the integration test proves the delta is SENT, and nothing proved the window did
 * anything with it.
 *
 * ══ WHAT STAYS AN E2E ══
 *
 * Nothing from this hook. The E2E's residual claim was that a file created outside throng becomes
 * choosable and a deleted one stops being — which is this hook mirroring two pushes, asserted below
 * without a filesystem, a walk or an application.
 */

const ROOT = 'C:/proj';

/** The pushes the bridge will deliver, and a handle to fire one. */
function bridge(): { push: (evt: Record<string, unknown>) => void; subscribes: unknown[]; off: ReturnType<typeof vi.fn> } {
  let handler: ((evt: unknown) => void) | null = null;
  const subscribes: unknown[] = [];
  const off = vi.fn(() => {
    handler = null;
  });
  Reflect.set(window, 'throng', {
    fileIndex: {
      onUpdate: (cb: (evt: unknown) => void) => {
        handler = cb;
        return off;
      },
      subscribe: (...args: unknown[]) => {
        subscribes.push(args);
        // Main's opening answer: still walking, no paths yet.
        return Promise.resolve({ status: 'building' });
      },
      unsubscribe: () => Promise.resolve({ ok: true }),
    },
  });
  return {
    push: (evt) => {
      act(() => {
        handler?.(evt);
      });
    },
    subscribes,
    off,
  };
}

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
  vi.restoreAllMocks();
});

describe('mirroring the index a window is subscribed to', () => {
  it('holds nothing and subscribes to nothing with no project open (R3)', async () => {
    const b = bridge();
    const { result } = renderHook(() => useFileIndex(null, true));

    expect(result.current.status).toBe('idle');
    expect(b.subscribes).toHaveLength(0);
  });

  it('takes the first ready set wholesale', async () => {
    const b = bridge();
    const { result } = renderHook(() => useFileIndex(ROOT, true));

    b.push({ root: ROOT, includeHidden: false, status: 'ready', paths: ['a.ts', 'b.ts'] });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.paths).toEqual(['a.ts', 'b.ts']);
  });

  it('a file that APPEARS outside throng becomes choosable — the E2E claim, without a filesystem', async () => {
    const b = bridge();
    const { result } = renderHook(() => useFileIndex(ROOT, true));

    b.push({ root: ROOT, includeHidden: false, status: 'ready', paths: ['anchor.txt'] });
    await waitFor(() => expect(result.current.paths).toEqual(['anchor.txt']));

    b.push({ root: ROOT, includeHidden: false, status: 'ready', added: ['appeared-later.txt'] });

    await waitFor(() => expect(result.current.paths).toContain('appeared-later.txt'));
    // The positive control the E2E also kept: the anchor is still there, so this is a statement
    // about the delta rather than about a list that was replaced.
    expect(result.current.paths).toContain('anchor.txt');
  });

  it('…and STOPS being choosable when it is deleted', async () => {
    const b = bridge();
    const { result } = renderHook(() => useFileIndex(ROOT, true));

    b.push({
      root: ROOT,
      includeHidden: false,
      status: 'ready',
      paths: ['anchor.txt', 'appeared-later.txt'],
    });
    await waitFor(() => expect(result.current.paths).toHaveLength(2));

    b.push({ root: ROOT, includeHidden: false, status: 'ready', removed: ['appeared-later.txt'] });

    await waitFor(() => expect(result.current.paths).not.toContain('appeared-later.txt'));
    expect(result.current.paths).toEqual(['anchor.txt']);
  });
});

describe('which pushes belong to this subscription (FR-069)', () => {
  it('ignores a push for a DIFFERENT root', async () => {
    const b = bridge();
    const { result } = renderHook(() => useFileIndex(ROOT, true));

    b.push({ root: ROOT, includeHidden: false, status: 'ready', paths: ['mine.ts'] });
    await waitFor(() => expect(result.current.paths).toEqual(['mine.ts']));

    b.push({ root: 'C:/other', includeHidden: false, status: 'ready', paths: ['theirs.ts'] });

    expect(result.current.paths).toEqual(['mine.ts']);
  });

  it('ignores a push at the OTHER includeHidden flag, which shares this channel', async () => {
    /*
     * A window may hold two subscriptions to one root at once — the standing one and a short-lived
     * one at the opposite flag — and both arrive here. Matching on `root` alone folds one index's
     * deltas into the other's set, producing a list that is neither, silently, and only while the
     * toggle is flipped. The hook's own comment says exactly this; nothing asserted it.
     */
    const b = bridge();
    const { result } = renderHook(() => useFileIndex(ROOT, true, false));

    b.push({ root: ROOT, includeHidden: false, status: 'ready', paths: ['visible.ts'] });
    await waitFor(() => expect(result.current.paths).toEqual(['visible.ts']));

    b.push({ root: ROOT, includeHidden: true, status: 'ready', added: ['.hidden/secret.ts'] });

    expect(result.current.paths).toEqual(['visible.ts']);
  });
});

describe('a bare `building` push: a walk starting, or main disowning the index (FR-075)', () => {
  it('KEEPS the list when it arrives before this key has ever delivered a ready', async () => {
    /*
     * A brand-new subscription's opening message and a disown are the same shape on the wire. The
     * only thing separating them is history, and getting it wrong is visible: the list a user is
     * reading blanks for as long as a walk takes.
     */
    const b = bridge();
    const { result, rerender } = renderHook(
      ({ hidden }: { hidden: boolean }) => useFileIndex(ROOT, true, hidden),
      { initialProps: { hidden: false } },
    );

    b.push({ root: ROOT, includeHidden: false, status: 'ready', paths: ['a.ts', 'b.ts'] });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    // Flip the flag: a NEW subscription key, whose first answer is a bare `building`.
    rerender({ hidden: true });
    b.push({ root: ROOT, includeHidden: true, status: 'building' });

    // Stale, and honest about it — the status says so while the rows stay.
    expect(result.current.paths).toEqual(['a.ts', 'b.ts']);
    expect(result.current.status).toBe('building');
  });

  it('DISCARDS the list when it arrives after a ready for this key — main has disowned it', async () => {
    const b = bridge();
    const { result } = renderHook(() => useFileIndex(ROOT, true));

    b.push({ root: ROOT, includeHidden: false, status: 'ready', paths: ['a.ts', 'b.ts'] });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    b.push({ root: ROOT, includeHidden: false, status: 'building' });

    await waitFor(() => expect(result.current.paths).toEqual([]));
  });
});

describe('changing project (FR-005, R4)', () => {
  it('clears the previous root’s files rather than showing them under the new name', async () => {
    /*
     * The failure this prevents is FR-005's wearing a timing disguise: another project's files
     * listed under this project's name for as long as the walk takes. Stale is tolerable and says
     * so; FALSE is not.
     */
    const b = bridge();
    const { result, rerender } = renderHook(
      ({ root }: { root: string }) => useFileIndex(root, true),
      { initialProps: { root: ROOT } },
    );

    b.push({ root: ROOT, includeHidden: false, status: 'ready', paths: ['old-project.ts'] });
    await waitFor(() => expect(result.current.paths).toEqual(['old-project.ts']));

    rerender({ root: 'C:/newproj' });

    expect(result.current.paths).toEqual([]);
    expect(result.current.status).toBe('building');
  });
});
