/**
 * 048 T014 — the store's `splitPanel`: the new panel is the tab's active panel and takes focus
 * (FR-002), is named by the Blank Panel sequence (FR-127), and the split is persisted.
 */
import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectPanels, createDefaultLayout, effectiveActivePanelId } from '@throng/core';
import { mountWorkspace } from './helpers/mount-workspace.js';
import { __resetPanelFocus, registerPanelFocus } from '../../src/renderer/workspace/panel-focus.js';

afterEach(() => __resetPanelFocus());

describe('workspace store splitPanel', () => {
  it('adds a panel beside the target, makes it active and focuses it (FR-002)', async () => {
    const layout = createDefaultLayout('proj-1', { tab: 't1', panel: 'p1' });
    const mounted = await mountWorkspace(layout);

    let newId: string | null = null;
    act(() => {
      newId = mounted.ws().splitPanel('t1', 'p1', 'right');
    });

    expect(newId).not.toBeNull();
    const tab = mounted.ws().layout?.tabs[0];
    expect(tab).toBeDefined();
    const panels = collectPanels(tab!.root);
    expect(panels.map((p) => p.id)).toEqual(['p1', newId]);
    expect(effectiveActivePanelId(tab!)).toBe(newId);
    expect(panels[1]?.title).toBe('Blank Panel 2');

    // Focus: a focus request for the new panel is parked until it registers, then delivered.
    const focus = vi.fn();
    registerPanelFocus(newId as unknown as string, focus);
    expect(focus).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  /*
   * 048 FR-127 — every empty panel is "Blank Panel", made unique across the layout by taking the lowest
   * free number (FR-033). The store's own creation sites (split, add-beside) and core's (the + add) draw
   * from the same sequence, so the numbers follow on whichever route made the panel.
   */
  it('a split and a + add each take the next Blank Panel name (FR-127)', async () => {
    const layout = createDefaultLayout('proj-1', { tab: 't1', panel: 'p1' });
    Object.assign(layout.tabs[0]!.root, { title: 'Build' });
    const mounted = await mountWorkspace(layout);

    let split: string | null = null;
    act(() => {
      split = mounted.ws().splitPanel('t1', 'p1', 'right');
    });
    let added = '';
    act(() => {
      added = mounted.ws().addPanel('t1');
    });
    let beside: string | null = null;
    act(() => {
      beside = mounted.ws().addPanelBeside('p1', 'left');
    });

    const titleOf = (id: string | null): string | undefined =>
      collectPanels(mounted.ws().layout!.tabs[0]!.root).find((p) => p.id === id)?.title;
    expect(titleOf('p1')).toBe('Build');
    expect(titleOf(split)).toBe('Blank Panel');
    expect(titleOf(added)).toBe('Blank Panel 2');
    expect(titleOf(beside)).toBe('Blank Panel 3');
    mounted.unmount();
  });

  it('takes the lowest free number, not a count of panels (FR-127, FR-033)', async () => {
    const layout = createDefaultLayout('proj-1', { tab: 't1', panel: 'p1' });
    Object.assign(layout.tabs[0]!.root, { title: 'Blank Panel 2' });
    const mounted = await mountWorkspace(layout);

    let split: string | null = null;
    act(() => {
      split = mounted.ws().splitPanel('t1', 'p1', 'down');
    });

    expect(collectPanels(mounted.ws().layout!.tabs[0]!.root).find((p) => p.id === split)?.title).toBe('Blank Panel');
    mounted.unmount();
  });

  it('does nothing for an unknown target', async () => {
    const layout = createDefaultLayout('proj-1', { tab: 't1', panel: 'p1' });
    const mounted = await mountWorkspace(layout);
    let newId: string | null = 'unset';
    act(() => {
      newId = mounted.ws().splitPanel('t1', 'nope', 'down');
    });
    expect(newId).toBeNull();
    expect(collectPanels(mounted.ws().layout!.tabs[0]!.root)).toHaveLength(1);
    mounted.unmount();
  });
});
