import { describe, it, expect } from 'vitest';
import { PANEL_NAME_CLAIM_METHOD, PANEL_NAME_RECONCILE_METHOD } from '@throng/ipc-contract';
import type { WorkspaceLayout } from '@throng/core';
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
}): { service: PanelNameIpcService; router: RpcRouter; saves: string[] } {
  const saves: string[] = [];
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
      save: (_o: string, projectId: string) => {
        saves.push(projectId);
      },
      loadSubWorkspaces: () => [],
      persistSubWorkspaces: () => {},
    } as never,
    userContext: { currentUser: () => ({ userId: OWNER }) } as never,
  });
  const router = new RpcRouter();
  service.register(router);
  return { service, router, saves };
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
