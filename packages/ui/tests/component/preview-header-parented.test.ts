/**
 * 044 T074 — a PARENTED preview's header: its title follows the parent editor, and it wears the
 * source document's unsaved dot (FR-031, FR-032, FR-040, FR-041, FR-043).
 *
 * ══ WHERE THE PARENT'S TITLE COMES FROM ══
 *
 * Not from the layout: a preview stores no link to an editor (FR-013). Main keeps each editor panel's
 * display title (published by `EditorTitlePublisher`) and forwards it on the preview's update as
 * `parent.title`, so this header reads it from `preview-store`. The tests push updates exactly as main
 * does and read the header through the real `PanelPlaceholder`, under the providers
 * `preview-panel-mount.test.ts` established.
 *
 * ══ THE DOT READS THE UPDATE, AND ONLY WHILE PARENTED ══
 *
 * FR-040's dot is the SOURCE document's state, copied by main onto the update — the preview holds no
 * dirty flag of its own. Main only ever sets it while parented; the header also refuses it on a
 * standalone preview (FR-043), so a standalone preview can never wear another document's mark.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PREVIEW_KIND,
  collectPanels,
  createDefaultLayout,
  createPreviewProviderRegistry,
  editorAutoTitle,
  type Panel,
  type PreviewAttachRequest,
  type PreviewUpdate,
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
import { ProjectsProvider } from '../../src/renderer/state/projects-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { PanelPlaceholder } from '../../src/renderer/workspace/panel-placeholder.js';
import { PreviewProviderRegistryContext } from '../../src/renderer/preview/provider-registry-context.js';
import { __resetPreviewStore } from '../../src/renderer/preview/preview-store.js';
import type { PreviewBodyProps } from '../../src/renderer/preview/provider-view.js';

const PROJECT = 'proj-1';
const FILE = 'D:/proj/notes.prvtxt';

const registry = createPreviewProviderRegistry([
  { id: 'testText', displayName: 'Test text', extensions: ['.prvtxt'], kind: 'text' },
]);
function FakeBody({ panelId }: PreviewBodyProps): ReactElement {
  return createElement('div', { 'data-testid': `fake-body-${panelId}` }, 'body');
}

function fakeDaemon(): ThrongBridge {
  const layout = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  return {
    invoke<T>(method: string): Promise<T> {
      switch (method) {
        case 'workspace.load':
          return Promise.resolve({ layout, restored: true } as T);
        case 'workspace.save':
          return Promise.resolve({ ok: true } as T);
        case 'workspace.loadSubWorkspaces':
        case 'subworkspace.list':
          return Promise.resolve({ subWorkspaces: [] } as T);
        case 'projects.list':
          return Promise.resolve({ projects: [] } as T);
        default:
          return Promise.reject(new Error(`unexpected RPC from the preview header mount: ${method}`));
      }
    },
  };
}

function servicesOver(bridge: ThrongBridge): Services {
  return {
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };
}

const update = (over: Partial<PreviewUpdate> & { revision: number }): PreviewUpdate => ({
  panelId: 'p1',
  filePath: FILE,
  providerId: 'testText',
  content: { kind: 'text', text: 'x' },
  dirty: false,
  parent: null,
  notice: null,
  ...over,
});

type Ws = ReturnType<typeof useWorkspace>;
const captured: { ws: Ws | null } = { ws: null };

function Host(): ReactElement | null {
  const ws = useWorkspace();
  captured.ws = ws;
  const tab = ws.layout?.tabs[0];
  if (!tab) return null;
  return createElement(
    'div',
    null,
    ...collectPanels(tab.root).map((p) => createElement(PanelPlaceholder, { key: p.id, panel: p, tabId: tab.id })),
  );
}

async function mountPreview() {
  const listeners = new Set<(u: PreviewUpdate) => void>();
  Reflect.set(window, 'throng', {
    panel: { notifyDestroyed: vi.fn(), onDestroyed: () => () => {} },
    preview: {
      attach: vi.fn((req: PreviewAttachRequest) =>
        Promise.resolve({ ok: true as const, update: update({ panelId: req.panelId, revision: 1 }) }),
      ),
      detach: vi.fn(),
      destroyed: vi.fn(),
      onUpdate: vi.fn((cb: (u: PreviewUpdate) => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      }),
    },
  });
  const services = servicesOver(fakeDaemon());
  render(
    createElement(
      PreviewProviderRegistryContext.Provider,
      { value: { registry, views: { testText: { id: 'testText', textSelection: true, load: () => Promise.resolve(FakeBody) } } } },
      createElement(
        ServicesProvider,
        { services },
        createElement(
          ProjectsProvider,
          { client: services.projects },
          createElement(
            WorkspaceProvider,
            { client: services.workspace, activeProjectId: PROJECT },
            createElement(
              NotificationProvider,
              null,
              createElement(ConfirmProvider, null, createElement(ContextMenuProvider, null, createElement(Host))),
            ),
          ),
        ),
      ),
    ),
  );
  await waitFor(() => expect(captured.ws?.layout).toBeTruthy());
  const layout = captured.ws?.layout as WorkspaceLayout;
  const id = (collectPanels(layout.tabs[0]!.root)[0] as Panel).id;
  act(() => captured.ws?.setPanelType(id, PREVIEW_KIND, { filePath: FILE }));
  await screen.findByTestId(`fake-body-${id}`);
  const push = (u: PreviewUpdate): void => {
    act(() => {
      for (const l of [...listeners]) l({ ...u, panelId: id });
    });
  };
  return { id, push };
}

const title = (id: string): HTMLElement => screen.getByTestId(`panel-title-${id}`);
const dot = (id: string): HTMLElement | null => screen.queryByTestId(`panel-unsaved-${id}`);

beforeEach(() => {
  captured.ws = null;
  __resetPreviewStore();
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

describe('the title follows the parent editor’s displayed name (FR-031)', () => {
  it('reads `<parent title> - Preview` while parented', async () => {
    const { id, push } = await mountPreview();
    push(update({ revision: 2, content: null, parent: { panelId: 'ed', title: 'My Notes' } }));
    expect(title(id).textContent).toBe('My Notes - Preview');
  });

  it('updates when the parent’s title changes — a rename of the editor, forwarded by main', async () => {
    const { id, push } = await mountPreview();
    push(update({ revision: 2, content: null, parent: { panelId: 'ed', title: 'notes' } }));
    expect(title(id).textContent).toBe('notes - Preview');

    push(update({ revision: 3, content: null, parent: { panelId: 'ed', title: 'Release plan' } }));
    expect(title(id).textContent).toBe('Release plan - Preview');
  });

  it('falls back to the standalone form when the parent goes away (FR-013b)', async () => {
    const { id, push } = await mountPreview();
    push(update({ revision: 2, content: null, parent: { panelId: 'ed', title: 'Release plan' } }));
    push(update({ revision: 3, content: null, parent: null }));
    expect(title(id).textContent).toBe(`${editorAutoTitle(FILE)} - Preview`);
  });
});

describe('a long parent name is shortened in its NAME part only (FR-032)', () => {
  it('marks the name truncated and keeps " - Preview" whole', async () => {
    const { id, push } = await mountPreview();
    push(update({ revision: 2, content: null, parent: { panelId: 'ed', title: 'P'.repeat(120) } }));

    const t = title(id);
    const name = t.querySelector('.panel-box__title-name');
    const suffix = t.querySelector('.panel-box__title-suffix');
    expect(name).toHaveClass('panel-box__title-name--truncated');
    expect(name?.textContent?.length).toBeLessThan(120);
    expect(name?.textContent?.startsWith('PPP')).toBe(true);
    expect(suffix?.textContent).toBe(' - Preview');
    expect(t).not.toHaveClass('panel-box__title--truncated');
  });
});

describe('the unsaved dot is the source document’s, exactly while it is dirty (FR-040, FR-041)', () => {
  it('shows while an update says dirty, and clears when one says clean', async () => {
    const { id, push } = await mountPreview();
    const parent = { panelId: 'ed', title: 'notes' };
    push(update({ revision: 2, content: null, parent }));
    expect(dot(id)).toBeNull();

    push(update({ revision: 3, content: null, parent, dirty: true }));
    expect(dot(id)).toBeInTheDocument();
    expect(dot(id)).toHaveAccessibleName('Unsaved changes');

    // Saved (or reverted) in the editor: main's next update carries the document's clean state.
    push(update({ revision: 4, content: null, parent, dirty: false }));
    expect(dot(id)).toBeNull();
  });

  it('a standalone preview never shows it (FR-043)', async () => {
    const { id, push } = await mountPreview();
    push(update({ revision: 2, content: null, parent: null, dirty: false }));
    expect(dot(id)).toBeNull();
    // Main never sends this; if it ever did, a standalone preview would still not wear the mark.
    push(update({ revision: 3, content: null, parent: null, dirty: true }));
    expect(dot(id)).toBeNull();
  });
});
