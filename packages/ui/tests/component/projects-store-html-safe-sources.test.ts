/**
 * `setHtmlSafeSources` on the projects store (074 T054, FR-072a).
 *
 * It sits beside `setProjectHidden` and has the same shape: the whole list REPLACES the stored one,
 * so a caller that adds an entry sends the list plus the entry. The store re-lists after the RPC so
 * the project's `htmlSafeSources` is what the next render reads.
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
    htmlSafeSources: [],
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
        case 'projects.setHtmlSafeSources': {
          const { htmlSafeSources } = params as { htmlSafeSources: string[] };
          project = { ...project, htmlSafeSources: [...htmlSafeSources] };
          return Promise.resolve({ project } as TResult);
        }
        default:
          return Promise.reject(new Error(`unexpected RPC: ${method}`));
      }
    },
  };
  return { client: new ProjectsClient(bridge), calls };
}

describe('setHtmlSafeSources (FR-072a)', () => {
  it('sends the whole list over projects.setHtmlSafeSources and the store then reads it back', async () => {
    const { client, calls } = fakeDaemon();
    const wrapper = ({ children }: { children: ReactNode }): ReactElement =>
      createElement(ProjectsProvider, { client, children });
    const { result } = renderHook(() => useProjects(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setHtmlSafeSources('p1', ['https://cdn.example.com', 'https://*.example.org']);
    });

    expect(calls.find((c) => c.method === 'projects.setHtmlSafeSources')?.params).toEqual({
      id: 'p1',
      htmlSafeSources: ['https://cdn.example.com', 'https://*.example.org'],
    });
    await waitFor(() =>
      expect(result.current.projects[0]?.htmlSafeSources).toEqual(['https://cdn.example.com', 'https://*.example.org']),
    );
  });
});
