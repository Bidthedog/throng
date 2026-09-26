/**
 * REPRO (maintainer, 046 iterate round 4 feedback, verbatim): "When the focus is on the center pane,
 * and I move between panels with CTRL+SHIFT+Alt+Arrows, it seems that the last terminal or editor
 * keeps carat focus when I move to an empty panel, or the search panel."
 *
 * Arrangement: one tab, two panels side by side — a REAL CodeMirror editor on the left holding DOM
 * focus, and on the right either an empty (untyped) panel or a Find in Files panel. Both are mounted
 * the way a window mounts them (`PanelPlaceholder` → `PanelBody`), under the real window key handler
 * (`app.tsx` `KeybindingsHandler`), and the chord is `focus.right`'s shipped `Ctrl+Shift+Alt+ArrowRight`
 * pressed on the focused editor content.
 *
 * Expected (012 US3 — "DOM focus follows the active-panel indicator"): the right panel becomes the
 * active panel AND the keyboard goes with it — DOM focus leaves the editor and lands inside the target
 * panel, so typing no longer reaches the editor.
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
import { installFileSearchStub, removeFileSearchStub } from './helpers/find-in-files.js';

const PROJECT = 'proj-move';
const ROOT = 'D:/proj-move';
const EDITOR_PATH = `${ROOT}/a.ts`;

type Ws = ReturnType<typeof useWorkspace>;
const captured: { ws: Ws | null } = { ws: null };

const editorPanel: Panel = {
  type: 'panel',
  id: 'p-ed',
  originProjectId: PROJECT,
  title: 'Editor',
  kind: 'editor',
  config: { filePath: EDITOR_PATH },
};

function layoutWith(target: Panel): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT, { tab: 't1', panel: editorPanel.id });
  l.tabs[0].root = { type: 'split', orientation: 'row', sizes: [0.5, 0.5], children: [editorPanel, target] };
  l.tabs[0].activePanelId = editorPanel.id;
  return l;
}

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

/*
 * jsdom has no text geometry; CodeMirror's selection layer measures on every update and throws inside
 * a callback it swallows. Same stub `helpers/mount-editor.ts` installs, for the same reason.
 */
function stubRangeGeometry(): void {
  const range = globalThis.Range?.prototype as unknown as Record<string, unknown> | undefined;
  if (range && typeof range.getClientRects !== 'function') {
    range.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
    range.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 });
  }
}

async function mount(target: Panel): Promise<void> {
  stubRangeGeometry();
  const layout = layoutWith(target);
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

  // The Find in Files stub first (it replaces `window.throng`), then the rest merged over it.
  installFileSearchStub();
  const base = (Reflect.get(window, 'throng') ?? {}) as Record<string, unknown>;
  Reflect.set(window, 'throng', {
    ...base,
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
  await waitFor(() => expect(screen.getByTestId(`panel-${target.id}`)).toBeInTheDocument());
}

/** The editor's live CodeMirror content element, once the document has been adopted. */
async function editorContent(): Promise<HTMLElement> {
  let el: HTMLElement | null = null;
  await waitFor(() => {
    el = screen.getByTestId(`panel-${editorPanel.id}`).querySelector<HTMLElement>('.cm-content');
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain('const a = 1;');
  });
  return el!;
}

const activeId = (): string | undefined => captured.ws?.layout?.tabs[0].activePanelId;

beforeEach(() => {
  captured.ws = null;
  setActivePane('workspace');
});

afterEach(() => {
  __resetPanelFocus();
  removeFileSearchStub();
  Reflect.deleteProperty(window, 'throng');
});

const targets: Array<[string, Panel]> = [
  ['an empty (untyped) panel', { type: 'panel', id: 'p-empty', originProjectId: PROJECT, title: 'Panel 2' }],
  ['a Find in Files panel', { type: 'panel', id: 'p-find', originProjectId: PROJECT, title: 'Find in Files', kind: 'findInFiles' }],
];

describe('REPRO — Ctrl+Shift+Alt+ArrowRight from a focused editor moves the keyboard with the active panel', () => {
  for (const [label, target] of targets) {
    it(`to ${label}: the target becomes active AND DOM focus leaves the editor for it`, async () => {
      await mount(target);
      const content = await editorContent();

      // The user is typing in the editor: DOM focus is in its CodeMirror content.
      act(() => content.focus());
      expect(document.activeElement, 'precondition: the editor holds DOM focus').toBe(content);

      act(() => {
        fireEvent.keyDown(content, { key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, shiftKey: true, altKey: true });
      });

      // Positive control — the chord did move the active panel.
      await waitFor(() => expect(activeId()).toBe(target.id));

      const focusedInEditor = screen.getByTestId(`panel-${editorPanel.id}`).contains(document.activeElement);
      expect(focusedInEditor, 'DOM focus is still inside the editor panel — typing would go into the editor').toBe(false);
      expect(
        screen.getByTestId(`panel-${target.id}`).contains(document.activeElement),
        `DOM focus is not inside the newly active panel (activeElement: ${document.activeElement?.outerHTML.slice(0, 120)})`,
      ).toBe(true);
    });
  }
});

/*
 * T210 (046 FR-125, constitution v5.6.0 Principle XI "Focus follows the active Panel"): WHERE inside
 * the target the caret lands. The control that last held focus inside the panel, else its first
 * focusable control — for an untyped panel its type picker, for Find in Files its search box.
 */
describe('FR-125 — a keyboard move lands on the panel\'s focus target', () => {
  const pressRight = (el: HTMLElement): void => {
    act(() => {
      fireEvent.keyDown(el, { key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, shiftKey: true, altKey: true });
    });
  };

  it('an untyped panel nothing was focused in before: the caret lands on its type picker', async () => {
    const target = targets[0][1];
    await mount(target);
    const content = await editorContent();
    act(() => content.focus());

    pressRight(content);

    await waitFor(() => expect(activeId()).toBe(target.id));
    expect(document.activeElement).toBe(screen.getByTestId(`panel-type-select-${target.id}`));
  });

  it('a Find in Files panel nothing was focused in before: the caret lands in its search box', async () => {
    const target = targets[1][1];
    await mount(target);
    const content = await editorContent();
    act(() => content.focus());

    pressRight(content);

    await waitFor(() => expect(activeId()).toBe(target.id));
    expect(document.activeElement).toBe(screen.getByTestId(`fif-term-${target.id}`));
  });

  it('a Find in Files panel whose replace field last held focus: the caret goes back to the replace field', async () => {
    const target = targets[1][1];
    await mount(target);
    const content = await editorContent();

    // The user was in the panel's replace field…
    fireEvent.click(screen.getByTestId(`fif-toggle-replace-${target.id}`));
    const replacement = await screen.findByTestId(`fif-replacement-${target.id}`);
    act(() => replacement.focus());
    expect(document.activeElement, 'precondition: the replace field holds DOM focus').toBe(replacement);

    // …then went back to the editor, making it the active panel again.
    act(() => captured.ws!.setActivePanel('t1', editorPanel.id));
    act(() => content.focus());
    await waitFor(() => expect(activeId()).toBe(editorPanel.id));

    pressRight(content);

    await waitFor(() => expect(activeId()).toBe(target.id));
    expect(document.activeElement).toBe(replacement);
  });
});
