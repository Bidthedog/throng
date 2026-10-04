/**
 * 050 T105 (FR-038, research R21) — a file dragged from File Explorer onto the tab strip's + button.
 *
 * A single tree file over + shows `copy`, and dropping it opens a NEW tab with the file in an editor and
 * NO rename box (a click on + opens one; a drop is not a request to name anything). A file already open
 * in an editor focuses that editor and adds no tab (006 FR-011a). A folder, several items, or a drag from
 * outside throng show the no-entry cursor, `none` (FR-034).
 *
 * Mounted as a window mounts them: the real `TabGroup`, which renders the strip and the + button, with
 * `useNoDropNavigation` beside it — the window-level listener that says `none` over anything no target
 * claimed, which is what an OS drag over + must end in.
 *
 * `openFileInTab` is stubbed: what it does with a tab (an editor panel in it, a focus on an existing one)
 * is `editor-open`'s and is proved there. This file proves WHICH tab it is asked about, and that the tab
 * strip made no tab when the file was already open.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, Fragment } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectPanels, createDefaultLayout, DEFAULT_APP_SETTINGS, type WorkspaceLayout } from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, useNoDropNavigation, type Services } from '../../src/renderer/composition-root.js';
import { WorkspaceProvider, useWorkspace } from '../../src/renderer/state/workspace-store.js';
import { ProjectsProvider } from '../../src/renderer/state/projects-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { TabGroup } from '../../src/renderer/workspace/tab-group.js';
import { clearTreeDrag, setTreeDrag, takeTreeDropEffect } from '../../src/renderer/explorer/tree-drag-store.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { __resetPanelFocus } from '../../src/renderer/workspace/panel-focus.js';

const openFileInTab = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));
vi.mock('../../src/renderer/editor/editor-open.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/editor/editor-open.js')>()),
  openFileInTab,
}));

// `requestPreviewOpen` is the plain command (used to FOCUS a preview that already exists); the
// `...Outcome` form is what the new tab's own preview is asked through, so the tab can be taken back
// when the preview did not land in it.
const requestPreviewOpen = vi.hoisted(() => vi.fn((_intent: unknown) => Promise.resolve(true)));
const requestPreviewOpenOutcome = vi.hoisted(() =>
  vi.fn((intent: { intoPanelId?: string }): Promise<{ kind: string; panelId?: string | null }> =>
    Promise.resolve({ kind: 'placed', panelId: intent.intoPanelId }),
  ),
);
vi.mock('../../src/renderer/preview/open-preview.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/preview/open-preview.js')>()),
  requestPreviewOpen,
  requestPreviewOpenOutcome,
}));

const PROJECT = 'proj-new-tab-drop';
const FILE = 'C:/projects/demo/src/a.txt';
const MD = 'C:/projects/demo/docs/readme.md';

const captured: { ws: ReturnType<typeof useWorkspace> | null } = { ws: null };
function Probe(): null {
  captured.ws = useWorkspace();
  useNoDropNavigation();
  return null;
}

/** The shipped settings with Markdown's default open action set — what 047 FR-077 reads. */
function settingsWith(action: 'preview' | 'editor'): typeof DEFAULT_APP_SETTINGS {
  const settings = structuredClone(DEFAULT_APP_SETTINGS);
  Reflect.set(settings.editor.previews.providers, 'markdown', { enabled: true, defaultOpenAction: action });
  return settings;
}

function mount(isOpen: boolean, markdown: 'preview' | 'editor' = 'editor', previewOpen = false): void {
  Reflect.set(window, 'throng', {
    panel: { notifyDestroyed: vi.fn(), notifyRenamed: vi.fn(), notifyTyped: vi.fn(), publishIdentities: vi.fn() },
    config: { get: () => Promise.resolve({ settings: settingsWith(markdown) }), onChange: () => () => {} },
    // The editor a drop now types mounts for real and loads its file; `load` answering nothing is the
    // "document not available" branch, which is all this file needs (what loads is `editor-open`'s).
    editor: { isOpen: vi.fn(() => Promise.resolve(isOpen)), load: vi.fn(() => Promise.resolve(undefined)) },
    preview: { isOpen: vi.fn(() => Promise.resolve(previewOpen)) },
  });
  const layout: WorkspaceLayout = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  const bridge: ThrongBridge = {
    invoke<T>(method: string, params?: unknown): Promise<T> {
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
        case 'projects.categories.list':
          return Promise.resolve({ categories: [] } as T);
        case 'panelName.claim':
          return Promise.resolve({ granted: (params as { desired: string }).desired, adjusted: false } as T);
        default:
          return Promise.resolve({} as T);
      }
    },
  };
  const services: Services = {
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };
  render(
    createElement(
      ConfigProvider,
      null,
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
              createElement(
                ConfirmProvider,
                null,
                createElement(
                  ContextMenuProvider,
                  null,
                  createElement(Fragment, null, createElement(TabGroup, null), createElement(Probe, null)),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

/** A `dragover` or `drop` over `target`, with a dataTransfer whose dropEffect can be read back. */
function drag(
  type: 'dragover' | 'drop',
  target: Element,
  types: string[] = [],
): { event: Event; effect: () => string } {
  let effect = 'move';
  const dataTransfer = {
    types,
    get dropEffect() {
      return effect;
    },
    set dropEffect(next: string) {
      effect = next;
    },
  };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  act(() => {
    target.dispatchEvent(event);
  });
  return { event, effect: () => effect };
}

const tabCount = (): number => captured.ws?.layout?.tabs.length ?? 0;

afterEach(() => {
  clearTreeDrag();
  takeTreeDropEffect();
  __resetPanelFocus();
  setActivePane('workspace');
  captured.ws = null;
  openFileInTab.mockClear();
  requestPreviewOpen.mockClear();
  requestPreviewOpenOutcome.mockClear();
  requestPreviewOpenOutcome.mockImplementation((intent) =>
    Promise.resolve({ kind: 'placed', panelId: intent.intoPanelId }),
  );
  Reflect.deleteProperty(window, 'throng');
});

/** The tab the + drop made, and every panel in it (FR-038: exactly ONE). */
const newTab = (): { id: string; panels: ReturnType<typeof collectPanels> } => {
  const tab = captured.ws!.layout!.tabs.find((t) => t.id !== 't1')!;
  return { id: tab.id, panels: collectPanels(tab.root) };
};

describe('a single tree file dragged over + (050 FR-038)', () => {
  it('shows `copy` and claims the drag', async () => {
    mount(false);
    const add = await screen.findByTestId('tab-add');
    setTreeDrag({ paths: [FILE], singleFile: true });

    const over = drag('dragover', add);

    expect(over.effect()).toBe('copy');
    expect(over.event.defaultPrevented).toBe(true);
    expect(takeTreeDropEffect()).toBe('copy');
  });

  it('on drop opens a new tab holding ONE editor panel on the file, and no rename box', async () => {
    mount(false);
    const add = await screen.findByTestId('tab-add');
    await waitFor(() => expect(tabCount()).toBe(1));
    setTreeDrag({ paths: [FILE], singleFile: true });

    const drop = drag('drop', add);

    expect(drop.event.defaultPrevented).toBe(true);
    await waitFor(() => expect(tabCount()).toBe(2));
    await waitFor(() => expect(newTab().panels[0]?.kind).toBe('editor'));
    const created = newTab();
    // The tab's own empty panel is FILLED — not left empty beside a second one (the defect: two panels).
    expect(created.panels).toHaveLength(1);
    expect(JSON.stringify(created.panels[0])).toContain(FILE);
    expect(openFileInTab).not.toHaveBeenCalled();
    // A click on + opens the name box; a drop is not a request to name the tab.
    expect(screen.queryByTestId(`tab-rename-input-${created.id}`)).toBeNull();
  });

  it('a Markdown file whose default open action is Preview opens a preview in the ONE panel', async () => {
    mount(false, 'preview');
    const add = await screen.findByTestId('tab-add');
    await waitFor(() => expect(tabCount()).toBe(1));
    setTreeDrag({ paths: [MD], singleFile: true });

    drag('drop', add);

    await waitFor(() => expect(requestPreviewOpenOutcome).toHaveBeenCalledTimes(1));
    const created = newTab();
    expect(created.panels).toHaveLength(1);
    expect(requestPreviewOpenOutcome).toHaveBeenCalledWith({
      absPath: MD,
      projectId: PROJECT,
      target: { mode: 'new' },
      intoPanelId: created.panels[0]!.id,
    });
    // Not an editor: the preview is asked for, and the panel is not typed as one.
    expect(created.panels[0]!.kind).not.toBe('editor');
    expect(openFileInTab).not.toHaveBeenCalled();
  });

  it('a Markdown file whose default is Editor opens an editor in the ONE panel', async () => {
    mount(false, 'editor');
    const add = await screen.findByTestId('tab-add');
    await waitFor(() => expect(tabCount()).toBe(1));
    setTreeDrag({ paths: [MD], singleFile: true });

    drag('drop', add);

    await waitFor(() => expect(newTab().panels[0]?.kind).toBe('editor'));
    expect(newTab().panels).toHaveLength(1);
    expect(requestPreviewOpen).not.toHaveBeenCalled();
    expect(requestPreviewOpenOutcome).not.toHaveBeenCalled();
  });

  it('a file open in an editor but defaulting to Preview does NOT focus the editor: a preview opens in a new tab', async () => {
    mount(true, 'preview');
    const add = await screen.findByTestId('tab-add');
    await waitFor(() => expect(tabCount()).toBe(1));
    setTreeDrag({ paths: [MD], singleFile: true });

    drag('drop', add);

    await waitFor(() => expect(requestPreviewOpenOutcome).toHaveBeenCalledTimes(1));
    expect(openFileInTab).not.toHaveBeenCalled();
    expect(tabCount()).toBe(2);
    expect(newTab().panels).toHaveLength(1);
  });

  it('a preview of the file already exists: it is focused and NO tab is made (044 FR-012, FR-053)', async () => {
    mount(false, 'preview', true);
    const add = await screen.findByTestId('tab-add');
    await waitFor(() => expect(tabCount()).toBe(1));
    setTreeDrag({ paths: [MD], singleFile: true });

    drag('drop', add);

    await waitFor(() => expect(requestPreviewOpen).toHaveBeenCalledTimes(1));
    expect(requestPreviewOpen).toHaveBeenCalledWith(expect.objectContaining({ absPath: MD, projectId: PROJECT }));
    // The request names no panel to place into: it can only focus the existing preview.
    expect(requestPreviewOpen.mock.calls[0]?.[0]).not.toHaveProperty('intoPanelId');
    expect(requestPreviewOpenOutcome).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 50));
    expect(tabCount()).toBe(1);
  });

  it.each([
    ['focused', { kind: 'focused', panelId: 'elsewhere' }],
    ['placedElsewhere', { kind: 'placedElsewhere' }],
    ['refused', { kind: 'refused', reason: 'no-provider' }],
    ['unavailable', { kind: 'unavailable' }],
  ])('leaves no stray empty tab when main answers `%s` instead of placing it', async (_name, answer) => {
    requestPreviewOpenOutcome.mockImplementation(() => Promise.resolve(answer));
    mount(false, 'preview');
    const add = await screen.findByTestId('tab-add');
    await waitFor(() => expect(tabCount()).toBe(1));
    setTreeDrag({ paths: [MD], singleFile: true });

    drag('drop', add);

    await waitFor(() => expect(requestPreviewOpenOutcome).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(tabCount()).toBe(1));
    expect(captured.ws!.layout!.tabs[0]!.id).toBe('t1');
  });

  it('on drop of a file already open in an editor, opens it through the existing path and adds no tab', async () => {
    mount(true);
    const add = await screen.findByTestId('tab-add');
    await waitFor(() => expect(tabCount()).toBe(1));
    setTreeDrag({ paths: [FILE], singleFile: true });

    drag('drop', add);

    await waitFor(() => expect(openFileInTab).toHaveBeenCalledTimes(1));
    expect(openFileInTab.mock.calls[0]?.slice(1)).toEqual(['t1', FILE]);
    expect(tabCount()).toBe(1);
  });
});

describe('anything else dragged over + shows the no-entry cursor (050 FR-034, FR-038)', () => {
  it('a folder', async () => {
    mount(false);
    const add = await screen.findByTestId('tab-add');
    setTreeDrag({ paths: ['C:/projects/demo/src'], singleFile: false });

    expect(drag('dragover', add).effect()).toBe('none');
    drag('drop', add);
    expect(tabCount()).toBe(1);
    expect(openFileInTab).not.toHaveBeenCalled();
  });

  it('two items', async () => {
    mount(false);
    const add = await screen.findByTestId('tab-add');
    setTreeDrag({ paths: [FILE, 'C:/projects/demo/src/b.txt'], singleFile: false });

    expect(drag('dragover', add).effect()).toBe('none');
    drag('drop', add);
    expect(tabCount()).toBe(1);
    expect(openFileInTab).not.toHaveBeenCalled();
  });

  it('a drag from outside throng, which no target claims', async () => {
    mount(false);
    const add = await screen.findByTestId('tab-add');

    const over = drag('dragover', add, ['Files']);

    expect(over.effect()).toBe('none');
    drag('drop', add, ['Files']);
    expect(tabCount()).toBe(1);
    expect(openFileInTab).not.toHaveBeenCalled();
  });
});

describe('+ still does what it did', () => {
  it('a click opens the name box on the new tab', async () => {
    mount(false);
    fireEvent.click(await screen.findByTestId('tab-add'));
    await waitFor(() => expect(tabCount()).toBe(2));
    const created = captured.ws!.layout!.tabs.find((t) => t.id !== 't1')!;
    expect(await screen.findByTestId(`tab-rename-input-${created.id}`)).toBeTruthy();
  });
});
