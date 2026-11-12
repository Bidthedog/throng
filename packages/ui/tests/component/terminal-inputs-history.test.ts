/**
 * 067 T084 (FR-061 to FR-064a, FR-067, FR-108, edge cases) — remembered Startup Commands and Shell
 * Arguments in the terminal form.
 *
 * Each field offers the values remembered for the SELECTED terminal type that match what is typed;
 * picking one fills the field. A clear button beside each field clears only that field's list for that
 * type. Confirming the form records both values; nothing is recorded per keystroke. With the history off
 * nothing is offered or recorded. A value holding newlines or running very long shows on ONE truncated
 * line, and picking it still fills the whole of it.
 *
 * The bridge is a double: main owns the rules (distinct, newest first, trimmed to N); here the list is
 * whatever `formHistory.get` answers, and the assertions are about what the form asks, shows and sends.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLayout, DEFAULT_APP_SETTINGS, type PanelTypeValues } from '@throng/core';
import { TerminalInputs } from '../../src/renderer/panel-type/terminal-inputs.js';
import { PanelTypeForm } from '../../src/renderer/panel-type/panel-type-form.js';
import { clearDraft } from '../../src/renderer/panel-type/panel-draft-store.js';
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
import { ConfigProvider } from '../../src/renderer/config/config-store.js';

const FLAVOURS = [
  { value: 'cmd', label: 'Command Prompt', defaultShellArguments: '/K' },
  { value: 'pwsh', label: 'PowerShell', defaultShellArguments: '-NoLogo' },
];

type Lists = Record<string, { startupCommand: string[]; shellArguments: string[] }>;

const LISTS: Lists = {
  cmd: {
    startupCommand: ['npm run dev', 'npm test', 'docker compose up'],
    shellArguments: ['/K', '/K echo hi'],
  },
  pwsh: { startupCommand: ['Get-Process'], shellArguments: ['-NoLogo', '-NoProfile'] },
};

function bridge(lists: Lists = LISTS) {
  const listeners = new Set<(change: { flavourId?: string }) => void>();
  const history = {
    get: vi.fn((flavourId: string) => Promise.resolve(lists[flavourId] ?? { startupCommand: [], shellArguments: [] })),
    // 067 T136 — main's change notification; `emit` plays it.
    onChanged: vi.fn((cb: (change: { flavourId?: string }) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
    emit: (change: { flavourId?: string } = {}) => listeners.forEach((l) => l(change)),
    listenerCount: () => listeners.size,
    record: vi.fn(),
    clearField: vi.fn(),
    // 067 T143 — main forgets the value, then tells every window, as FormHistoryService does.
    removeValue: vi.fn((flavourId: string, field: 'startupCommand' | 'shellArguments', value: string) => {
      const own = lists[flavourId];
      if (own) lists[flavourId] = { ...own, [field]: own[field].filter((v) => v !== value) };
      listeners.forEach((l) => l({ flavourId }));
    }),
    clearFlavour: vi.fn(),
    clearAll: vi.fn(),
  };
  Reflect.set(window, 'throng', {
    formHistory: history,
    terminal: { listFlavours: () => Promise.resolve([]), capabilities: () => Promise.resolve({ elevated: false }) },
    config: { get: () => Promise.resolve({ settings: DEFAULT_APP_SETTINGS }), onChange: () => () => {} },
    panel: {},
  });
  return history;
}

function renderInputs(initial: PanelTypeValues = { flavourId: 'cmd', shellArguments: '', startupCommand: '' }) {
  const seen: PanelTypeValues[] = [];
  function Host() {
    const [values, setValues] = useState<PanelTypeValues>(initial);
    return createElement(TerminalInputs, {
      values,
      flavours: FLAVOURS,
      elevated: false,
      onChange: (next: PanelTypeValues) => {
        seen.push(next);
        setValues(next);
      },
    });
  }
  const { unmount } = render(createElement(NotificationProvider, null, createElement(ConfigProvider, null, createElement(Host))));
  return { user: userEvent.setup({ delay: null }), seen, unmount };
}

const field = (id: string): HTMLInputElement => screen.getByTestId(id) as HTMLInputElement;
const options = (listId: string): string[] =>
  within(screen.getByTestId(listId))
    .getAllByRole('option')
    .map((o) => o.textContent ?? '');
const noList = (listId: string): boolean => screen.queryByTestId(listId) === null;

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

describe('offering (FR-062)', () => {
  it('asks for the selected flavour’s lists and offers the matches for what is typed, per field', async () => {
    const h = bridge();
    const { user } = renderInputs();
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('cmd'));
    await user.type(field('terminal-startup-command'), 'npm');
    expect(options('terminal-startup-command-history')).toEqual(['npm run dev', 'npm test']);
    expect(noList('terminal-shell-arguments-history')).toBe(true);
    await user.click(field('terminal-shell-arguments'));
    await user.type(field('terminal-shell-arguments'), '/K');
    // The value typed in full is not offered back to itself.
    expect(options('terminal-shell-arguments-history')).toEqual(['/K echo hi']);
  });

  it('matches case-insensitively anywhere in the value, and offers nothing when nothing matches', async () => {
    const h = bridge();
    const { user } = renderInputs();
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    await user.type(field('terminal-startup-command'), 'COMPOSE');
    expect(options('terminal-startup-command-history')).toEqual(['docker compose up']);
    await user.clear(field('terminal-startup-command'));
    await user.type(field('terminal-startup-command'), 'zzz');
    expect(noList('terminal-startup-command-history')).toBe(true);
  });

  it('offers the other flavour’s values once that flavour is selected, never both', async () => {
    const h = bridge();
    const { user } = renderInputs({ flavourId: 'pwsh', shellArguments: '', startupCommand: '' });
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('pwsh'));
    await user.type(field('terminal-startup-command'), 'e');
    expect(options('terminal-startup-command-history')).toEqual(['Get-Process']);
  });

  it('asks again when the flavour changes', async () => {
    const h = bridge();
    const { user } = renderInputs();
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('cmd'));
    await user.selectOptions(screen.getByTestId('terminal-flavour'), 'pwsh');
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('pwsh'));
  });
});

describe('picking (FR-062)', () => {
  it('a click fills the field with the whole value and closes the list', async () => {
    const h = bridge();
    const { user, seen } = renderInputs();
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    await user.type(field('terminal-startup-command'), 'npm');
    await user.click(screen.getByRole('option', { name: 'npm test' }));
    expect(field('terminal-startup-command').value).toBe('npm test');
    expect(seen.at(-1)!.startupCommand).toBe('npm test');
    expect(noList('terminal-startup-command-history')).toBe(true);
  });

  it('the keyboard reaches it too: Down to move, Enter to pick, Escape to close', async () => {
    const h = bridge();
    const { user } = renderInputs();
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    await user.type(field('terminal-startup-command'), 'npm');
    expect(field('terminal-startup-command')).toHaveAttribute('role', 'combobox');
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(field('terminal-startup-command').value).toBe('npm test');

    await user.clear(field('terminal-startup-command'));
    await user.type(field('terminal-startup-command'), 'npm');
    expect(noList('terminal-startup-command-history')).toBe(false);
    await user.keyboard('{Escape}');
    expect(noList('terminal-startup-command-history')).toBe(true);
    expect(field('terminal-startup-command').value).toBe('npm');
  });

  it('Enter with nothing highlighted leaves the typed text alone', async () => {
    const h = bridge();
    const { user } = renderInputs();
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    await user.type(field('terminal-startup-command'), 'npm{Enter}');
    expect(field('terminal-startup-command').value).toBe('npm');
  });
});

describe('Down arrow shows the remembered list (067 FR-129)', () => {
  it('in an EMPTY field shows the whole list; Down moves through it, Enter picks, Esc closes', async () => {
    const h = bridge();
    const { user } = renderInputs();
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    await user.click(field('terminal-startup-command'));
    await user.keyboard('{Escape}');
    expect(noList('terminal-startup-command-history')).toBe(true);

    await user.keyboard('{ArrowDown}');
    expect(options('terminal-startup-command-history')).toEqual(['npm run dev', 'npm test', 'docker compose up']);
    expect(within(screen.getByTestId('terminal-startup-command-history')).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}');
    expect(within(screen.getByTestId('terminal-startup-command-history')).getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Escape}');
    expect(noList('terminal-startup-command-history')).toBe(true);
    expect(field('terminal-startup-command').value).toBe('');

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(field('terminal-startup-command').value).toBe('npm test');
  });

  it('with text typed still shows only the matches', async () => {
    const h = bridge();
    const { user } = renderInputs();
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    await user.type(field('terminal-startup-command'), 'compose');
    await user.keyboard('{Escape}');
    expect(noList('terminal-startup-command-history')).toBe(true);
    await user.keyboard('{ArrowDown}');
    expect(options('terminal-startup-command-history')).toEqual(['docker compose up']);
  });

  it('deleting the text down to empty offers the whole list again (FR-135)', async () => {
    const h = bridge();
    const { user } = renderInputs();
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    await user.type(field('terminal-startup-command'), 'n{Backspace}');
    expect(options('terminal-startup-command-history')).toEqual(['npm run dev', 'npm test', 'docker compose up']);
  });

  it('shows nothing for an empty field with nothing remembered', async () => {
    const h = bridge({ cmd: { startupCommand: [], shellArguments: [] }, pwsh: LISTS.pwsh! });
    const { user } = renderInputs();
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    await user.click(field('terminal-startup-command'));
    await user.keyboard('{ArrowDown}');
    expect(noList('terminal-startup-command-history')).toBe(true);
  });
});

describe('a clear made elsewhere reaches an open form (067 FR-064b, FR-066, T136)', () => {
  it('stops offering a value cleared in Preferences, without reopening the form', async () => {
    const lists: Lists = { cmd: { ...LISTS.cmd! }, pwsh: LISTS.pwsh! };
    const h = bridge(lists);
    const { user } = renderInputs();
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('cmd'));
    await screen.findByTestId('terminal-startup-command-clear');
    await user.type(field('terminal-startup-command'), 'npm');
    expect(options('terminal-startup-command-history')).toEqual(['npm run dev', 'npm test']);

    // Another window clears everything; main tells every window.
    lists.cmd = { startupCommand: [], shellArguments: [] };
    act(() => h.emit({}));

    await waitFor(() => expect(noList('terminal-startup-command-history')).toBe(true));
    expect(screen.queryByTestId('terminal-startup-command-clear')).toBeNull();
    expect(screen.queryByTestId('terminal-shell-arguments-clear')).toBeNull();
    await user.clear(field('terminal-startup-command'));
    await user.type(field('terminal-startup-command'), 'npm');
    expect(noList('terminal-startup-command-history')).toBe(true);
  });

  it('re-reads for the clear of its own terminal type, and ignores the clear of another', async () => {
    const h = bridge();
    renderInputs();
    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(1));
    act(() => h.emit({ flavourId: 'pwsh' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(h.get).toHaveBeenCalledTimes(1);
    act(() => h.emit({ flavourId: 'cmd' }));
    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(2));
  });

  it('stops listening when the form goes away', async () => {
    const h = bridge();
    const { unmount } = renderInputs();
    await waitFor(() => expect(h.listenerCount()).toBe(1));
    unmount();
    expect(h.listenerCount()).toBe(0);
  });
});

describe('focusing or clicking shows the list (067 FR-135, T146)', () => {
  it('a click into an empty field shows the whole list', async () => {
    const h = bridge();
    const { user } = renderInputs();
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    await screen.findByTestId('terminal-startup-command-clear');
    await user.click(field('terminal-startup-command'));
    expect(options('terminal-startup-command-history')).toEqual(['npm run dev', 'npm test', 'docker compose up']);
  });

  it('a field that already holds text shows the whole list too, and a pick replaces the text', async () => {
    const h = bridge();
    const { user, seen } = renderInputs({ flavourId: 'cmd', shellArguments: '/K', startupCommand: '' });
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    await screen.findByTestId('terminal-shell-arguments-clear');
    await user.click(field('terminal-shell-arguments'));
    expect(options('terminal-shell-arguments-history')).toEqual(['/K', '/K echo hi']);
    await user.click(screen.getByRole('option', { name: '/K echo hi' }));
    expect(field('terminal-shell-arguments').value).toBe('/K echo hi');
    expect(seen.at(-1)!.shellArguments).toBe('/K echo hi');
  });

  it('keyboard focus shows it as well', async () => {
    const h = bridge();
    const { user } = renderInputs();
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    await screen.findByTestId('terminal-startup-command-clear');
    act(() => field('terminal-startup-command').focus());
    await waitFor(() => expect(noList('terminal-startup-command-history')).toBe(false));
    void user;
  });

  it('typing narrows it to the matches', async () => {
    const h = bridge();
    const { user } = renderInputs();
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    await screen.findByTestId('terminal-startup-command-clear');
    await user.click(field('terminal-startup-command'));
    await user.keyboard('test');
    expect(options('terminal-startup-command-history')).toEqual(['npm test']);
  });

  it('Esc closes it until the field is clicked again', async () => {
    const h = bridge();
    const { user } = renderInputs();
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    await screen.findByTestId('terminal-startup-command-clear');
    await user.click(field('terminal-startup-command'));
    await user.keyboard('{Escape}');
    expect(noList('terminal-startup-command-history')).toBe(true);
    await user.click(field('terminal-startup-command'));
    expect(options('terminal-startup-command-history')).toEqual(['npm run dev', 'npm test', 'docker compose up']);
  });
});

describe('Delete forgets the highlighted value (067 FR-133, T143)', () => {
  const fresh = (): Lists => ({ cmd: { ...LISTS.cmd!, startupCommand: [...LISTS.cmd!.startupCommand] }, pwsh: LISTS.pwsh! });
  const highlighted = (): string | undefined =>
    within(screen.getByTestId('terminal-startup-command-history'))
      .getAllByRole('option')
      .find((o) => o.getAttribute('aria-selected') === 'true')?.textContent ?? undefined;

  it('removes it from the open list, keeps the text, and moves the highlight to the next value', async () => {
    const h = bridge(fresh());
    const { user } = renderInputs();
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    await screen.findByTestId('terminal-startup-command-clear');
    await user.click(field('terminal-startup-command'));
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(highlighted()).toBe('npm test');
    await user.keyboard('{Delete}');
    expect(h.removeValue).toHaveBeenCalledWith('cmd', 'startupCommand', 'npm test');
    await waitFor(() => expect(options('terminal-startup-command-history')).toEqual(['npm run dev', 'docker compose up']));
    expect(highlighted()).toBe('docker compose up');
    expect(field('terminal-startup-command').value).toBe('');
  });

  it('moves the highlight back after the last value, and closes the list once it is empty', async () => {
    const h = bridge(fresh());
    const { user } = renderInputs();
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    await screen.findByTestId('terminal-startup-command-clear');
    await user.click(field('terminal-startup-command'));
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(highlighted()).toBe('docker compose up');
    await user.keyboard('{Delete}');
    await waitFor(() => expect(highlighted()).toBe('npm test'));
    await user.keyboard('{Delete}');
    await waitFor(() => expect(highlighted()).toBe('npm run dev'));
    await user.keyboard('{Delete}');
    await waitFor(() => expect(noList('terminal-startup-command-history')).toBe(true));
    expect(h.removeValue).toHaveBeenCalledTimes(3);
  });

  it('with nothing highlighted, Delete edits the text and forgets nothing', async () => {
    const h = bridge(fresh());
    const { user } = renderInputs();
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    await user.type(field('terminal-startup-command'), 'npm');
    expect(noList('terminal-startup-command-history')).toBe(false);
    await user.keyboard('{ArrowLeft}{Delete}');
    expect(field('terminal-startup-command').value).toBe('np');
    expect(h.removeValue).not.toHaveBeenCalled();
  });

  it('another open form stops offering it once main announces the removal', async () => {
    const h = bridge(fresh());
    const { user } = renderInputs();
    renderInputs();
    await waitFor(() => expect(h.listenerCount()).toBe(2));
    const [first, second] = screen.getAllByTestId('terminal-startup-command') as HTMLInputElement[];
    await waitFor(() => expect(screen.getAllByTestId('terminal-startup-command-clear')).toHaveLength(2));
    await user.click(first!);
    await user.keyboard('{ArrowDown}{ArrowDown}{Delete}');
    await user.click(second!);
    await user.keyboard('{ArrowDown}');
    await waitFor(() =>
      expect(within(screen.getByTestId('terminal-startup-command-history')).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'npm run dev',
        'docker compose up',
      ]),
    );
  });
});

describe('long and multi-line values (edge case)', () => {
  const long = `${'x'.repeat(400)}`;
  const multi = 'echo one\necho two\r\necho three';

  it('shows each on ONE line, with the full value on hover, and picks the whole of it', async () => {
    const h = bridge({ cmd: { startupCommand: [multi, long], shellArguments: [] }, pwsh: LISTS.pwsh! });
    const { user, seen } = renderInputs();
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    await user.type(field('terminal-startup-command'), 'e');
    const rows = within(screen.getByTestId('terminal-startup-command-history')).getAllByRole('option');
    for (const row of rows) {
      expect(row.textContent).not.toMatch(/[\r\n]/);
      expect(row.className).toContain('history-option');
    }
    expect(rows[0]!).toHaveAttribute('title', multi);
    await user.click(rows[0]!);
    expect(seen.at(-1)!.startupCommand).toBe(multi);
  });
});

describe('clearing one field (FR-067)', () => {
  it('has an accessible name and clears only that field of the selected flavour', async () => {
    const h = bridge();
    const { user } = renderInputs();
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    const clear = await screen.findByTestId('terminal-startup-command-clear');
    expect(clear).toHaveAccessibleName(/clear remembered startup commands/i);
    await user.click(clear);
    expect(h.clearField).toHaveBeenCalledTimes(1);
    expect(h.clearField).toHaveBeenCalledWith('cmd', 'startupCommand');
    // The other field’s button is untouched and still there.
    expect(screen.getByTestId('terminal-shell-arguments-clear')).toHaveAccessibleName(/clear remembered shell arguments/i);
    await user.type(field('terminal-startup-command'), 'npm');
    expect(noList('terminal-startup-command-history')).toBe(true);
    await user.type(field('terminal-shell-arguments'), '/K');
    expect(noList('terminal-shell-arguments-history')).toBe(false);
  });

  it('is absent when there is nothing remembered for that field', async () => {
    const h = bridge({ cmd: { startupCommand: [], shellArguments: ['/K'] }, pwsh: LISTS.pwsh! });
    renderInputs();
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    await screen.findByTestId('terminal-shell-arguments-clear');
    expect(screen.queryByTestId('terminal-startup-command-clear')).toBeNull();
  });

  it('is reachable by keyboard', async () => {
    const h = bridge();
    const { user } = renderInputs();
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    const clear = await screen.findByTestId('terminal-startup-command-clear');
    clear.focus();
    await user.keyboard('{Enter}');
    expect(h.clearField).toHaveBeenCalledWith('cmd', 'startupCommand');
  });
});

describe('with the history off (FR-064a)', () => {
  function off() {
    const h = bridge();
    Reflect.set(window, 'throng', {
      ...(window.throng as object),
      config: {
        get: () =>
          Promise.resolve({
            settings: {
              ...DEFAULT_APP_SETTINGS,
              terminals: { ...DEFAULT_APP_SETTINGS.terminals, formHistory: { enabled: false, maxEntries: 10 } },
            },
          }),
        onChange: () => () => {},
      },
    });
    return h;
  }

  it('offers nothing and shows no clear buttons', async () => {
    off();
    const { user } = renderInputs();
    // The setting arrives with the config document; until then the shipped default (on) stands.
    await new Promise((r) => setTimeout(r, 50));
    await user.type(field('terminal-startup-command'), 'npm');
    expect(noList('terminal-startup-command-history')).toBe(true);
    expect(screen.queryByTestId('terminal-startup-command-clear')).toBeNull();
    expect(screen.queryByTestId('terminal-shell-arguments-clear')).toBeNull();
  });
});

/* ── Confirm records (FR-063) ─────────────────────────────────────────── */

const PANEL = 'p-hist';

function mountForm(
  history: ReturnType<typeof bridge>,
  settings: typeof DEFAULT_APP_SETTINGS = DEFAULT_APP_SETTINGS,
) {
  Reflect.set(window, 'throng', {
    ...(window.throng as object),
    terminal: {
      listFlavours: () =>
        Promise.resolve([
          { id: 'cmd', label: 'Command Prompt', file: 'cmd.exe', args: [], source: 'builtin', defaultShellArguments: '/K', reportsDirectory: true },
        ]),
      capabilities: () => Promise.resolve({ elevated: false }),
    },
    config: { get: () => Promise.resolve({ settings }), onChange: () => () => {} },
    panel: { notifyTyped: vi.fn(), notifyDestroyed: vi.fn(), publishIdentities: vi.fn() },
    formHistory: history,
  });
  const layout = createDefaultLayout('proj-hist', { tab: 't1', panel: PANEL });
  const rpc: ThrongBridge = {
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
        case 'projects.categories.list':
          return Promise.resolve({ categories: [] } as T);
        default:
          return Promise.resolve({} as T);
      }
    },
  };
  const services = {
    projects: new ProjectsClient(rpc),
    workspace: new WorkspaceClient(rpc),
    subWorkspaces: new SubWorkspacesClient(rpc),
    documents: new DocumentClient(rpc),
    fileOpUndo: new FileOpUndoClient(rpc),
    panelNames: new PanelNameClient(rpc),
  };
  render(
    createElement(
      ServicesProvider,
      { services },
      createElement(
        ConfigProvider,
        null,
        createElement(
          ProjectsProvider,
          { client: services.projects },
          createElement(
            WorkspaceProvider,
            { client: services.workspace, activeProjectId: 'proj-hist' },
            createElement(
              NotificationProvider,
              null,
              createElement(PanelTypeForm, { panelId: PANEL, projectRoot: 'C:/proj' }),
            ),
          ),
        ),
      ),
    ),
  );
  return userEvent.setup({ delay: null });
}

describe('recording on confirm (FR-063)', () => {
  afterEach(() => clearDraft(PANEL));

  async function fill(user: ReturnType<typeof userEvent.setup>) {
    await user.selectOptions(await screen.findByTestId(`panel-type-select-${PANEL}`), 'terminal');
    await screen.findByTestId('terminal-flavour');
    await waitFor(() => expect(screen.getByTestId(`panel-type-confirm-${PANEL}`)).toBeEnabled());
  }

  it('records both values once, when confirmed — not while typing', async () => {
    const h = bridge();
    const user = mountForm(h);
    await fill(user);
    const cmd = screen.getByTestId('terminal-startup-command');
    await user.type(cmd, 'npm run build');
    expect(h.record).not.toHaveBeenCalled();
    await user.click(screen.getByTestId(`panel-type-confirm-${PANEL}`));
    expect(h.record).toHaveBeenCalledTimes(1);
    expect(h.record).toHaveBeenCalledWith('cmd', { startupCommand: 'npm run build', shellArguments: '/K' });
  });

  it('records nothing for two empty fields', async () => {
    const h = bridge();
    const user = mountForm(h);
    await fill(user);
    await user.clear(screen.getByTestId('terminal-shell-arguments'));
    await user.click(screen.getByTestId(`panel-type-confirm-${PANEL}`));
    expect(h.record).not.toHaveBeenCalled();
  });

  it('records nothing with the history off', async () => {
    const h = bridge();
    const user = mountForm(h, {
      ...DEFAULT_APP_SETTINGS,
      terminals: { ...DEFAULT_APP_SETTINGS.terminals, formHistory: { enabled: false, maxEntries: 10 } },
    });
    await fill(user);
    await user.type(screen.getByTestId('terminal-startup-command'), 'npm run build');
    await user.click(screen.getByTestId(`panel-type-confirm-${PANEL}`));
    expect(h.record).not.toHaveBeenCalled();
  });
});
