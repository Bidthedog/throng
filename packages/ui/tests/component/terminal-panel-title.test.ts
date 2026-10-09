import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultLayout,
  DEFAULT_APP_SETTINGS,
  DEFAULT_TERMINAL_TITLE_TEMPLATE,
  type AppSettings,
  type Panel,
} from '@throng/core';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { forgetTerminalCommand } from '../../src/renderer/terminal/command-store.js';
import { reportTerminalCwd } from '../../src/renderer/terminal/cwd-store.js';
import { clearTerminalTitle, setTerminalTitle } from '../../src/renderer/terminal/title-store.js';
import {
  setTerminalTitleContext,
  TerminalTitleContextFeeder,
  type TerminalTitleContext,
} from '../../src/renderer/terminal/title-context.js';
import { ProjectsProvider } from '../../src/renderer/state/projects-store.js';
import { WorkspaceProvider } from '../../src/renderer/state/workspace-store.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { PanelPlaceholder } from '../../src/renderer/workspace/panel-placeholder.js';
import { usePanelDisplayNames } from '../../src/renderer/workspace/use-panel-display-names.js';

/**
 * 053 — a terminal panel is named from the terminal title template (US1, US2).
 *
 * The header, the tab strip and every other surface name a panel through `panelDisplayTitle`, and
 * the renderer's only job is to hand it the live values. So this renders the REAL header
 * (`PanelPlaceholder`) and the real list hook the tab strip uses, feeds the stores the way the
 * daemon's notifications and the shell do, and reads what comes out.
 *
 *   • The command arrives as the daemon's `terminal.command` notification, through the bridge
 *     listener `command-store.ts` installs once per renderer; `bridgeCommand` below is that listener.
 *   • The working directory is the store the shell's OSC 9;9 and the daemon poll both write.
 *   • The template and its limits are what the config provider feeds (`title-context.ts`).
 */

// The header is the subject; the terminal body (xterm) needs a real canvas and is not.
vi.mock('../../src/renderer/workspace/panel-body.js', () => ({ PanelBody: () => null }));

const PROJECT = 'proj-1';
// Fresh per test: the cwd store has no way to forget a directory, so a shared id would leak one in.
let PANEL_ID = 'p-term';
let seq = 0;
const SHELL = 'Git Bash';

const terminalPanel = (over: Partial<Panel> = {}): Panel =>
  ({
    type: 'panel',
    id: PANEL_ID,
    originProjectId: PROJECT,
    title: 'Panel 3',
    kind: 'terminal',
    config: { flavourId: 'git-bash', flavourLabel: SHELL },
    ...over,
  }) as Panel;

/** What the config provider would feed, with the defaults the shipped settings carry. */
const defaults = (over: Partial<TerminalTitleContext> = {}): TerminalTitleContext => ({
  template: DEFAULT_TERMINAL_TITLE_TEMPLATE,
  limits: { command: 40, path: 40 },
  projects: new Map(),
  subWorkspaceName: null,
  elevated: false,
  ...over,
});

/* ── the bridge ──────────────────────────────────────────────────────────── */

type CommandEvent = { panelId: string; command: string | null; arch?: string | null };
let bridgeCommand: ((e: CommandEvent) => void) | null = null;
let configChange: ((payload: unknown) => void) | null = null;

function settingsWith(terminals: Partial<AppSettings['terminals']>): AppSettings {
  return { ...DEFAULT_APP_SETTINGS, terminals: { ...DEFAULT_APP_SETTINGS.terminals, ...terminals } };
}

beforeAll(() => {
  Reflect.set(window, 'throng', {
    panel: { notifyDestroyed: vi.fn() },
    terminal: {
      // `command-store.ts` installs this ONCE per renderer, so the first listener it hands us is kept
      // for the whole file.
      onCommand: (cb: (e: CommandEvent) => void) => {
        bridgeCommand ??= cb;
        return () => {};
      },
    },
    config: {
      get: () => Promise.resolve({ settings: DEFAULT_APP_SETTINGS }),
      onChange: (cb: (payload: unknown) => void) => {
        configChange = cb;
        return () => {};
      },
    },
  });
});
afterAll(() => {
  Reflect.deleteProperty(window, 'throng');
});
beforeEach(() => {
  seq += 1;
  PANEL_ID = `p-term-${seq}`;
});
afterEach(() => {
  setTerminalTitleContext(null);
  forgetTerminalCommand(PANEL_ID);
  clearTerminalTitle(PANEL_ID);
});

/* ── the host ────────────────────────────────────────────────────────────── */

function services(): Services {
  const bridge: ThrongBridge = {
    invoke<T>(method: string): Promise<T> {
      switch (method) {
        case 'workspace.load':
          return Promise.resolve({ layout: createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' }), restored: true } as T);
        case 'projects.list':
          return Promise.resolve({ projects: [] } as T);
        case 'projects.categories.list':
          return Promise.resolve({ categories: [] } as T);
        case 'workspace.loadSubWorkspaces':
        case 'subworkspace.list':
          return Promise.resolve({ subWorkspaces: [] } as T);
        default:
          return Promise.resolve({ ok: true } as T);
      }
    },
  };
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

/** The real header over the real providers. `fed` mounts the config-fed context, else tests set it. */
function mountHeader(panel: Panel, opts: { fed?: boolean } = {}): void {
  const svc = services();
  const header: ReactElement = createElement(PanelPlaceholder, { panel, tabId: 't1' });
  const tree = createElement(
    ServicesProvider,
    { services: svc },
    createElement(
      ConfigProvider,
      null,
      createElement(
        ProjectsProvider,
        { client: svc.projects },
        createElement(
          WorkspaceProvider,
          { client: svc.workspace, activeProjectId: PROJECT },
          createElement(
            NotificationProvider,
            null,
            createElement(
              ConfirmProvider,
              null,
              createElement(
                ContextMenuProvider,
                null,
                opts.fed ? createElement(TerminalTitleContextFeeder) : null,
                header,
              ),
            ),
          ),
        ),
      ),
    ),
  );
  render(tree);
}

const titleEl = (): HTMLElement => screen.getByTestId(`panel-title-${PANEL_ID}`);
const shown = (): string => titleEl().textContent?.trim() ?? '';
const handleEl = (): HTMLElement => screen.getByTestId(`panel-handle-${PANEL_ID}`);

/** The daemon says `command` now holds the terminal. */
function observe(command: string | null, arch?: string): void {
  expect(bridgeCommand, 'the command store must have armed its bridge listener').not.toBeNull();
  act(() => bridgeCommand?.({ panelId: PANEL_ID, command, ...(arch ? { arch } : {}) }));
}
const cd = (dir: string): void => act(() => reportTerminalCwd(PANEL_ID, dir));

/* ── the header (US1) ────────────────────────────────────────────────────── */

describe('a terminal header is named from the default template (FR-001, FR-002, FR-010)', () => {
  it('shows the shell and the directory while idle, with no separate directory element', async () => {
    setTerminalTitleContext(defaults());
    mountHeader(terminalPanel());
    observe(null);
    cd('C:/proj');

    await waitFor(() => expect(shown()).toBe(`${SHELL} (C:/proj)`));
    expect(screen.queryByTestId(`panel-cwd-${PANEL_ID}`)).toBeNull();
  });

  it('puts an observed command in front, and takes it away when the command clears', async () => {
    setTerminalTitleContext(defaults());
    mountHeader(terminalPanel());
    cd('C:/proj');

    observe('"C:\\WINDOWS\\system32\\PING.EXE" localhost -t');
    await waitFor(() => expect(shown()).toBe(`ping localhost -t | ${SHELL} (C:/proj)`));

    observe(null);
    await waitFor(() => expect(shown()).toBe(`${SHELL} (C:/proj)`));
  });

  it('follows the shell into another directory', async () => {
    setTerminalTitleContext(defaults());
    mountHeader(terminalPanel());
    cd('C:/proj');
    await waitFor(() => expect(shown()).toBe(`${SHELL} (C:/proj)`));

    cd('C:/proj/src');

    await waitFor(() => expect(shown()).toBe(`${SHELL} (C:/proj/src)`));
  });

  it('keeps the terminal panel-type icon beside the name', () => {
    setTerminalTitleContext(defaults());
    mountHeader(terminalPanel());

    expect(screen.getByTestId(`panel-kind-${PANEL_ID}`)).toBeTruthy();
  });

  it('shows no command from the panel’s previous terminal once a new one mounts (FR-016)', async () => {
    setTerminalTitleContext(defaults());
    mountHeader(terminalPanel());
    cd('C:/proj');
    observe('ping localhost -t');
    await waitFor(() => expect(shown()).toContain('ping localhost -t'));

    // What `terminal-panel.tsx` does when a terminal mounts, before the daemon has observed anything.
    act(() => forgetTerminalCommand(PANEL_ID));

    await waitFor(() => expect(shown()).toBe(`${SHELL} (C:/proj)`));
  });

  it('names an untyped panel as before — the template applies only to a terminal', () => {
    setTerminalTitleContext(defaults());
    mountHeader(terminalPanel({ kind: undefined, title: 'Panel 9', config: {} }));

    expect(shown()).toBe('Blank Panel');
  });

  it('puts a program that titled itself first: its name and its title (FR-009)', async () => {
    setTerminalTitleContext(defaults());
    mountHeader(terminalPanel());
    cd('C:/proj');

    observe('"C:\\Users\\me\\.local\\bin\\claude.exe"');
    act(() => setTerminalTitle(PANEL_ID, 'work on links'));

    await waitFor(() => expect(shown()).toBe(`claude: work on links | ${SHELL} (C:/proj)`));
  });

  it('{title} is not a title the shell set before the command started (FR-003)', async () => {
    setTerminalTitleContext(defaults());
    mountHeader(terminalPanel());
    cd('C:/proj');

    // Git Bash titles itself at the prompt; cmd as a command starts — both before the daemon sees it.
    act(() => setTerminalTitle(PANEL_ID, 'MINGW64:/c/proj'));
    await waitFor(() => expect(shown()).toBe(`${SHELL} (C:/proj)`));
    act(() => setTerminalTitle(PANEL_ID, 'C:\\WINDOWS\\system32\\cmd.exe - ping localhost -t'));
    observe('"C:\\WINDOWS\\system32\\PING.EXE" localhost -t');

    await waitFor(() => expect(shown()).toBe(`ping localhost -t | ${SHELL} (C:/proj)`));

    // PowerShell titles its window with its own path, set at start and kept while a command runs.
    act(() => setTerminalTitle(PANEL_ID, 'Administrator: C:\\Program Files\\PowerShell\\7\\pwsh.exe'));
    await waitFor(() => expect(shown()).toBe(`ping localhost -t | ${SHELL} (C:/proj)`));
  });

  it('{title} clears when the command ends, and a later command starts with none (FR-003)', async () => {
    setTerminalTitleContext(defaults());
    mountHeader(terminalPanel());
    cd('C:/proj');
    observe('claude');
    act(() => setTerminalTitle(PANEL_ID, 'work on links'));
    await waitFor(() => expect(shown()).toBe(`claude: work on links | ${SHELL} (C:/proj)`));

    observe(null);
    await waitFor(() => expect(shown()).toBe(`${SHELL} (C:/proj)`));

    observe('ping localhost -t');
    await waitFor(() => expect(shown()).toBe(`ping localhost -t | ${SHELL} (C:/proj)`));
  });

  it('a restored terminal: a remembered program that titles itself as it starts is named by that title', async () => {
    // Reload after End Terminals, or a throng restart: the panel's terminal mounts, the remembered
    // `claude` starts at once and titles itself straight away — before the daemon's first observation.
    setTerminalTitleContext(defaults());
    mountHeader(terminalPanel());
    cd('C:/proj');
    act(() => forgetTerminalCommand(PANEL_ID)); // what a terminal's mount does
    act(() => setTerminalTitle(PANEL_ID, '✳ Claude Code'));
    observe('"C:\\Users\\me\\.local\\bin\\claude.exe"');

    await waitFor(() => expect(shown()).toBe(`claude: ✳ Claude Code | ${SHELL} (C:/proj)`));
  });

  it('switching projects away and back keeps a running program’s title in the name', async () => {
    setTerminalTitleContext(defaults());
    mountHeader(terminalPanel());
    cd('C:/proj');
    observe('claude');
    act(() => setTerminalTitle(PANEL_ID, 'work on links'));
    await waitFor(() => expect(shown()).toBe(`claude: work on links | ${SHELL} (C:/proj)`));

    // Back to this project: the terminal view remounts over the same, still-running session, and the
    // daemon's next observation names the same command again.
    act(() => forgetTerminalCommand(PANEL_ID));
    observe('claude');

    await waitFor(() => expect(shown()).toBe(`claude: work on links | ${SHELL} (C:/proj)`));
  });

  it('still names a terminal by its window title when no template has been fed', () => {
    // A caller outside the app's providers — or the first frame before the config feeds the context —
    // is named as it was before 053.
    setTerminalTitleContext(null);
    mountHeader(terminalPanel());
    act(() => setTerminalTitle(PANEL_ID, 'MINGW64:/c/proj'));

    expect(shown()).toBe('MINGW64:/c/proj');
  });
});

describe('{admin} and {project} come from the panel and the window (FR-003)', () => {
  const adminTemplate = '{shell}({admin} ? " [{admin}]" : "")';

  it('shows Admin only for a run-as-admin panel in an elevated throng', () => {
    setTerminalTitleContext(defaults({ template: adminTemplate, elevated: true }));
    mountHeader(terminalPanel({ config: { flavourLabel: SHELL, runAsAdmin: true } }));

    expect(shown()).toBe(`${SHELL} [Admin]`);
  });

  it('shows nothing for it when throng is not elevated', () => {
    setTerminalTitleContext(defaults({ template: adminTemplate, elevated: false }));
    mountHeader(terminalPanel({ config: { flavourLabel: SHELL, runAsAdmin: true } }));

    expect(shown()).toBe(SHELL);
  });

  it('shows nothing for it when the panel did not ask to run as admin', () => {
    setTerminalTitleContext(defaults({ template: adminTemplate, elevated: true }));
    mountHeader(terminalPanel());

    expect(shown()).toBe(SHELL);
  });

  it('names the owning project, else the sub-workspace', () => {
    setTerminalTitleContext(defaults({ template: '{shell} in {project}', projects: new Map([[PROJECT, 'throng']]) }));
    mountHeader(terminalPanel());
    expect(shown()).toBe(`${SHELL} in throng`);
  });

  it('falls back to the sub-workspace’s name for a panel whose project is not registered', () => {
    setTerminalTitleContext(defaults({ template: '{shell} in {project}', subWorkspaceName: 'Scratch' }));
    mountHeader(terminalPanel({ originProjectId: 'gone' }));
    expect(shown()).toBe(`${SHELL} in Scratch`);
  });
});

describe('the tooltip carries the unshortened name (research R5)', () => {
  it('holds the whole name while the header shows it bounded by tabs.maxNameLength', () => {
    const long = 'x'.repeat(200);
    setTerminalTitleContext(defaults({ template: '{title}' }));
    mountHeader(terminalPanel());
    observe('claude');
    act(() => setTerminalTitle(PANEL_ID, long));

    expect(handleEl().getAttribute('title')).toBe(long);
    expect(shown().length).toBeLessThan(long.length);
  });
});

/* ── the tab strip names it the same way ─────────────────────────────────── */

describe('the tab strip’s list of panels shows the same name as the header (FR-001)', () => {
  it('follows the command, the directory and the template', async () => {
    setTerminalTitleContext(defaults());
    const { result } = renderHook(() => usePanelDisplayNames([terminalPanel()], 64));
    expect(result.current[0].name).toBe(SHELL);

    cd('C:/proj');
    await waitFor(() => expect(result.current[0].name).toBe(`${SHELL} (C:/proj)`));

    observe('ping localhost -t');
    await waitFor(() => expect(result.current[0].name).toBe(`ping localhost -t | ${SHELL} (C:/proj)`));

    act(() => setTerminalTitleContext(defaults({ template: '{folder}' })));
    await waitFor(() => expect(result.current[0].name).toBe('proj'));
  });
});

/* ── a settings change re-names open terminals without a remount (US2, FR-013, SC-003) ─── */

describe('a settings change re-renders open terminals’ names without a remount (FR-013, SC-003)', () => {
  it('follows the template', async () => {
    mountHeader(terminalPanel(), { fed: true });
    cd('C:/proj');
    await waitFor(() => expect(shown()).toBe(`${SHELL} (C:/proj)`));
    const before = titleEl();

    act(() => configChange?.({ settings: settingsWith({ titleTemplate: '{folder} - {shell}' }) }));

    await waitFor(() => expect(shown()).toBe(`proj - ${SHELL}`));
    expect(titleEl(), 'the header was updated in place, not remounted').toBe(before);
  });

  it('follows the path limit', async () => {
    mountHeader(terminalPanel(), { fed: true });
    cd('C:/projects/throng/packages/ui/src/renderer');
    await waitFor(() => expect(shown()).toContain('…'));
    const before = shown();

    act(() => configChange?.({ settings: settingsWith({ titlePathMaxLength: 200 }) }));

    await waitFor(() => expect(shown()).toBe(`${SHELL} (C:/projects/throng/packages/ui/src/renderer)`));
    expect(shown()).not.toBe(before);
  });

  it('follows the command limit', async () => {
    mountHeader(terminalPanel(), { fed: true });
    observe('node --some-long-flag --another-long-flag script.js');
    await waitFor(() => expect(shown()).toContain('…'));

    act(() => configChange?.({ settings: settingsWith({ titleCommandMaxLength: 200 }) }));

    await waitFor(() =>
      expect(shown()).toBe(`node --some-long-flag --another-long-flag script.js | ${SHELL}`),
    );
  });

  it('falls back to the default template when the persisted one cannot be parsed', async () => {
    mountHeader(terminalPanel(), { fed: true });
    cd('C:/proj');

    act(() => configChange?.({ settings: settingsWith({ titleTemplate: '({shell}' }) }));

    await waitFor(() => expect(shown()).toBe(`${SHELL} (C:/proj)`));
  });
});
