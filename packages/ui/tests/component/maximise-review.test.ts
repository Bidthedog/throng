/**
 * 054 US8 review findings (FR-074, FR-075) that live in the maximise layer and the panel box — Esc
 * deferring to what owns it, a hidden panel's find bar, a tab drag's Esc, the owner panel under a section,
 * and a maximised tab refusing a move into it.
 *
 * Layer: component — each claim is about what the real `TabGroup` renders / how its capture-phase Esc
 * listeners cooperate; jsdom has the real layer, strip and panel boxes. Where a drop lands is not
 * observable here (no layout for collision detection), so the tab chip's disabled drop zone is asserted
 * on its marker.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, useEffect, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultLayout, type Panel, type WorkspaceLayout } from '@throng/core';
import { mountTabGroup, type MountedTabGroup } from './helpers/mount-tab-group.js';
import {
  __resetMaximise,
  getMaximiseStack,
  maximisePanel,
  maximiseSection,
} from '../../src/renderer/workspace/maximise-store.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { __resetPanelFocus } from '../../src/renderer/workspace/panel-focus.js';

const PROJECT = 'proj-review';
const blank = (id: string): Panel => ({ type: 'panel', id, originProjectId: PROJECT, title: id });

function twoPanels(): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  l.tabs[0].root = { type: 'split', orientation: 'row', sizes: [0.5, 0.5], children: [blank('p1'), blank('p2')] };
  l.tabs[0].activePanelId = 'p1';
  return l;
}

let m: MountedTabGroup | undefined;
const cleanup: HTMLElement[] = [];

async function mount(extra?: { wrap?: (c: ReactElement) => ReactElement }): Promise<MountedTabGroup> {
  m = mountTabGroup(twoPanels(), extra);
  await screen.findByTestId('panel-p1');
  return m;
}

const shape = (): string[] => getMaximiseStack('t1').map((t) => `${t.kind}:${t.panelId}`);
const esc = (target: Element = document.body): boolean => {
  let notTaken = true;
  act(() => {
    notTaken = fireEvent.keyDown(target, { key: 'Escape', code: 'Escape' });
  });
  return !notTaken;
};

function add<T extends HTMLElement>(el: T, parent: HTMLElement = document.body): T {
  parent.appendChild(el);
  cleanup.push(el);
  return el;
}

afterEach(() => {
  for (const el of cleanup.splice(0)) el.remove();
  m?.unmount();
  m = undefined;
  __resetMaximise();
  __resetPanelFocus();
  setActivePane('workspace');
});

describe('Esc is left to an inline editor outside the maximised tab (review 3)', () => {
  it('a focused input outside the tab body keeps its Esc', async () => {
    await mount();
    act(() => maximisePanel('t1', 'p1'));
    const rename = add(document.createElement('input'));
    rename.focus();
    expect(esc(rename)).toBe(false);
    expect(shape()).toEqual(['panel:p1']);
  });

  it('a focused contenteditable outside the tab body keeps its Esc', async () => {
    await mount();
    act(() => maximisePanel('t1', 'p1'));
    const rename = add(document.createElement('div'));
    rename.setAttribute('contenteditable', 'true');
    rename.tabIndex = 0;
    rename.focus();
    expect(esc(rename)).toBe(false);
    expect(shape()).toEqual(['panel:p1']);
  });

  it('a focused notice keeps its Esc', async () => {
    await mount();
    act(() => maximisePanel('t1', 'p1'));
    const notices = add(document.createElement('div'));
    notices.className = 'notices';
    const dismiss = add(document.createElement('button'), notices);
    dismiss.focus();
    expect(esc(dismiss)).toBe(false);
    expect(shape()).toEqual(['panel:p1']);
  });

  it('an Esc with focus on nothing in particular still steps back', async () => {
    await mount();
    act(() => maximisePanel('t1', 'p1'));
    expect(esc()).toBe(true);
    expect(shape()).toEqual([]);
  });
});

describe('a find bar in a hidden panel does not block the step back (review 5)', () => {
  it('ignores a .find-bar inside an inert, hidden panel', async () => {
    await mount();
    const bar = document.createElement('div');
    bar.className = 'find-bar';
    add(bar, screen.getByTestId('panel-body-p2'));
    act(() => maximisePanel('t1', 'p1'));
    expect(screen.getByTestId('panel-p2')).toHaveAttribute('inert');
    expect(esc()).toBe(true);
    expect(shape()).toEqual([]);
  });

  it('still defers to a find bar in the maximised panel', async () => {
    await mount();
    const bar = document.createElement('div');
    bar.className = 'find-bar';
    add(bar, screen.getByTestId('panel-body-p1'));
    act(() => maximisePanel('t1', 'p1'));
    expect(esc()).toBe(false);
    expect(shape()).toEqual(['panel:p1']);
  });
});

describe('Esc during a tab drag cancels the drag, not the maximise (review 4)', () => {
  it('leaves the maximise in place while the drag is live', async () => {
    const mounted = await mount();
    act(() => maximisePanel('t1', 'p1'));
    const chip = screen.getByTestId('tab-title-t1');
    fireEvent.pointerDown(chip, { isPrimary: true, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { isPrimary: true, clientX: 40, clientY: 10 });
    fireEvent.pointerMove(document, { isPrimary: true, clientX: 80, clientY: 10 });
    await waitFor(() => expect(mounted.ghost.start).toHaveBeenCalledTimes(1));

    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(mounted.ghost.stop).toHaveBeenCalledTimes(1));
    expect(shape()).toEqual(['panel:p1']);

    // The drag is over, so the next Esc is the maximise's.
    fireEvent.pointerUp(document, { isPrimary: true, clientX: 80, clientY: 10 });
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 80));
    });
    expect(esc()).toBe(true);
    expect(shape()).toEqual([]);
  });
});

describe('the owner panel is inert under a maximised section (review 6)', () => {
  const Section = (): ReactElement | null => {
    useEffect(() => {
      maximiseSection('t1', 'p1', 'd0', () => createElement('span', { 'data-testid': 'section-view' }, 'section'));
    }, []);
    return null;
  };
  const wrap = (children: ReactElement): ReactElement => createElement('div', null, children, createElement(Section));

  it('a section alone makes its own panel inert, as it does the others', async () => {
    await mount({ wrap });
    await screen.findByTestId('maximise-layer');
    expect(screen.getByTestId('panel-p1')).toHaveAttribute('inert');
    expect(screen.getByTestId('panel-p2')).toHaveAttribute('inert');
  });

  it('a section nested over its maximised panel makes the panel inert, and Esc brings it back', async () => {
    await mount({ wrap });
    await screen.findByTestId('maximise-layer');
    act(() => maximisePanel('t1', 'p1'));
    act(() => {
      maximiseSection('t1', 'p1', 'd0', () => createElement('span', null, 'section'));
    });
    expect(screen.getByTestId('panel-p1')).toHaveAttribute('inert');
    esc();
    expect(screen.getByTestId('panel-p1')).not.toHaveAttribute('inert');
    expect(shape()).toEqual(['panel:p1']);
  });
});

describe('a maximised tab refuses a panel moved into it (review 2, FR-074)', () => {
  async function twoTabs(): Promise<string> {
    await mount();
    let t2 = '';
    act(() => {
      t2 = m!.ws().addTab();
    });
    act(() => m!.ws().setActiveTab('t1'));
    await screen.findByTestId(`tab-${t2}`);
    return t2;
  }

  it('draws that tab chip with its drop zone disabled', async () => {
    const t2 = await twoTabs();
    expect(screen.getByTestId(`tab-${t2}`)).not.toHaveAttribute('data-drop-disabled');
    act(() => maximisePanel(t2, m!.ws().layout!.tabs.find((t) => t.id === t2)!.activePanelId!));
    expect(screen.getByTestId(`tab-${t2}`)).toHaveAttribute('data-drop-disabled', 'true');
    expect(screen.getByTestId('tab-t1')).not.toHaveAttribute('data-drop-disabled');
  });

  it("draws that tab's Send to Tab row disabled, and the other tab's enabled", async () => {
    const user = userEvent.setup();
    const t2 = await twoTabs();
    const t3 = (() => {
      let id = '';
      act(() => {
        id = m!.ws().addTab();
      });
      act(() => m!.ws().setActiveTab('t1'));
      return id;
    })();
    act(() => maximisePanel(t2, m!.ws().layout!.tabs.find((t) => t.id === t2)!.activePanelId!));
    const title = (id: string): string => m!.ws().layout!.tabs.find((t) => t.id === id)!.title;
    expect(title(t2)).not.toBe(title(t3));

    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('panel-handle-p1') });
    await user.click(await screen.findByTestId('menu-item-Send to Tab'));
    expect(await screen.findByTestId(`menu-item-${title(t2)}`)).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId(`menu-item-${title(t3)}`)).toHaveAttribute('aria-disabled', 'false');
  });
});
