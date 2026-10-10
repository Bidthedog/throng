/**
 * 054 FR-070, FR-074, FR-075 — a SECTION target (a diagram's Full Pane, FR-046f) drawn by the tab's
 * `MaximiseLayer`.
 *
 * Layer: component — the layer is a real `TabGroup`'s; the section is a stand-in that registers itself
 * the way `DiagramFrame` does (its state above the layer, `maximiseSection` re-called as that state
 * changes, `sectionUnmounted` on unmount). The diagram's own controls are the preview's tests.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createElement, Fragment, useEffect, useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultLayout, type Panel, type WorkspaceLayout } from '@throng/core';
import { mountTabGroup, type MountedTabGroup } from './helpers/mount-tab-group.js';
import {
  __resetMaximise,
  getMaximiseStack,
  maximisePanel,
  maximiseSection,
  sectionUnmounted,
  useSectionMaximised,
} from '../../src/renderer/workspace/maximise-store.js';

const PROJECT = 'proj-section';
const blank = (id: string): Panel => ({ type: 'panel', id, originProjectId: PROJECT, title: id });

function twoPanels(): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  l.tabs[0].root = { type: 'split', orientation: 'row', sizes: [0.6, 0.4], children: [blank('p1'), blank('p2')] };
  l.tabs[0].activePanelId = 'p1';
  return l;
}

/** What the test drives the stand-in section with. */
const control: { bump: () => void; full: () => void; unmount: () => void } = {
  bump: () => undefined,
  full: () => undefined,
  unmount: () => undefined,
};

/** A section of panel p1 holding its own state, as `DiagramFrame` holds its view state. */
function Section(): ReactElement {
  const [count, setCount] = useState(0);
  const [full, setFull] = useState(false);
  const maximised = useSectionMaximised('t1', 'p1', 'd0');
  control.bump = () => setCount((c) => c + 1);
  control.full = () => setFull(true);
  useEffect(() => {
    if (full) maximiseSection('t1', 'p1', 'd0', () => createElement('span', { 'data-testid': 'section-view' }, `count ${count}`));
  }, [full, count]);
  useEffect(() => () => sectionUnmounted('t1', 'p1', 'd0'), []);
  // Its in-place slot is empty while the layer draws it.
  return createElement('span', { 'data-testid': 'section-in-place' }, maximised ? '' : `count ${count}`);
}

function Host(): ReactElement | null {
  const [shown, setShown] = useState(true);
  control.unmount = () => setShown(false);
  return shown ? createElement(Section) : null;
}

let m: MountedTabGroup | undefined;

async function mount(): Promise<void> {
  m = mountTabGroup(twoPanels(), {
    wrap: (children) => createElement(Fragment, null, children, createElement(Host)),
  });
  await screen.findByTestId('panel-p1');
}

const shape = (): string[] =>
  getMaximiseStack('t1').map((t) => (t.kind === 'panel' ? `panel:${t.panelId}` : `section:${t.sectionId}`));
const esc = (): void => {
  act(() => {
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
  });
};

afterEach(() => {
  m?.unmount();
  m = undefined;
  __resetMaximise();
});

describe('a maximised section (FR-070, FR-074)', () => {
  it('is drawn in the layer over the tab body, and keeps the state that lives above it', async () => {
    await mount();
    act(() => control.bump());
    act(() => control.full());
    const layer = await screen.findByTestId('maximise-layer');
    expect(screen.getByTestId('tab-body').contains(layer)).toBe(true);
    expect(screen.getByTestId('section-view')).toHaveTextContent('count 1');
    expect(screen.getByTestId('section-in-place')).toHaveTextContent('');
    // Its state moves on while it is maximised, and the layer follows.
    act(() => control.bump());
    await waitFor(() => expect(screen.getByTestId('section-view')).toHaveTextContent('count 2'));
    // The other panel is hidden behind it, as for a whole-panel target.
    expect(screen.getByTestId('panel-p2')).toHaveAttribute('inert');
  });

  it('nests over its maximised panel, and Esc steps back one level at a time', async () => {
    await mount();
    act(() => maximisePanel('t1', 'p1'));
    act(() => control.full());
    await screen.findByTestId('maximise-layer');
    expect(screen.getByTestId('tab-body')).toHaveAttribute('data-maximised', 'p1');
    expect(shape()).toEqual(['panel:p1', 'section:d0']);

    esc();
    expect(screen.queryByTestId('maximise-layer')).toBeNull();
    expect(screen.getByTestId('tab-body')).toHaveAttribute('data-maximised', 'p1');
    esc();
    expect(screen.getByTestId('tab-body')).not.toHaveAttribute('data-maximised');
    expect(shape()).toEqual([]);
  });

  it('restores by itself when the section unmounts (FR-075)', async () => {
    await mount();
    act(() => control.full());
    await screen.findByTestId('maximise-layer');
    act(() => control.unmount());
    await waitFor(() => expect(screen.queryByTestId('maximise-layer')).toBeNull());
    expect(shape()).toEqual([]);
    expect(screen.getByTestId('panel-p2')).not.toHaveAttribute('inert');
  });
});
