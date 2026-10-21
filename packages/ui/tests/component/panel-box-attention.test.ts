import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLayout, collectPanels, type Panel, type WorkspaceLayout } from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { WorkspaceProvider, useWorkspace } from '../../src/renderer/state/workspace-store.js';
import { ProjectsProvider } from '../../src/renderer/state/projects-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { PanelPlaceholder } from '../../src/renderer/workspace/panel-placeholder.js';
import { setEditorState, removeEditorState, allEditorStates } from '../../src/renderer/editor/editor-state.js';
import { __resetAttentionStore, setAttentionMarks } from '../../src/renderer/attention/attention-store.js';
import { makeMark } from './attention-fixtures.js';

/**
 * The mark in a panel's header (057 US2, FR-003, FR-017).
 *
 * Layer: component — the REAL `PanelPlaceholder`, mounted as `panel-box.test.ts` mounts it. A header's
 * contents are what a DOM can see; "the mark clears on focus" is main's rule and is proved in core.
 *
 * ANTI-VACUITY CONTROL: gate the header mark on `panel.kind === 'terminal'` and the editor test fails;
 * remove the mark and every positive assertion fails.
 */

const PROJECT = 'proj-1';

function fakeDaemon(): ThrongBridge {
  const layout = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  return {
    invoke<T>(method: string): Promise<T> {
      switch (method) {
        case 'workspace.load': return Promise.resolve({ layout, restored: true } as T);
        case 'workspace.save': return Promise.resolve({ ok: true } as T);
        case 'workspace.loadSubWorkspaces':
        case 'subworkspace.list': return Promise.resolve({ subWorkspaces: [] } as T);
        case 'projects.list': return Promise.resolve({ projects: [] } as T);
        case 'projects.categories.list': return Promise.resolve({ categories: [] } as T);
        default: return Promise.reject(new Error(`unexpected RPC from the panel box: ${method}`));
      }
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

type Ws = ReturnType<typeof useWorkspace>;
const captured: { ws: Ws | null } = { ws: null };
const live = (): Ws => captured.ws as Ws;

function Host(): ReactElement | null {
  const ws = useWorkspace();
  captured.ws = ws;
  const tab = ws.layout?.tabs[0];
  if (!tab) return null;
  return createElement('div', null, ...collectPanels(tab.root).map((p) => createElement(PanelPlaceholder, { key: p.id, panel: p, tabId: tab.id })));
}

function mount(): void {
  Reflect.set(window, 'throng', { panel: { notifyDestroyed: vi.fn() } });
  const services = servicesOver(fakeDaemon());
  render(
    createElement(ServicesProvider, { services },
      createElement(ProjectsProvider, { client: services.projects },
        createElement(WorkspaceProvider, { client: services.workspace, activeProjectId: PROJECT },
          createElement(NotificationProvider, null,
            createElement(ConfirmProvider, null,
              createElement(ContextMenuProvider, null, createElement(Host))))))),
  );
}

async function firstPanel(): Promise<Panel> {
  await waitFor(() => expect(captured.ws?.layout).toBeTruthy());
  return collectPanels((live().layout as WorkspaceLayout).tabs[0].root)[0] as Panel;
}

beforeEach(() => { captured.ws = null; __resetAttentionStore(); });
afterEach(() => {
  __resetAttentionStore();
  for (const s of allEditorStates()) removeEditorState(s.panelId);
  Reflect.deleteProperty(window, 'throng');
});

describe('a panel header’s attention mark (FR-003)', () => {
  it('shows nothing for an unmarked panel', async () => {
    mount();
    const p = await firstPanel();
    await screen.findByTestId(`panel-${p.id}`);
    expect(screen.queryByTestId(`attention-panel-${p.id}`)).toBeNull();
  });

  it.each([
    ['an untyped panel', undefined],
    ['a terminal', 'terminal'],
    ['an editor', 'editor'],
  ] as const)('marks %s', async (_name, kind) => {
    mount();
    const p = await firstPanel();
    if (kind !== undefined) {
      act(() => live().setPanelType(p.id, kind, kind === 'editor' ? { filePath: 'C:/proj/a.txt' } : { flavourId: 'cmd' }));
    }
    await screen.findByTestId(`panel-${p.id}`);
    act(() => setAttentionMarks([makeMark(p.id, PROJECT, { title: 'Build', projectName: 'Alpha' })]));
    const el = await screen.findByTestId(`attention-panel-${p.id}`);
    expect(el).toHaveAttribute('aria-label', expect.stringContaining('Build'));
    expect(screen.getByTestId(`panel-${p.id}`)).toContainElement(el);
  });

  // FR-096 — the panel it marks is the one it sits on, so a native tooltip only repeated the kind.
  it('carries no native tooltip, and keeps its accessible name (FR-096, FR-015)', async () => {
    mount();
    const p = await firstPanel();
    await screen.findByTestId(`panel-${p.id}`);
    act(() => setAttentionMarks([makeMark(p.id, PROJECT, { title: 'Build', projectName: 'Alpha' })]));
    const el = await screen.findByTestId(`attention-panel-${p.id}`);
    expect(el).not.toHaveAttribute('title');
    expect(el).toHaveAttribute('aria-label', expect.stringContaining('Build'));
  });

  it('is absent again once the mark is cleared', async () => {
    mount();
    const p = await firstPanel();
    await screen.findByTestId(`panel-${p.id}`);
    act(() => setAttentionMarks([makeMark(p.id, PROJECT)]));
    expect(await screen.findByTestId(`attention-panel-${p.id}`)).toBeInTheDocument();
    act(() => setAttentionMarks([]));
    expect(screen.queryByTestId(`attention-panel-${p.id}`)).toBeNull();
  });

  it('ignores a mark on ANOTHER panel', async () => {
    mount();
    const p = await firstPanel();
    await screen.findByTestId(`panel-${p.id}`);
    act(() => setAttentionMarks([makeMark('someone-else', PROJECT)]));
    expect(screen.queryByTestId(`attention-panel-${p.id}`)).toBeNull();
  });

  it('sits beside the unsaved dot rather than replacing it (FR-017)', async () => {
    mount();
    const p = await firstPanel();
    act(() => live().setPanelType(p.id, 'editor', { filePath: 'C:/proj/a.txt' }));
    await screen.findByTestId(`panel-${p.id}`);
    setEditorState(p.id, { filePath: 'C:/proj/a.txt', dirty: true });
    act(() => setAttentionMarks([makeMark(p.id, PROJECT)]));
    const dot = await screen.findByTestId(`panel-unsaved-${p.id}`);
    const mark = await screen.findByTestId(`attention-panel-${p.id}`);
    expect(mark.parentElement).toBe(dot.parentElement);
    expect(mark).not.toBe(dot);
  });
});

// FR-118 — a marked panel says so across its whole header, so it stands out on a tab at a glance.
describe('a marked panel’s header is tinted (FR-118)', () => {
  it('carries the mark’s kind on the panel box, and drops it when the mark clears', async () => {
    mount();
    const p = await firstPanel();
    const box = await screen.findByTestId(`panel-${p.id}`);
    expect(box).not.toHaveAttribute('data-attention');
    act(() => setAttentionMarks([makeMark(p.id, PROJECT)]));
    await waitFor(() => expect(box).toHaveAttribute('data-attention', 'attention'));
    act(() => setAttentionMarks([makeMark(p.id, PROJECT, { kind: 'failed' })]));
    await waitFor(() => expect(box).toHaveAttribute('data-attention', 'failed'));
    act(() => setAttentionMarks([]));
    await waitFor(() => expect(box).not.toHaveAttribute('data-attention'));
  });
});
