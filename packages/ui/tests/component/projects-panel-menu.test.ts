/**
 * 046 US4 (T060) — the project row's context menu (contracts/menus.md §1), over the REAL
 * `ProjectsPanel` (`packages/ui/src/renderer/sidebar/projects-panel.tsx`) and the REAL
 * `KeybindingsHandler` (`app.tsx`).
 *
 * Right-click opens it; so does `menu.open`'s two default chords (`Shift+F10`, `ContextMenu`) on a
 * focused row, redirected through the SAME `document.activeElement`-driven mechanism
 * `side-pane-focus-commands.test.ts` already exercises for `focus.projects` — a project row already
 * carries real DOM focus (roving tabindex), so nothing in `app.tsx`'s `menu.open` case is
 * project-specific and none of it is touched by this batch.
 *
 * WHAT IS RED, AND WHY: `projects-panel.tsx` wires no `onContextMenu` on a row yet (T074), and
 * `packages/ui/src/renderer/sidebar/project-menu.ts` (T072) does not exist — so no menu ever opens,
 * on either gesture, until both land. This file drives the interaction only; it does not import
 * `project-menu.ts` directly (that pin is T061's, in `menu-sections.test.ts`).
 *
 * ══ T126 (iterate round 1; FR-081, FR-038, FR-111) ══
 *
 * Three Unload rows became two. **Unload Project** runs the preference `projects.unloadTerminalAction`,
 * whatever its value, and ONE more row names the action the preference does not pick:
 *
 *   | preference     | row 1          | row 2                                      |
 *   | keepRunning    | Unload Project | Unload Project and End Terminals           |
 *   | endTerminals   | Unload Project | Unload Project and Keep Terminals Running  |
 *
 * The row named for the default action is never drawn (it would be a second row for the plain row's
 * command, 006 FR-030). Row 2 follows a live preference change on the next open. Both rows are drawn
 * and disabled on an unloaded project. The harness now mounts the REAL `ConfigProvider` over a fake
 * `window.throng.config`, so the preference comes from where the app reads it, and a change arrives the
 * way a Preferences edit does (`config.onChange`).
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectCategoryDto, ProjectDto } from '@throng/ipc-contract';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { ProjectsProvider, useProjects } from '../../src/renderer/state/projects-store.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { WorkspaceProvider } from '../../src/renderer/state/workspace-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { DirtyCloseDialog } from '../../src/renderer/editor/dirty-close-dialog.js';
import { __resetDirtyCloseStore } from '../../src/renderer/editor/dirty-close-store.js';
import { ProjectsPanel } from '../../src/renderer/sidebar/projects-panel.js';
import { KeybindingsHandler } from '../../src/renderer/app.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';

class ImmediateResizeObserver implements ResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(target: Element): void {
    const contentRect = {
      width: 320, height: 600, top: 0, left: 0, right: 320, bottom: 600, x: 0, y: 0,
      toJSON: () => ({}),
    } satisfies DOMRectReadOnly;
    this.cb([{ target, contentRect } as ResizeObserverEntry], this);
  }
  unobserve(): void {}
  disconnect(): void {}
}

const now = '2026-01-01T00:00:00.000Z';
const CATEGORIES: ProjectCategoryDto[] = [
  { id: 'default', name: 'In Progress', isDefault: true, minimised: false, createdAt: now, updatedAt: now },
];
const project = (id: string): ProjectDto => ({
  id, name: id, colour: '#3b82f6', rootFolder: `C:/projects/${id}`, isActive: false,
  createdAt: now, updatedAt: now, hiddenPaths: [], categoryId: 'default',
});
const PROJECTS: ProjectDto[] = [project('p1'), project('p2')];

function client(): ProjectsClient {
  const bridge: ThrongBridge = {
    invoke<T>(method: string, params?: unknown): Promise<T> {
      switch (method) {
        case 'projects.list':
          return Promise.resolve({ projects: PROJECTS } as unknown as T);
        case 'projects.categories.list':
          return Promise.resolve({ categories: CATEGORIES } as unknown as T);
        case 'projects.setActive':
          return Promise.resolve({ activeId: (params as { id: string }).id } as unknown as T);
        case 'projects.update':
          return Promise.resolve({} as T);
        case 'projects.remove':
          return Promise.resolve({} as T);
        default:
          return Promise.reject(new Error(`unexpected projects RPC: ${method}`));
      }
    },
  };
  return new ProjectsClient(bridge);
}

function fakeServices(): Services {
  const bridge: ThrongBridge = { invoke: () => Promise.reject(new Error('unexpected RPC')) };
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

function Harness(): ReactElement {
  useProjects();
  return createElement(
    'div',
    null,
    createElement(KeybindingsHandler, {
      onToggleProjects: vi.fn(),
      onToggleExplorer: vi.fn(),
      onRevealLeft: vi.fn(),
      onRevealRight: vi.fn(),
    }),
    createElement(DirtyCloseDialog),
    createElement(ProjectsPanel),
  );
}

type UnloadAction = 'keepRunning' | 'endTerminals';

/** The terminal RPC Unload reaches through `window.throng.terminal`, recorded. */
function fakeTerminal() {
  return {
    list: vi.fn((_projectId: unknown, _opts: unknown) => Promise.resolve({ sessions: [] as unknown[] })),
    closeIdle: vi.fn((_params: unknown) => Promise.resolve({ closed: [] as string[] })),
    killAll: vi.fn((_params: unknown) => Promise.resolve({ killed: [] as string[] })),
  };
}

interface Mounted {
  /** Deliver a settings change the way a Preferences edit reaches this window (`config.onChange`). */
  setUnloadTerminalAction(action: UnloadAction): Promise<void>;
  terminal: ReturnType<typeof fakeTerminal>;
}

async function mount(opts: { unloadTerminalAction?: UnloadAction } = {}): Promise<Mounted> {
  const projectsClient = client();
  const services = fakeServices();
  const payload = (action: UnloadAction) => ({ settings: { projects: { unloadTerminalAction: action } } });
  let onChange: ((p: unknown) => void) | undefined;
  let configRead: Promise<unknown> = Promise.resolve();
  const terminal = fakeTerminal();
  Reflect.set(window, 'throng', {
    editor: {
      isOpen: () => Promise.resolve(false),
      saveAll: () => Promise.resolve({ saved: [], skippedUnpathed: [], failed: [] }),
    },
    panel: { notifyTyped: () => {} },
    config: {
      get: () => {
        configRead = Promise.resolve(payload(opts.unloadTerminalAction ?? 'keepRunning'));
        return configRead;
      },
      onChange: (cb: (p: unknown) => void) => {
        onChange = cb;
        return () => {
          onChange = undefined;
        };
      },
    },
    terminal,
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
          { client: projectsClient },
          createElement(
            WorkspaceProvider,
            { client: services.workspace, activeProjectId: null },
            createElement(
              NotificationProvider,
              null,
              createElement(ConfirmProvider, null, createElement(ContextMenuProvider, null, createElement(Harness))),
            ),
          ),
        ),
      ),
    ),
  );
  await waitFor(() => expect(screen.getByTestId('project-item-p1')).toBeInTheDocument());
  // Let the provider adopt the configured settings before any menu is opened.
  await act(async () => {
    await configRead;
  });
  return {
    setUnloadTerminalAction: async (action) => {
      await act(async () => {
        onChange?.(payload(action));
      });
    },
    terminal,
  };
}

/** Every Unload row the open menu draws, by label, in menu order. */
const unloadRowLabels = (): string[] =>
  screen.queryAllByTestId(/^menu-item-Unload/).map((el) => el.getAttribute('data-testid')!.slice('menu-item-'.length));

async function openMenuOn(projectId: string): Promise<void> {
  fireEvent.contextMenu(screen.getByTestId(`project-item-${projectId}`));
  await screen.findByTestId('context-menu');
}

async function closeMenu(): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(screen.getByTestId('context-menu'), { key: 'Escape' });
  });
  await waitFor(() => expect(screen.queryByTestId('context-menu')).toBeNull());
}

async function loadProject(projectId: string): Promise<void> {
  fireEvent.click(screen.getByTestId(`project-switch-${projectId}`));
  await waitFor(() => expect(screen.getByTestId(`project-item-${projectId}`)).toHaveAttribute('data-loaded', 'true'));
}

const press = (key: string, mods: { shiftKey?: boolean } = {}): void => {
  fireEvent.keyDown(document.body, { key, code: key, ...mods });
};

beforeAll(() => {
  globalThis.ResizeObserver = ImmediateResizeObserver;
});
afterAll(() => {
  Reflect.deleteProperty(globalThis, 'ResizeObserver');
});
beforeEach(() => {
  setActivePane('workspace');
});
afterEach(() => {
  __resetDirtyCloseStore();
  Reflect.deleteProperty(window, 'throng');
});

/**
 * Every label T072 (US4) draws, in the section order contracts/menus.md §1 gives.
 *
 * `Move to Category ▸` is in the CONTRACT's table but not in T072's own task text — it is added by
 * T081 (US5), which depends on `project-menu.ts` existing first (tasks.md Phase 7 note). It is
 * deliberately absent here; adding it would pin a row this batch's GREEN step is not asked to draw.
 */
const EXPECTED_LABELS = [
  'Edit',
  'Rename',
  'Remove',
  // T126 (FR-081) — the shipped preference is keepRunning, so the second row names End Terminals.
  'Unload Project',
  'Unload Project and End Terminals',
];

describe('right-click opens Edit, Rename, Remove and the two Unload rows, each with an icon', () => {
  it('draws every row, and none renders with an empty icon slot', async () => {
    await mount();
    const row = screen.getByTestId('project-item-p1');

    fireEvent.contextMenu(row);

    const menu = await screen.findByTestId('context-menu');
    for (const label of EXPECTED_LABELS) {
      const item = screen.getByTestId(`menu-item-${label}`);
      expect(item).toBeInTheDocument();
      expect(item.querySelector('.context-menu__icon .icon')).not.toBeNull();
    }
    expect(menu).toBeInTheDocument();
  });

  it('the Unload rows are ENABLED once the project is loaded', async () => {
    await mount();
    await loadProject('p1');

    await openMenuOn('p1');

    expect(screen.getByTestId('menu-item-Unload Project')).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('menu-item-Unload Project and End Terminals')).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('the inline ✎ and ✕ controls stay, alongside the new menu (FR-031)', async () => {
    await mount();
    expect(screen.getByTestId('project-edit-p1')).toBeInTheDocument();
    expect(screen.getByTestId('project-delete-p1')).toBeInTheDocument();
  });
});

describe('Shift+F10 and the ContextMenu key open the SAME menu on a focused row (contracts/menus.md §1)', () => {
  it('Shift+F10 opens the row menu that right-click opens', async () => {
    await mount();
    const row = screen.getByTestId('project-item-p1');
    row.focus();

    press('F10', { shiftKey: true });

    await screen.findByTestId('context-menu');
    expect(screen.getByTestId('menu-item-Edit')).toBeInTheDocument();
  });

  it('the ContextMenu key does the same', async () => {
    await mount();
    const row = screen.getByTestId('project-item-p1');
    row.focus();

    press('ContextMenu');

    await screen.findByTestId('context-menu');
    expect(screen.getByTestId('menu-item-Edit')).toBeInTheDocument();
  });
});

describe('Edit, Rename and Remove run the SAME routes as the inline controls (FR-030)', () => {
  it('Edit opens the same create/edit form the inline ✎ opens, prefilled', async () => {
    await mount();
    fireEvent.contextMenu(screen.getByTestId('project-item-p1'));
    await screen.findByTestId('context-menu');

    fireEvent.click(screen.getByTestId('menu-item-Edit'));

    const form = await screen.findByTestId('project-form');
    expect(form).toBeInTheDocument();
    expect((screen.getByTestId('project-name-input') as HTMLInputElement).value).toBe('p1');
  });

  it('Rename starts the same inline rename a double-click starts', async () => {
    await mount();
    fireEvent.contextMenu(screen.getByTestId('project-item-p1'));
    await screen.findByTestId('context-menu');

    fireEvent.click(screen.getByTestId('menu-item-Rename'));

    expect(await screen.findByTestId('project-rename-input-p1')).toBeInTheDocument();
  });

  it('Remove keeps its confirmation and unsaved guard', async () => {
    await mount();
    fireEvent.contextMenu(screen.getByTestId('project-item-p1'));
    await screen.findByTestId('context-menu');

    fireEvent.click(screen.getByTestId('menu-item-Remove'));

    const dialog = await screen.findByTestId('confirm-dialog');
    expect(dialog).toHaveTextContent(/remove project/i);
  });
});

describe('Escape closes the menu and returns focus to the row (contracts/menus.md §1, closeAndRestore)', () => {
  it('restores DOM focus to the row that opened it', async () => {
    await mount();
    const row = screen.getByTestId('project-item-p1');
    row.focus();

    press('F10', { shiftKey: true });
    const menu = await screen.findByTestId('context-menu');

    await act(async () => {
      fireEvent.keyDown(menu, { key: 'Escape' });
    });

    await waitFor(() => expect(screen.queryByTestId('context-menu')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(row));
  });
});

describe('T126 — exactly two Unload rows, following projects.unloadTerminalAction (FR-081, FR-038)', () => {
  it('under keepRunning: Unload Project, then Unload Project and End Terminals', async () => {
    await mount({ unloadTerminalAction: 'keepRunning' });
    await openMenuOn('p1');

    expect(unloadRowLabels()).toEqual(['Unload Project', 'Unload Project and End Terminals']);
  });

  it('under endTerminals: Unload Project, then Unload Project and Keep Terminals Running', async () => {
    await mount({ unloadTerminalAction: 'endTerminals' });
    await openMenuOn('p1');

    expect(unloadRowLabels()).toEqual(['Unload Project', 'Unload Project and Keep Terminals Running']);
  });

  it.each([
    ['keepRunning', 'Unload Project and Keep Terminals Running'],
    ['endTerminals', 'Unload Project and End Terminals'],
  ] as const)(
    'under %s, never draws "%s" — it would duplicate Unload Project (006 FR-030)',
    async (action, redundant) => {
      await mount({ unloadTerminalAction: action });
      await openMenuOn('p1');
      expect(screen.queryByTestId(`menu-item-${redundant}`)).toBeNull();
    },
  );

  it('the second row follows a live preference change on the next open, with no restart', async () => {
    const app = await mount({ unloadTerminalAction: 'keepRunning' });
    await openMenuOn('p1');
    expect(unloadRowLabels()).toEqual(['Unload Project', 'Unload Project and End Terminals']);
    await closeMenu();

    await app.setUnloadTerminalAction('endTerminals');
    await openMenuOn('p1');
    expect(unloadRowLabels()).toEqual(['Unload Project', 'Unload Project and Keep Terminals Running']);
    await closeMenu();

    await app.setUnloadTerminalAction('keepRunning');
    await openMenuOn('p1');
    expect(unloadRowLabels()).toEqual(['Unload Project', 'Unload Project and End Terminals']);
  });

  it.each(['keepRunning', 'endTerminals'] as const)(
    'under %s, both rows are drawn and DISABLED on an unloaded project (FR-038)',
    async (action) => {
      await mount({ unloadTerminalAction: action });
      await openMenuOn('p1'); // p1 never switchProject()'d — unloaded

      const labels = unloadRowLabels();
      expect(labels).toHaveLength(2);
      for (const label of labels) {
        expect(screen.getByTestId(`menu-item-${label}`)).toHaveAttribute('aria-disabled', 'true');
      }
    },
  );

  it('under keepRunning, the second row ENDS the terminals, with no dialog (FR-081, FR-111)', async () => {
    const app = await mount({ unloadTerminalAction: 'keepRunning' });
    await loadProject('p1');
    await openMenuOn('p1');

    fireEvent.click(screen.getByTestId('menu-item-Unload Project and End Terminals'));

    await waitFor(() => expect(app.terminal.killAll).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1' })));
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  it('under endTerminals, the second row KEEPS the terminals: the project unloads and nothing is ended (FR-081, FR-086)', async () => {
    const app = await mount({ unloadTerminalAction: 'endTerminals' });
    await loadProject('p1');
    await openMenuOn('p1');

    fireEvent.click(screen.getByTestId('menu-item-Unload Project and Keep Terminals Running'));

    await waitFor(() => expect(screen.getByTestId('project-item-p1')).toHaveAttribute('data-loaded', 'false'));
    expect(app.terminal.killAll).not.toHaveBeenCalled();
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });
});
