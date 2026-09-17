/**
 * Turning a provider off closes this window's previews of it (044 US4 — FR-063, FR-064; research R19).
 *
 * ══ WHAT IS BEING PROVED ══
 *
 * `PreviewProviderSync` is the ONE renderer reader of the transition: when `providersTurnedOff(previous,
 * next)` names a provider, this window's previews of that provider go exactly as closing them by hand
 * would (FR-064, `removePanelsWhere`) — a split collapses, a tab they empty closes, and the workspace's
 * last panel becomes an empty panel (002 FR-016) — and each goes through the preview destroy route, so
 * main hears `destroyed` for it and purges its history (contracts/preview-ipc.md §1).
 *
 * The opposite is proved too: a settings change that turns nothing off, or turns off a DIFFERENT
 * provider, closes nothing.
 *
 * ══ WHY A TEST REGISTRY ══
 *
 * The surface takes its providers by injection (FR-070), so the provider here is `testText`; nothing in
 * the component can be keyed to Markdown and still pass.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Every test first asserts the preview is in the layout, and flips the provider only after the first
 * settings payload has landed — so "the preview is gone" cannot be satisfied by a layout that never held
 * it, or by the shipped defaults racing the payload.
 */
import { act, render, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PREVIEW_KIND,
  collectPanels,
  createDefaultLayout,
  createPreviewProviderRegistry,
  type LayoutNode,
  type Panel,
  type WorkspaceLayout,
} from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { WorkspaceProvider, useWorkspace } from '../../src/renderer/state/workspace-store.js';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';
import { PreviewProviderRegistryContext } from '../../src/renderer/preview/provider-registry-context.js';
import { __resetPreviewStore } from '../../src/renderer/preview/preview-store.js';
import { PreviewProviderSync } from '../../src/renderer/preview/preview-provider-sync.js';

const PROJECT = 'proj-1';

const registry = createPreviewProviderRegistry([
  { id: 'testText', displayName: 'Test text', extensions: ['.prvtxt'], kind: 'text' },
  { id: 'otherText', displayName: 'Other text', extensions: ['.othertxt'], kind: 'text' },
]);

const preview = (id: string, file = `${id}.prvtxt`): Panel => ({
  type: 'panel',
  id,
  originProjectId: PROJECT,
  title: `Panel ${id}`,
  kind: PREVIEW_KIND,
  config: { filePath: `D:/proj/${file}` },
});
/** A preview whose OWNING project is named explicitly — for the sub-workspace tests below, where
 *  whether a panel is the sub-workspace's own or a project's synced into it is exactly the question. */
const previewOwned = (id: string, origin: string, file = `${id}.prvtxt`): Panel => ({
  type: 'panel',
  id,
  originProjectId: origin,
  title: `Panel ${id}`,
  kind: PREVIEW_KIND,
  config: { filePath: `D:/proj/${file}` },
});
const plain = (id: string): Panel => ({ type: 'panel', id, originProjectId: PROJECT, title: `Panel ${id}` });
const row = (...children: Panel[]): LayoutNode =>
  children.length === 1
    ? children[0]
    : { type: 'split', orientation: 'row', children, sizes: children.map(() => 1 / children.length) };

function layoutOf(tabs: LayoutNode[]): WorkspaceLayout {
  const base = createDefaultLayout(PROJECT, { tab: 't1', panel: 'unused' });
  return { ...base, tabs: tabs.map((root, i) => ({ id: `t${i + 1}`, title: `Tab ${i + 1}`, root })), activeTabId: 't1' };
}

/** A sub-workspace window's layout: its synthetic project id, `subworkspace:<id>` (`SubWorkspaceWorkspaceClient`'s
 *  own convention), which is what tells `PreviewProviderSync` this window is a sub-workspace's (item 2). */
function subLayoutOf(subId: string, tabs: LayoutNode[]): WorkspaceLayout {
  const projectId = `subworkspace:${subId}`;
  const base = createDefaultLayout(projectId, { tab: 't1', panel: 'unused' });
  return { ...base, tabs: tabs.map((root, i) => ({ id: `t${i + 1}`, title: `Tab ${i + 1}`, root })), activeTabId: 't1' };
}

function bridgeOver(layout: WorkspaceLayout): ThrongBridge {
  return {
    invoke<T>(method: string): Promise<T> {
      if (method === 'workspace.load') return Promise.resolve({ layout, restored: true } as T);
      if (method === 'workspace.save') return Promise.resolve({ ok: true } as T);
      if (method === 'subworkspace.delete') return Promise.resolve({ ok: true } as T);
      return Promise.reject(new Error(`unexpected RPC from PreviewProviderSync: ${method}`));
    },
  };
}

const captured: { ws: ReturnType<typeof useWorkspace> | null } = { ws: null };
function Probe(): null {
  captured.ws = useWorkspace();
  return null;
}
function WhenLive({ children }: { children: ReactNode }): ReactNode {
  return useConfigLoaded() ? children : null;
}

const providers = (testText: boolean, otherText = true) => ({
  editor: { previews: { providers: { testText: { enabled: testText }, otherText: { enabled: otherText } } } },
});

function mount(layout: WorkspaceLayout) {
  const destroyed = vi.fn();
  const subWorkspace = { notifyChanged: vi.fn(), close: vi.fn() };
  let push: ((payload: unknown) => void) | null = null;
  Reflect.set(window, 'throng', {
    config: {
      get: () => Promise.resolve({ settings: providers(true) }),
      onChange: (listener: (payload: unknown) => void) => {
        push = listener;
        return () => {};
      },
    },
    preview: { destroyed },
    subWorkspace,
  });
  const bridge = bridgeOver(layout);
  const services: Services = {
    bridge,
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };
  // A real sub-workspace window's `SubWorkspaceWindowContext` plays no part here (item 2's design):
  // `PreviewProviderSync` tells a sub-workspace's own layout from a project's by the layout's own
  // `projectId`, exactly as `SubWorkspaceWorkspaceClient` names it — so mounting with a sub-workspace
  // layout, and `ServicesProvider` for the destroy route, is the whole of the setup this needs.
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
          // Settings are live before a project opens, as in the app — so neither the restore filter nor
          // the sync ever judges this layout against the shipped defaults, which know no `testText`.
          createElement(
            WhenLive,
            null,
            createElement(
              WorkspaceProvider,
              { client: services.workspace, activeProjectId: layout.projectId },
              createElement(Probe, null),
              createElement(PreviewProviderSync, { isSubWorkspace: layout.projectId.startsWith('subworkspace:') }),
            ),
          ),
        ),
      ),
    ),
  );
  const setSettings = (settings: unknown): void => {
    act(() => push?.({ settings }));
  };
  return { destroyed, subWorkspace, setSettings };
}

const tabs = () => captured.ws?.layout?.tabs ?? [];
const ids = () => tabs().flatMap((t) => collectPanels(t.root).map((p) => p.id));

async function ready(expectedIds: string[]): Promise<void> {
  await waitFor(() => expect(ids()).toEqual(expectedIds));
}

beforeEach(() => {
  captured.ws = null;
  __resetPreviewStore();
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

describe('turning a provider off closes this window’s previews of it (FR-063)', () => {
  it('removes each preview of the provider and sends destroyed for each', async () => {
    const { destroyed, setSettings } = mount(layoutOf([row(preview('a'), plain('b')), row(plain('c'), preview('d'))]));
    await ready(['a', 'b', 'c', 'd']);

    setSettings(providers(false));

    await waitFor(() => expect(ids()).toEqual(['b', 'c']));
    expect(destroyed).toHaveBeenCalledWith('a');
    expect(destroyed).toHaveBeenCalledWith('d');
    expect(destroyed).toHaveBeenCalledTimes(2);
  });

  it('matches on the file the preview shows: its history’s current entry wins over filePath', async () => {
    // Persisted filePath says `.othertxt`; the history — the file it actually shows — says `.prvtxt`.
    const shown: Panel = {
      ...preview('h', 'h.othertxt'),
      config: { filePath: 'D:/proj/h.othertxt', history: { v: 1, entries: [{ filePath: 'D:/proj/h.prvtxt' }], index: 0 } },
    };
    const { destroyed, setSettings } = mount(layoutOf([row(shown, plain('b'))]));
    await ready(['h', 'b']);

    setSettings(providers(false));

    await waitFor(() => expect(ids()).toEqual(['b']));
    expect(destroyed).toHaveBeenCalledWith('h');
  });

  it('leaves previews of a provider that stayed on, and does nothing on a change that turns nothing off', async () => {
    const { destroyed, setSettings } = mount(layoutOf([row(preview('a'), preview('o', 'o.othertxt'))]));
    await ready(['a', 'o']);

    setSettings({ ...providers(true), editor: { ...providers(true).editor, openOnClick: 'double' } });
    setSettings(providers(true, false));

    await waitFor(() => expect(ids()).toEqual(['a']));
    expect(destroyed).toHaveBeenCalledWith('o');
    expect(destroyed).not.toHaveBeenCalledWith('a');
  });
});

describe('closing them behaves as closing by hand (FR-064)', () => {
  it('a tab the previews empty closes, as any emptied tab does', async () => {
    const { setSettings } = mount(layoutOf([plain('keep'), row(preview('x'), preview('y'))]));
    await ready(['keep', 'x', 'y']);
    expect(tabs()).toHaveLength(2);

    setSettings(providers(false));

    await waitFor(() => expect(tabs()).toHaveLength(1));
    expect(ids()).toEqual(['keep']);
  });

  it('the workspace’s last panel is replaced by an empty panel, so the workspace keeps a tab and a panel', async () => {
    const { destroyed, setSettings } = mount(layoutOf([preview('only')]));
    await ready(['only']);

    setSettings(providers(false));

    await waitFor(() => expect(ids()).not.toContain('only'));
    expect(tabs()).toHaveLength(1);
    const remaining = collectPanels(tabs()[0].root);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].kind, 'an EMPTY panel, not a preview of nothing').toBeUndefined();
    expect(destroyed).toHaveBeenCalledWith('only');
  });
});

/*
 * 044 US4 fix round 1, item 2 — controller ruling: FR-064 means "exactly as closing by hand". Closing
 * the last Panel of an OPEN sub-workspace window by hand destroys the sub-workspace (005 FR-029,
 * `panel-placeholder.tsx`) rather than leaving an empty panel behind — so a provider turning off must
 * do the same, through the same route (`destroy-sub-workspace.ts`), with no confirmation. The MAIN
 * window has no such concept, which the FR-064 describe block above already covers and this must not
 * disturb.
 */
describe('an OPEN sub-workspace window emptied by the turn-off destroys itself instead (FR-064, item 2)', () => {
  it('destroys the sub-workspace exactly as a hand close would, with no empty placeholder left behind', async () => {
    const { destroyed, subWorkspace, setSettings } = mount(subLayoutOf('sub-1', [previewOwned('only', 'subworkspace:sub-1')]));
    await ready(['only']);

    setSettings(providers(false));

    await waitFor(() => expect(subWorkspace.close).toHaveBeenCalledWith('sub-1'));
    expect(subWorkspace.notifyChanged).toHaveBeenCalledWith('sub-1');
    expect(destroyed).toHaveBeenCalledWith('only');
  });

  it('the sub-workspace survives when a panel other than the closing preview remains', async () => {
    const { subWorkspace, setSettings } = mount(
      subLayoutOf('sub-2', [row(previewOwned('x', 'subworkspace:sub-2'), plain('keep'))]),
    );
    await ready(['x', 'keep']);

    setSettings(providers(false));

    await waitFor(() => expect(ids()).toEqual(['keep']));
    expect(subWorkspace.close).not.toHaveBeenCalled();
  });
});

/*
 * 044 US4 fix round 1, item 8 — the untested branch: a PROJECT preview synced into a sub-workspace is
 * one run with two views (`forget-preview-panel.ts`'s `viewEndsPreview`); the project still shows it,
 * so a provider turning off must forget only THIS window's mirror, never send `destroyed` for it.
 */
describe('a synced project preview loses only this window’s mirror (FR-042, FR-110, item 8)', () => {
  it('sends no destroyed for the synced preview, destroyed for the sub-workspace’s own, and removes both here', async () => {
    const own = previewOwned('own', 'subworkspace:sub-3');
    const synced = previewOwned('synced', PROJECT);
    const { destroyed, subWorkspace, setSettings } = mount(subLayoutOf('sub-3', [row(own, synced, plain('keep'))]));
    await ready(['own', 'synced', 'keep']);

    setSettings(providers(false));

    await waitFor(() => expect(ids()).toEqual(['keep']));
    expect(destroyed).toHaveBeenCalledWith('own');
    expect(destroyed).not.toHaveBeenCalledWith('synced');
    // 'keep' survives, so the sub-workspace itself is untouched.
    expect(subWorkspace.close).not.toHaveBeenCalled();
  });
});
