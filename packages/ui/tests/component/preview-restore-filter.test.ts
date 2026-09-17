/**
 * A persisted preview whose provider is disabled or gone is never restored (044 US4 — FR-067, FR-064;
 * research R19).
 *
 * ══ WHAT IS BEING PROVED ══
 *
 * The layout a window restores — a project's, or a sub-workspace's through its window client — passes
 * through the restore filter BEFORE the store publishes it, so such a preview is never mounted (no
 * attach, no flash of a panel that then vanishes). It goes as closing it by hand would
 * (`removePanelsWhere`): a split collapses, a tab it empties closes, the workspace's last panel becomes
 * an empty panel — and the filtered layout is written back, so the stored record stops holding it.
 *
 * ══ WHICH FILE A PERSISTED PREVIEW IS ══
 *
 * `previewPathOf(config)` — the persisted history's current entry when present, else `config.filePath`:
 * the precedence `attach` uses. The two can disagree only across a save that landed between two mirror
 * writes, and the case where they differ IN EXTENSION is the one that proves which is read — so it is
 * tested in both directions.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Each test keeps an ENABLED preview beside the ones filtered, and asserts it survives: a filter that
 * dropped every preview would fail there. The probe records every layout the store ever published, so
 * "never mounted" is asserted over the whole history, not only the final state.
 */
import { render, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PREVIEW_KIND,
  collectPanels,
  createDefaultLayout,
  createPreviewProviderRegistry,
  type LayoutNode,
  type Panel,
  type SubWorkspace,
  type Tab,
  type WorkspaceLayout,
} from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspaceWorkspaceClient } from '../../src/renderer/state/subworkspace-window-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { WorkspaceProvider, useWorkspace } from '../../src/renderer/state/workspace-store.js';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';
import { PreviewProviderRegistryContext } from '../../src/renderer/preview/provider-registry-context.js';

const PROJECT = 'proj-1';
const SUB = 'sub-1';

/** `testText` stays on; `offText` is registered but disabled; `.gone` has no provider at all. */
const registry = createPreviewProviderRegistry([
  { id: 'testText', displayName: 'Test text', extensions: ['.prvtxt'], kind: 'text' },
  { id: 'offText', displayName: 'Off text', extensions: ['.offtxt'], kind: 'text' },
]);
const SETTINGS = { editor: { previews: { providers: { testText: { enabled: true }, offText: { enabled: false } } } } };

const preview = (id: string, file: string, origin = PROJECT, history?: string): Panel => ({
  type: 'panel',
  id,
  originProjectId: origin,
  title: `Panel ${id}`,
  kind: PREVIEW_KIND,
  config: {
    filePath: `D:/proj/${file}`,
    ...(history !== undefined ? { history: { v: 1, entries: [{ filePath: `D:/proj/${history}` }], index: 0 } } : {}),
  },
});
const plain = (id: string, origin = PROJECT): Panel => ({ type: 'panel', id, originProjectId: origin, title: `Panel ${id}` });
const row = (...children: Panel[]): LayoutNode =>
  children.length === 1
    ? children[0]
    : { type: 'split', orientation: 'row', children, sizes: children.map(() => 1 / children.length) };
const tabsOf = (roots: LayoutNode[]): Tab[] => roots.map((root, i) => ({ id: `t${i + 1}`, title: `Tab ${i + 1}`, root }));

function layoutOf(roots: LayoutNode[]): WorkspaceLayout {
  return { ...createDefaultLayout(PROJECT, { tab: 't1', panel: 'unused' }), tabs: tabsOf(roots), activeTabId: 't1' };
}

const captured: { ws: ReturnType<typeof useWorkspace> | null; seen: Set<string> } = { ws: null, seen: new Set() };
function Probe(): null {
  captured.ws = useWorkspace();
  for (const tab of captured.ws.layout?.tabs ?? []) for (const p of collectPanels(tab.root)) captured.seen.add(p.id);
  return null;
}
function WhenLive({ children }: { children: ReactNode }): ReactNode {
  return useConfigLoaded() ? children : null;
}

/** No sub-workspace destroy route is wired unless a test passes its own bridge (below). */
const noopBridge: ThrongBridge = {
  invoke<T>(method: string): Promise<T> {
    return Promise.reject(new Error(`unexpected RPC from the restore filter’s services: ${method}`));
  },
};

function mount(client: WorkspaceClient, activeProjectId: string, subWorkspacesBridge: ThrongBridge = noopBridge) {
  const closeSubWorkspace = vi.fn();
  Reflect.set(window, 'throng', {
    config: { get: () => Promise.resolve({ settings: SETTINGS }), onChange: () => () => {} },
    subWorkspace: { notifyChanged: vi.fn(), close: closeSubWorkspace },
  });
  // 044 US4 fix round 1, item 2 — `ServicesProvider` for the destroy route the restore filter takes when
  // a sub-workspace window's layout would come out empty (below); every other test here never reaches
  // it, so the default `noopBridge` is never called.
  const services = { workspace: client, subWorkspaces: new SubWorkspacesClient(subWorkspacesBridge) } as Services;
  render(
    createElement(
      PreviewProviderRegistryContext.Provider,
      { value: { registry, views: {} } },
      createElement(
        ServicesProvider,
        { services },
        createElement(
          ConfigProvider,
          null,
          createElement(
            WhenLive,
            null,
            createElement(WorkspaceProvider, { client, activeProjectId }, createElement(Probe, null)),
          ),
        ),
      ),
    ),
  );
  return { closeSubWorkspace };
}

function projectBridge(layout: WorkspaceLayout) {
  const saves: WorkspaceLayout[] = [];
  const bridge: ThrongBridge = {
    invoke<T>(method: string, params?: unknown): Promise<T> {
      if (method === 'workspace.load') return Promise.resolve({ layout, restored: true } as T);
      if (method === 'workspace.save') {
        saves.push((params as { layout: WorkspaceLayout }).layout);
        return Promise.resolve({ ok: true } as T);
      }
      return Promise.reject(new Error(`unexpected RPC from the restore filter: ${method}`));
    },
  };
  return { bridge, saves };
}

const ids = (): string[] => (captured.ws?.layout?.tabs ?? []).flatMap((t) => collectPanels(t.root).map((p) => p.id));

beforeEach(() => {
  captured.ws = null;
  captured.seen = new Set();
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

describe('a restored project layout never mounts a preview whose provider is off or gone (FR-067)', () => {
  it('drops the disabled and the unregistered previews, keeps the enabled one, and writes the result back', async () => {
    const { bridge, saves } = projectBridge(
      layoutOf([row(preview('on', 'on.prvtxt'), preview('off', 'off.offtxt'), preview('gone', 'gone.gone'), plain('b'))]),
    );
    mount(new WorkspaceClient(bridge), PROJECT);

    await waitFor(() => expect(ids()).toEqual(['on', 'b']));
    expect(captured.seen.has('off'), 'a disabled provider’s preview was mounted').toBe(false);
    expect(captured.seen.has('gone'), 'an unregistered provider’s preview was mounted').toBe(false);

    await waitFor(() => expect(saves.length).toBeGreaterThan(0));
    const written = saves.at(-1)!.tabs.flatMap((t) => collectPanels(t.root).map((p) => p.id));
    expect(written).toEqual(['on', 'b']);
  });

  it('reads the history’s current entry over filePath — dropped when the entry names a disabled type', async () => {
    const { bridge } = projectBridge(layoutOf([row(preview('stale', 'x.prvtxt', PROJECT, 'x.offtxt'), preview('on', 'on.prvtxt'))]));
    mount(new WorkspaceClient(bridge), PROJECT);

    await waitFor(() => expect(ids()).toEqual(['on']));
    expect(captured.seen.has('stale')).toBe(false);
  });

  it('…and kept when the entry names an enabled type, though filePath names a disabled one', async () => {
    const { bridge } = projectBridge(layoutOf([row(preview('moved', 'y.offtxt', PROJECT, 'y.prvtxt'), plain('b'))]));
    mount(new WorkspaceClient(bridge), PROJECT);

    await waitFor(() => expect(ids()).toEqual(['moved', 'b']));
  });

  it('a tab it empties closes, and the workspace’s last panel becomes an empty panel (FR-064)', async () => {
    const { bridge } = projectBridge(layoutOf([preview('only', 'only.offtxt'), row(preview('x', 'x.gone'), preview('y', 'y.offtxt'))]));
    mount(new WorkspaceClient(bridge), PROJECT);

    await waitFor(() => expect(captured.ws?.layout).toBeTruthy());
    const tabs = captured.ws!.layout!.tabs;
    expect(tabs).toHaveLength(1);
    const remaining = collectPanels(tabs[0].root);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].kind).toBeUndefined();
    expect(captured.seen.has('only') || captured.seen.has('x') || captured.seen.has('y')).toBe(false);
  });

  it('leaves a layout with nothing to filter untouched, and writes nothing for it', async () => {
    const { bridge, saves } = projectBridge(layoutOf([row(preview('on', 'on.prvtxt'), plain('b'))]));
    mount(new WorkspaceClient(bridge), PROJECT);

    await waitFor(() => expect(ids()).toEqual(['on', 'b']));
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(saves).toEqual([]);
  });
});

describe('a restored sub-workspace never mounts such a preview either (FR-067)', () => {
  it('drops it from the sub-workspace window’s layout and from the persisted record', async () => {
    const sub: SubWorkspace = {
      id: SUB,
      ownerUser: 'u',
      name: 'Sub',
      colour: '#336699',
      tabs: tabsOf([row(preview('own-off', 'a.offtxt', `subworkspace:${SUB}`), preview('synced-on', 'b.prvtxt'), plain('c'))]),
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    };
    const persisted: SubWorkspace[][] = [];
    const bridge: ThrongBridge = {
      invoke<T>(method: string, params?: unknown): Promise<T> {
        if (method === 'workspace.loadSubWorkspaces') return Promise.resolve({ subWorkspaces: persisted.at(-1) ?? [sub] } as T);
        if (method === 'workspace.persistSubWorkspaces') {
          persisted.push((params as { subWorkspaces: SubWorkspace[] }).subWorkspaces);
          return Promise.resolve({ ok: true } as T);
        }
        return Promise.reject(new Error(`unexpected RPC from the sub-workspace restore filter: ${method}`));
      },
    };
    mount(new SubWorkspaceWorkspaceClient(bridge, SUB), SubWorkspaceWorkspaceClient.layoutProjectId(SUB));

    await waitFor(() => expect(ids()).toEqual(['synced-on', 'c']));
    expect(captured.seen.has('own-off')).toBe(false);

    await waitFor(() => expect(persisted.length).toBeGreaterThan(0));
    const record = persisted.at(-1)!.find((s) => s.id === SUB)!;
    expect(record.tabs.flatMap((t) => collectPanels(t.root).map((p) => p.id))).toEqual(['synced-on', 'c']);
  });
});

/*
 * 044 US4 fix round 1, item 2 — controller ruling: FR-064 means "exactly as closing by hand". When the
 * restore filter would strip EVERY panel an open sub-workspace window's layout holds, a hand close of
 * that same last panel destroys the sub-workspace (005 FR-029) rather than leaving an empty panel — so
 * the restore filter takes the same route, with no confirmation, through the sub-workspace's own destroy
 * (`destroy-sub-workspace.ts`), never through `removePanelsWhere`'s placeholder.
 */
describe('a sub-workspace left with nothing to restore destroys itself instead (FR-064, item 2)', () => {
  it('destroys the sub-workspace through the hand-close route, and never persists an empty placeholder', async () => {
    const sub: SubWorkspace = {
      id: SUB,
      ownerUser: 'u',
      name: 'Sub',
      colour: '#336699',
      tabs: tabsOf([preview('only', 'only.offtxt', `subworkspace:${SUB}`)]),
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    };
    const persisted: SubWorkspace[][] = [];
    const deleted: string[] = [];
    const bridge: ThrongBridge = {
      invoke<T>(method: string, params?: unknown): Promise<T> {
        if (method === 'workspace.loadSubWorkspaces') return Promise.resolve({ subWorkspaces: persisted.at(-1) ?? [sub] } as T);
        if (method === 'workspace.persistSubWorkspaces') {
          persisted.push((params as { subWorkspaces: SubWorkspace[] }).subWorkspaces);
          return Promise.resolve({ ok: true } as T);
        }
        if (method === 'subworkspace.delete') {
          deleted.push((params as { id: string }).id);
          return Promise.resolve({ ok: true } as T);
        }
        return Promise.reject(new Error(`unexpected RPC from the emptied sub-workspace’s restore filter: ${method}`));
      },
    };
    const { closeSubWorkspace } = mount(
      new SubWorkspaceWorkspaceClient(bridge, SUB),
      SubWorkspaceWorkspaceClient.layoutProjectId(SUB),
      bridge,
    );

    await waitFor(() => expect(closeSubWorkspace).toHaveBeenCalledWith(SUB));
    expect(deleted).toEqual([SUB]);
    // The filter never fell back to persisting an empty-panel placeholder through the window's own
    // `save` (`workspace.persistSubWorkspaces`) — the destroy route is the only write this run makes.
    expect(persisted).toEqual([]);
  });
});
