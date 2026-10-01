/**
 * 048 FR-133 (T092) — a keyboard focus move to another panel ends the transient state of the panel being
 * left, exactly as a click on another panel does; and leaves alone what such a click leaves alone.
 *
 * REPRO (maintainer, verbatim): "if I open a blank panel, expand the 'Choose a type' drop-down, then
 * ctrl+shift+alt+arrow to another panel, the drop-down stays open."
 *
 * A click elsewhere closes an open throng menu through the menu's window `pointerdown` listener, and a
 * native drop-down because its `<select>` loses focus. A keyboard move produces no pointerdown, so a menu
 * open over the panel survived the move (red here before the fix). The select half is asserted as what
 * jsdom can see — the select is blurred — since jsdom has no popup to observe; see the closing report.
 *
 * Arrangement: one tab, an untyped panel (the type form) on the left and a REAL CodeMirror editor on
 * the right, mounted the way a window mounts them, under the real window key handler.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import { KeybindingsHandler } from '../../src/renderer/app.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { __resetPanelFocus } from '../../src/renderer/workspace/panel-focus.js';
import { __resetFindState, getFindSession, openFind, setTerm } from '../../src/renderer/search/search-store.js';
import { clearDraft } from '../../src/renderer/panel-type/panel-draft-store.js';

const PROJECT = 'proj-leave';
const ROOT = 'D:/proj-leave';
const EDITOR_PATH = `${ROOT}/a.ts`;
const FORM = 'p-form';
const EDITOR = 'p-ed';

type Ws = ReturnType<typeof useWorkspace>;
const captured: { ws: Ws | null } = { ws: null };

const formPanel: Panel = { type: 'panel', id: FORM, originProjectId: PROJECT, title: 'Panel 1' };
const editorPanel: Panel = {
  type: 'panel',
  id: EDITOR,
  originProjectId: PROJECT,
  title: 'Editor',
  kind: 'editor',
  config: { filePath: EDITOR_PATH },
};

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

async function mount(activePanelId: string): Promise<void> {
  stubRangeGeometry();
  const layout: WorkspaceLayout = createDefaultLayout(PROJECT, { tab: 't1', panel: FORM });
  layout.tabs[0].root = { type: 'split', orientation: 'row', sizes: [0.5, 0.5], children: [formPanel, editorPanel] };
  layout.tabs[0].activePanelId = activePanelId;
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
          text: 'const a = 1;\n',
          version: 1,
          dirty: false,
          absPath: EDITOR_PATH,
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
              createElement(
                ConfirmProvider,
                null,
                createElement(
                  ContextMenuProvider,
                  null,
                  createElement(Host, { key: 'host' }),
                  createElement(KeybindingsHandler, {
                    key: 'keys',
                    onToggleProjects: () => {},
                    onToggleExplorer: () => {},
                    onRevealLeft: () => {},
                    onRevealRight: () => {},
                  }),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  await screen.findByTestId(`panel-type-select-${FORM}`);
}

/** The editor's live CodeMirror content element, once the document has been adopted. */
async function editorContent(): Promise<HTMLElement> {
  let el: HTMLElement | null = null;
  await waitFor(() => {
    el = screen.getByTestId(`panel-${EDITOR}`).querySelector<HTMLElement>('.cm-content');
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain('const a = 1;');
  });
  return el!;
}

const press = (el: Element, key: 'ArrowRight' | 'ArrowLeft'): void => {
  act(() => {
    fireEvent.keyDown(el, { key, code: key, ctrlKey: true, shiftKey: true, altKey: true });
  });
};

const activeId = (): string | undefined => captured.ws?.layout?.tabs[0].activePanelId;

beforeEach(() => {
  captured.ws = null;
  setActivePane('workspace');
});

afterEach(() => {
  clearDraft(FORM);
  __resetFindState();
  __resetPanelFocus();
  Reflect.deleteProperty(window, 'throng');
});

describe('FR-133 — a keyboard move ends the leaving panel\'s transient controls', () => {
  it('an open menu over the panel being left closes, as a click on another panel closes it', async () => {
    await mount(FORM);
    await editorContent();
    const select = screen.getByTestId(`panel-type-select-${FORM}`);
    act(() => select.focus());

    // The untyped panel's content menu (048 FR-015), opened over the form.
    fireEvent.contextMenu(select, { clientX: 10, clientY: 10 });
    await screen.findByTestId('context-menu');

    press(document.activeElement ?? document.body, 'ArrowRight');

    await waitFor(() => expect(activeId()).toBe(EDITOR)); // positive control — the move happened
    expect(screen.queryByTestId('context-menu'), 'the menu outlived the keyboard move').toBeNull();
  });

  it('the type form\'s "Choose a type" drop-down loses focus, which is what closes a native list', async () => {
    await mount(FORM);
    await editorContent();
    const select = screen.getByTestId(`panel-type-select-${FORM}`);
    act(() => select.focus());
    const blurred = vi.fn();
    select.addEventListener('blur', blurred);

    press(select, 'ArrowRight');

    await waitFor(() => expect(activeId()).toBe(EDITOR));
    expect(blurred).toHaveBeenCalled();
    expect(document.activeElement).not.toBe(select);
  });

  /*
   * Blur alone does not close a native list in Electron on Windows (maintainer's report: focus moved, the
   * list stayed open). Chromium hides a select's popup when its layout is detached, so the move toggles
   * the select's `display` through one forced layout. jsdom has no popup; what it CAN prove is that the
   * toggle happened and that it never leaks — the inline value ends exactly as it was.
   */
  it('the drop-down is taken out of layout once and its inline display restored exactly', async () => {
    await mount(FORM);
    await editorContent();
    const select = screen.getByTestId(`panel-type-select-${FORM}`);
    select.style.display = 'inline-block'; // a non-empty prior value, so "restored" cannot mean "cleared"
    act(() => select.focus());
    // Records are collected in the callback AND drained at the end: a delivered batch leaves the queue.
    const oldValues: string[] = [];
    const collect = (records: MutationRecord[]): void => {
      for (const r of records) oldValues.push(r.oldValue ?? '');
    };
    const observer = new MutationObserver(collect);
    observer.observe(select, { attributes: true, attributeFilter: ['style'], attributeOldValue: true });

    press(select, 'ArrowRight');

    await waitFor(() => expect(activeId()).toBe(EDITOR));
    collect(observer.takeRecords());
    observer.disconnect();
    expect(oldValues.some((v) => v.includes('display: none')), `style history: ${JSON.stringify(oldValues)}`).toBe(true);
    expect(select.style.display).toBe('inline-block');
  });

  it('a find bar in the panel being left keeps its state (spec 033 — only its user or its editor closes it)', async () => {
    await mount(EDITOR);
    const content = await editorContent();
    act(() => content.focus());
    act(() => {
      openFind(EDITOR, 'editor');
      setTerm(EDITOR, 'const');
    });
    expect(getFindSession(EDITOR)?.term, 'precondition: a find session with a term').toBe('const');

    press(content, 'ArrowLeft');

    await waitFor(() => expect(activeId()).toBe(FORM));
    expect(getFindSession(EDITOR)?.term).toBe('const');
  });
});
