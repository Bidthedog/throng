/**
 * A project not yet opened this session is marked UNLOADED, and opening it marks it loaded
 * (046 T048b; the loaded/unloaded indication of the Projects pane, spec *Key Entities*).
 *
 * MIGRATED FROM (046 T048b, Principle V budget offset): `packages/ui/tests/e2e/loaded-projects.e2e.ts`
 * *"indicates loaded vs not-loaded projects"*, the file's only declaration, now deleted.
 *
 * ══ WHY A FRESH STORE IS A RESTART ══
 *
 * The E2E launched the app twice over one data directory: the first session created the project,
 * the second started lazily and so began with it UNLOADED. Loaded state is session-only — it lives in
 * `projects-store.tsx`'s `loadedIds`, never on disk — so the second launch contributed exactly one
 * thing: a fresh store over a persisted project. That is what `mount()` below builds, with the
 * persisted project coming back from `projects.list` the way the daemon returns it.
 *
 * ══ WHAT DOES NOT COME DOWN ══
 *
 * The painted italic. The E2E read `getComputedStyle(name).fontStyle`, and jsdom applies no
 * stylesheet, so a component test can only say which CLASS the row carries — never how it was
 * painted (Principle V). That half moves into T065's E2E declaration, as an extra case after Unload.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Drop the `project-item--unloaded` modifier in `projects-panel.tsx` and the first test fails on its
 * class assertion; observed red before the E2E was deleted.
 */
import { render, screen, waitFor } from '@testing-library/react';
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

const PERSISTED: ProjectDto = {
  id: 'persist',
  name: 'Persist',
  colour: '#3b82f6',
  rootFolder: 'C:/c/persist',
  isActive: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  hiddenPaths: [],
};

/** A daemon that has ONE project on disk from an earlier session, and nothing else. */
function daemonBridge(): ThrongBridge {
  let seq = 0;
  return {
    invoke<TResult>(method: string, params?: unknown): Promise<TResult> {
      switch (method) {
        case 'projects.list':
          return Promise.resolve({ projects: [PERSISTED] } as unknown as TResult);
        case 'projects.categories.list':
          return Promise.resolve({ categories: [] } as unknown as TResult);
        case 'projects.setActive':
          return Promise.resolve({ activeId: (params as { id: string }).id } as unknown as TResult);
        case 'workspace.load': {
          const { projectId } = params as { projectId: string };
          const layout = createDefaultLayout(projectId, { tab: `t${(seq += 1)}`, panel: `pn${(seq += 1)}` });
          return Promise.resolve({ layout, restored: false } as unknown as TResult);
        }
        case 'workspace.save':
          return Promise.resolve({ ok: true } as unknown as TResult);
        default:
          return Promise.reject(new Error(`unexpected RPC from the projects panel: ${method}`));
      }
    },
  };
}

function WorkspaceForActiveProject({ client, children }: { client: WorkspaceClient; children: ReactNode }): ReactElement {
  const { activeProject } = useProjects();
  return createElement(WorkspaceProvider, { client, activeProjectId: activeProject?.id ?? null, children });
}

async function mount(): Promise<HTMLElement> {
  Reflect.set(window, 'throng', {
    editor: { subWorkspaceFiles: () => Promise.resolve([]) },
    projects: { onChanged: () => () => {}, notifyChanged: () => {} },
    panels: { publishIdentities: () => {} },
    config: { writePatch: () => Promise.resolve({ ok: true }) },
  });
  const bridge = daemonBridge();
  render(
    createElement(ProjectsProvider, {
      client: new ProjectsClient(bridge),
      children: createElement(WorkspaceForActiveProject, {
        client: new WorkspaceClient(bridge),
        children: createElement(
          NotificationProvider,
          null,
          createElement(
            ConfirmProvider,
            null,
            createElement(ContextMenuProvider, null, createElement(ProjectsPanel)),
          ),
        ),
      }),
    }),
  );
  // Something PRESENT first — the persisted row — so no absence below is satisfied by an empty list.
  return waitFor(() => screen.getByTestId(`project-item-${PERSISTED.id}`));
}

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
  localStorage.clear();
});

describe('loaded vs not-loaded projects (046 T048b, from loaded-projects.e2e.ts)', () => {
  it('a persisted project starts a session UNLOADED, with neither an unsaved dot nor a loaded marker', async () => {
    const row = await mount();
    expect(row).toHaveAttribute('data-loaded', 'false');
    expect(row).toHaveClass('project-item--unloaded');
    expect(row.querySelector('.throng-unsaved-dot')).toBeNull();
    expect(row.querySelector('.project-item__loaded')).toBeNull();
  });

  it('opening it marks it loaded, and the unloaded modifier goes', async () => {
    const row = await mount();
    expect(row).toHaveAttribute('data-loaded', 'false');
    await userEvent.setup().click(screen.getByTestId(`project-switch-${PERSISTED.id}`));
    await waitFor(() => expect(screen.getByTestId(`project-item-${PERSISTED.id}`)).toHaveAttribute('data-loaded', 'true'));
    const after = screen.getByTestId(`project-item-${PERSISTED.id}`);
    expect(after).not.toHaveClass('project-item--unloaded');
    expect(after.querySelector('.throng-unsaved-dot')).toBeNull();
  });
});
