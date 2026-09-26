import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 046 T057 [derived] — the main-process half of Unload's release step (contracts/unload.md §2 step
 * 6, §3; FR-034c, FR-037).
 *
 * The renderer reaches the daemon ONLY through `throng:terminal:*` handlers, and until 046 nothing in
 * the renderer ever called `closeIdle` or `killAll` — app close calls the daemon from main directly.
 * So the daemon change (T069) is unreachable from Unload unless main forwards it, and forwards
 * `exceptPanelIds` intact: a handler that drops the field would end a terminal a sub-workspace window
 * is showing, which is exactly what FR-037 forbids.
 *
 * Pinned signatures (renderer → main):
 *
 *   throng:terminal:closeIdle   (params: { projectId: string; exceptPanelIds?: string[] })
 *   throng:terminal:killAll     (params: { projectId: string; exceptPanelIds?: string[] })
 *   throng:terminal:list        (projectId?: string, opts?: { includeBusy?: boolean })
 *
 * `list` keeps its positional `projectId` so every existing caller is untouched; the busy probe is
 * a second, optional argument, and without it the list stays the cheap no-probe call.
 *
 * Mocks `electron`'s `ipcMain` exactly as `terminal-attach-env.test.ts` does.
 */

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
    on: () => {},
  },
}));

const { registerTerminalIpc } = await import('../../src/main/terminal-ipc.js');

interface Call {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

const calls: Call[] = [];
/** The per-call timeout main passed, kept apart from `calls` so the param assertions stay exact. */
const timeouts: Array<{ method: string; timeoutMs: number | undefined }> = [];
let failNext = false;

const DAEMON_RESULTS: Record<string, unknown> = {
  'terminal.closeIdle': { closed: ['idle-1'] },
  'terminal.killAll': { killed: ['busy-1'] },
  'terminal.list': { sessions: [] },
};

function register(): void {
  handlers.clear();
  calls.length = 0;
  timeouts.length = 0;
  failNext = false;
  registerTerminalIpc({
    daemonClient: {
      call: (method: string, params: unknown, timeoutMs?: number) => {
        calls.push({ method, params: params as Record<string, unknown> });
        timeouts.push({ method, timeoutMs });
        if (failNext) return Promise.reject(new Error('daemon unreachable'));
        return Promise.resolve(DAEMON_RESULTS[method] ?? {});
      },
    } as never,
    shellDetection: { listFlavours: () => Promise.resolve([]) } as never,
    attachTimeoutMs: 1000,
    clipboard: { writeText: () => {}, writeRich: () => Promise.resolve(), readText: () => '' },
    foregroundHandoff: { handOffForeground: () => {} } as never,
    readTerminalSettings: () => ({}) as never,
  });
}

const EVENT = { sender: { id: 1, once: () => {} } };

function handler(channel: string): (...args: unknown[]) => unknown {
  const h = handlers.get(channel);
  expect(h, `${channel} must be registered by registerTerminalIpc`).toBeDefined();
  return h!;
}

const daemonCalls = (method: string): Call[] => calls.filter((c) => c.method === method);

beforeEach(register);

describe.each([
  ['throng:terminal:closeIdle', 'terminal.closeIdle', { closed: ['idle-1'] }],
  ['throng:terminal:killAll', 'terminal.killAll', { killed: ['busy-1'] }],
] as const)('%s', (channel, method, daemonResult) => {
  it('forwards {projectId, exceptPanelIds} to the daemon unchanged', async () => {
    await handler(channel)(EVENT, { projectId: 'proj-1', exceptPanelIds: ['p-sub-1', 'p-sub-2'] });
    expect(daemonCalls(method)).toEqual([
      { method, params: { projectId: 'proj-1', exceptPanelIds: ['p-sub-1', 'p-sub-2'] } },
    ]);
  });

  it('forwards a call with no exceptions as just the project', async () => {
    await handler(channel)(EVENT, { projectId: 'proj-1' });
    expect(daemonCalls(method)).toHaveLength(1);
    expect(daemonCalls(method)[0]!.params).toEqual({ projectId: 'proj-1' });
  });

  it("returns the daemon's result to the renderer", async () => {
    expect(await handler(channel)(EVENT, { projectId: 'proj-1', exceptPanelIds: [] })).toEqual(daemonResult);
  });

  it('does not disguise a daemon failure as success (contracts/unload.md §2, "Failure")', async () => {
    // Unload's step 6 must reach the store's `fail` path. A handler that swallowed the error into an
    // empty `{closed: []}` would report "nothing to do" while every terminal kept running.
    failNext = true;
    const outcome = await Promise.resolve(handler(channel)(EVENT, { projectId: 'proj-1' })).then(
      (value) => ({ rejected: false, value }),
      () => ({ rejected: true, value: undefined }),
    );
    const signalled = outcome.rejected || (outcome.value as { ok?: unknown } | undefined)?.ok === false;
    expect(signalled, `resolved with ${JSON.stringify(outcome.value)}`).toBe(true);
  });
});

describe.each([
  ['throng:terminal:closeIdle', 'terminal.closeIdle'],
  ['throng:terminal:killAll', 'terminal.killAll'],
] as const)('%s refuses params that would widen its scope (review #2)', (channel, method) => {
  /*
   * The daemon reads a missing or empty `projectId` as EVERY session — that is app close, which
   * main sends itself (`main.ts`). From the renderer it can only be a mistake, and the mistake
   * would end terminals in every project. So main rejects it without calling the daemon, and
   * rejects an `exceptPanelIds` it cannot honour rather than silently dropping the exceptions.
   */
  it.each([
    ['no params', undefined],
    ['no projectId', {}],
    ['an empty projectId', { projectId: '' }],
    ['a non-string projectId', { projectId: 7 }],
    ['exceptPanelIds that is not an array', { projectId: 'proj-1', exceptPanelIds: 'p-sub-1' }],
    ['exceptPanelIds holding a non-string', { projectId: 'proj-1', exceptPanelIds: ['p-sub-1', 3] }],
  ])('rejects %s, and never reaches the daemon', async (_label, params) => {
    await expect(Promise.resolve().then(() => handler(channel)(EVENT, params))).rejects.toThrow();
    expect(daemonCalls(method)).toEqual([]);
  });
});

describe("Unload's daemon calls get a budget that covers a process snapshot (branch review #1)", () => {
  /*
   * The default per-call budget is the health ping's 2 s. A busy probe takes one process snapshot,
   * measured at 0.55–0.7 s on a quiet machine, and the host caps a snapshot at 5 s before it gives
   * up and counts the terminal busy. Under the 2 s default, a loaded machine turned Unload into a
   * raw timeout — or, for closeIdle, a timeout in main while the daemon went on closing shells.
   * So these three calls say their own budget, and it must clear the host's 5 s cap.
   */
  const HOST_SNAPSHOT_CAP_MS = 5000;
  const budgetOf = (method: string) => timeouts.find((t) => t.method === method)?.timeoutMs;

  it.each([
    ['throng:terminal:closeIdle', 'terminal.closeIdle'],
    ['throng:terminal:killAll', 'terminal.killAll'],
  ] as const)('%s passes an explicit timeout above the snapshot cap', async (channel, method) => {
    await handler(channel)(EVENT, { projectId: 'proj-1' });
    expect(budgetOf(method)).toBeGreaterThan(HOST_SNAPSHOT_CAP_MS);
  });

  it('list with includeBusy passes one too', async () => {
    await handler('throng:terminal:list')(EVENT, 'proj-1', { includeBusy: true });
    expect(budgetOf('terminal.list')).toBeGreaterThan(HOST_SNAPSHOT_CAP_MS);
  });

  it('the plain list keeps the default budget — it probes nothing', async () => {
    await handler('throng:terminal:list')(EVENT, 'proj-1');
    expect(budgetOf('terminal.list')).toBeUndefined();
  });
});

describe('throng:terminal:list', () => {
  it('forwards includeBusy when asked, so Unload can count busy sessions', async () => {
    await handler('throng:terminal:list')(EVENT, 'proj-1', { includeBusy: true });
    expect(daemonCalls('terminal.list')).toEqual([
      { method: 'terminal.list', params: { projectId: 'proj-1', includeBusy: true } },
    ]);
  });

  it('stays the cheap no-probe call when not asked (the app-close count and every existing caller)', async () => {
    await handler('throng:terminal:list')(EVENT, 'proj-1');
    const [call] = daemonCalls('terminal.list');
    expect(call!.params.projectId).toBe('proj-1');
    expect(call!.params.includeBusy).toBeFalsy();
  });
});

describe('the renderer can reach the new channels', () => {
  const source = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

  it('the preload exposes closeIdle and killAll, and passes list its options', () => {
    const preload = source('../../src/preload/preload.cts');
    expect(preload).toContain(`ipcRenderer.invoke('throng:terminal:closeIdle'`);
    expect(preload).toContain(`ipcRenderer.invoke('throng:terminal:killAll'`);
    // `list` must forward a SECOND argument, or `includeBusy` never leaves the renderer.
    expect(preload).toMatch(/ipcRenderer\.invoke\('throng:terminal:list',\s*[^,)]+,\s*[^)]+\)/);
  });

  it('the renderer declaration types them', () => {
    const decl = source('../../src/renderer/global.d.ts');
    expect(decl).toMatch(/closeIdle:\s*\(/);
    expect(decl).toMatch(/killAll:\s*\(/);
    expect(decl).toMatch(/exceptPanelIds\?:\s*(readonly\s+)?string\[\]/);
    expect(decl).toMatch(/includeBusy\?:\s*boolean/);
  });
});
