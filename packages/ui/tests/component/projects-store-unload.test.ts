/**
 * 046 US4 (T062) — `projects-store.tsx`'s new public transition, `unloadProject(id)`
 * (data-model.md §6, FR-032, FR-036). NOT YET ADDED (T071 GREEN) — every test below is red on
 * `ctx.unloadProject is not a function`.
 *
 * `loadedIds` and `openedId` are internal `useState` in `ProjectsProvider`
 * (`packages/ui/src/renderer/state/projects-store.tsx:124-126`), reachable only through the public
 * `ProjectsContextValue` — so this drives the REAL provider over a fake bridge and reads the two
 * observable effects back through `activeProject` and a project row's own `loaded` classification,
 * which is exactly what `projects-panel.tsx` already reads (`loadedIds.has(project.id)`).
 */
import { render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { ProjectDto } from '@throng/ipc-contract';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { ProjectsProvider, useProjects, type ProjectsContextValue } from '../../src/renderer/state/projects-store.js';

const now = '2026-01-01T00:00:00.000Z';
const project = (id: string): ProjectDto => ({
  id, name: id, colour: '#3b82f6', rootFolder: `C:/projects/${id}`, isActive: false,
  createdAt: now, updatedAt: now, hiddenPaths: [], categoryId: 'default',
});
const PROJECTS: ProjectDto[] = [project('p1'), project('p2')];

function fixture(): { client: ProjectsClient; setActiveCalls: string[] } {
  const setActiveCalls: string[] = [];
  const bridge: ThrongBridge = {
    invoke<T>(method: string, params?: unknown): Promise<T> {
      switch (method) {
        case 'projects.list':
          return Promise.resolve({ projects: PROJECTS } as unknown as T);
        case 'projects.categories.list':
          return Promise.resolve({ categories: [] } as unknown as T);
        case 'projects.setActive': {
          const id = (params as { id: string }).id;
          setActiveCalls.push(id);
          return Promise.resolve({ activeId: id } as unknown as T);
        }
        default:
          return Promise.reject(new Error(`unexpected projects RPC: ${method}`));
      }
    },
  };
  return { client: new ProjectsClient(bridge), setActiveCalls };
}

/** Captures the live `ProjectsContextValue` so the test can call its methods directly. */
function Probe({ onReady }: { onReady: (ctx: ProjectsContextValue) => void }): null {
  onReady(useProjects());
  return null;
}

async function mount(): Promise<{ ctx: () => ProjectsContextValue; setActiveCalls: string[] }> {
  const { client, setActiveCalls } = fixture();
  const captured: { ctx: ProjectsContextValue | null } = { ctx: null };
  render(
    createElement(
      ProjectsProvider,
      { client },
      createElement(Probe, { onReady: (ctx) => { captured.ctx = ctx; } }),
    ),
  );
  await waitFor(() => expect(captured.ctx?.projects.length).toBeGreaterThan(0));
  return { ctx: () => captured.ctx as ProjectsContextValue, setActiveCalls };
}

describe('unloadProject(id) removes the id from loadedIds (FR-032, data-model §6)', () => {
  it('a loaded, INACTIVE project is unloaded without touching openedId', async () => {
    const { ctx } = await mount();
    await ctx().switchProject('p1');
    await waitFor(() => expect(ctx().activeProject?.id).toBe('p1'));
    // p2 is loaded but never made active.
    await ctx().switchProject('p2');
    await waitFor(() => expect(ctx().activeProject?.id).toBe('p2'));
    // Re-activate p1 so p2 is loaded-but-inactive for the assertion below.
    await ctx().switchProject('p1');
    await waitFor(() => expect(ctx().activeProject?.id).toBe('p1'));
    expect(ctx().loadedIds.has('p2')).toBe(true);

    ctx().unloadProject('p2');

    await waitFor(() => expect(ctx().loadedIds.has('p2')).toBe(false));
    // p1 is still active — unloading p2 did not touch it.
    expect(ctx().activeProject?.id).toBe('p1');
  });
});

describe('unloading the ACTIVE project sets openedId to null (FR-036)', () => {
  it('activeProject becomes null, and the id leaves loadedIds', async () => {
    const { ctx } = await mount();
    await ctx().switchProject('p1');
    await waitFor(() => expect(ctx().activeProject?.id).toBe('p1'));

    ctx().unloadProject('p1');

    await waitFor(() => expect(ctx().activeProject).toBeNull());
    expect(ctx().loadedIds.has('p1')).toBe(false);
  });
});

describe('a later switchProject(id) loads it again as usual (data-model §6)', () => {
  it('re-opens the project and marks it loaded again', async () => {
    const { ctx, setActiveCalls } = await mount();
    await ctx().switchProject('p1');
    await waitFor(() => expect(ctx().activeProject?.id).toBe('p1'));
    ctx().unloadProject('p1');
    await waitFor(() => expect(ctx().activeProject).toBeNull());

    await ctx().switchProject('p1');

    await waitFor(() => expect(ctx().activeProject?.id).toBe('p1'));
    expect(ctx().loadedIds.has('p1')).toBe(true);
    // A REAL re-open — the RPC ran a second time, not a cached no-op.
    expect(setActiveCalls.filter((id) => id === 'p1')).toHaveLength(2);
  });
});

describe('unloadProject never persists — loaded state is session-only (data-model §6)', () => {
  it('leaves the project list/RPC call surface untouched (no projects.* call made by unload itself)', async () => {
    const { ctx } = await mount();
    await ctx().switchProject('p1');
    await waitFor(() => expect(ctx().activeProject?.id).toBe('p1'));

    // unloadProject(id) is a pure client-side transition — nothing to await, and it must not throw
    // reaching for an RPC the contract never gives it (contracts/unload.md §5: "does not… change the
    // daemon's persisted is_active").
    expect(() => ctx().unloadProject('p1')).not.toThrow();
  });
});
