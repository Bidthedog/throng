/**
 * 048 FR-132 (T091) — confirming a type on an empty panel's type form puts the keyboard in the new
 * content, so the user can type at once.
 *
 * REPRO (maintainer, verbatim): "if I navigate to 'Confirm' on the blank panel page, and a new editor is
 * created, the editor should take the carat focus — currently, I have to click or press tab again to
 * activate the editor. This works OK in terminals."
 *
 * A terminal takes the caret because `use-terminal.ts` focuses its xterm on mount when its panel is the
 * active one. An editor deliberately does NOT focus on an ordinary mount (`use-editor.ts`: a fresh open
 * from the tree must leave the tree focused for F2), so nothing put the caret in a confirmed editor: the
 * focused Confirm button unmounted with the form and focus fell to the body.
 *
 * Mounted the way a window mounts a panel (`PanelPlaceholder` → `PanelBody`), with a REAL CodeMirror
 * view, and Confirm driven both by a click and by Enter on the focused button.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectPanels, createDefaultLayout, type Panel, type WorkspaceLayout } from '@throng/core';
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
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { PanelPlaceholder } from '../../src/renderer/workspace/panel-placeholder.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { __resetPanelFocus } from '../../src/renderer/workspace/panel-focus.js';
import { clearDraft } from '../../src/renderer/panel-type/panel-draft-store.js';

const PROJECT = 'proj-confirm';
const ROOT = 'D:/proj-confirm';
/*
 * A FRESH panel id per test, and not for tidiness: an unmounting editor saves its view state in a
 * module-level store keyed by panel id (`takeEditorViewState`), and an editor that mounts with saved
 * state is a RESTORE, which takes focus on its own. Sharing one id let the second test pass on the first
 * one's leftovers — observed: keyboard green, click red, against the same unfixed code.
 */
let PANEL = '';
let seq = 0;

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

/* jsdom has no text geometry; same stub `move-focus-dom-focus.test.ts` installs, for the same reason. */
function stubRangeGeometry(): void {
  const range = globalThis.Range?.prototype as unknown as Record<string, unknown> | undefined;
  if (range && typeof range.getClientRects !== 'function') {
    range.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
    range.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 });
  }
}

async function mount(): Promise<void> {
  stubRangeGeometry();
  const layout: WorkspaceLayout = createDefaultLayout(PROJECT, { tab: 't1', panel: PANEL });
  const emptyPanel: Panel = { type: 'panel', id: PANEL, originProjectId: PROJECT, title: 'Panel 1' };
  layout.tabs[0].root = emptyPanel;
  layout.tabs[0].activePanelId = PANEL;
  const bridge: ThrongBridge = {
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
          return Promise.resolve({
            projects: [
              {
                id: PROJECT,
                name: 'Proj',
                colour: '#336699',
                rootFolder: ROOT,
                isActive: true,
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
                hiddenPaths: [],
              },
            ],
          } as T);
        case 'projects.categories.list':
          return Promise.resolve({ categories: [] } as T);
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

  Reflect.set(window, 'throng', {
    terminal: { listFlavours: () => Promise.resolve([]), capabilities: () => Promise.resolve({ elevated: false }) },
    panel: { notifyDestroyed: vi.fn(), notifyRenamed: vi.fn(), notifyTyped: vi.fn(), publishIdentities: vi.fn() },
    config: { get: () => Promise.resolve({ settings: {} }), onChange: () => () => {} },
    editor: {
      register: vi.fn(),
      destroy: vi.fn(),
      verifyPath: vi.fn(),
      isOpen: () => Promise.resolve(false),
      openInto: () => Promise.resolve({ action: 'open' }),
      load: () => Promise.resolve({ ok: false, reason: 'io' }),
      getContent: () =>
        Promise.resolve({
          text: '',
          version: 1,
          dirty: false,
          absPath: null,
          fileMissing: false,
          unloadable: false,
          encoding: 'utf8',
          hasBom: false,
          lineEnding: 'lf',
        }),
      onSync: () => () => {},
      dispatch: vi.fn(),
    },
  });

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
              createElement(ConfirmProvider, null, createElement(ContextMenuProvider, null, createElement(Host, null))),
            ),
          ),
        ),
      ),
    ),
  );
  await screen.findByTestId(`panel-type-select-${PANEL}`);
}

/** The confirmed editor's CodeMirror content element, once it exists. */
async function editorContent(): Promise<HTMLElement> {
  let el: HTMLElement | null = null;
  await waitFor(() => {
    el = screen.getByTestId(`panel-${PANEL}`).querySelector<HTMLElement>('.cm-content');
    expect(el).not.toBeNull();
  });
  return el!;
}

beforeEach(() => {
  captured.ws = null;
  PANEL = `p-empty-${++seq}`;
  setActivePane('workspace');
});

afterEach(() => {
  clearDraft(PANEL);
  __resetPanelFocus();
  Reflect.deleteProperty(window, 'throng');
});

describe('FR-132 — Confirm on the type form puts the caret in the new editor', () => {
  it('Confirm CLICKED: DOM focus lands in the editor\'s content', async () => {
    const user = userEvent.setup();
    await mount();
    await user.selectOptions(screen.getByTestId(`panel-type-select-${PANEL}`), 'editor');

    await user.click(screen.getByTestId(`panel-type-confirm-${PANEL}`));

    const content = await editorContent();
    await waitFor(() =>
      expect(document.activeElement, `activeElement: ${document.activeElement?.outerHTML.slice(0, 120)}`).toBe(content),
    );
  });

  it('Confirm pressed from the KEYBOARD: DOM focus lands in the editor\'s content', async () => {
    const user = userEvent.setup();
    await mount();
    await user.selectOptions(screen.getByTestId(`panel-type-select-${PANEL}`), 'editor');

    const confirm = screen.getByTestId(`panel-type-confirm-${PANEL}`);
    act(() => confirm.focus());
    expect(document.activeElement, 'precondition: Confirm holds focus').toBe(confirm);
    await user.keyboard('{Enter}');

    const content = await editorContent();
    await waitFor(() =>
      expect(document.activeElement, `activeElement: ${document.activeElement?.outerHTML.slice(0, 120)}`).toBe(content),
    );
  });
});
