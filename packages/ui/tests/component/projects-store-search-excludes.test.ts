/**
 * `setSearchExcludes` on the projects store (060 #532 T048, FR-033/FR-035).
 *
 * It sits beside `setProjectHidden` and has the same shape: the whole list REPLACES the stored one,
 * so a caller that adds an entry sends the list plus the entry. The store re-lists after the RPC so
 * the active project's `searchExcludeGlobs` is what the next render reads.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { ProjectDto } from '@throng/ipc-contract';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { ProjectsProvider, useProjects } from '../../src/renderer/state/projects-store.js';

function fakeDaemon() {
  let project: ProjectDto = {
    id: 'p1',
    name: 'Demo',
    colour: '#336699',
    rootFolder: 'C:/code/p1',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    hiddenPaths: [],
    searchExcludeGlobs: [],
  };
  const calls: Array<{ method: string; params: unknown }> = [];
  const bridge: ThrongBridge = {
    invoke<TResult>(method: string, params?: unknown): Promise<TResult> {
      calls.push({ method, params });
      switch (method) {
        case 'projects.list':
          return Promise.resolve({ projects: [{ ...project }] } as TResult);
        case 'projects.categories.list':
          return Promise.resolve({ categories: [] } as TResult);
        case 'projects.setSearchExcludes': {
          const { searchExcludeGlobs } = params as { searchExcludeGlobs: string[] };
          project = { ...project, searchExcludeGlobs: [...searchExcludeGlobs] };
          return Promise.resolve({ project } as TResult);
        }
        default:
          return Promise.reject(new Error(`unexpected RPC: ${method}`));
      }
    },
  };
  return { client: new ProjectsClient(bridge), calls };
}

describe('setSearchExcludes (FR-033, FR-035)', () => {
  it('sends the whole list over projects.setSearchExcludes and the store then reads it back', async () => {
    const { client, calls } = fakeDaemon();
    const wrapper = ({ children }: { children: ReactNode }): ReactElement =>
      createElement(ProjectsProvider, { client, children });
    const { result } = renderHook(() => useProjects(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setSearchExcludes('p1', ['**/gen', '**/fixtures']);
    });

    expect(calls.find((c) => c.method === 'projects.setSearchExcludes')?.params).toEqual({
      id: 'p1',
      searchExcludeGlobs: ['**/gen', '**/fixtures'],
    });
    await waitFor(() =>
      expect(result.current.projects[0]?.searchExcludeGlobs).toEqual(['**/gen', '**/fixtures']),
    );
  });
});
