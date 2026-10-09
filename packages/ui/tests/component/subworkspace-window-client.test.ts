/**
 * 052 T008 — a sub-workspace window's save writes ONLY its own record (`workspace.saveSubWorkspace`),
 * never the whole owner set, so a sibling rewritten by the follow-moves walk in the meantime is not
 * overwritten with a stale copy (contracts/workspace-rpc.md, "Callers moved").
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLayout, type SubWorkspace } from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { SubWorkspaceWorkspaceClient } from '../../src/renderer/state/subworkspace-window-client.js';

const sub = (id: string, name: string): SubWorkspace => ({
  id,
  ownerUser: 'local',
  name,
  colour: '#3fb950',
  bounds: { x: 1, y: 2, width: 300, height: 200 },
  tabs: [
    {
      id: `t-${id}`,
      title: id,
      root: { type: 'panel', id: `p-${id}`, originProjectId: 'proj', title: id },
    },
  ],
});

afterEach(() => {
  delete window.throng;
});

describe('SubWorkspaceWorkspaceClient.save (052 T008)', () => {
  it('sends only its own record, with the edited tabs, and never persists the whole set', async () => {
    const notifyChanged = vi.fn();
    window.throng = { subWorkspace: { notifyChanged } } as unknown as typeof window.throng;
    const calls: Array<{ method: string; params: unknown }> = [];
    const own = sub('s1', 'Mine');
    const sibling = sub('s2', 'Sibling');
    const bridge: ThrongBridge = {
      invoke<TResult>(method: string, params?: unknown): Promise<TResult> {
        calls.push({ method, params });
        if (method === 'workspace.loadSubWorkspaces') {
          return Promise.resolve({ subWorkspaces: [own, sibling] } as TResult);
        }
        return Promise.resolve({ ok: true } as TResult);
      },
    };
    const client = new SubWorkspaceWorkspaceClient(bridge, 's1');
    const layout = createDefaultLayout(SubWorkspaceWorkspaceClient.layoutProjectId('s1'), {
      tab: 'edited-tab',
      panel: 'edited-panel',
    });

    await client.save(layout.projectId, layout);

    expect(calls.some((c) => c.method === 'workspace.persistSubWorkspaces')).toBe(false);
    const saves = calls.filter((c) => c.method === 'workspace.saveSubWorkspace');
    expect(saves).toHaveLength(1);
    const sent = (saves[0].params as { subWorkspace: SubWorkspace }).subWorkspace;
    expect(sent.id).toBe('s1');
    expect(sent.name).toBe('Mine');
    expect(sent.tabs).toEqual(layout.tabs);
    expect(sent.activeTabId).toBe(layout.activeTabId);
    expect(notifyChanged).toHaveBeenCalledWith('s1');
  });
});
