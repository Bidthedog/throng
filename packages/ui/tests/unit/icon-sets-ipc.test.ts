/**
 * Spec 069 T021 — the `throng:iconSets:*` handlers (contracts/icon-sets-ipc.md).
 *
 * The renderer is not trusted and never sends a path: every path is resolved in main from a LISTED
 * set name, `throng` is never a folder, and the sets directory opens through `IShellIntegration`.
 * Every action reads the sets from disk before and after it, and broadcasts what they hold (FR-041).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ICON_SETS_CHANNELS,
  registerIconSetsIpc,
  type IconSetsIpcDeps,
  type IconSetsIpcMain,
} from '../../src/main/icon-sets-ipc.js';

const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>();
const ipc: IconSetsIpcMain = { handle: (channel, fn) => void handlers.set(channel, fn) };

async function call<T = unknown>(channel: string, payload?: unknown): Promise<T> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`channel not registered: ${channel}`);
  return (await fn({}, payload)) as T;
}

type ServiceFn = 'create' | 'override' | 'reload' | 'rescan' | 'rename' | 'remove' | 'resetIcon';

function makeDeps(initial: string[] = ['mine']): {
  deps: IconSetsIpcDeps;
  service: { [K in ServiceFn]: ReturnType<typeof vi.fn> };
  /** What the folders hold now: a rescan makes the listing this. */
  onDisk: string[];
  openFolder: ReturnType<typeof vi.fn>;
  onChanged: ReturnType<typeof vi.fn>;
  retargetThemes: ReturnType<typeof vi.fn>;
  beforeOpenFolder: ReturnType<typeof vi.fn>;
  order: string[];
} {
  let listed = [...initial];
  const onDisk = [...initial];
  const order: string[] = [];
  const ok = async () => ({ ok: true as const });
  const service = {
    create: vi.fn(ok),
    override: vi.fn(ok),
    reload: vi.fn(ok),
    rename: vi.fn(ok),
    remove: vi.fn(ok),
    resetIcon: vi.fn(ok),
    rescan: vi.fn(async () => {
      order.push('rescan');
      listed = [...onDisk];
    }),
  };
  const openFolder = vi.fn(async () => {
    order.push('open');
  });
  const onChanged = vi.fn(async () => {
    order.push('broadcast');
  });
  const retargetThemes = vi.fn(async () => []);
  const beforeOpenFolder = vi.fn(() => {
    order.push('yield');
  });
  const deps: IconSetsIpcDeps = {
    service: {
      ...service,
      list: () => listed.map((name) => ({ name, overrides: {}, failures: {}, unrecognised: [] })),
      pathOf: (name) => (listed.includes(name) ? `/sets/${name}` : undefined),
      dir: '/sets',
      ensureDir: async () => undefined,
    },
    shell: { openFolder },
    validateName: (name, existing) =>
      name.trim() === '' || existing.some((e) => e.toLowerCase() === name.toLowerCase())
        ? { ok: false, reason: 'taken or empty' }
        : { ok: true },
    onChanged,
    retargetThemes,
    beforeOpenFolder,
  };
  return { deps, service, onDisk, openFolder, onChanged, retargetThemes, beforeOpenFolder, order };
}

beforeEach(() => handlers.clear());

describe('every action reads the folders again (FR-041)', () => {
  it('rescans before and after the action, then broadcasts, even when the action is refused', async () => {
    const { deps, service, order } = makeDeps();
    service.override.mockImplementationOnce(async () => {
      order.push('override');
      return { ok: false, reason: 'exists', message: 'there' };
    });
    registerIconSetsIpc(ipc, deps);
    await call(ICON_SETS_CHANNELS.override, { set: 'mine', key: 'save', replace: false });
    expect(order).toEqual(['rescan', 'override', 'rescan', 'broadcast']);
  });

  it('acts on a set made outside throng since the window listed the sets', async () => {
    const { deps, service, onDisk } = makeDeps([]);
    registerIconSetsIpc(ipc, deps);
    onDisk.push('handmade');
    expect(await call(ICON_SETS_CHANNELS.override, { set: 'handmade', key: 'save', replace: false })).toEqual({ ok: true });
    expect(service.override).toHaveBeenCalledWith('handmade', 'save', false);
  });

  it('refuses a set removed outside throng, and still broadcasts the fresh listing', async () => {
    const { deps, service, onDisk, onChanged } = makeDeps(['mine']);
    registerIconSetsIpc(ipc, deps);
    onDisk.splice(0);
    expect(await call(ICON_SETS_CHANNELS.resetIcon, { set: 'mine', key: 'save' })).toMatchObject({ ok: false, reason: 'unknown-set' });
    expect(service.resetIcon).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});

describe('create', () => {
  it('validates the name against the listing, then creates', async () => {
    const { deps, service } = makeDeps();
    registerIconSetsIpc(ipc, deps);
    expect(await call(ICON_SETS_CHANNELS.create, { name: 'fresh', from: 'throng' })).toEqual({ ok: true });
    expect(service.create).toHaveBeenCalledWith('fresh', 'throng');
  });

  it('refuses an invalid name without touching the service', async () => {
    const { deps, service } = makeDeps();
    registerIconSetsIpc(ipc, deps);
    expect(await call(ICON_SETS_CHANNELS.create, { name: 'MINE', from: 'throng' })).toMatchObject({
      ok: false,
      reason: 'invalid-name',
      message: 'taken or empty',
    });
    expect(service.create).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 'x', { name: 1, from: 'throng' }, { name: 'a' }])(
    'refuses a malformed payload (%j)',
    async (payload) => {
      const { deps, service } = makeDeps();
      registerIconSetsIpc(ipc, deps);
      expect(await call(ICON_SETS_CHANNELS.create, payload)).toMatchObject({ ok: false, reason: 'invalid-name' });
      expect(service.create).not.toHaveBeenCalled();
    },
  );
});

describe('override', () => {
  it('passes the set, key and replace flag', async () => {
    const { deps, service } = makeDeps();
    registerIconSetsIpc(ipc, deps);
    expect(await call(ICON_SETS_CHANNELS.override, { set: 'mine', key: 'save', replace: true })).toEqual({ ok: true });
    expect(service.override).toHaveBeenCalledWith('mine', 'save', true);
  });

  it('treats anything but boolean true as replace: false', async () => {
    const { deps, service } = makeDeps();
    registerIconSetsIpc(ipc, deps);
    await call(ICON_SETS_CHANNELS.override, { set: 'mine', key: 'save', replace: 'yes' });
    expect(service.override).toHaveBeenCalledWith('mine', 'save', false);
  });

  it('refuses throng and an unknown set as unknown-set', async () => {
    const { deps, service } = makeDeps();
    registerIconSetsIpc(ipc, deps);
    for (const set of ['throng', 'nope']) {
      expect(await call(ICON_SETS_CHANNELS.override, { set, key: 'save', replace: false })).toMatchObject({
        ok: false,
        reason: 'unknown-set',
      });
    }
    expect(service.override).not.toHaveBeenCalled();
  });
});

describe('reload', () => {
  it('reads every set again, whichever is named', async () => {
    const { deps, service, onChanged } = makeDeps();
    registerIconSetsIpc(ipc, deps);
    expect(await call(ICON_SETS_CHANNELS.reload, {})).toEqual({ ok: true });
    expect(await call(ICON_SETS_CHANNELS.reload, { set: 'throng' })).toEqual({ ok: true });
    expect(service.reload).toHaveBeenCalledTimes(2);
    expect(onChanged).toHaveBeenCalledTimes(2);
  });
});

describe('rename (FR-042)', () => {
  it('renames a listed set and carries the themes using it along', async () => {
    const { deps, service, retargetThemes } = makeDeps(['mine', 'other']);
    registerIconSetsIpc(ipc, deps);
    expect(await call(ICON_SETS_CHANNELS.rename, { from: 'mine', to: 'ours' })).toEqual({ ok: true });
    expect(service.rename).toHaveBeenCalledWith('mine', 'ours');
    expect(retargetThemes).toHaveBeenCalledWith('mine', 'ours');
  });

  it('accepts a change of case alone: the set\'s own name is not a clash', async () => {
    const { deps, service } = makeDeps(['mine']);
    registerIconSetsIpc(ipc, deps);
    expect(await call(ICON_SETS_CHANNELS.rename, { from: 'mine', to: 'Mine' })).toEqual({ ok: true });
    expect(service.rename).toHaveBeenCalledWith('mine', 'Mine');
  });

  it('refuses a name another set has, and leaves the themes alone', async () => {
    const { deps, service, retargetThemes } = makeDeps(['mine', 'other']);
    registerIconSetsIpc(ipc, deps);
    expect(await call(ICON_SETS_CHANNELS.rename, { from: 'mine', to: 'OTHER' })).toMatchObject({ ok: false, reason: 'invalid-name' });
    expect(service.rename).not.toHaveBeenCalled();
    expect(retargetThemes).not.toHaveBeenCalled();
  });

  it('refuses an unknown set and a malformed payload', async () => {
    const { deps, service } = makeDeps();
    registerIconSetsIpc(ipc, deps);
    expect(await call(ICON_SETS_CHANNELS.rename, { from: 'throng', to: 'x' })).toMatchObject({ reason: 'unknown-set' });
    expect(await call(ICON_SETS_CHANNELS.rename, { from: 'mine' })).toMatchObject({ reason: 'invalid-name' });
    expect(service.rename).not.toHaveBeenCalled();
  });

  it('leaves the themes alone when the folder could not be renamed', async () => {
    const { deps, service, retargetThemes } = makeDeps();
    service.rename.mockResolvedValueOnce({ ok: false, reason: 'io', message: 'busy' });
    registerIconSetsIpc(ipc, deps);
    expect(await call(ICON_SETS_CHANNELS.rename, { from: 'mine', to: 'ours' })).toMatchObject({ reason: 'io' });
    expect(retargetThemes).not.toHaveBeenCalled();
  });
});

describe('delete (FR-043)', () => {
  it('deletes a listed set and returns the themes using it to the default set', async () => {
    const { deps, service, retargetThemes } = makeDeps();
    registerIconSetsIpc(ipc, deps);
    expect(await call(ICON_SETS_CHANNELS.remove, { set: 'mine' })).toEqual({ ok: true });
    expect(service.remove).toHaveBeenCalledWith('mine');
    expect(retargetThemes).toHaveBeenCalledWith('mine', undefined);
  });

  it('refuses throng and an unknown set', async () => {
    const { deps, service, retargetThemes } = makeDeps();
    registerIconSetsIpc(ipc, deps);
    for (const set of ['throng', 'nope', undefined]) {
      expect(await call(ICON_SETS_CHANNELS.remove, { set })).toMatchObject({ reason: 'unknown-set' });
    }
    expect(service.remove).not.toHaveBeenCalled();
    expect(retargetThemes).not.toHaveBeenCalled();
  });
});

describe('reset an icon (FR-044)', () => {
  it('passes the set and key', async () => {
    const { deps, service } = makeDeps();
    registerIconSetsIpc(ipc, deps);
    expect(await call(ICON_SETS_CHANNELS.resetIcon, { set: 'mine', key: 'save' })).toEqual({ ok: true });
    expect(service.resetIcon).toHaveBeenCalledWith('mine', 'save');
  });

  it('refuses an unknown set and a missing key', async () => {
    const { deps, service } = makeDeps();
    registerIconSetsIpc(ipc, deps);
    expect(await call(ICON_SETS_CHANNELS.resetIcon, { set: 'throng', key: 'save' })).toMatchObject({ reason: 'unknown-set' });
    expect(await call(ICON_SETS_CHANNELS.resetIcon, { set: 'mine' })).toMatchObject({ reason: 'unknown-key' });
    expect(service.resetIcon).not.toHaveBeenCalled();
  });
});

describe('openFolder', () => {
  it('opens the sets directory through the shell integration when no set is named', async () => {
    const { deps, openFolder } = makeDeps();
    registerIconSetsIpc(ipc, deps);
    expect(await call(ICON_SETS_CHANNELS.openFolder, {})).toEqual({ ok: true });
    expect(await call(ICON_SETS_CHANNELS.openFolder)).toEqual({ ok: true });
    expect(openFolder).toHaveBeenNthCalledWith(1, '/sets');
    expect(openFolder).toHaveBeenNthCalledWith(2, '/sets');
  });

  it('opens a listed set resolved in main, never a renderer path, after Preferences yields (FR-045)', async () => {
    const { deps, openFolder, order } = makeDeps();
    registerIconSetsIpc(ipc, deps);
    expect(await call(ICON_SETS_CHANNELS.openFolder, { set: 'mine' })).toEqual({ ok: true });
    expect(openFolder).toHaveBeenCalledWith('/sets/mine');
    expect(order).toEqual(['rescan', 'yield', 'open', 'rescan', 'broadcast']);
  });

  it('refuses throng, an unknown set and a path-shaped name', async () => {
    const { deps, openFolder, beforeOpenFolder } = makeDeps();
    registerIconSetsIpc(ipc, deps);
    for (const set of ['throng', 'nope', '../x', '/etc']) {
      expect(await call(ICON_SETS_CHANNELS.openFolder, { set })).toMatchObject({ ok: false, reason: 'unknown-set' });
    }
    expect(openFolder).not.toHaveBeenCalled();
    expect(beforeOpenFolder).not.toHaveBeenCalled();
  });

  it('reports an OS refusal as io, and does not throw', async () => {
    const { deps, openFolder } = makeDeps();
    openFolder.mockRejectedValueOnce(new Error('no file manager'));
    registerIconSetsIpc(ipc, deps);
    expect(await call(ICON_SETS_CHANNELS.openFolder, { set: 'mine' })).toMatchObject({ ok: false, reason: 'io' });
  });
});
