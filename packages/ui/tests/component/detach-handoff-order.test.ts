/**
 * 049 T012 — the ORDER of the cross-window panel-state hand-off (contracts/panel-state-handoff.md,
 * *Renderer ordering*). The sending window must have stashed the moved panels' state in main BEFORE it
 * persists the sub-workspace, opens its window or tells an open window to reload — otherwise the receiving
 * renderer can claim before the stash lands and the panel arrives with default state (FR-000a). And the
 * receiving window must have claimed and seeded BEFORE it renders the workspace, on first mount and on every
 * `reloadKey` remount.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement, useEffect, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collectPanels,
  createDefaultLayout,
  type PanelSnapshot,
  type SubWorkspace,
  type WorkspaceLayout,
} from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import { WorkspaceProvider } from '../../src/renderer/state/workspace-store.js';
import { SubWorkspacesProvider } from '../../src/renderer/state/subworkspaces-store.js';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { DetachProvider, useDetach } from '../../src/renderer/workspace/detach-context.js';
import { PanelStateGate } from '../../src/renderer/subworkspace-app.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import {
  clearEditorViewState,
  peekEditorViewState,
  saveEditorViewState,
} from '../../src/renderer/editor/editor-view-state.js';

const PROJECT = 'proj';
const EDITOR = { selection: { ranges: [{ anchor: 2, head: 8 }], main: 0 }, scrollAnchor: 40 };

function subWith(panelIds: string[]): SubWorkspace {
  const root = (id: string) => ({ type: 'panel' as const, id, originProjectId: PROJECT, title: id });
  return {
    id: 'sw1',
    ownerUser: 'local',
    name: 'Detached A',
    colour: '#3fb950',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
    tabs: panelIds.map((id) => ({ id: `t-${id}`, title: id, root: root(id) })),
  };
}

function fakeDaemon(layout: WorkspaceLayout, initial: SubWorkspace[], log: string[]) {
  let subs = initial;
  const bridge: ThrongBridge = {
    invoke<TResult>(method: string, params?: unknown): Promise<TResult> {
      let reply: unknown;
      switch (method) {
        case 'workspace.load':
          reply = { layout, restored: true };
          break;
        case 'workspace.save':
          reply = { ok: true };
          break;
        case 'workspace.loadSubWorkspaces':
          reply = { subWorkspaces: subs };
          break;
        case 'workspace.saveSubWorkspace': {
          log.push('persist');
          const next = (params as { subWorkspace: SubWorkspace }).subWorkspace;
          subs = subs.some((s) => s.id === next.id)
            ? subs.map((s) => (s.id === next.id ? next : s))
            : [...subs, next];
          reply = { ok: true };
          break;
        }
        case 'subworkspace.list':
          reply = { subWorkspaces: subs.map((s) => ({ id: s.id, name: s.name ?? '', colour: s.colour ?? '', tabCount: s.tabs.length, panelCount: s.tabs.length })) };
          break;
        default:
          return Promise.reject(new Error(`unexpected RPC: ${method}`));
      }
      return Promise.resolve(reply as TResult);
    },
  };
  return bridge;
}

function servicesOver(bridge: ThrongBridge): Services {
  return {
    bridge,
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };
}

let detachApi: ReturnType<typeof useDetach> = null;
function Capture(): ReactElement | null {
  detachApi = useDetach();
  return null;
}

function stubWindow(log: string[], claimed: Record<string, PanelSnapshot> = {}) {
  const stash = vi.fn(async (snapshots: readonly PanelSnapshot[]) => {
    // Resolve on a later task, so an implementation that does not AWAIT it is caught out.
    await new Promise((r) => setTimeout(r, 5));
    log.push(`stash:${snapshots.map((s) => s.panelId).join(',')}`);
  });
  const claim = vi.fn(async (ids: readonly string[]) => {
    log.push(`claim:${ids.join(',')}`);
    return claimed;
  });
  const subWorkspace = {
    open: vi.fn(() => log.push('open')),
    atPoint: vi.fn(() => Promise.resolve(null)),
    close: vi.fn(),
    notifyChanged: vi.fn(() => log.push('notify')),
    onChanged: vi.fn(() => () => {}),
  };
  window.throng = { subWorkspace, panelState: { stash, claim } } as unknown as typeof window.throng;
  return { stash, claim, subWorkspace };
}

afterEach(() => {
  delete window.throng;
  detachApi = null;
  clearEditorViewState('p1');
  clearEditorViewState('p2');
});

describe('hand-off ordering, sending side (049 T012)', () => {
  async function mountSender(initial: SubWorkspace[]) {
    const log: string[] = [];
    const layout = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
    const bridge = fakeDaemon(layout, initial, log);
    const api = stubWindow(log);
    const services = servicesOver(bridge);
    render(
      createElement(ServicesProvider, {
        services,
        children: createElement(WorkspaceProvider, {
          client: services.workspace,
          activeProjectId: PROJECT,
          children: createElement(SubWorkspacesProvider, {
            client: services.subWorkspaces,
            children: createElement(DetachProvider, {
              children: createElement(NotificationProvider, { children: createElement(Capture) }),
            }),
          }),
        }),
      }),
    );
    await waitFor(() => expect(detachApi).not.toBeNull());
    await waitFor(() => expect(detachApi!.subWorkspaces.length).toBe(initial.length));
    return { log, api };
  }

  it('detachToNew stashes the moved panel before persisting and opening', async () => {
    const { log } = await mountSender([]);
    // Let the layout load.
    await waitFor(() => expect(detachApi).not.toBeNull());
    await act(async () => {
      detachApi!.detachToNew('panel', 'p1');
      await waitFor(() => expect(log).toContain('open'));
    });
    const stashAt = log.findIndex((e) => e.startsWith('stash:'));
    expect(log[stashAt]).toBe('stash:p1');
    expect(stashAt).toBeGreaterThanOrEqual(0);
    expect(stashAt).toBeLessThan(log.indexOf('persist'));
    expect(log.indexOf('persist')).toBeLessThan(log.indexOf('open'));
  });

  it('detachToNew of a tab stashes every panel of the tab', async () => {
    const { log } = await mountSender([]);
    await act(async () => {
      detachApi!.detachToNew('tab', 't1');
      await waitFor(() => expect(log).toContain('open'));
    });
    expect(log.find((e) => e.startsWith('stash:'))).toBe('stash:p1');
    expect(log.findIndex((e) => e.startsWith('stash:'))).toBeLessThan(log.indexOf('persist'));
  });

  it('syncToExisting stashes before persisting and notifying the open window', async () => {
    const { log } = await mountSender([subWith(['other'])]);
    await act(async () => {
      detachApi!.syncToExisting('panel', 'p1', 'sw1');
      await waitFor(() => expect(log).toContain('notify'));
    });
    const stashAt = log.findIndex((e) => e.startsWith('stash:'));
    expect(log[stashAt]).toBe('stash:p1');
    expect(stashAt).toBeLessThan(log.indexOf('persist'));
    expect(log.indexOf('persist')).toBeLessThan(log.indexOf('notify'));
  });
});

describe('hand-off ordering, receiving side (049 T012)', () => {
  function mountGate(sub: SubWorkspace, log: string[], claimed: Record<string, PanelSnapshot>) {
    const bridge = fakeDaemon(createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' }), [sub], log);
    const api = stubWindow(log, claimed);
    const services = servicesOver(bridge);
    const Child = (): ReactElement => {
      useEffect(() => {
        log.push('mount');
      }, []);
      return createElement('div', { 'data-testid': 'child' });
    };
    const tree = (reloadKey: number) =>
      createElement(ServicesProvider, {
        services,
        children: createElement(PanelStateGate, {
          subWorkspaceId: sub.id,
          reloadKey,
          children: createElement(Child),
        }),
      });
    return { api, tree };
  }

  it('claims the sub-workspace layout panel ids and seeds them before rendering its children', async () => {
    const log: string[] = [];
    const { tree } = mountGate(subWith(['p1', 'p2']), log, { p1: { panelId: 'p1', editor: EDITOR } });
    render(tree(0));
    expect(screen.queryByTestId('child')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('child')).toBeTruthy());
    expect(log.indexOf('claim:p1,p2')).toBeGreaterThanOrEqual(0);
    expect(log.indexOf('claim:p1,p2')).toBeLessThan(log.indexOf('mount'));
    expect(peekEditorViewState('p1')).toEqual(EDITOR);
  });

  it('claims again, before remounting, on every reloadKey change', async () => {
    const log: string[] = [];
    const { tree } = mountGate(subWith(['p1']), log, {});
    const { rerender } = render(tree(0));
    await waitFor(() => expect(screen.getByTestId('child')).toBeTruthy());
    log.length = 0;
    rerender(tree(1));
    await waitFor(() => expect(log).toContain('mount'));
    expect(log[0]).toBe('claim:p1');
    expect(log.indexOf('claim:p1')).toBeLessThan(log.indexOf('mount'));
  });
});

describe('hand-off symmetry (049 T012, US6 scenario 3)', () => {
  it('stashPanelState and the claim-and-seed helper take no window kind', async () => {
    const { stashPanelState, claimAndSeedPanelState } = await import(
      '../../src/renderer/workspace/panel-state-capture.js'
    );
    expect(stashPanelState.length).toBe(1);
    expect(claimAndSeedPanelState.length).toBe(1);
    const held = new Map<string, PanelSnapshot>();
    window.throng = {
      panelState: {
        stash: async (s: readonly PanelSnapshot[]) => s.forEach((x) => held.set(x.panelId, x)),
        claim: async (ids: readonly string[]) =>
          Object.fromEntries(ids.filter((i) => held.has(i)).map((i) => [i, held.get(i)!])),
      },
    } as unknown as typeof window.throng;
    // A sub-workspace window's own stores…
    saveEditorViewState('p1', EDITOR);
    await stashPanelState(['p1']);
    clearEditorViewState('p1');
    // …round-trip into another window's the same way.
    await claimAndSeedPanelState(['p1']);
    expect(peekEditorViewState('p1')).toEqual(EDITOR);
    expect(collectPanels).toBeDefined();
  });
});
