import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LINK_ROOT_BACKOFF_MS,
  SHIPPED_PREVIEW_PROVIDERS,
  type IExecutableExtensions,
  type IFileSystem,
  type IPathForms,
  type IShellIntegration,
  type LinkResolutionRequest,
  type PreviewSettings,
} from '@throng/core';
import { FileLinkResolver, type FileLinkResolverDeps } from '../../src/main/file-link-resolver.js';

/**
 * 045 T145 — bounded existence checks (FR-120 – FR-122, FR-124; `contracts/link-resolution.md` §6.4
 * P7 – P11; `data-model.md` §13.5).
 *
 * ══ WHAT THE USER SEES WITHOUT THIS ══
 *
 * A path on a share that has gone offline. Windows' `stat` of `\\fileserver\home\x` does not fail —
 * it WAITS, for as long as the redirector's own timeout, which is tens of seconds. Every hover over
 * such a path queues one more of those, each holding a libuv thread-pool thread, and the pool is
 * four threads wide: the fifth hover leaves saving, reading and watching with nowhere to run. So the
 * user's editor stops saving because a terminal printed a path to a share.
 *
 * ══ THE FAKE ══
 *
 * An `IFileSystem` whose `stat` NEVER SETTLES for anything under a named "stuck" volume root, until
 * the test settles it — the offline share, reduced to the one property that matters. A local root
 * answers at once. The clock is vitest's fake one, so "at the timeout" means exactly the setting's
 * value and not a real two seconds.
 *
 * Every outcome is read through {@link outcomeAfter}, which reports `'pending'` rather than hanging
 * when the resolver has not answered — so a red run says what it got instead of timing out.
 */

const STUCK = '\\\\fileserver\\home\\';
const STUCK_TWO = '\\\\nas\\share\\';
const STUCK_THREE = '\\\\archive\\pub\\';
/** 045 T255 — a share that answers at once: FR-122a's "two in back-off never gate a third". */
const HEALTHY = '\\\\good\\share\\';
const LOCAL = 'C:\\proj\\';
const TIMEOUT_MS = 2000;

interface StuckStat {
  readonly path: string;
  settle(): void;
}

function fakeFileSystem() {
  const statCalls: string[] = [];
  const stuck: StuckStat[] = [];
  const stuckRoots = new Set([STUCK, STUCK_TWO, STUCK_THREE]);
  const stat = (path: string): Promise<{ kind: 'file' | 'folder'; isSymlink: boolean }> => {
    statCalls.push(path);
    const root = [...stuckRoots].find((r) => path.toLowerCase().startsWith(r.toLowerCase()));
    if (root !== undefined) {
      // The offline share: no answer, and no error either, until the test says so.
      return new Promise((_resolve, reject) => {
        stuck.push({ path, settle: () => reject(new Error('ENOENT')) });
      });
    }
    const healthy = [LOCAL, HEALTHY].some((r) => path.toLowerCase().startsWith(r.toLowerCase()));
    if (healthy && path.toLowerCase().endsWith('.ts')) {
      return Promise.resolve({ kind: 'file', isSymlink: false });
    }
    return Promise.reject(new Error('ENOENT'));
  };
  return { fs: { stat } as unknown as IFileSystem, statCalls, stuck };
}

/** A path-forms port that maps nothing — every path in this file is already native. */
const PATH_FORMS: IPathForms = {
  homeDirectory: () => 'C:\\Users\\someone',
  fromDriveForm: () => null,
  fromFileUrl: () => null,
  fromHomeForm: () => null,
} as unknown as IPathForms;

const EXECUTABLES: IExecutableExtensions = {
  isExecutable: () => false,
} as unknown as IExecutableExtensions;

const PREVIEW_SETTINGS: PreviewSettings = {
  updateDelayMs: 300,
  maxWaitMs: 1000,
  copyFormat: 'rich',
  syncScroll: true,
  providers: { markdown: { enabled: true, defaultOpenAction: 'editor' } },
};

function makeResolver(over: { projectRoot?: string } = {}) {
  const disk = fakeFileSystem();
  const shellCalls: string[] = [];
  const deps = {
    fs: disk.fs,
    pathForms: PATH_FORMS,
    executables: EXECUTABLES,
    projectRootFor: () => over.projectRoot ?? LOCAL.slice(0, -1),
    previewRegistry: SHIPPED_PREVIEW_PROVIDERS,
    readPreviewSettings: () => PREVIEW_SETTINGS,
    // data-model §13.5: the timeout is READ PER CHECK, on the `readPreviewSettings` pattern.
    readLinkSettings: () => ({
      detectInEditors: true,
      detectInTerminals: true,
      existenceCheckTimeoutMs: TIMEOUT_MS,
    }),
  };
  const resolver = new FileLinkResolver(deps as FileLinkResolverDeps);
  resolver.setShell({
    openFolder: async (p: string) => void shellCalls.push(`folder:${p}`),
    revealInFileManager: async (p: string) => void shellCalls.push(`reveal:${p}`),
    openWithDefaultProgram: async (p: string) => void shellCalls.push(`open:${p}`),
  } as unknown as IShellIntegration);
  return { resolver, disk, shellCalls };
}

const request = (text: string, baseDirectory?: string): LinkResolutionRequest => ({
  text,
  kind: 'detectedPath',
  panelId: 'p1',
  originProjectId: 'proj-1',
  ...(baseDirectory === undefined ? {} : { baseDirectory }),
});

/**
 * What `running` has answered once `ms` of fake time has passed — or `'pending'`.
 *
 * `advanceTimersByTimeAsync` flushes the microtasks between timer steps, so an answer that the
 * resolver produces "at once" is in by `ms = 0`.
 */
async function outcomeAfter<T>(running: Promise<T>, ms: number): Promise<T | 'pending'> {
  let settled: { value: T } | undefined;
  void running.then((value) => {
    settled = { value };
  });
  await vi.advanceTimersByTimeAsync(ms);
  return settled === undefined ? 'pending' : settled.value;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('P7 — every check races the existence-check timeout (FR-120)', () => {
  it('a stat that never settles answers { ok: false, reason: unreachable } AT the timeout', async () => {
    const { resolver } = makeResolver();
    const running = resolver.resolve(request(`${STUCK}notes.txt`));

    expect(await outcomeAfter(running, TIMEOUT_MS - 1), 'must not answer before the timeout').toBe('pending');
    expect(await outcomeAfter(running, 1)).toMatchObject({ ok: false, reason: 'unreachable' });
  });
});

describe('P8 — a timed-out root is not asked again while it is stuck (FR-121)', () => {
  it('a second request under the same root answers unreachable at once, with ZERO further stats', async () => {
    const { resolver, disk } = makeResolver();
    await outcomeAfter(resolver.resolve(request(`${STUCK}first.txt`)), TIMEOUT_MS);
    const statsBefore = disk.statCalls.length;

    const second = await outcomeAfter(resolver.resolve(request(`${STUCK}second.txt`)), 0);

    expect(second).toMatchObject({ ok: false, reason: 'unreachable' });
    expect(disk.statCalls.slice(statsBefore), 'the stuck share must not be touched again').toEqual([]);
  });
});

describe('P11 — a healthy root is never delayed by a stuck one (FR-121)', () => {
  it('a local request answers normally and at once while the share is stuck', async () => {
    const { resolver } = makeResolver();
    void resolver.resolve(request(`${STUCK}first.txt`));
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    const local = await outcomeAfter(resolver.resolve(request(`${LOCAL}src\\foo.ts`)), 0);

    expect(local).toMatchObject({ ok: true, link: { path: `${LOCAL}src\\foo.ts`, kind: 'file' } });
  });
});

describe('P9 — at most two checks may be stuck past the timeout (FR-121)', () => {
  it('with two roots stuck, a THIRD root answers unreachable at once and is never stat-ed', async () => {
    const { resolver, disk } = makeResolver();
    void resolver.resolve(request(`${STUCK}a.txt`));
    void resolver.resolve(request(`${STUCK_TWO}b.txt`));
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    const statsBefore = disk.statCalls.length;

    const third = await outcomeAfter(resolver.resolve(request(`${STUCK_THREE}c.txt`)), 0);

    expect(third).toMatchObject({ ok: false, reason: 'unreachable' });
    expect(disk.statCalls.slice(statsBefore), 'a third stuck thread must not be risked').toEqual([]);
  });

  it('with two roots stuck, a healthy LOCAL drive root is still checked and answers normally (§13.5)', async () => {
    const { resolver } = makeResolver();
    void resolver.resolve(request(`${STUCK}a.txt`));
    void resolver.resolve(request(`${STUCK_TWO}b.txt`));
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    // A full stuck-root map gates only other NETWORK roots: a local drive is never gated, or every
    // local link would go dead the moment two shares went offline.
    const local = await outcomeAfter(resolver.resolve(request(`${LOCAL}src\\foo.ts`)), 0);

    expect(local).toMatchObject({ ok: true, link: { path: `${LOCAL}src\\foo.ts`, kind: 'file' } });
  });
});

/*
 * *Round four (T255, FR-122a):* P10 asserted that a root was asked again the moment its stuck `stat`
 * settled, because FR-122's back-off was then the renderer cache's lifetime. FR-155 deletes that cache
 * and FR-122a moves the back-off to main: the root is left alone for `LINK_ROOT_BACKOFF_MS` after its
 * stuck check settles, then asked again.
 */
describe('P10 / FR-122a — after the stuck stat settles, the root is left alone, then checked again', () => {
  it('is gated while stuck, left alone for LINK_ROOT_BACKOFF_MS after it settles, then asked again', async () => {
    const { resolver, disk } = makeResolver();
    void resolver.resolve(request(`${STUCK}a.txt`));
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    // Still stuck: gated.
    const before = disk.statCalls.length;
    expect(await outcomeAfter(resolver.resolve(request(`${STUCK}b.txt`)), 0)).toMatchObject({
      ok: false,
      reason: 'unreachable',
    });
    expect(disk.statCalls.length, 'gated while stuck').toBe(before);

    // The share answers at last (here: "no such file"), which starts the back-off.
    for (const s of disk.stuck) s.settle();
    await vi.advanceTimersByTimeAsync(0);

    // Inside the back-off: unreachable at once, and the disk is not touched.
    await vi.advanceTimersByTimeAsync(LINK_ROOT_BACKOFF_MS - 1);
    const inside = disk.statCalls.length;
    expect(await outcomeAfter(resolver.resolve(request(`${STUCK}c.txt`)), 0)).toMatchObject({
      ok: false,
      reason: 'unreachable',
    });
    expect(disk.statCalls.length, 'left alone during the back-off').toBe(inside);

    // After it: asked again.
    await vi.advanceTimersByTimeAsync(1);
    const after = disk.statCalls.length;
    void resolver.resolve(request(`${STUCK}d.txt`));
    await vi.advanceTimersByTimeAsync(0);
    expect(disk.statCalls.length, 'the root is asked again once the back-off has passed').toBeGreaterThan(after);
  });

  it('LINK_ROOT_BACKOFF_MS is the cache lifetime FR-122 always had: 30,000', () => {
    expect(LINK_ROOT_BACKOFF_MS).toBe(30_000);
  });

  it('two roots in back-off do not gate a third, healthy share (the back-off map is not the stuck map)', async () => {
    const { resolver, disk } = makeResolver();
    void resolver.resolve(request(`${STUCK}a.txt`));
    void resolver.resolve(request(`${STUCK_TWO}b.txt`));
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    for (const s of disk.stuck) s.settle();
    await vi.advanceTimersByTimeAsync(0);

    const healthy = await outcomeAfter(resolver.resolve(request(`${HEALTHY}x.ts`)), 0);
    expect(healthy).toMatchObject({ ok: true, link: { path: `${HEALTHY}x.ts`, kind: 'file' } });
  });

  it('a folder by grammar under a root in back-off still opens as a folder, with no check (FR-158d)', async () => {
    const { resolver, disk, shellCalls } = makeResolver();
    void resolver.resolve(request(`${STUCK}a.txt`));
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    for (const s of disk.stuck) s.settle();
    await vi.advanceTimersByTimeAsync(0);

    const before = disk.statCalls.length;
    const outcome = await outcomeAfter(resolver.revealInFileManager(request(`${STUCK}dir\\`)), 0);
    expect(outcome).toEqual({ ok: true });
    expect(shellCalls).toEqual([`folder:${STUCK}dir`]);
    expect(disk.statCalls.length).toBe(before);
  });
});

describe('T226 / T227 / FR-161 — one deadline per request, across every reading and root', () => {
  it('a follow whose every reading and root hangs ends within the timeout IN TOTAL', async () => {
    // A relative text: the base directory's reading on one offline share, the project root's on
    // another. Before FR-161 each reading waited out its own timeout.
    const { resolver } = makeResolver({ projectRoot: `${STUCK_TWO}proj` });
    const running = resolver.resolve(request('notes.txt', `${STUCK}dir`));

    expect(await outcomeAfter(running, TIMEOUT_MS - 1)).toBe('pending');
    expect(await outcomeAfter(running, 1)).toMatchObject({ ok: false, reason: 'unreachable' });
  });

  it('a positioned text on a hanging root — two readings — also ends at the one timeout', async () => {
    const { resolver } = makeResolver({ projectRoot: `${STUCK}proj` });
    const running = resolver.resolve(request('src/foo.ts:42', `${STUCK_TWO}dir`));
    expect(await outcomeAfter(running, TIMEOUT_MS)).toMatchObject({ ok: false, reason: 'unreachable' });
  });

  it('FR-160a: an in-project first reading that times out is unreachable, not not-found', async () => {
    const { resolver } = makeResolver({ projectRoot: `${STUCK}proj` });
    const running = resolver.resolve(request('notes.txt'));
    expect(await outcomeAfter(running, TIMEOUT_MS)).toMatchObject({ ok: false, reason: 'unreachable' });
  });
});

describe('FR-124 — following a link on a stuck root ends at the timeout, reason unreachable', () => {
  // *Round four (T255, FR-158a):* this case asserted that an out-of-project reveal on a stuck root
  // answered `unreachable` and touched no shell. FR-158a hands a location the check cannot reach to OS
  // Explorer on its PARENT, with no throng notice — within the one deadline.
  it('revealInFileManager on an out-of-project stuck location reveals its parent at the timeout', async () => {
    const { resolver, shellCalls } = makeResolver();
    const running = resolver.revealInFileManager(request(`${STUCK}notes.txt`));

    expect(await outcomeAfter(running, TIMEOUT_MS - 1)).toBe('pending');
    expect(await outcomeAfter(running, 1)).toEqual({ ok: true });
    expect(shellCalls.map((c) => c.replace(/\\+$/, ''))).toEqual([`folder:${STUCK.replace(/\\+$/, '')}`]);
  });

  it('revealInFileManager on an IN-project stuck location answers unreachable and touches no shell', async () => {
    const { resolver, shellCalls } = makeResolver({ projectRoot: `${STUCK}proj` });
    const running = resolver.revealInFileManager(request('notes.txt'));

    expect(await outcomeAfter(running, TIMEOUT_MS)).toMatchObject({ ok: false, reason: 'unreachable' });
    expect(shellCalls).toEqual([]);
  });

  it('openWithDefaultProgram answers unreachable at the timeout and touches no shell', async () => {
    const { resolver, shellCalls } = makeResolver();
    const running = resolver.openWithDefaultProgram(request(`${STUCK}notes.txt`));

    expect(await outcomeAfter(running, TIMEOUT_MS)).toMatchObject({ ok: false, reason: 'unreachable' });
    expect(shellCalls).toEqual([]);
  });
});
