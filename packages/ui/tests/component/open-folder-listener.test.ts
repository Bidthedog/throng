/**
 * 067 T047 (FR-026, FR-027, FR-035, edge case) — a folder arriving from outside throng.
 *
 * Main queues `throng <path>` requests and delivers them once the renderer has said `ready()`. The
 * listener classifies each against the project list (core's `decideOpenFolder`) and acts:
 *
 *   add              the existing add-project path and its validation, named after the folder
 *   select           switch to the project (or only load it, with `projects.openFromOutside: 'load'`)
 *   refuse-contains  one notice naming the overlapping project, nothing added
 *   refuse-invalid   one notice naming the path (a file, or one that is gone), nothing added
 *
 * A request that arrives while a modal is open waits for it to close.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDto } from '@throng/ipc-contract';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { ProjectsProvider, useProjects } from '../../src/renderer/state/projects-store.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { OpenFolderListener } from '../../src/renderer/sidebar/open-folder-listener.js';

const project = (id: string, name: string, rootFolder: string): ProjectDto => ({
  id,
  name,
  colour: '#3fb950',
  rootFolder,
  isActive: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  hiddenPaths: [],
});

interface Req {
  absPath: string;
  kind: 'folder' | 'file' | 'missing';
}

function setup(seed: ProjectDto[], openFromOutside: 'switch' | 'load' = 'switch') {
  const state = { projects: [...seed] };
  const invoke = vi.fn(async (method: string, params?: unknown): Promise<unknown> => {
    switch (method) {
      case 'projects.list':
        return { projects: state.projects };
      case 'projects.categories.list':
        return { categories: [] };
      case 'projects.create': {
        const input = params as { name: string; colour: string; rootFolder: string };
        const created = { ...project(`new-${state.projects.length}`, input.name, input.rootFolder), colour: input.colour };
        state.projects = [...state.projects, created];
        return { project: created };
      }
      case 'projects.setActive':
        return { ok: true };
      default:
        throw new Error(`unexpected RPC ${method}`);
    }
  });
  let deliver: (req: Req) => void = () => {};
  const ready = vi.fn();
  Reflect.set(window, 'throng', {
    config: {
      get: () => Promise.resolve({ settings: { projects: { openFromOutside } } }),
      onChange: () => () => {},
    },
    openFolder: {
      onRequest: (cb: (req: Req) => void) => {
        deliver = cb;
        return () => {};
      },
      ready,
    },
  });
  function Probe(): ReactElement {
    const { activeProject, loadedIds } = useProjects();
    return createElement(
      'div',
      { 'data-testid': 'probe' },
      createElement('span', { 'data-testid': 'active' }, activeProject?.name ?? 'none'),
      createElement('span', { 'data-testid': 'loaded' }, [...loadedIds].sort().join(',')),
    );
  }
  render(
    createElement(
      NotificationProvider,
      null,
      createElement(
        ConfigProvider,
        null,
        createElement(
          ProjectsProvider,
          { client: new ProjectsClient({ invoke } as unknown as ThrongBridge) },
          createElement(Probe),
          createElement(OpenFolderListener),
        ),
      ),
    ),
  );
  return {
    invoke,
    ready,
    send: (req: Req) =>
      act(() => {
        deliver(req);
      }),
  };
}

const notices = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('[data-testid="notices"] .notice'),
];
const active = (): string => screen.getByTestId('active').textContent ?? '';
const loaded = (): string => screen.getByTestId('loaded').textContent ?? '';

const A = project('pa', 'Alpha', 'C:/work/alpha');

beforeEach(() => {
  document.body.replaceChildren();
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

describe('announcing itself', () => {
  it('says ready() once, after the project list has loaded', async () => {
    const t = setup([A]);
    await waitFor(() => expect(t.ready).toHaveBeenCalledTimes(1));
    expect(t.invoke).toHaveBeenCalledWith('projects.list', {});
  });
});

describe('each decision (FR-026, FR-027)', () => {
  it('adds a new folder through the add-project path, named after the folder, and opens it', async () => {
    const t = setup([A]);
    await waitFor(() => expect(t.ready).toHaveBeenCalled());
    t.send({ absPath: 'D:/code/Shiny Thing', kind: 'folder' });
    await waitFor(() =>
      expect(t.invoke).toHaveBeenCalledWith(
        'projects.create',
        expect.objectContaining({ name: 'Shiny Thing', rootFolder: 'D:/code/Shiny Thing' }),
      ),
    );
    await waitFor(() => expect(active()).toBe('Shiny Thing'));
    expect(notices()).toHaveLength(0);
  });

  it('selects the project when the folder is its root, or lies inside it', async () => {
    const t = setup([A]);
    await waitFor(() => expect(t.ready).toHaveBeenCalled());
    t.send({ absPath: 'C:/work/alpha/src/deep', kind: 'folder' });
    await waitFor(() => expect(active()).toBe('Alpha'));
    expect(t.invoke).toHaveBeenCalledWith('projects.setActive', { id: 'pa' });
    expect(t.invoke).not.toHaveBeenCalledWith('projects.create', expect.anything());
    expect(notices()).toHaveLength(0);
  });

  it('refuses a folder that contains a project with ONE notice naming it, and adds nothing', async () => {
    const t = setup([A]);
    await waitFor(() => expect(t.ready).toHaveBeenCalled());
    t.send({ absPath: 'C:/work', kind: 'folder' });
    await waitFor(() => expect(notices()).toHaveLength(1));
    expect(notices()[0]!.textContent).toContain('Alpha');
    expect(t.invoke).not.toHaveBeenCalledWith('projects.create', expect.anything());
    expect(active()).toBe('none');
  });

  it.each([
    ['file', 'C:/work/notes.txt'],
    ['missing', 'C:/work/gone'],
  ] as const)('raises ONE notice naming a %s path and adds nothing', async (kind, absPath) => {
    const t = setup([A]);
    await waitFor(() => expect(t.ready).toHaveBeenCalled());
    t.send({ absPath, kind });
    await waitFor(() => expect(notices()).toHaveLength(1));
    expect(notices()[0]!.textContent).toContain(absPath.split('/').pop()!);
    expect(t.invoke).not.toHaveBeenCalledWith('projects.create', expect.anything());
  });
});

describe('projects.openFromOutside: load (FR-035)', () => {
  it('loads an existing project without switching to it', async () => {
    const t = setup([A], 'load');
    await waitFor(() => expect(t.ready).toHaveBeenCalled());
    await waitFor(() => expect(t.invoke).toHaveBeenCalledWith('projects.list', {}));
    // The setting arrives with config.get; give it its turn before the request.
    await act(async () => {});
    t.send({ absPath: 'C:/work/alpha', kind: 'folder' });
    await waitFor(() => expect(loaded()).toBe('pa'));
    expect(active()).toBe('none');
    expect(t.invoke).not.toHaveBeenCalledWith('projects.setActive', expect.anything());
  });

  it('adds a new folder and loads it without switching', async () => {
    const t = setup([A], 'load');
    await waitFor(() => expect(t.ready).toHaveBeenCalled());
    await act(async () => {});
    t.send({ absPath: 'D:/code/fresh', kind: 'folder' });
    await waitFor(() => expect(t.invoke).toHaveBeenCalledWith('projects.create', expect.anything()));
    await waitFor(() => expect(loaded()).toContain('new-1'));
    expect(active()).toBe('none');
  });
});

describe('while a modal is open (edge case)', () => {
  it('waits for it to close, then acts on the request', async () => {
    const t = setup([A]);
    await waitFor(() => expect(t.ready).toHaveBeenCalled());
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);

    t.send({ absPath: 'C:/work/alpha', kind: 'folder' });
    await new Promise((r) => setTimeout(r, 50));
    expect(active(), 'nothing acted while the modal was up').toBe('none');
    expect(t.invoke).not.toHaveBeenCalledWith('projects.setActive', expect.anything());

    act(() => {
      modal.remove();
    });
    await waitFor(() => expect(active()).toBe('Alpha'));
  });

  it('keeps several waiting requests in arrival order', async () => {
    const t = setup([A, project('pb', 'Beta', 'C:/work/beta')]);
    await waitFor(() => expect(t.ready).toHaveBeenCalled());
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    t.send({ absPath: 'C:/work/alpha', kind: 'folder' });
    t.send({ absPath: 'C:/work/beta', kind: 'folder' });
    act(() => {
      modal.remove();
    });
    await waitFor(() => expect(active()).toBe('Beta'));
    const order = t.invoke.mock.calls.filter(([m]) => m === 'projects.setActive').map(([, p]) => (p as { id: string }).id);
    expect(order).toEqual(['pa', 'pb']);
  });
});
