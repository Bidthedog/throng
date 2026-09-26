/**
 * REPRO (maintainer, 046 iterate round 4 feedback, verbatim): "If I use the arrow keys to select a
 * project in the project list, then press enter, the project becomes active (the first panel
 * activates), but the highlight box remains visible around the projects pane, and no highlight box is
 * active around the active panel in the center pane. When entering a project, the project pane should
 * stay active - center pane activation is a manual step for the user."
 *
 * Governing requirement: 046 FR-082 — a switch from the Projects list by click or Enter "MUST leave
 * the Projects pane as the active pane, with its outline and its keyboard scope (projects), and focus
 * MUST stay on the project list, on the chosen row."
 *
 * `project-switch-active-pane.test.ts` pins FR-082 with NO editor mounted, and
 * `editor-caret-persist.e2e.ts:175` pins it for a switch into a project whose editor mounts FRESH.
 * Neither covers the case here: ProjA's editor has ALREADY been shown this session, so when the user
 * comes back to ProjA its editor REMOUNTS with saved view state.
 *
 * Arrangement: the real Projects list, the real `PanelFocusSync`, and the active tab's panels mounted
 * as a window mounts them (`PanelPlaceholder` → `PanelBody` → a real CodeMirror `EditorPanel`). ProjA
 * holds an editor showing a file; ProjB holds one empty panel.
 *
 * Steps: Enter on ProjA's row (editor mounts fresh) → Enter on ProjB's row (ProjA's editor unmounts)
 * → ArrowUp to ProjA's row → Enter. Expected: ProjA's row keeps DOM focus. Nothing else was pressed.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectCategoryDto, ProjectDto } from '@throng/ipc-contract';
import { collectPanels, type WorkspaceLayout } from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { ProjectsProvider, useProjects } from '../../src/renderer/state/projects-store.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { WorkspaceProvider, useWorkspace } from '../../src/renderer/state/workspace-store.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ProjectsPanel } from '../../src/renderer/sidebar/projects-panel.js';
import { PanelPlaceholder } from '../../src/renderer/workspace/panel-placeholder.js';
import { PanelFocusSync } from '../../src/renderer/app.js';
import { getActivePane, setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { __resetPanelFocus } from '../../src/renderer/workspace/panel-focus.js';

const now = '2026-01-01T00:00:00.000Z';
const CATEGORIES: ProjectCategoryDto[] = [
  { id: 'default', name: 'In Progress', isDefault: true, minimised: false, createdAt: now, updatedAt: now },
];
const project = (id: string): ProjectDto => ({
  id,
  name: id,
  colour: '#3b82f6',
  rootFolder: `C:/projects/${id}`,
  isActive: false,
  createdAt: now,
  updatedAt: now,
  hiddenPaths: [],
  categoryId: 'default',
});
const PROJECTS: ProjectDto[] = [project('pA'), project('pB')];
const FILE_A = 'C:/projects/pA/lines.txt';

/**
 * What ProjA's one panel is. The editor is `c7e5fd84`'s repro; the terminal is T212's — the same
 * route through `use-terminal.ts` `focusIfActive`, read from the code.
 */
let projAKind: 'editor' | 'terminal' = 'editor';
const projAPanelId = (): string => (projAKind === 'editor' ? 'ed-pA' : 'term-pA');

/** ProjA: one editor showing lines.txt (or one terminal). ProjB: one empty (untyped) panel. */
const layoutFor = (projectId: string): WorkspaceLayout => ({
  projectId,
  schemaVersion: 1,
  tabs: [
    {
      id: `t-${projectId}`,
      title: 'Tab 1',
      root:
        projectId === 'pA'
          ? projAKind === 'editor'
            ? { type: 'panel', id: 'ed-pA', originProjectId: 'pA', title: 'Editor', kind: 'editor', config: { filePath: FILE_A } }
            : { type: 'panel', id: 'term-pA', originProjectId: 'pA', title: 'Terminal', kind: 'terminal' }
          : { type: 'panel', id: 'empty-pB', originProjectId: 'pB', title: 'Panel 1' },
      activePanelId: projectId === 'pA' ? projAPanelId() : 'empty-pB',
    },
  ],
  activeTabId: `t-${projectId}`,
});

function noop(): void {
  /* nothing */
}

/** Every call the terminal attach makes, answered and inert (the `terminal-title-unmount` bridge). */
function fakeTerminalBridge() {
  return {
    attach: vi.fn(() => Promise.resolve({ ok: true as const, status: 'running' })),
    detach: vi.fn(() => Promise.resolve()),
    write: vi.fn(() => Promise.resolve()),
    writeClipboard: vi.fn(() => Promise.resolve()),
    resize: vi.fn(() => Promise.resolve()),
    onOutput: vi.fn(() => noop),
    onGrid: vi.fn(() => noop),
    onExit: vi.fn(() => noop),
  };
}

/** jsdom has no media queries and no layout; xterm asks for both on its first render. */
function shimTerminalEnvironment(): void {
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: noop,
        removeListener: noop,
        addEventListener: noop,
        removeEventListener: noop,
        dispatchEvent: () => false,
      }),
    });
  }
  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver !== 'function') {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe = noop;
      unobserve = noop;
      disconnect = noop;
    };
  }
}

function fakeBridge(): ThrongBridge {
  return {
    invoke<T>(method: string, params?: unknown): Promise<T> {
      switch (method) {
        case 'projects.list':
          return Promise.resolve({ projects: PROJECTS } as unknown as T);
        case 'projects.categories.list':
          return Promise.resolve({ categories: CATEGORIES } as unknown as T);
        case 'projects.setActive': {
          const { id } = params as { id: string };
          return Promise.resolve({ activeId: id } as unknown as T);
        }
        case 'workspace.load': {
          const { projectId } = params as { projectId: string };
          return Promise.resolve({ layout: layoutFor(projectId), restored: true } as unknown as T);
        }
        case 'workspace.save':
          return Promise.resolve({ ok: true } as unknown as T);
        case 'workspace.loadSubWorkspaces':
        case 'subworkspace.list':
          return Promise.resolve({ subWorkspaces: [] } as unknown as T);
        default:
          return Promise.resolve({} as T);
      }
    },
  };
}

/** The active tab's panels, as the workspace pane mounts them. */
function Host(): ReactElement | null {
  const { layout } = useWorkspace();
  const tab = layout?.tabs.find((t) => t.id === layout.activeTabId);
  if (!tab) return null;
  return createElement(
    'div',
    { 'data-testid': 'layout-probe', 'data-active-tab': tab.id },
    ...collectPanels(tab.root).map((p) => createElement(PanelPlaceholder, { key: p.id, panel: p, tabId: tab.id })),
  );
}

function WorkspaceWire({ client }: { client: WorkspaceClient }): ReactElement {
  const { activeProject } = useProjects();
  return createElement(
    WorkspaceProvider,
    { client, activeProjectId: activeProject?.id ?? null },
    createElement(
      NotificationProvider,
      null,
      createElement(
        ConfirmProvider,
        null,
        createElement(
          ContextMenuProvider,
          null,
          createElement('div', null, createElement(ProjectsPanel), createElement(PanelFocusSync), createElement(Host)),
        ),
      ),
    ),
  );
}

function stubRangeGeometry(): void {
  // jsdom has no text geometry — the same stub `helpers/mount-editor.ts` installs, for the same reason.
  const range = globalThis.Range?.prototype as unknown as Record<string, unknown> | undefined;
  if (range && typeof range.getClientRects !== 'function') {
    range.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
    range.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 });
  }
}

async function mount(): Promise<void> {
  stubRangeGeometry();
  shimTerminalEnvironment();
  const bridge = fakeBridge();
  const services: Services = {
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };
  Reflect.set(window, 'throng', {
    panel: { notifyDestroyed: vi.fn(), notifyRenamed: vi.fn(), notifyTyped: vi.fn(), publishIdentities: vi.fn() },
    config: { get: () => Promise.resolve({ settings: {} }), onChange: () => () => {} },
    terminal: fakeTerminalBridge(),
    editor: {
      register: vi.fn(),
      destroy: vi.fn(),
      verifyPath: vi.fn(),
      isOpen: () => Promise.resolve(false),
      openInto: () => Promise.resolve({ action: 'open' }),
      load: () => Promise.resolve({ ok: false, reason: 'io' }),
      getContent: () =>
        Promise.resolve({
          text: 'AAAA\nBBBB\nCCCC\nDDDD\n',
          version: 1,
          dirty: false,
          absPath: FILE_A,
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
        createElement(ProjectsProvider, { client: services.projects }, createElement(WorkspaceWire, { client: services.workspace })),
      ),
    ),
  );
  await waitFor(() => expect(screen.getByTestId('project-item-pA')).toBeInTheDocument());
}

const row = (id: string): HTMLElement => screen.getByTestId(`project-item-${id}`);
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** ProjA's editor has adopted its document. */
async function editorShowsFileA(): Promise<HTMLElement> {
  let el: HTMLElement | null = null;
  await waitFor(() => {
    el = screen.getByTestId('panel-ed-pA').querySelector<HTMLElement>('.cm-content');
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain('CCCC');
  });
  return el!;
}

afterEach(() => {
  projAKind = 'editor';
  setActivePane('workspace');
  __resetPanelFocus();
  Reflect.deleteProperty(window, 'throng');
});

describe('REPRO — returning to a visited project from the list keeps focus on its row (046 FR-082)', () => {
  it('ArrowUp to ProjA’s row and Enter: the row keeps focus and ProjA’s restored editor does not take it', async () => {
    await mount();

    // 1. Enter on ProjA's row — its editor mounts fresh (nothing saved yet).
    act(() => row('pA').focus());
    act(() => {
      fireEvent.keyDown(row('pA'), { key: 'Enter' });
    });
    await editorShowsFileA();
    await settle();
    // Control: the FRESH mount leaves focus on the row, as editor-caret-persist.e2e.ts:175 pins.
    expect(document.activeElement, 'fresh mount: focus left ProjA’s row').toBe(row('pA'));

    // 2. ArrowDown to ProjB's row, Enter — ProjA's editor unmounts.
    act(() => {
      fireEvent.keyDown(row('pA'), { key: 'ArrowDown' });
    });
    expect(document.activeElement, 'ArrowDown did not reach ProjB’s row').toBe(row('pB'));
    act(() => {
      fireEvent.keyDown(row('pB'), { key: 'Enter' });
    });
    await waitFor(() => expect(screen.getByTestId('layout-probe')).toHaveAttribute('data-active-tab', 't-pB'));
    await settle();
    expect(document.activeElement).toBe(row('pB'));

    // 3. ArrowUp back to ProjA's row, Enter — ProjA's editor REMOUNTS.
    act(() => {
      fireEvent.keyDown(row('pB'), { key: 'ArrowUp' });
    });
    expect(document.activeElement, 'ArrowUp did not reach ProjA’s row').toBe(row('pA'));
    act(() => {
      fireEvent.keyDown(row('pA'), { key: 'Enter' });
    });
    await editorShowsFileA();
    await settle();
    await settle();

    const editorPanel = screen.getByTestId('panel-ed-pA');
    expect(getActivePane(), 'the Projects pane lost the active pane').toBe('projects');
    expect(
      editorPanel.contains(document.activeElement),
      'DOM focus moved into ProjA’s editor — keystrokes now reach the editor, not the project list',
    ).toBe(false);
    expect(
      document.activeElement,
      `focus is not on ProjA’s row (activeElement: ${document.activeElement?.outerHTML.slice(0, 120)})`,
    ).toBe(row('pA'));
  });
});

/*
 * T212 (046 FR-082): the same list-Enter route into a project whose active panel is a TERMINAL. A
 * terminal takes focus on mount and again when its attach resolves (`use-terminal.ts` `focusIfActive`),
 * so both the first visit and the return are asserted: neither may move focus off the chosen row.
 */
describe('FR-082 — a list-Enter switch into a project whose active panel is a terminal keeps focus on the row', () => {
  /** ProjA's terminal has opened its xterm view (and its attach has resolved). */
  async function terminalMounted(): Promise<void> {
    await waitFor(() => {
      expect(screen.getByTestId('panel-term-pA').querySelector('.xterm')).not.toBeNull();
    });
    await settle();
    await settle();
  }

  const focusNotInTerminal = (label: string): void => {
    expect(
      screen.getByTestId('panel-term-pA').contains(document.activeElement),
      `${label}: DOM focus moved into ProjA’s terminal — keystrokes now reach the shell, not the project list`,
    ).toBe(false);
    expect(
      document.activeElement,
      `${label}: focus is not on ProjA’s row (activeElement: ${document.activeElement?.outerHTML.slice(0, 120)})`,
    ).toBe(row('pA'));
  };

  it('Enter on ProjA’s row, away to ProjB, ArrowUp back and Enter: the row keeps focus both times', async () => {
    projAKind = 'terminal';
    await mount();

    act(() => row('pA').focus());
    act(() => {
      fireEvent.keyDown(row('pA'), { key: 'Enter' });
    });
    await terminalMounted();
    expect(getActivePane(), 'first visit: the Projects pane lost the active pane').toBe('projects');
    focusNotInTerminal('first visit');

    act(() => {
      fireEvent.keyDown(row('pA'), { key: 'ArrowDown' });
    });
    act(() => {
      fireEvent.keyDown(row('pB'), { key: 'Enter' });
    });
    await waitFor(() => expect(screen.getByTestId('layout-probe')).toHaveAttribute('data-active-tab', 't-pB'));
    await settle();
    expect(document.activeElement).toBe(row('pB'));

    act(() => {
      fireEvent.keyDown(row('pB'), { key: 'ArrowUp' });
    });
    act(() => {
      fireEvent.keyDown(row('pA'), { key: 'Enter' });
    });
    await terminalMounted();
    expect(getActivePane(), 'return: the Projects pane lost the active pane').toBe('projects');
    focusNotInTerminal('return');
  });
});
