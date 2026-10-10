/**
 * 054 US8 — maximising a whole panel, in place (FR-070 – FR-076, research R7).
 *
 * Layer: component — what the real `TabGroup` renders while a tab has a maximised panel: the SAME DOM
 * nodes kept (no remount), `.tab-body[data-maximised]`, the hidden panels `inert`, the modal gates
 * (header +, split, drop zones), the open paths restoring first, the header control and title-menu row,
 * Esc, and that nothing is written to the layout. The keyboard chord is `maximise-keys.test.ts`; the
 * store's transition table is `unit/maximise-store.test.ts`; a real terminal keeping its bytes is T069.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { collectPanels, createDefaultLayout, DEFAULT_KEYBINDINGS, type Panel, type WorkspaceLayout } from '@throng/core';
import { mountTabGroup, type MountedTabGroup } from './helpers/mount-tab-group.js';
import { __resetMaximise, getMaximiseStack, maximisePanel, toggleMaximisePanel } from '../../src/renderer/workspace/maximise-store.js';
import { splitMenuItems } from '../../src/renderer/workspace/split-menu.js';
import { focusPanelIfLocal, createDedicatedEditor } from '../../src/renderer/editor/open-into-panel.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { __resetPanelFocus } from '../../src/renderer/workspace/panel-focus.js';
import { claimTransientOverlay, __resetTransientOverlayForTests } from '../../src/renderer/common/transient-overlay.js';

const PROJECT = 'proj-max';
const blank = (id: string): Panel => ({ type: 'panel', id, originProjectId: PROJECT, title: id });

/** p1 | p2 | p3 in a row, uneven sizes so a restore that touched them would show. */
function threePanels(): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  l.tabs[0].root = {
    type: 'split',
    orientation: 'row',
    sizes: [0.5, 0.3, 0.2],
    children: [blank('p1'), blank('p2'), blank('p3')],
  };
  l.tabs[0].activePanelId = 'p1';
  return l;
}

let m: MountedTabGroup | undefined;

async function mount(): Promise<MountedTabGroup> {
  m = mountTabGroup(threePanels());
  await screen.findByTestId('panel-maximise-p1');
  return m;
}

const body = (): HTMLElement => screen.getByTestId('tab-body');
const shape = (): string[] => getMaximiseStack('t1').map((t) => `${t.kind}:${t.panelId}`);
const ids = (): string[] => collectPanels(m!.ws().layout!.tabs[0]!.root).map((p) => p.id);

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, ms));
  });
}

afterEach(() => {
  m?.unmount();
  m = undefined;
  __resetMaximise();
  __resetPanelFocus();
  __resetTransientOverlayForTests();
  setActivePane('workspace');
});

describe('the header control (FR-071)', () => {
  it('maximises its panel in place: the same nodes, the body marked, the others hidden and inert', async () => {
    const user = userEvent.setup();
    await mount();
    const box = screen.getByTestId('panel-p1');
    const panelBody = screen.getByTestId('panel-body-p1');
    const button = screen.getByTestId('panel-maximise-p1');
    expect(button).toHaveAttribute('title', 'Maximise panel');

    await user.click(button);

    expect(body()).toHaveAttribute('data-maximised', 'p1');
    expect(screen.getByTestId('panel-p1'), 'the panel was re-mounted').toBe(box);
    expect(screen.getByTestId('panel-body-p1')).toBe(panelBody);
    expect(box).toHaveAttribute('data-maximised', 'true');
    expect(box).not.toHaveAttribute('inert');
    for (const id of ['p2', 'p3']) {
      expect(screen.getByTestId(`panel-${id}`)).toHaveAttribute('inert');
      expect(screen.getByTestId(`panel-${id}`)).toHaveClass('panel-box--maximise-hidden');
    }
    expect(screen.getByTestId('panel-maximise-p1')).toHaveAttribute('title', 'Restore panel');
  });

  it('restores from the same control, leaving the layout exactly as it was (FR-072, FR-073)', async () => {
    const user = userEvent.setup();
    await mount();
    const before = JSON.stringify(m!.ws().layout!.tabs[0]!.root);
    await user.click(screen.getByTestId('panel-maximise-p1'));
    await user.click(screen.getByTestId('panel-maximise-p1'));
    expect(body()).not.toHaveAttribute('data-maximised');
    expect(screen.getByTestId('panel-p2')).not.toHaveAttribute('inert');
    expect(JSON.stringify(m!.ws().layout!.tabs[0]!.root)).toBe(before);
  });
});

describe('the title menu row (FR-071, FR-077)', () => {
  it('offers Maximise Panel with its chord, and Restore Panel once maximised', async () => {
    const user = userEvent.setup();
    await mount();
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('panel-handle-p2') });
    const row = await screen.findByTestId('menu-item-Maximise Panel');
    expect(screen.getByTestId('menu-shortcut-Maximise Panel')).toHaveTextContent('Shift+Alt+Enter');
    await user.click(row);
    await waitFor(() => expect(shape()).toEqual(['panel:p2']));

    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('panel-handle-p2') });
    await user.click(await screen.findByTestId('menu-item-Restore Panel'));
    await waitFor(() => expect(shape()).toEqual([]));
  });
});

describe('a maximised tab is modal (FR-074)', () => {
  it('shows the header + disabled, saying why, and adds nothing', async () => {
    await mount();
    act(() => maximisePanel('t1', 'p1'));
    const add = screen.getByTestId('panel-add-p1');
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute('title', 'Restore the panel to add panels');
  });

  it('draws every Split row disabled, and a split (chord, menu, store) is refused', async () => {
    await mount();
    act(() => maximisePanel('t1', 'p1'));
    expect(splitMenuItems('p1', DEFAULT_KEYBINDINGS, () => undefined).every((row) => row.disabled === true)).toBe(true);
    let result: string | null = 'x';
    act(() => {
      result = m!.ws().splitPanel('t1', 'p1', 'right');
    });
    expect(result).toBeNull();
    expect(ids()).toEqual(['p1', 'p2', 'p3']);
  });

  it('starts no panel drag, so no drop zones appear', async () => {
    await mount();
    act(() => maximisePanel('t1', 'p1'));
    const handle = screen.getByTestId('panel-handle-p1');
    fireEvent.pointerDown(handle, { isPrimary: true, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { isPrimary: true, clientX: 40, clientY: 10 });
    fireEvent.pointerMove(document, { isPrimary: true, clientX: 80, clientY: 10 });
    await settle();
    expect(document.querySelector('.edge-zones')).toBeNull();
    expect(screen.queryByTestId('outer-edge-zones')).toBeNull();
    fireEvent.pointerUp(document, { isPrimary: true, clientX: 80, clientY: 10 });
    await settle(80);
  });

  it('an open landing in a hidden panel restores the tab first', async () => {
    await mount();
    act(() => maximisePanel('t1', 'p1'));
    act(() => {
      focusPanelIfLocal(m!.ws(), 'p3');
    });
    expect(shape()).toEqual([]);
    expect(body()).not.toHaveAttribute('data-maximised');
  });

  it('an open landing in the maximised panel itself leaves it maximised', async () => {
    await mount();
    act(() => maximisePanel('t1', 'p1'));
    act(() => {
      focusPanelIfLocal(m!.ws(), 'p1');
    });
    expect(shape()).toEqual(['panel:p1']);
  });

  it('an open that creates a panel in the tab restores first, so the user sees where it went', async () => {
    await mount();
    act(() => maximisePanel('t1', 'p1'));
    Reflect.set(window.throng as object, 'editor', undefined);
    act(() => {
      createDedicatedEditor(m!.ws(), 't1', 'D:/proj/a.ts');
    });
    expect(shape()).toEqual([]);
  });
});

describe('what ends or survives a maximise (FR-073, FR-075, FR-076)', () => {
  it('closing the maximised panel restores the tab', async () => {
    await mount();
    act(() => maximisePanel('t1', 'p1'));
    act(() => m!.ws().removePanel('p1'));
    await waitFor(() => expect(body()).not.toHaveAttribute('data-maximised'));
    expect(shape()).toEqual([]);
    expect(screen.getByTestId('panel-p2')).not.toHaveAttribute('inert');
  });

  it('switching to another tab and back shows it still maximised', async () => {
    await mount();
    act(() => maximisePanel('t1', 'p1'));
    let t2 = '';
    act(() => {
      t2 = m!.ws().addTab();
    });
    act(() => m!.ws().setActiveTab(t2));
    await waitFor(() => expect(screen.queryByTestId('panel-p1')).toBeNull());
    expect(body()).not.toHaveAttribute('data-maximised');
    act(() => m!.ws().setActiveTab('t1'));
    await waitFor(() => expect(body()).toHaveAttribute('data-maximised', 'p1'));
  });

  it('maximising and restoring write nothing to the layout — no save is scheduled', async () => {
    await mount();
    await settle(500); // whatever the load itself scheduled has gone out
    const before = m!.saves.mock.calls.length;
    const layoutBefore = m!.ws().layout;
    // Through the toggle the chord and the control share. (A CLICK also activates the panel it lands
    // on — any click on a panel does — which is a layout write of its own and not this feature's.)
    act(() => toggleMaximisePanel('t1', 'p1'));
    expect(body()).toHaveAttribute('data-maximised', 'p1');
    act(() => toggleMaximisePanel('t1', 'p1'));
    await settle(500);
    expect(m!.saves.mock.calls.length).toBe(before);
    expect(m!.ws().layout).toBe(layoutBefore);
  });
});

describe('Esc restores one level (FR-071, contracts "Esc")', () => {
  const esc = (target: Element = document.body): boolean => {
    let notTaken = true;
    act(() => {
      notTaken = fireEvent.keyDown(target, { key: 'Escape', code: 'Escape' });
    });
    return !notTaken;
  };

  /** A focusable surface inside panel p1's body, wrapped the way the real one is. */
  function inside(className: string): HTMLElement {
    const host = document.createElement('div');
    host.className = className;
    const el = document.createElement('textarea');
    host.appendChild(el);
    screen.getByTestId('panel-body-p1').appendChild(host);
    el.focus();
    return el;
  }

  it('restores the maximised panel and consumes the key', async () => {
    await mount();
    act(() => maximisePanel('t1', 'p1'));
    expect(esc()).toBe(true);
    expect(shape()).toEqual([]);
  });

  it('does nothing, and takes nothing, with nothing maximised', async () => {
    await mount();
    expect(esc()).toBe(false);
  });

  for (const host of ['xterm', 'cm-editor']) {
    it(`is left to a focused .${host}, which uses Esc itself`, async () => {
      await mount();
      act(() => maximisePanel('t1', 'p1'));
      expect(esc(inside(host))).toBe(false);
      expect(shape()).toEqual(['panel:p1']);
    });
  }

  it('is left alone while a find bar is open', async () => {
    await mount();
    act(() => maximisePanel('t1', 'p1'));
    const bar = document.createElement('div');
    bar.className = 'find-bar';
    screen.getByTestId('panel-body-p1').appendChild(bar);
    expect(esc()).toBe(false);
    expect(shape()).toEqual(['panel:p1']);
  });

  it('is left alone while a transient overlay is open', async () => {
    await mount();
    act(() => maximisePanel('t1', 'p1'));
    claimTransientOverlay(() => undefined);
    expect(esc()).toBe(false);
    expect(shape()).toEqual(['panel:p1']);
  });

  it('is left alone while a context menu is open', async () => {
    const user = userEvent.setup();
    await mount();
    act(() => maximisePanel('t1', 'p1'));
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('panel-handle-p1') });
    await screen.findByTestId('context-menu');
    esc();
    expect(shape()).toEqual(['panel:p1']);
  });
});
