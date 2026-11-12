/**
 * 067 T091 (FR-075, FR-077, FR-078, FR-079, FR-081) — `tabs.rename`, `Ctrl+Shift+Alt+F2`.
 *
 * A window command: from any focused panel it opens the existing inline rename on the ACTIVE tab, and
 * committing or cancelling returns the keyboard to the panel that had it. It does nothing, consuming the
 * chord all the same, where there is nothing to rename or a rename is already open. Plain `F2`, double
 * click and the tab menu's Rename are unchanged, and the menu item now shows the chord.
 *
 * Driven through the real `WindowDispatcher` over the real `TabGroup`.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLayout, DEFAULT_KEYBINDINGS, firstBinding, type Panel, type WorkspaceLayout } from '@throng/core';
import { MAIN_WINDOW_CAPABILITIES, WindowDispatcher } from '../../src/renderer/keybindings/window-dispatcher.js';
import { __resetPanelFocus, registerPanelFocus } from '../../src/renderer/workspace/panel-focus.js';
import { requestTabRename } from '../../src/renderer/workspace/tab-rename.js';
import { tabContextMenu } from '../../src/renderer/workspace/tab-menu.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { mountTabGroup, type MountedTabGroup } from './helpers/mount-tab-group.js';

const PROJECT = 'proj-rename';
const CHORD = { key: 'F2', code: 'F2', ctrlKey: true, shiftKey: true, altKey: true } as const;
const blank = (id: string): Panel => ({ type: 'panel', id, originProjectId: PROJECT, title: id });

/** Two tabs, t2 active; t2 holds p2 beside p3. */
function layout(): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  l.tabs.push({
    id: 't2',
    title: 'Second',
    root: { type: 'split', orientation: 'row', sizes: [0.5, 0.5], children: [blank('p2'), blank('p3')] },
    activePanelId: 'p2',
  });
  l.activeTabId = 't2';
  return l;
}

let m: MountedTabGroup | undefined;

async function mount(): Promise<void> {
  m = mountTabGroup(layout(), {
    extras: [createElement(WindowDispatcher, { key: 'dispatcher', capabilities: MAIN_WINDOW_CAPABILITIES })],
  });
  await screen.findByTestId('panel-p2');
}

/** Press the chord with focus inside panel `id`'s body; true when the dispatcher consumed it. */
function press(id: string, init: KeyboardEventInit = CHORD): boolean {
  const body = screen.getByTestId(`panel-body-${id}`);
  body.tabIndex = -1;
  body.focus();
  let notTaken = true;
  act(() => {
    notTaken = fireEvent.keyDown(body, init);
  });
  return !notTaken;
}

const renameInput = (tabId: string): HTMLInputElement | null =>
  screen.queryByTestId(`tab-rename-input-${tabId}`) as HTMLInputElement | null;

beforeEach(() => {
  __resetPanelFocus();
  setActivePane('workspace');
});

afterEach(() => {
  m?.unmount();
  m = undefined;
  __resetPanelFocus();
});

describe('starting the rename (FR-075)', () => {
  it('opens the inline rename on the ACTIVE tab, from a focused panel, and consumes the chord', async () => {
    await mount();
    expect(press('p3')).toBe(true);
    await waitFor(() => expect(renameInput('t2')).not.toBeNull());
    expect(renameInput('t1')).toBeNull();
    expect(renameInput('t2')!.value).toBe('Second');
  });

  it('follows the active tab, not a fixed one', async () => {
    await mount();
    act(() => m!.ws().setActiveTab('t1'));
    await screen.findByTestId('panel-p1');
    press('p1');
    await waitFor(() => expect(renameInput('t1')).not.toBeNull());
  });
});

describe('returning the keyboard (FR-077)', () => {
  it('committing focuses the panel that had it', async () => {
    const user = userEvent.setup({ delay: null });
    await mount();
    const focusP3 = vi.fn();
    registerPanelFocus('p3', focusP3);
    press('p3');
    const input = await waitFor(() => renameInput('t2')!);
    await user.clear(input);
    await user.type(input, 'Renamed{Enter}');
    await waitFor(() => expect(m!.ws().layout!.tabs.find((t) => t.id === 't2')!.title).toBe('Renamed'));
    await waitFor(() => expect(focusP3).toHaveBeenCalledTimes(1));
  });

  it('cancelling does too, and changes nothing', async () => {
    const user = userEvent.setup({ delay: null });
    await mount();
    const focusP3 = vi.fn();
    registerPanelFocus('p3', focusP3);
    press('p3');
    const input = await waitFor(() => renameInput('t2')!);
    await user.type(input, 'xx{Escape}');
    await waitFor(() => expect(renameInput('t2')).toBeNull());
    expect(m!.ws().layout!.tabs.find((t) => t.id === 't2')!.title).toBe('Second');
    await waitFor(() => expect(focusP3).toHaveBeenCalledTimes(1));
  });

  it('a rename started some other way (double click) does not steal focus to a panel afterwards', async () => {
    const user = userEvent.setup({ delay: null });
    await mount();
    const focusP2 = vi.fn();
    registerPanelFocus('p2', focusP2);
    await user.dblClick(screen.getByTestId('tab-t2'));
    const input = await waitFor(() => renameInput('t2')!);
    await user.type(input, '{Escape}');
    await waitFor(() => expect(renameInput('t2')).toBeNull());
    await new Promise((r) => setTimeout(r, 50));
    expect(focusP2).not.toHaveBeenCalled();
  });
});

describe('nothing to do (FR-081)', () => {
  it('while a rename is already open the chord leaves the box and its text alone', async () => {
    const user = userEvent.setup({ delay: null });
    await mount();
    const focusP3 = vi.fn();
    registerPanelFocus('p3', focusP3);
    press('p3');
    const input = await waitFor(() => renameInput('t2')!);
    await user.clear(input);
    await user.type(input, 'half typed');
    act(() => {
      fireEvent.keyDown(input, CHORD);
    });
    expect(screen.getAllByTestId('tab-rename-input-t2')).toHaveLength(1);
    expect(renameInput('t2')!.value).toBe('half typed');
    expect(focusP3).not.toHaveBeenCalled();
  });

  it('with no tab strip mounted the opener reports nothing happened, and does not throw', () => {
    expect(requestTabRename(null)).toBe(false);
  });
});

describe('everything else is unchanged (FR-079)', () => {
  it('plain F2 is not taken by the window dispatcher', async () => {
    await mount();
    expect(press('p3', { key: 'F2', code: 'F2' })).toBe(false);
    expect(renameInput('t2')).toBeNull();
  });

  it('double-click still renames', async () => {
    const user = userEvent.setup({ delay: null });
    await mount();
    await user.dblClick(screen.getByTestId('tab-t2'));
    await waitFor(() => expect(renameInput('t2')).not.toBeNull());
  });
});

describe('the tab menu’s Rename shows the chord (FR-078)', () => {
  const args = {
    tabId: 't2',
    destroyTabDisabled: false,
    destroyOthersDisabled: false,
    detach: null,
    actions: { rename: vi.fn(), destroyTab: vi.fn(), destroyOthers: vi.fn() },
  };

  it('with the live binding', () => {
    const rename = tabContextMenu({ ...args, keybindings: DEFAULT_KEYBINDINGS }).find((i) => i.label === 'Rename');
    expect(rename?.shortcut).toBe('Ctrl+Shift+Alt+F2');
  });

  it('and nothing without bindings', () => {
    const rename = tabContextMenu(args).find((i) => i.label === 'Rename');
    expect(rename?.shortcut).toBeUndefined();
  });

  it('the command is in the default key bindings at that chord', () => {
    expect(firstBinding(DEFAULT_KEYBINDINGS, 'tabs.rename')).toBe('Ctrl+Shift+Alt+F2');
  });
});
