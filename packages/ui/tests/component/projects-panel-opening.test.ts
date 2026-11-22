/**
 * #702 — a project click is acknowledged at once: the row takes the active highlight and shows the
 * app's busy glyph (060 FR-001b) while its workspace is still opening, and the glyph goes once the
 * workspace has loaded, or once a failed switch has reverted (#212).
 *
 * Layer: component — the glyph is a function of two stores (the active project, and whether the
 * workspace on screen is that project's yet); only a render of the panel over both shows it.
 *
 * The daemon's `workspace.load` is held open by the test, which is what an installed throng's first
 * open of a large project does for a second or two: the glyph is asserted while it is held, and
 * after it is released.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultLayout } from '@throng/core';
import type { ProjectDto } from '@throng/ipc-contract';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { ProjectsProvider, useProjects } from '../../src/renderer/state/projects-store.js';
import { WorkspaceProvider } from '../../src/renderer/state/workspace-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ProjectsPanel } from '../../src/renderer/sidebar/projects-panel.js';

const project = (id: string, name: string): ProjectDto => ({
  id,
  name,
  colour: '#3b82f6',
  rootFolder: `C:/c/${id}`,
  isActive: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  hiddenPaths: [],
});
const ALPHA = project('alpha', 'Alpha');
const BRAVO = project('bravo', 'Bravo');

interface Held {
  release(): void;
}

/** A daemon whose `workspace.load` for BRAVO waits until the test releases it. */
function daemonBridge(opts: { failSwitch?: boolean } = {}): { bridge: ThrongBridge; held: Held } {
  let seq = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const bridge: ThrongBridge = {
    invoke<TResult>(method: string, params?: unknown): Promise<TResult> {
      switch (method) {
        case 'projects.list':
          return Promise.resolve({ projects: [ALPHA, BRAVO] } as unknown as TResult);
        case 'projects.categories.list':
          return Promise.resolve({ categories: [] } as unknown as TResult);
        case 'projects.setActive':
          if (opts.failSwitch && (params as { id: string }).id === BRAVO.id) return Promise.reject(new Error('the daemon refused the switch'));
          return Promise.resolve({ activeId: (params as { id: string }).id } as unknown as TResult);
        case 'workspace.load': {
          const { projectId } = params as { projectId: string };
          const layout = createDefaultLayout(projectId, { tab: `t${(seq += 1)}`, panel: `pn${(seq += 1)}` });
          const answer = { layout, restored: false } as unknown as TResult;
          return projectId === BRAVO.id ? gate.then(() => answer) : Promise.resolve(answer);
        }
        case 'workspace.save':
          return Promise.resolve({ ok: true } as unknown as TResult);
        default:
          return Promise.reject(new Error(`unexpected RPC from the projects panel: ${method}`));
      }
    },
  };
  return { bridge, held: { release: () => release() } };
}

function WorkspaceForActiveProject({ client, children }: { client: WorkspaceClient; children: ReactNode }): ReactElement {
  const { activeProject } = useProjects();
  return createElement(WorkspaceProvider, { client, activeProjectId: activeProject?.id ?? null, children });
}

async function mount(opts: { failSwitch?: boolean } = {}): Promise<Held> {
  Reflect.set(window, 'throng', {
    editor: { subWorkspaceFiles: () => Promise.resolve([]) },
    projects: { onChanged: () => () => {}, notifyChanged: () => {} },
    panels: { publishIdentities: () => {} },
    config: { writePatch: () => Promise.resolve({ ok: true }) },
  });
  const { bridge, held } = daemonBridge(opts);
  render(
    createElement(ProjectsProvider, {
      client: new ProjectsClient(bridge),
      children: createElement(WorkspaceForActiveProject, {
        client: new WorkspaceClient(bridge),
        children: createElement(
          NotificationProvider,
          null,
          createElement(ConfirmProvider, null, createElement(ContextMenuProvider, null, createElement(ProjectsPanel))),
        ),
      }),
    }),
  );
  await waitFor(() => screen.getByTestId(`project-item-${BRAVO.id}`));
  // Alpha open and drawn first, so the switch below is a switch AWAY from a drawn workspace.
  await userEvent.setup({ delay: null }).click(screen.getByTestId(`project-switch-${ALPHA.id}`));
  await waitFor(() => expect(screen.getByTestId(`project-item-${ALPHA.id}`)).toHaveClass('project-item--active'));
  await waitFor(() => expect(screen.queryByTestId(`project-opening-${ALPHA.id}`)).toBeNull());
  return held;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
  localStorage.clear();
});

describe('a project click is acknowledged at once (#702)', () => {
  it('the clicked row is active and shows the busy glyph while its workspace opens, and the glyph goes once it has', async () => {
    const held = await mount();
    await userEvent.setup({ delay: null }).click(screen.getByTestId(`project-switch-${BRAVO.id}`));

    const row = screen.getByTestId(`project-item-${BRAVO.id}`);
    expect(row).toHaveClass('project-item--active');
    const glyph = await screen.findByTestId(`project-opening-${BRAVO.id}`);
    expect(glyph.querySelector('.busy-glyph')).not.toBeNull();
    expect(screen.queryByTestId(`project-opening-${ALPHA.id}`)).toBeNull();

    await act(async () => held.release());
    await waitFor(() => expect(screen.queryByTestId(`project-opening-${BRAVO.id}`)).toBeNull());
    expect(screen.getByTestId(`project-item-${BRAVO.id}`)).toHaveClass('project-item--active');
  });

  it('a switch the daemon refuses reverts the highlight, and leaves no glyph behind (#212)', async () => {
    await mount({ failSwitch: true });
    await userEvent.setup({ delay: null }).click(screen.getByTestId(`project-switch-${BRAVO.id}`));
    await waitFor(() => expect(screen.getByTestId(`project-item-${ALPHA.id}`)).toHaveClass('project-item--active'));
    // Reverting re-opens Alpha's layout, which is itself an open: its glyph may turn for that load,
    // and must then go. Bravo's never stays, though its own load was never answered.
    await waitFor(() => expect(screen.queryByTestId(`project-opening-${ALPHA.id}`)).toBeNull());
    expect(screen.queryByTestId(`project-opening-${BRAVO.id}`)).toBeNull();
  });
});
