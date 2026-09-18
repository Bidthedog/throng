import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
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
    if (path.toLowerCase().startsWith(LOCAL.toLowerCase()) && path.toLowerCase().endsWith('.ts')) {
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

function makeResolver() {
  const disk = fakeFileSystem();
  const shellCalls: string[] = [];
  const deps = {
    fs: disk.fs,
    pathForms: PATH_FORMS,
    executables: EXECUTABLES,
    projectRootFor: () => LOCAL.slice(0, -1),
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

const request = (text: string): LinkResolutionRequest => ({
  text,
  kind: 'detectedPath',
  panelId: 'p1',
  originProjectId: 'proj-1',
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
    expect(await outcomeAfter(running, 1)).toEqual({ ok: false, reason: 'unreachable' });
  });
});

describe('P8 — a timed-out root is not asked again while it is stuck (FR-121)', () => {
  it('a second request under the same root answers unreachable at once, with ZERO further stats', async () => {
    const { resolver, disk } = makeResolver();
    await outcomeAfter(resolver.resolve(request(`${STUCK}first.txt`)), TIMEOUT_MS);
    const statsBefore = disk.statCalls.length;

    const second = await outcomeAfter(resolver.resolve(request(`${STUCK}second.txt`)), 0);

    expect(second).toEqual({ ok: false, reason: 'unreachable' });
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

    expect(third).toEqual({ ok: false, reason: 'unreachable' });
    expect(disk.statCalls.slice(statsBefore), 'a third stuck thread must not be risked').toEqual([]);
  });
});

describe('P10 — when the stuck stat settles, the root is checked again (FR-122)', () => {
  it('is gated while stuck, and asked again once its stat has settled', async () => {
    const { resolver, disk } = makeResolver();
    void resolver.resolve(request(`${STUCK}a.txt`));
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    // Still stuck: gated.
    const before = disk.statCalls.length;
    expect(await outcomeAfter(resolver.resolve(request(`${STUCK}b.txt`)), 0)).toEqual({
      ok: false,
      reason: 'unreachable',
    });
    expect(disk.statCalls.length, 'gated while stuck').toBe(before);

    // The share answers at last (here: "no such file"), which clears the mark.
    for (const s of disk.stuck) s.settle();
    await vi.advanceTimersByTimeAsync(0);

    const after = disk.statCalls.length;
    void resolver.resolve(request(`${STUCK}c.txt`));
    await vi.advanceTimersByTimeAsync(0);
    expect(disk.statCalls.length, 'the root is asked again once it has settled').toBeGreaterThan(after);
  });
});

describe('FR-124 — following a link on a stuck root ends at the timeout, reason unreachable', () => {
  it('revealInFileManager answers unreachable at the timeout and touches no shell', async () => {
    const { resolver, shellCalls } = makeResolver();
    const running = resolver.revealInFileManager(request(`${STUCK}notes.txt`));

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
