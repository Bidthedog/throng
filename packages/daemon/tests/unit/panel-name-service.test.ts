import { describe, it, expect } from 'vitest';
import { PANEL_NAME_CLAIM_METHOD, PANEL_NAME_RECONCILE_METHOD } from '@throng/ipc-contract';
import type { SubWorkspace, WorkspaceLayout } from '@throng/core';
import { PanelNameIpcService } from '../../src/panel-name-service.js';
import { RpcRouter } from '../../src/rpc-router.js';

/**
 * `panelName.*` (024, #184) — the daemon is the only component that can see every panel name, so it
 * decides whether one is taken.
 *
 * The case these tests exist for is the phantom. `WorkspaceRepository.load` is a convenience that
 * SYNTHESISES a default layout — containing a panel called "Panel 1" — for any project that has
 * never saved one. Those panels do not exist: nothing shows them and no id matches them. Counting
 * them made the first panel of a brand-new project clash with its own phantom and come out as
 * "Panel 1 (2)", and reconcile would then have PERSISTED the invention.
 */
const OWNER = 'u1';

function layoutWith(panels: { id: string; title: string }[], projectId = 'proj'): WorkspaceLayout {
  const leaves = panels.map((p) => ({
    type: 'panel' as const,
    id: p.id,
    title: p.title,
    originProjectId: projectId,
  }));
  // A single-child split is always collapsed away (INV-3), so one panel is the root itself.
  const root =
    leaves.length === 1
      ? leaves[0]
      : {
          type: 'split' as const,
          orientation: 'row' as const,
          children: leaves,
          sizes: leaves.map(() => 1 / leaves.length),
        };
  return { tabs: [{ id: 't1', title: 'Tab 1', root }], activeTabId: 't1' } as unknown as WorkspaceLayout;
}

function makeService(opts: {
  projects: string[];
  saved: Record<string, WorkspaceLayout>;
  subs?: SubWorkspace[];
}): { service: PanelNameIpcService; router: RpcRouter; saves: string[]; written: Record<string, WorkspaceLayout>; persistedSubs: SubWorkspace[][] } {
  const saves: string[] = [];
  const written: Record<string, WorkspaceLayout> = {};
  const persistedSubs: SubWorkspace[][] = [];
  const service = new PanelNameIpcService({
    projectStore: { list: () => opts.projects.map((id) => ({ id })) as never },
    workspaceStore: {
      load: (_o: string, projectId: string) => {
        const saved = opts.saved[projectId];
        return saved
          ? { layout: saved, restored: true }
          : // What the real repository does for an unsaved project: a default layout it made up.
            { layout: layoutWith([{ id: `phantom-${projectId}`, title: 'Panel 1' }], projectId), restored: false, reason: 'missing' };
      },
      save: (_o: string, projectId: string, layout: WorkspaceLayout) => {
        written[projectId] = layout;
        saves.push(projectId);
      },
      loadSubWorkspaces: () => opts.subs ?? [],
      persistSubWorkspaces: (_o: string, subs: SubWorkspace[]) => {
        persistedSubs.push(subs);
      },
    } as never,
    userContext: { currentUser: () => ({ userId: OWNER }) } as never,
  });
  const router = new RpcRouter();
  service.register(router);
  return { service, router, saves, written, persistedSubs };
}

async function call(router: RpcRouter, method: string, params: unknown): Promise<never> {
  return (await router.handle({ jsonrpc: '2.0', id: 1, method, params } as never)) as never;
}

describe('panelName.claim (024, #184)', () => {
  it('grants the name a brand-new project asks for — no phantom to clash with', async () => {
    const { router } = makeService({ projects: ['p-new'], saved: {} });
    const res = (await call(router, PANEL_NAME_CLAIM_METHOD, {
      panelId: 'real-1',
      desired: 'Panel 1',
    })) as unknown as { result: { granted: string; adjusted: boolean } };
    expect(res.result.granted).toBe('Panel 1');
    expect(res.result.adjusted).toBe(false);
  });

  it('still adjusts against a REAL panel in another project', async () => {
    const { router } = makeService({
      projects: ['a', 'b'],
      saved: { a: layoutWith([{ id: 'pa', title: 'Build' }]) },
    });
    const res = (await call(router, PANEL_NAME_CLAIM_METHOD, {
      panelId: 'pb',
      desired: 'Build',
    })) as unknown as { result: { granted: string; adjusted: boolean } };
    expect(res.result.granted).toBe('Build (2)');
    expect(res.result.adjusted).toBe(true);
  });

  it('never clashes a panel with ITSELF', async () => {
    const { router } = makeService({
      projects: ['a'],
      saved: { a: layoutWith([{ id: 'pa', title: 'Build' }]) },
    });
    const res = (await call(router, PANEL_NAME_CLAIM_METHOD, {
      panelId: 'pa',
      desired: 'Build',
    })) as unknown as { result: { granted: string; adjusted: boolean } };
    expect(res.result.granted).toBe('Build');
    expect(res.result.adjusted).toBe(false);
  });
});

describe('panelName.reconcile (024, #184)', () => {
  it('does not CREATE a layout for a project that never saved one', async () => {
    const { router, saves } = makeService({ projects: ['never-opened'], saved: {} });
    await call(router, PANEL_NAME_RECONCILE_METHOD, {});
    // Writing the synthesised default back would invent a persisted panel for a project the user
    // has not opened.
    expect(saves).toEqual([]);
  });

  it('leaves already-unique real layouts untouched', async () => {
    const { router, saves } = makeService({
      projects: ['a', 'b'],
      saved: {
        a: layoutWith([{ id: 'pa', title: 'Alpha' }]),
        b: layoutWith([{ id: 'pb', title: 'Beta' }]),
      },
    });
    await call(router, PANEL_NAME_RECONCILE_METHOD, {});
    expect(saves).toEqual([]);
  });
});

/**
 * 048 FR-035 (review R4) — names are judged AFTER the custom-title migration.
 *
 * A pre-048 panel renamed "Build" whose original title was "Panel 2" will SHOW "Panel 2" once
 * `dropCustomPanelTitles` runs on load. If uniqueness were judged on the stored "Build", it would pass
 * beside another project's real "Panel 2", and both panels would show "Panel 2" after the upgrade.
 */
describe('panelName.* judges migrated titles (048 FR-035)', () => {
  const legacy = (id: string, title: string, defaultTitle: string, projectId: string): WorkspaceLayout =>
    ({
      tabs: [
        {
          id: 't1',
          title: 'Tab 1',
          root: { type: 'panel', id, title, titleIsCustom: true, defaultTitle, originProjectId: projectId },
        },
      ],
      activeTabId: 't1',
    }) as unknown as WorkspaceLayout;

  it('reconcile sees a custom-titled panel by its migrated title, renames the clash, and writes no legacy field', async () => {
    const { router, written } = makeService({
      projects: ['a', 'b'],
      saved: {
        a: layoutWith([{ id: 'pa', title: 'Panel 2' }], 'a'),
        b: legacy('pb', 'Build', 'Panel 2', 'b'),
      },
    });
    const res = (await call(router, PANEL_NAME_RECONCILE_METHOD, {})) as unknown as { result: { renamed: number } };
    expect(res.result.renamed).toBe(1);
    const root = written.b?.tabs[0].root as unknown as Record<string, unknown>;
    expect(root.title).not.toBe('Panel 2');
    expect(root.title).not.toBe('Build');
    expect(root).not.toHaveProperty('titleIsCustom');
    expect(root).not.toHaveProperty('defaultTitle');
  });

  it('claim treats a migrated title as taken', async () => {
    const { router } = makeService({ projects: ['b'], saved: { b: legacy('pb', 'Build', 'Panel 2', 'b') } });
    // "Panel 2" migrates to "Build"'s creation title, which FR-128 then retires to "Blank Panel".
    const res = (await call(router, PANEL_NAME_CLAIM_METHOD, { panelId: 'new', desired: 'Blank Panel' })) as unknown as {
      result: { granted: string; adjusted: boolean };
    };
    expect(res.result.adjusted).toBe(true);
    const freed = (await call(router, PANEL_NAME_CLAIM_METHOD, { panelId: 'new', desired: 'Build' })) as unknown as {
      result: { adjusted: boolean };
    };
    expect(freed.result.adjusted).toBe(false);
  });

  it('judges sub-workspace panels by their migrated titles too', async () => {
    const sub = {
      id: 's1',
      tabs: [
        {
          id: 'st',
          title: 'Tab 1',
          root: { type: 'panel', id: 'ps', title: 'Mine', titleIsCustom: true, defaultTitle: 'Panel 2', originProjectId: 'a' },
        },
      ],
    } as unknown as SubWorkspace;
    const { router, persistedSubs } = makeService({
      projects: ['a'],
      saved: { a: layoutWith([{ id: 'pa', title: 'Panel 2' }], 'a') },
      subs: [sub],
    });
    await call(router, PANEL_NAME_RECONCILE_METHOD, {});
    expect(persistedSubs).toHaveLength(1);
    const root = persistedSubs[0][0].tabs[0].root as unknown as Record<string, unknown>;
    expect(root.title).not.toBe('Panel 2');
    expect(root).not.toHaveProperty('titleIsCustom');
  });
});

/**
 * 048 FR-128 — saved generated "Panel N" titles retire to the Blank Panel sequence. The read path
 * turns each into "Blank Panel"; reconcile then numbers the duplicates application-wide, and persists
 * only what it renamed. A second reconcile over what it wrote renames nothing.
 */
describe('panelName.reconcile retires legacy "Panel N" titles (048 FR-128)', () => {
  it('numbers them into one unique Blank Panel sequence across projects and sub-workspaces', async () => {
    const sub = {
      id: 's1',
      tabs: [{ id: 'st', title: 'Tab 1', root: { type: 'panel', id: 'ps', title: 'Panel 2', originProjectId: 'a' } }],
    } as unknown as SubWorkspace;
    const { router, written, persistedSubs } = makeService({
      projects: ['a', 'b'],
      saved: {
        a: layoutWith([{ id: 'pa', title: 'Panel 1' }], 'a'),
        b: layoutWith([{ id: 'pb', title: 'Panel 1' }], 'b'),
      },
      subs: [sub],
    });
    const res = (await call(router, PANEL_NAME_RECONCILE_METHOD, {})) as unknown as { result: { renamed: number } };
    expect(res.result.renamed).toBe(2);
    expect((written.b?.tabs[0].root as unknown as { title: string }).title).toBe('Blank Panel 2');
    expect((persistedSubs[0][0].tabs[0].root as unknown as { title: string }).title).toBe('Blank Panel 3');
  });

  it('renames nothing on a second pass over what it wrote', async () => {
    const { router } = makeService({
      projects: ['a', 'b'],
      saved: {
        a: layoutWith([{ id: 'pa', title: 'Panel 1' }], 'a'),
        b: layoutWith([{ id: 'pb', title: 'Blank Panel 2' }], 'b'),
      },
    });
    const res = (await call(router, PANEL_NAME_RECONCILE_METHOD, {})) as unknown as { result: { renamed: number } };
    expect(res.result.renamed).toBe(0);
  });
});
