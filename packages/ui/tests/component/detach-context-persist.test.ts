/**
 * 052 T009 — `detach-context.tsx` writes through the per-record RPCs. No call sends a record other than
 * the one the operation changed, so a sibling the follow-moves walk rewrote in between is never put back
 * from a stale copy (contracts/workspace-rpc.md, "Callers moved").
 */
import { act, render, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLayout, type SubWorkspace } from '@throng/core';
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
import { NotificationProvider } from '../../src/renderer/common/notification.js';

const PROJECT = 'proj';

const panel = (id: string) => ({ type: 'panel' as const, id, originProjectId: PROJECT, title: id });

function sub(id: string, panelIds: string[]): SubWorkspace {
  return {
    id,
    ownerUser: 'local',
    name: `Sub ${id}`,
    colour: '#3fb950',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
    tabs: panelIds.map((p) => ({ id: `t-${id}-${p}`, title: p, root: panel(p) })),
  };
}

interface Write {
  method: string;
  params: unknown;
}

function fakeDaemon(initial: SubWorkspace[], writes: Write[]): ThrongBridge {
  let subs = initial;
  return {
    invoke<TResult>(method: string, params?: unknown): Promise<TResult> {
      let reply: unknown;
      switch (method) {
        case 'workspace.load':
          reply = { layout: createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' }), restored: true };
          break;
        case 'workspace.save':
          reply = { ok: true };
          break;
        case 'workspace.loadSubWorkspaces':
          reply = { subWorkspaces: subs };
          break;
        case 'workspace.saveSubWorkspace': {
          writes.push({ method, params });
          const next = (params as { subWorkspace: SubWorkspace }).subWorkspace;
          subs = subs.some((s) => s.id === next.id)
            ? subs.map((s) => (s.id === next.id ? next : s))
            : [...subs, next];
          reply = { ok: true };
          break;
        }
        case 'workspace.deleteSubWorkspaces': {
          writes.push({ method, params });
          const ids = (params as { ids: string[] }).ids;
          subs = subs.filter((s) => !ids.includes(s.id));
          reply = { ok: true, deleted: ids };
          break;
        }
        case 'subworkspace.list':
          reply = {
            subWorkspaces: subs.map((s) => ({
              id: s.id,
              name: s.name ?? '',
              colour: s.colour ?? '',
              tabCount: s.tabs.length,
              panelCount: s.tabs.length,
            })),
          };
          break;
        default:
          // `workspace.persistSubWorkspaces` lands here on purpose: replacing the owner set is the
          // behaviour this spec removes.
          return Promise.reject(new Error(`unexpected RPC: ${method}`));
      }
      return Promise.resolve(reply as TResult);
    },
  };
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

let api: ReturnType<typeof useDetach> = null;
function Capture(): ReactElement | null {
  api = useDetach();
  return null;
}

async function mountDetach(initial: SubWorkspace[]) {
  const writes: Write[] = [];
  const subWorkspace = {
    open: vi.fn(),
    atPoint: vi.fn(() => Promise.resolve(null)),
    close: vi.fn(),
    notifyChanged: vi.fn(),
    onChanged: vi.fn(() => () => {}),
  };
  window.throng = {
    subWorkspace,
    panelState: { stash: vi.fn(async () => {}), claim: vi.fn(async () => ({})) },
  } as unknown as typeof window.throng;
  const services = servicesOver(fakeDaemon(initial, writes));
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
  await waitFor(() => expect(api).not.toBeNull());
  await waitFor(() => expect(api!.subWorkspaces.length).toBe(initial.length));
  return { writes, subWorkspace };
}

afterEach(() => {
  delete window.throng;
  api = null;
});

const savedIds = (writes: Write[]): string[] =>
  writes
    .filter((w) => w.method === 'workspace.saveSubWorkspace')
    .map((w) => (w.params as { subWorkspace: SubWorkspace }).subWorkspace.id);

describe('detach-context persists per record (052 T009)', () => {
  it('detach to a new sub-workspace saves only the new record', async () => {
    const { writes, subWorkspace } = await mountDetach([sub('sw1', ['other'])]);
    await act(async () => {
      api!.detachToNew('panel', 'p1');
      await waitFor(() => expect(subWorkspace.open).toHaveBeenCalled());
    });
    const ids = savedIds(writes);
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toBe('sw1');
    expect(writes.map((w) => w.method)).toEqual(['workspace.saveSubWorkspace']);
  });

  it('sync to an existing sub-workspace saves only the updated record', async () => {
    const { writes, subWorkspace } = await mountDetach([sub('sw1', ['a']), sub('sw2', ['b'])]);
    await act(async () => {
      api!.syncToExisting('panel', 'p1', 'sw1');
      await waitFor(() => expect(subWorkspace.notifyChanged).toHaveBeenCalledWith('sw1'));
    });
    expect(writes.map((w) => w.method)).toEqual(['workspace.saveSubWorkspace']);
    expect(savedIds(writes)).toEqual(['sw1']);
  });

  it('purge of a destroyed panel saves each survivor and deletes the emptied, and sends no other record', async () => {
    const { writes, subWorkspace } = await mountDetach([
      sub('keeps', ['gone', 'stays']),
      sub('empties', ['gone']),
      sub('untouched', ['elsewhere']),
    ]);
    await act(async () => {
      api!.purgePanel('gone');
      await waitFor(() => expect(subWorkspace.close).toHaveBeenCalledWith('empties'));
    });
    expect(savedIds(writes)).toEqual(['keeps']);
    const deletes = writes.filter((w) => w.method === 'workspace.deleteSubWorkspaces');
    expect(deletes).toHaveLength(1);
    expect((deletes[0].params as { ids: string[] }).ids).toEqual(['empties']);
    expect(writes).toHaveLength(2);
  });
});
