/**
 * The Sub-workspaces panel (003 US7, FR-012-015), over the REAL `SubworkspacesPanel`, its real store and
 * its real `@dnd-kit` `DndContext`, against a fake daemon that really renames, deletes and reorders.
 *
 * Layer: component — MIGRATED FROM `subworkspaces.e2e.ts` ("lists, renames and deletes
 * sub-workspaces" and "reorders sub-workspaces by dragging, and the order persists"). Everything those
 * two asserted is a renderer decision (what the list shows, which box a double-click opens, how many
 * confirmations a delete takes, which RPC a drop produces); none needed a window. What stays end-to-end
 * is the window half: deleting an OPEN sub-workspace closes its window, reopen, bounds, lifecycle.
 *
 * Modelled on `projects-panel-drag-categories.test.ts` (the same pointer-drag technique) and
 * `projects-panel-form.test.ts` (the same provider wrap).
 *
 * ANTI-VACUITY: the drop test seeds the order [A, B] and expects [B, A] on the wire, so a panel that
 * ignores the drop fails it; the delete test cancels first, so a delete that skips its confirmation
 * fails the first half and one that never deletes fails the second.
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

const sw = (id: string, name: string, colour = '#3fb950'): SubWorkspaceMetaDto => ({
  id,
  name,
  colour,
  tabCount: 1,
  panelCount: 1,
});

function makeServer(seed: SubWorkspaceMetaDto[]) {
  const state = { list: [...seed] };
  const invoke = vi.fn(async (method: string, params?: unknown): Promise<unknown> => {
    switch (method) {
      case 'subworkspace.list':
        return { subWorkspaces: state.list };
      case 'subworkspace.rename': {
        const { id, name } = params as { id: string; name: string };
        state.list = state.list.map((s) => (s.id === id ? { ...s, name } : s));
        return { ok: true };
      }
      case 'subworkspace.delete': {
        const { id } = params as { id: string };
        state.list = state.list.filter((s) => s.id !== id);
        return { ok: true };
      }
      case 'subworkspace.reorder': {
        const { orderedIds } = params as { orderedIds: string[] };
        state.list = orderedIds
          .map((id) => state.list.find((s) => s.id === id))
          .filter((s): s is SubWorkspaceMetaDto => !!s);
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
  const user = userEvent.setup();
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

const names = (): string[] =>
  [...document.querySelectorAll('.subworkspace-item__name')].map((el) => el.textContent ?? '');

beforeEach(() => {
  bridgeApi.close.mockClear();
  bridgeApi.notifyChanged.mockClear();
  bridgeApi.open.mockClear();
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

describe('the list', () => {
  it('says so when there are no sub-workspaces', async () => {
    await mount(makeServer([]));
    expect(await screen.findByTestId('subworkspaces-empty')).toBeInTheDocument();
  });

  it('shows each sub-workspace by name, with its tab and panel counts', async () => {
    await mount(makeServer([sw('swA', 'Detached A'), sw('swB', 'Detached B')]));
    await waitFor(() => expect(names()).toEqual(['Detached A', 'Detached B']));
    expect(screen.getByTestId('subworkspace-counts-swA')).toHaveTextContent('(1T·1P)');
    expect(screen.queryByTestId('subworkspaces-empty')).toBeNull();
  });
});

describe('renaming (double-click)', () => {
  it('opens a box on double-click and commits the new name on Enter', async () => {
    const server = makeServer([sw('sw1', 'Detached A')]);
    const { user } = await mount(server);
    await screen.findByTestId('subworkspace-name-sw1');

    await user.dblClick(screen.getByTestId('subworkspace-name-sw1'));
    const input = await screen.findByTestId('subworkspace-rename-input-sw1');
    await user.clear(input);
    await user.type(input, 'Renamed SW{Enter}');

    await waitFor(() => expect(screen.getByTestId('subworkspace-name-sw1')).toHaveTextContent('Renamed SW'));
    expect(server.invoke).toHaveBeenCalledWith('subworkspace.rename', { id: 'sw1', name: 'Renamed SW' });
    // An open sub-workspace window learns of it, so its title follows live.
    expect(bridgeApi.notifyChanged).toHaveBeenCalledWith('sw1');
  });

  it('leaves the name alone when the box is dismissed with Escape', async () => {
    const server = makeServer([sw('sw1', 'Detached A')]);
    const { user } = await mount(server);
    await screen.findByTestId('subworkspace-name-sw1');

    await user.dblClick(screen.getByTestId('subworkspace-name-sw1'));
    const input = await screen.findByTestId('subworkspace-rename-input-sw1');
    await user.clear(input);
    await user.type(input, 'Discarded{Escape}');

    await waitFor(() => expect(screen.queryByTestId('subworkspace-rename-input-sw1')).toBeNull());
    expect(screen.getByTestId('subworkspace-name-sw1')).toHaveTextContent('Detached A');
    expect(server.invoke).not.toHaveBeenCalledWith('subworkspace.rename', expect.anything());
  });
});

describe('deleting takes the configured double confirmation', () => {
  it('destroys nothing on Cancel, and only after BOTH dialogs on accept', async () => {
    const server = makeServer([sw('sw1', 'Detached A')]);
    const { user } = await mount(server);
    await screen.findByTestId('subworkspace-name-sw1');

    // First dialog, refused: the row is still there and nothing reached the daemon.
    await user.click(screen.getByTestId('subworkspace-delete-sw1'));
    expect(await screen.findByTestId('confirm-dialog')).toBeVisible();
    await user.click(screen.getByTestId('confirm-cancel'));
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
    expect(screen.getByTestId('subworkspace-name-sw1')).toBeInTheDocument();
    expect(server.invoke).not.toHaveBeenCalledWith('subworkspace.delete', expect.anything());

    // Accepting the first opens the wry second; nothing is destroyed yet.
    await user.click(screen.getByTestId('subworkspace-delete-sw1'));
    await screen.findByTestId('confirm-dialog');
    await user.click(screen.getByTestId('confirm-accept'));
    await waitFor(() => expect(screen.getByTestId('confirm-dialog')).toHaveTextContent(/absolutely sure/i));
    expect(server.invoke).not.toHaveBeenCalledWith('subworkspace.delete', expect.anything());

    await user.click(screen.getByTestId('confirm-accept'));
    expect(await screen.findByTestId('subworkspaces-empty')).toBeInTheDocument();
    expect(server.invoke).toHaveBeenCalledWith('subworkspace.delete', { id: 'sw1' });
    // …and its window, if it is open, is told to close (the window half is end-to-end).
    expect(bridgeApi.close).toHaveBeenCalledWith('sw1');
  });
});

describe('drag-to-reorder by the grip', () => {
  const ROW = 40;
  function layoutRows(): void {
    const list = screen.getByTestId('subworkspace-list');
    const rect = (top: number, bottom: number): DOMRect =>
      ({ top, bottom, left: 0, right: 300, width: 300, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    Object.defineProperty(list, 'getBoundingClientRect', { configurable: true, value: () => rect(0, 10_000) });
    [...list.querySelectorAll<HTMLElement>('.subworkspace-item')].forEach((row, i) => {
      Object.defineProperty(row, 'getBoundingClientRect', {
        configurable: true,
        value: () => rect(i * ROW, (i + 1) * ROW),
      });
    });
  }

  it('dropping B above A sends the new order, and the list shows it', async () => {
    const server = makeServer([sw('swA', 'Detached A'), sw('swB', 'Detached B')]);
    await mount(server);
    await waitFor(() => expect(names()).toEqual(['Detached A', 'Detached B']));
    layoutRows();

    const grip = screen.getByTestId('subworkspace-grip-swB');
    fireEvent.pointerDown(grip, { isPrimary: true, button: 0, pointerId: 1, clientX: 10, clientY: 50 });
    fireEvent.pointerMove(document, { isPrimary: true, pointerId: 1, clientX: 10, clientY: 40 }); // > 4px: the drag starts
    // The drag really STARTED — a press that misses fails here, naming its cause.
    await waitFor(() => expect(document.querySelectorAll('.subworkspace-item--dragging')).toHaveLength(1));
    fireEvent.pointerMove(document, { isPrimary: true, pointerId: 1, clientX: 10, clientY: 5 }); // above A's midpoint
    fireEvent.pointerUp(document, { isPrimary: true, pointerId: 1, clientX: 10, clientY: 5 });

    await waitFor(() =>
      expect(server.invoke).toHaveBeenCalledWith('subworkspace.reorder', { orderedIds: ['swB', 'swA'] }),
    );
    await waitFor(() => expect(names()).toEqual(['Detached B', 'Detached A']));
  });

  it('dropping A back onto its own slot keeps the order, so the test above is not satisfied by any drop', async () => {
    const server = makeServer([sw('swA', 'Detached A'), sw('swB', 'Detached B')]);
    await mount(server);
    await waitFor(() => expect(names()).toEqual(['Detached A', 'Detached B']));
    layoutRows();

    const grip = screen.getByTestId('subworkspace-grip-swA');
    fireEvent.pointerDown(grip, { isPrimary: true, button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { isPrimary: true, pointerId: 1, clientX: 10, clientY: 20 });
    await waitFor(() => expect(document.querySelectorAll('.subworkspace-item--dragging')).toHaveLength(1));
    fireEvent.pointerMove(document, { isPrimary: true, pointerId: 1, clientX: 10, clientY: 5 }); // A's own slot
    fireEvent.pointerUp(document, { isPrimary: true, pointerId: 1, clientX: 10, clientY: 5 });

    await waitFor(() =>
      expect(server.invoke).toHaveBeenCalledWith('subworkspace.reorder', { orderedIds: ['swA', 'swB'] }),
    );
    expect(names()).toEqual(['Detached A', 'Detached B']);
  });
});
