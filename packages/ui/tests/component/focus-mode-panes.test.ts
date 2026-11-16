/**
 * #635 — Focus Mode collapses both side panes, and leaving it restores each pane's ENTRY state.
 * Supersedes the last line of 054 FR-074 ("side panes … are unaffected") for the side panes.
 *
 * Layer: component — the decision is React state (a hook) fed by the window's workspace store and the
 * maximise store; both need a rendered tree. `App` itself is not mounted: it only reads these two.
 *  - `useFocusModePanes` decides what each pane shows from the stored preference and Focus Mode — a derived
 *    collapse, with a show or hide during Focus Mode held for that Focus Mode only;
 *  - `FocusModeBridge` decides what Focus Mode IS for the panes: a whole panel maximised in the ACTIVE tab
 *    (054 FR-073: per tab), never a diagram maximised on its own (a section target);
 *  - entering Focus Mode writes nothing to the layout's side-pane state (067 FR-056, FR-058).
 */
import { act, renderHook, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addTab, createDefaultLayout, type WorkspaceLayout } from '@throng/core';
import { FocusModeBridge, useFocusModePanes } from '../../src/renderer/panes/focus-mode-panes.js';
import {
  __resetMaximise,
  maximisePanel,
  maximiseSection,
  restore,
} from '../../src/renderer/workspace/maximise-store.js';
import { settleLayoutSaves } from '../../src/renderer/state/layout-saves.js';
import { mountTabGroup, type MountedTabGroup } from './helpers/mount-tab-group.js';

const PROJECT = 'proj-focus-panes';
let m: MountedTabGroup | undefined;

afterEach(() => {
  m?.unmount();
  m = undefined;
  act(() => __resetMaximise());
});

describe('useFocusModePanes: a derived collapse with an entry-state restore', () => {
  const mount = (on: boolean) =>
    renderHook(({ active }: { active: boolean }) => useFocusModePanes(active), { initialProps: { active: on } });

  it('outside Focus Mode each pane shows exactly what the stored preference says', () => {
    const { result } = mount(false);
    expect(result.current.shown('projects', true)).toBe(true);
    expect(result.current.shown('files', false)).toBe(false);
  });

  it('entering collapses both panes, whatever they were', () => {
    const { result, rerender } = mount(false);
    rerender({ active: true });
    expect(result.current.active).toBe(true);
    expect(result.current.shown('projects', true)).toBe(false);
    expect(result.current.shown('files', true)).toBe(false);
  });

  it('exiting restores the entry state: an expanded pane expands again, a collapsed one stays collapsed', () => {
    const { result, rerender } = mount(true);
    rerender({ active: false });
    expect(result.current.shown('projects', true)).toBe(true);
    expect(result.current.shown('files', false)).toBe(false);
  });

  it('a pane shown during Focus Mode shows until exit, and exit still restores the ENTRY state', () => {
    const { result, rerender } = mount(true);
    act(() => result.current.set('files', true));
    expect(result.current.shown('files', false)).toBe(true);
    expect(result.current.shown('projects', true)).toBe(false);
    rerender({ active: false });
    // Collapsed in the stored preference on entry, collapsed after: the show was never written.
    expect(result.current.shown('files', false)).toBe(false);
  });

  it('a pane shown during Focus Mode can be hidden again during it', () => {
    const { result } = mount(true);
    act(() => result.current.set('projects', true));
    act(() => result.current.set('projects', false));
    expect(result.current.shown('projects', true)).toBe(false);
  });

  it('each entry starts collapsed: a show from an earlier Focus Mode does not carry over', () => {
    const { result, rerender } = mount(true);
    act(() => result.current.set('projects', true));
    rerender({ active: false });
    rerender({ active: true });
    expect(result.current.shown('projects', true)).toBe(false);
  });
});

describe('FocusModeBridge: Focus Mode is a whole panel maximised in the active tab', () => {
  const mountWithBridge = async (layout: WorkspaceLayout, panelId: string) => {
    const onChange = vi.fn();
    m = mountTabGroup(layout, { extras: [createElement(FocusModeBridge, { key: 'focus', onChange })] });
    await screen.findByTestId(`panel-${panelId}`);
    return onChange;
  };
  const last = (spy: ReturnType<typeof vi.fn>): unknown => spy.mock.calls.at(-1)?.[0];
  const oneTab = (): WorkspaceLayout => createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });

  it('is off with nothing maximised, on once a panel is maximised, off again on restore', async () => {
    const onChange = await mountWithBridge(oneTab(), 'p1');
    expect(last(onChange)).toBe(false);
    act(() => maximisePanel('t1', 'p1'));
    expect(last(onChange)).toBe(true);
    act(() => restore('t1'));
    expect(last(onChange)).toBe(false);
  });

  it('a diagram maximised on its own is a section target, not Focus Mode', async () => {
    const onChange = await mountWithBridge(oneTab(), 'p1');
    act(() => maximiseSection('t1', 'p1', 'diagram-1', () => null));
    expect(last(onChange)).toBe(false);
  });

  it('a diagram nested in a maximised panel stays in Focus Mode until the panel itself is restored', async () => {
    const onChange = await mountWithBridge(oneTab(), 'p1');
    act(() => maximisePanel('t1', 'p1'));
    act(() => maximiseSection('t1', 'p1', 'diagram-1', () => null));
    act(() => restore('t1')); // the diagram steps back first
    expect(last(onChange)).toBe(true);
    act(() => restore('t1')); // then the panel
    expect(last(onChange)).toBe(false);
  });

  it('follows the active tab: off on a tab with nothing maximised, on again on returning', async () => {
    const onChange = await mountWithBridge(addTab(oneTab(), { tab: 't2', panel: 'p2' }), 'p2');
    act(() => maximisePanel('t2', 'p2'));
    expect(last(onChange)).toBe(true);
    act(() => m!.ws().setActiveTab('t1'));
    expect(last(onChange)).toBe(false);
    act(() => m!.ws().setActiveTab('t2'));
    expect(last(onChange)).toBe(true);
  });

  it('entering Focus Mode writes nothing to the layout’s side panes (067 FR-056, FR-058)', async () => {
    await mountWithBridge(oneTab(), 'p1');
    await act(async () => {
      await settleLayoutSaves();
    });
    const before = m!.saves.mock.calls.length;
    act(() => maximisePanel('t1', 'p1'));
    await act(async () => {
      await settleLayoutSaves();
    });
    expect(m!.ws().layout!.sidePanes).toBeUndefined();
    expect(m!.saves.mock.calls.length).toBe(before);
  });
});
