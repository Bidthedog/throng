/**
 * 067 T098 (FR-082, FR-083, FR-085, FR-087, FR-108) — creating a sub-workspace from its panel.
 *
 * The header gains the themed `add` button in the slot the Projects panel's New project button holds.
 * A click asks the daemon for an empty, unloaded sub-workspace and opens no window; the new row is
 * then an ordinary one (renamed, recoloured, reordered and deleted through the controls it already has,
 * an unopened one deleting behind only the existing confirmation). The empty-state text no longer
 * says detaching is the way to make one.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubWorkspaceMetaDto } from '@throng/ipc-contract';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { SubWorkspacesProvider } from '../../src/renderer/state/subworkspaces-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { SubworkspacesPanel } from '../../src/renderer/sidebar/subworkspaces-panel.js';

const NEW: SubWorkspaceMetaDto = { id: 'swNew', name: 'Sub-workspace 1', colour: '#58a6ff', tabCount: 1, panelCount: 1 };

function makeServer(seed: SubWorkspaceMetaDto[] = []) {
  const state = { list: [...seed] };
  const invoke = vi.fn(async (method: string, params?: unknown): Promise<unknown> => {
    switch (method) {
      case 'subworkspace.list':
        return { subWorkspaces: state.list };
      case 'subworkspace.create':
        state.list = [...state.list, NEW];
        return NEW;
      case 'subworkspace.rename': {
        const { id, name } = params as { id: string; name: string };
        state.list = state.list.map((s) => (s.id === id ? { ...s, name } : s));
        return { ok: true };
      }
      case 'subworkspace.recolour': {
        const { id, colour } = params as { id: string; colour: string };
        state.list = state.list.map((s) => (s.id === id ? { ...s, colour } : s));
        return { ok: true };
      }
      case 'subworkspace.delete': {
        const { id } = params as { id: string };
        state.list = state.list.filter((s) => s.id !== id);
        return { ok: true };
      }
      default:
        throw new Error(`unexpected sub-workspace RPC: ${method}`);
    }
  });
  return { state, invoke, bridge: { invoke } as unknown as ThrongBridge };
}

const bridgeApi = { close: vi.fn(), notifyChanged: vi.fn(), open: vi.fn() };

async function mount(server: ReturnType<typeof makeServer>) {
  const user = userEvent.setup({ delay: null });
  Reflect.set(window, 'throng', { subWorkspace: bridgeApi });
  render(
    createElement(
      NotificationProvider,
      null,
      createElement(
        ConfirmProvider,
        null,
        createElement(
          SubWorkspacesProvider,
          { client: new SubWorkspacesClient(server.bridge) },
          createElement(SubworkspacesPanel),
        ),
      ),
    ),
  );
  await waitFor(() => expect(screen.getByTestId('subworkspace-list')).toBeInTheDocument());
  return { user };
}

beforeEach(() => {
  bridgeApi.close.mockClear();
  bridgeApi.notifyChanged.mockClear();
  bridgeApi.open.mockClear();
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

describe('the create button (FR-082, FR-108)', () => {
  it('is the themed add icon in the header actions slot, with a name and a title, and is a real button', async () => {
    await mount(makeServer());
    const button = screen.getByTestId('subworkspace-new');
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('title')).toBe('New sub-workspace');
    expect(button.getAttribute('aria-label')).toBe('New sub-workspace');
    expect(button.querySelector('.icon')).not.toBeNull();
    expect(button.closest('.panel__header-actions')).not.toBeNull();
    expect(button.closest('header')).not.toBeNull();
    expect(button.getAttribute('tabindex')).not.toBe('-1');
  });

  it('is reachable and activated from the keyboard', async () => {
    const server = makeServer();
    const { user } = await mount(server);
    screen.getByTestId('subworkspace-new').focus();
    expect(document.activeElement).toBe(screen.getByTestId('subworkspace-new'));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(server.invoke).toHaveBeenCalledWith('subworkspace.create', {}));
  });
});

describe('creating (FR-083)', () => {
  it('adds an unloaded row and opens no window', async () => {
    const server = makeServer();
    const { user } = await mount(server);
    expect(await screen.findByTestId('subworkspaces-empty')).toBeInTheDocument();

    await user.click(screen.getByTestId('subworkspace-new'));

    const row = await screen.findByTestId('subworkspace-item-swNew');
    await user.keyboard('{Escape}');
    expect(row.getAttribute('data-loaded')).toBe('false');
    expect(screen.getByTestId('subworkspace-name-swNew')).toHaveTextContent('Sub-workspace 1');
    expect(screen.getByTestId('subworkspace-counts-swNew')).toHaveTextContent('(1T·1P)');
    expect(bridgeApi.open).not.toHaveBeenCalled();
    expect(screen.queryByTestId('subworkspaces-empty')).toBeNull();
  });

  it('keeps the existing rows and adds the new one after them', async () => {
    const existing: SubWorkspaceMetaDto = { id: 'swOld', name: 'Detached A', colour: '#3fb950', tabCount: 2, panelCount: 3 };
    const { user } = await mount(makeServer([existing]));
    await user.click(screen.getByTestId('subworkspace-new'));
    await screen.findByTestId('subworkspace-item-swNew');
    await user.keyboard('{Escape}');
    const names = [...document.querySelectorAll('.subworkspace-item__name')].map((el) => el.textContent);
    expect(names).toEqual(['Detached A', 'Sub-workspace 1']);
  });

  it('reports a failed create as one notice and adds nothing', async () => {
    const server = makeServer();
    server.invoke.mockImplementationOnce(async () => ({ subWorkspaces: [] })); // the mount's list
    server.invoke.mockImplementationOnce(async () => {
      throw new Error('daemon said no');
    });
    const { user } = await mount(server);
    await user.click(screen.getByTestId('subworkspace-new'));
    await waitFor(() => expect(document.querySelectorAll('[data-testid="notices"] .notice')).toHaveLength(1));
    expect(screen.queryByTestId('subworkspace-item-swNew')).toBeNull();
  });
});

describe('the new row is an ordinary one (FR-085)', () => {
  it('renames through the existing double-click box', async () => {
    const server = makeServer();
    const { user } = await mount(server);
    await user.click(screen.getByTestId('subworkspace-new'));
    await screen.findByTestId('subworkspace-rename-input-swNew');
    await user.keyboard('{Escape}');
    await user.dblClick(await screen.findByTestId('subworkspace-name-swNew'));
    const input = await screen.findByTestId('subworkspace-rename-input-swNew');
    await user.clear(input);
    await user.type(input, 'Scratch{Enter}');
    await waitFor(() => expect(screen.getByTestId('subworkspace-name-swNew')).toHaveTextContent('Scratch'));
    expect(server.invoke).toHaveBeenCalledWith('subworkspace.rename', { id: 'swNew', name: 'Scratch' });
  });

  it('recolours through the existing swatch', async () => {
    const server = makeServer();
    const { user } = await mount(server);
    await user.click(screen.getByTestId('subworkspace-new'));
    const colour = await screen.findByTestId('subworkspace-colour-swNew');
    await user.keyboard('{Escape}');

    fireEvent.change(colour, { target: { value: '#ff0000' } });
    await waitFor(() =>
      expect(server.invoke).toHaveBeenCalledWith('subworkspace.recolour', { id: 'swNew', colour: '#ff0000' }),
    );
  });

  it('has the reorder grip', async () => {
    const { user } = await mount(makeServer());
    await user.click(screen.getByTestId('subworkspace-new'));
    expect(await screen.findByTestId('subworkspace-grip-swNew')).toBeInTheDocument();
  });

  it('deletes behind the existing confirmation only; it never asked to be detached or opened', async () => {
    const server = makeServer();
    const { user } = await mount(server);
    await user.click(screen.getByTestId('subworkspace-new'));
    await screen.findByTestId('subworkspace-delete-swNew');
    await user.keyboard('{Escape}');
    await user.click(screen.getByTestId('subworkspace-delete-swNew'));
    await screen.findByTestId('confirm-dialog');
    await user.click(screen.getByTestId('confirm-accept'));
    await waitFor(() => expect(screen.getByTestId('confirm-dialog')).toHaveTextContent(/absolutely sure/i));
    await user.click(screen.getByTestId('confirm-accept'));
    expect(await screen.findByTestId('subworkspaces-empty')).toBeInTheDocument();
    expect(server.invoke).toHaveBeenCalledWith('subworkspace.delete', { id: 'swNew' });
  });
});

describe('the empty state (FR-087)', () => {
  it('no longer says detaching is the way to create one', async () => {
    await mount(makeServer());
    const text = (await screen.findByTestId('subworkspaces-empty')).textContent ?? '';
    expect(text).not.toMatch(/detach/i);
    expect(text).toMatch(/new sub-workspace|create/i);
  });
});

describe('the new row opens in its name (FR-124)', () => {
  async function created() {
    const server = makeServer();
    const { user } = await mount(server);
    await user.click(screen.getByTestId('subworkspace-new'));
    const input = (await screen.findByTestId('subworkspace-rename-input-swNew')) as HTMLInputElement;
    return { server, user, input };
  }
  const renames = (server: ReturnType<typeof makeServer>) =>
    server.invoke.mock.calls.filter(([method]) => method === 'subworkspace.rename');

  it('puts the caret in the name with the default name selected', async () => {
    const { input } = await created();
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input.value).toBe('Sub-workspace 1');
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
  });

  it('takes what is typed in place of the default, and Enter commits it and opens the sub-workspace', async () => {
    const { server, user } = await created();
    await user.keyboard('Scratch{Enter}');
    await waitFor(() => expect(bridgeApi.open).toHaveBeenCalledWith('swNew'));
    expect(server.invoke).toHaveBeenCalledWith('subworkspace.rename', { id: 'swNew', name: 'Scratch' });
    expect(screen.getByTestId('subworkspace-name-swNew')).toHaveTextContent('Scratch');
    expect(bridgeApi.open).toHaveBeenCalledTimes(1);
  });

  it('opens it under the default name when Enter is pressed with nothing typed, and renames nothing', async () => {
    const { server, user } = await created();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(bridgeApi.open).toHaveBeenCalledWith('swNew'));
    expect(renames(server)).toHaveLength(0);
  });

  it('keeps the default and opens nothing on Escape, even with text typed', async () => {
    const { server, user } = await created();
    await user.keyboard('Scratch{Escape}');
    expect(await screen.findByTestId('subworkspace-name-swNew')).toHaveTextContent('Sub-workspace 1');
    expect(screen.queryByTestId('subworkspace-rename-input-swNew')).toBeNull();
    expect(renames(server)).toHaveLength(0);
    expect(bridgeApi.open).not.toHaveBeenCalled();
  });

  it('commits what is typed without opening when the user clicks away', async () => {
    const { server, user } = await created();
    await user.keyboard('Scratch');
    await user.click(document.body);
    await waitFor(() => expect(server.invoke).toHaveBeenCalledWith('subworkspace.rename', { id: 'swNew', name: 'Scratch' }));
    expect(bridgeApi.open).not.toHaveBeenCalled();
    expect(screen.queryByTestId('subworkspace-rename-input-swNew')).toBeNull();
  });

  it('does not take an emptied name: the default stays, and Enter still opens', async () => {
    const { server, user } = await created();
    await user.keyboard('{Backspace}{Enter}');
    await waitFor(() => expect(bridgeApi.open).toHaveBeenCalledWith('swNew'));
    expect(renames(server)).toHaveLength(0);
  });

  it('is the ordinary rename box for a row that is not new: Enter renames and opens nothing', async () => {
    const existing = { id: 'swOld', name: 'Detached A', colour: '#3fb950', tabCount: 2, panelCount: 3 };
    const server = makeServer([existing]);
    const { user } = await mount(server);
    await user.dblClick(await screen.findByTestId('subworkspace-name-swOld'));
    await screen.findByTestId('subworkspace-rename-input-swOld');
    await user.keyboard('Renamed{Enter}');
    await waitFor(() => expect(server.invoke).toHaveBeenCalledWith('subworkspace.rename', { id: 'swOld', name: 'Renamed' }));
    expect(bridgeApi.open).not.toHaveBeenCalled();
  });

  it('opens no name box when the create failed', async () => {
    const server = makeServer();
    server.invoke.mockImplementationOnce(async () => ({ subWorkspaces: [] }));
    server.invoke.mockImplementationOnce(async () => {
      throw new Error('daemon said no');
    });
    const { user } = await mount(server);
    await user.click(screen.getByTestId('subworkspace-new'));
    await waitFor(() => expect(document.querySelectorAll('[data-testid="notices"] .notice')).toHaveLength(1));
    expect(document.querySelector('.subworkspace-item__rename')).toBeNull();
  });
});
