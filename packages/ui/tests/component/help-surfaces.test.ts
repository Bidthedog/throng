/**
 * 080 FR-017 (research R20) — the surfaces that carry long descriptions get a (?) to the right guide section:
 * the New Panel **Panel Type** picker, the Terminal settings form, the Projects list header and the Find in
 * Files options. Each opens in the OS browser (FR-011), through the shared themeable `HelpLink`.
 *
 * Layer: component — the real components; what each renders and what its (?) opens.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HELP_APP_BASE_URL, GUIDE_MAP, createDefaultLayout, defaultPanelTypeRegistry, helpUrl } from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import { ServicesProvider } from '../../src/renderer/composition-root.js';
import { WorkspaceProvider } from '../../src/renderer/state/workspace-store.js';
import { ProjectsProvider } from '../../src/renderer/state/projects-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { PanelTypeForm } from '../../src/renderer/panel-type/panel-type-form.js';
import { clearDraft } from '../../src/renderer/panel-type/panel-draft-store.js';
import { TerminalInputs } from '../../src/renderer/panel-type/terminal-inputs.js';
import { ProjectsPanel } from '../../src/renderer/sidebar/projects-panel.js';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  PANEL_ID,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
} from './helpers/find-in-files.js';

const openHelp = vi.fn();

beforeEach(() => openHelp.mockClear());
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'throng');
});

describe('the Terminal settings form (?)', () => {
  it('opens Terminals › Change how a terminal is set up', async () => {
    Reflect.set(window, 'throng', { openHelp });
    render(createElement(TerminalInputs, { values: {}, flavours: [], elevated: false, onChange: () => {} }));
    const link = screen.getByTestId('help-link-terminal-form');
    expect(link).toHaveAttribute('title', 'Help: Terminal settings');
    await userEvent.setup({ delay: null }).click(link);
    expect(openHelp).toHaveBeenCalledExactlyOnceWith(
      helpUrl({ page: 'terminals', anchor: 'change-how-a-terminal-is-set-up' }, { base: HELP_APP_BASE_URL }),
    );
  });
});

describe('the Projects list header (?)', () => {
  class ImmediateResizeObserver implements ResizeObserver {
    constructor(private readonly cb: ResizeObserverCallback) {}
    observe(target: Element): void {
      const contentRect = { width: 320, height: 600, top: 0, left: 0, right: 320, bottom: 600, x: 0, y: 0, toJSON: () => ({}) } satisfies DOMRectReadOnly;
      this.cb([{ target, contentRect } as ResizeObserverEntry], this);
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  beforeAll(() => {
    globalThis.ResizeObserver = ImmediateResizeObserver;
  });
  afterAll(() => {
    Reflect.deleteProperty(globalThis, 'ResizeObserver');
  });

  it('is not there: the Projects pane header carries no (?) (FR-056, superseding FR-017 for the project list)', async () => {
    const bridge = {
      invoke: vi.fn(async (method: string): Promise<unknown> => {
        if (method === 'projects.list') return { projects: [] };
        if (method === 'projects.categories.list') return { categories: [] };
        throw new Error(`unexpected RPC: ${method}`);
      }),
    } as unknown as ThrongBridge;
    Reflect.set(window, 'throng', { openHelp, editor: { subWorkspaceFiles: () => Promise.resolve([]) }, projects: { onChanged: () => () => {}, notifyChanged: () => {} }, panels: { publishIdentities: () => {} } });
    render(
      createElement(ProjectsProvider, { client: new ProjectsClient(bridge) },
        createElement(WorkspaceProvider, { client: new WorkspaceClient(bridge), activeProjectId: null },
          createElement(NotificationProvider, null,
            createElement(ConfirmProvider, null,
              createElement(ContextMenuProvider, null, createElement(ProjectsPanel)))))),
    );
    const header = (await screen.findByText('Projects', { selector: '.panel__title' })).closest('header');
    expect(header).toHaveClass('panel__header');
    expect(header?.querySelector('.help-link')).toBeNull();
    expect(screen.queryByTestId('help-link-projects')).toBeNull();
  });
});

describe('the Find in Files options (?)', () => {
  beforeEach(() => {
    __resetFindInFilesState();
    installFileSearchStub();
    window.throng = { ...(window.throng as object), openHelp } as unknown as typeof window.throng;
  });
  afterEach(() => {
    removeFileSearchStub();
    __resetFindInFilesState();
  });

  it("draws the (?) at the help link's own small size, not the row's button size", () => {
    renderFindInFilesPanel();
    expect(screen.getByTestId(`help-link-fif-options-${PANEL_ID}`).classList.contains('help-link')).toBe(true);
  });

  it('opens Finding › Search the whole project (FR-061)', () => {
    renderFindInFilesPanel();
    fireEvent.click(screen.getByTestId(`help-link-fif-options-${PANEL_ID}`));
    expect(openHelp).toHaveBeenCalledExactlyOnceWith(helpUrl({ page: 'finding', anchor: 'search-the-whole-project' }, { base: HELP_APP_BASE_URL }));
  });
});

describe('the New Panel Panel Type picker (?)', () => {
  const PROJECT = 'proj-1';
  const PANEL = 'p-help';

  /** The first guide task teaching the panel type — the picker's target (research R20). */
  // The type's own topic page, not the Quick start's tour of it.
  const taskFor = (kind: string) => {
    const task = GUIDE_MAP.find((t) => t.panelTypes.includes(kind) && t.page !== 'quick-start');
    expect(task, `no topic-page task for ${kind}`).toBeDefined();
    return task!;
  };

  function mount(): void {
    const layout = createDefaultLayout(PROJECT, { tab: 't1', panel: PANEL });
    const bridge: ThrongBridge = {
      invoke<T>(method: string): Promise<T> {
        switch (method) {
          case 'workspace.load': return Promise.resolve({ layout, restored: true } as T);
          case 'workspace.save': return Promise.resolve({ ok: true } as T);
          case 'workspace.loadSubWorkspaces':
          case 'subworkspace.list': return Promise.resolve({ subWorkspaces: [] } as T);
          case 'projects.list': return Promise.resolve({ projects: [] } as T);
          case 'projects.categories.list': return Promise.resolve({ categories: [] } as T);
          default: return Promise.reject(new Error(`unexpected RPC: ${method}`));
        }
      },
    };
    Reflect.set(window, 'throng', {
      openHelp,
      terminal: { listFlavours: () => Promise.resolve([]), capabilities: () => Promise.resolve({ elevated: false }) },
      config: { onChange: () => () => {} },
      panel: {},
    });
    const services = {
      projects: new ProjectsClient(bridge),
      workspace: new WorkspaceClient(bridge),
      subWorkspaces: new SubWorkspacesClient(bridge),
      documents: new DocumentClient(bridge),
      fileOpUndo: new FileOpUndoClient(bridge),
      panelNames: new PanelNameClient(bridge),
    };
    const form: ReactElement = createElement(PanelTypeForm, { panelId: PANEL, projectRoot: 'C:/proj' });
    render(
      createElement(ServicesProvider, { services },
        createElement(ConfigProvider, null,
          createElement(ProjectsProvider, { client: services.projects },
            createElement(WorkspaceProvider, { client: services.workspace, activeProjectId: PROJECT },
              createElement(NotificationProvider, null, form))))),
    );
  }

  afterEach(() => clearDraft(PANEL));

  it('has none until a type is chosen, then opens the chosen type’s guide task', async () => {
    mount();
    const select = await screen.findByTestId(`panel-type-select-${PANEL}`);
    expect(screen.queryByTestId(`help-link-panel-type-${PANEL}`)).toBeNull();
    const kinds = defaultPanelTypeRegistry.listOfferable().map((t) => t.id);
    expect(kinds).toContain('editor');
    fireEvent.change(select, { target: { value: 'editor' } });
    const link = await screen.findByTestId(`help-link-panel-type-${PANEL}`);
    const task = taskFor('editor');
    await userEvent.setup({ delay: null }).click(link);
    expect(openHelp).toHaveBeenCalledExactlyOnceWith(helpUrl({ page: task.page, anchor: task.anchor }, { base: HELP_APP_BASE_URL }));
    await waitFor(() => expect(link).toBeInTheDocument());
  });
});
