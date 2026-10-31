/**
 * #212 — a project switch that FAILS must leave the opened project where it actually is.
 *
 * MIGRATED FROM `packages/ui/tests/e2e/daemon-status-bar.e2e.ts:199` ("a failed project switch leaves the active
 * project where it was") — test-suite audit, pass 1.
 *
 * Layer: component. The E2E stopped a real daemon to make `projects.setActive` fail, then slept 5 s because the
 * optimistic update is a transient it could not fence. Here the failing RPC is a promise the test holds and
 * rejects itself, so the optimistic state is observed first (the switch was genuinely attempted) and the rollback
 * after it — no sleep, no race.
 *
 * `switchProject` lives in `ProjectsProvider` (`state/projects-store.tsx`), not in the workspace store; the file is
 * named for the failing RPC's owner in the audit. The provider mounts over a real `ProjectsClient` on a fake
 * `ThrongBridge` — the pattern `project-settings-dialog.test.ts` uses.
 *
 * `openedId` drives `activeProject`, which drives the sidebar's `data-active`, the window title and the accent
 * colour — so a store that keeps the failed project highlights, titles and colours itself for a project that was
 * never opened.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { ProjectDto } from '@throng/ipc-contract';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { ProjectsProvider, useProjects } from '../../src/renderer/state/projects-store.js';

const project = (id: string, name: string): ProjectDto => ({
  id,
  name,
  colour: '#3b82f6',
  rootFolder: `C:/projects/${id}`,
  isActive: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  hiddenPaths: [],
  searchExcludeGlobs: [],
});

/** A daemon whose `projects.setActive` for Bravo is held until the test rejects it. */
function fakeDaemon() {
  const projects = [project('p1', 'Alpha'), project('p2', 'Bravo')];
  const setActiveCalls: string[] = [];
  let rejectBravo: (reason: Error) => void = () => undefined;

  const bridge: ThrongBridge = {
    invoke<TResult>(method: string, params?: unknown): Promise<TResult> {
      switch (method) {
        case 'projects.list':
          return Promise.resolve({ projects } as TResult);
        case 'projects.categories.list':
          return Promise.resolve({ categories: [] } as TResult);
        case 'projects.setActive': {
          const { id } = params as { id: string };
          setActiveCalls.push(id);
          if (id === 'p2') {
            return new Promise<TResult>((_resolve, reject) => {
              rejectBravo = reject;
            });
          }
          return Promise.resolve({ activeId: id } as TResult);
        }
        default:
          return Promise.reject(new Error(`unexpected RPC: ${method}`));
      }
    },
  };

  return {
    client: new ProjectsClient(bridge),
    setActiveCalls,
    rejectBravo: (): void => rejectBravo(new Error('the daemon is not running')),
  };
}

function Host(): ReactElement {
  const { activeProject, loading, switchProject } = useProjects();
  return createElement(
    'div',
    null,
    createElement('span', { 'data-testid': 'store-state' }, loading ? 'loading' : 'ready'),
    createElement('span', { 'data-testid': 'active-project' }, activeProject?.name ?? 'none'),
    createElement('button', { 'data-testid': 'open-p1', onClick: () => void switchProject('p1') }, 'open p1'),
    createElement('button', { 'data-testid': 'open-p2', onClick: () => void switchProject('p2') }, 'open p2'),
  );
}

describe('a project switch whose RPC fails (#212)', () => {
  it('puts the opened project back where it was, rather than staying on the one it never entered', async () => {
    const daemon = fakeDaemon();
    const user = userEvent.setup();
    render(createElement(ProjectsProvider, { client: daemon.client, children: createElement(Host) }));
    await waitFor(() => expect(screen.getByTestId('store-state')).toHaveTextContent('ready'));

    // SETUP: Alpha is open and the app agrees, so switching to Bravo is a real change.
    await user.click(screen.getByTestId('open-p1'));
    await waitFor(() => expect(screen.getByTestId('active-project')).toHaveTextContent('Alpha'));

    // The switch is attempted: the optimistic update shows Bravo while the RPC is still in flight. Asserted so the
    // rollback below is a transition and not a switch that never started.
    await user.click(screen.getByTestId('open-p2'));
    await waitFor(() => expect(screen.getByTestId('active-project')).toHaveTextContent('Bravo'));
    expect(daemon.setActiveCalls).toEqual(['p1', 'p2']);

    // The daemon cannot serve it.
    daemon.rejectBravo();

    await waitFor(
      () => expect(screen.getByTestId('active-project'), 'the app moved to a project it never opened').toHaveTextContent('Alpha'),
    );
  });

  it('does not roll back a switch that succeeds', async () => {
    const daemon = fakeDaemon();
    const user = userEvent.setup();
    render(createElement(ProjectsProvider, { client: daemon.client, children: createElement(Host) }));
    await waitFor(() => expect(screen.getByTestId('store-state')).toHaveTextContent('ready'));

    // The control: p1 → p1's RPC resolves, and the project stays open. A rollback that always fired would pass the
    // test above and fail this one.
    await user.click(screen.getByTestId('open-p1'));
    await waitFor(() => expect(screen.getByTestId('active-project')).toHaveTextContent('Alpha'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId('active-project')).toHaveTextContent('Alpha');
  });
});
