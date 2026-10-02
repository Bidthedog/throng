/**
 * 049 FR-000b (T052) — a panel dropped by a drag becomes its tab's active panel, its tab is the one shown, and
 * keyboard focus moves into it: dropped on another tab, on a panel's edge (a split), on a tab's outer edge, and on
 * the New-Tab button.
 *
 * The drag is a real dnd-kit drag (`helpers/drop-panel.ts` gives jsdom the geometry `pointerWithin` needs). The
 * panels are untyped: they register their focus target through `usePanelFocusTarget`, the same registration an
 * editor, a preview and a terminal make for their own input surface.
 */
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addTab, collectPanels, createDefaultLayout, splitPanel, type WorkspaceLayout } from '@throng/core';
import { mountTabGroup, type MountedTabGroup } from './helpers/mount-tab-group.js';
import { dragPanelTo, installDropGeometry } from './helpers/drop-panel.js';
import { __resetPanelFocus } from '../../src/renderer/workspace/panel-focus.js';
import { __resetSplitMode } from '../../src/renderer/workspace/split-mode.js';

let mounted: MountedTabGroup | null = null;
let uninstall: () => void = () => {};

beforeEach(() => {
  uninstall = installDropGeometry();
});

afterEach(() => {
  uninstall();
  mounted?.unmount();
  mounted = null;
  __resetSplitMode();
  __resetPanelFocus();
});

/** t1 holds p1 and p2 side by side (t1 shown); t2 holds p3. */
function layout(): WorkspaceLayout {
  const base = createDefaultLayout('proj-drop-focus', { tab: 't1', panel: 'p1' });
  const split = splitPanel(base, 't1', 'p1', 'right', { id: 'p2', title: 'Panel 2' });
  const two = addTab(split, { tab: 't2', panel: 'p3' });
  return { ...two, activeTabId: 't1' };
}

const panelsIn = (tabId: string): string[] =>
  collectPanels(mounted!.ws().layout!.tabs.find((t) => t.id === tabId)!.root).map((p) => p.id);

async function expectDroppedPanelActiveAndFocused(panelId: string): Promise<void> {
  const l = (): WorkspaceLayout => mounted!.ws().layout!;
  await waitFor(() => {
    const shown = l().tabs.find((t) => t.id === l().activeTabId)!;
    expect(shown.activePanelId).toBe(panelId);
  });
  await waitFor(() => {
    const body = screen.getByTestId(`panel-${panelId}`);
    expect(document.activeElement).not.toBeNull();
    expect(body.contains(document.activeElement)).toBe(true);
  });
}

describe('a dropped panel is the active panel and takes focus (FR-000b)', () => {
  it('dropped on another tab: that tab is shown, the panel is its active panel, focus is inside it', async () => {
    mounted = mountTabGroup(layout());
    await screen.findByTestId('panel-p2');
    await dragPanelTo(mounted, 'p2', 'tab-t2');
    // The drop landed: p2 left t1 and is in t2.
    expect(panelsIn('t2')).toContain('p2');
    expect(panelsIn('t1')).not.toContain('p2');
    expect(mounted.ws().layout!.activeTabId).toBe('t2');
    await expectDroppedPanelActiveAndFocused('p2');
  });

  it('dropped on a panel edge (a split) in the same tab: it is the active panel and has focus', async () => {
    mounted = mountTabGroup(layout());
    await screen.findByTestId('panel-p2');
    // p1 was the tab's active panel; p2 is dragged to p1's left edge.
    await dragPanelTo(mounted, 'p2', 'edge-left-p1');
    expect(panelsIn('t1')).toEqual(['p2', 'p1']); // the drop landed: p2 is now left of p1
    await expectDroppedPanelActiveAndFocused('p2');
  });

  it("dropped on a tab's outer edge: it is the active panel and has focus", async () => {
    mounted = mountTabGroup(layout());
    await screen.findByTestId('panel-p2');
    await dragPanelTo(mounted, 'p2', 'outer-edge-left');
    expect(panelsIn('t1')).toEqual(['p2', 'p1']); // the drop landed: p2 runs along the left edge
    await expectDroppedPanelActiveAndFocused('p2');
  });

  it('dropped on the New-Tab button: the new tab is shown and the panel has focus', async () => {
    mounted = mountTabGroup(layout());
    await screen.findByTestId('panel-p2');
    await dragPanelTo(mounted, 'p2', 'tab-add');
    expect(mounted.ws().layout!.tabs).toHaveLength(3);
    await expectDroppedPanelActiveAndFocused('p2');
  });
});
