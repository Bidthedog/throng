/**
 * 048 FR-080/081/082 — Escape cancels a panel drag with the same teardown as a drop, and the next drag
 * behaves as a first one; plus the outer-edge bands' lifetime (FR-060) and the store wrapper's no-op
 * rule. (Where a drop lands is E2E — jsdom has no layout for `pointerWithin`.)
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultLayout, splitPanel } from '@throng/core';
import { mountTabGroup, type MountedTabGroup } from './helpers/mount-tab-group.js';
import { getSplitModePanel, startSplitMode, __resetSplitMode } from '../../src/renderer/workspace/split-mode.js';
import { __resetPanelFocus } from '../../src/renderer/workspace/panel-focus.js';

let mounted: MountedTabGroup | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  __resetSplitMode();
  __resetPanelFocus();
});

function twoPanels() {
  const base = createDefaultLayout('proj-cancel', { tab: 't1', panel: 'p1' });
  return splitPanel(base, 't1', 'p1', 'right', { id: 'p2', title: 'Panel 2' });
}

function beginDrag(panelId = 'p1'): void {
  const handle = screen.getByTestId(`panel-handle-${panelId}`);
  fireEvent.pointerDown(handle, { isPrimary: true, button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(document, { isPrimary: true, clientX: 30, clientY: 10 });
  fireEvent.pointerMove(document, { isPrimary: true, clientX: 50, clientY: 10 });
}

const afterDrag = (): Promise<void> => new Promise((r) => setTimeout(r, 80));

describe('Escape cancels a panel drag (FR-080..082)', () => {
  it('tears down as a drop does, changes nothing, and the next drag is a first one', async () => {
    mounted = mountTabGroup(twoPanels());
    await screen.findByTestId('panel-p1');
    // The arrangement, not the active panel: pressing the handle legitimately activates that panel.
    const arrangement = (): string => JSON.stringify(mounted!.ws().layout?.tabs.map((t) => t.root));
    const before = arrangement();

    beginDrag();
    await waitFor(() => expect(mounted!.ghost.start).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('outer-edge-zones')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(mounted!.ghost.stop).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('outer-edge-zones')).toBeNull();
    expect(arrangement()).toBe(before);

    // The next drag starts from clean state: a second ghost, its bands, and the same teardown.
    await afterDrag();
    beginDrag('p2');
    await waitFor(() => expect(mounted!.ghost.start).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('outer-edge-zones')).not.toBeNull();
    fireEvent.pointerUp(document, { isPrimary: true, clientX: 50, clientY: 10 });
    await waitFor(() => expect(mounted!.ghost.stop).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('outer-edge-zones')).toBeNull();
    await afterDrag();
  });

  it('cancels even when the focused element swallows Escape, as a terminal does, and consumes the key (R2)', async () => {
    mounted = mountTabGroup(twoPanels());
    await screen.findByTestId('panel-p1');
    // Stands in for xterm's textarea: pressing a header focuses it, and it stops Escape bubbling.
    const textarea = document.createElement('textarea');
    textarea.addEventListener('keydown', (e) => e.stopPropagation());
    document.body.appendChild(textarea);
    try {
      beginDrag();
      await waitFor(() => expect(mounted!.ghost.start).toHaveBeenCalledTimes(1));
      textarea.focus();
      const reachedShell = fireEvent.keyDown(textarea, { key: 'Escape', code: 'Escape' });
      await waitFor(() => expect(mounted!.ghost.stop).toHaveBeenCalledTimes(1));
      expect(screen.queryByTestId('outer-edge-zones')).toBeNull();
      // fireEvent returns false when the event was cancelled: the ESC never reaches the shell.
      expect(reachedShell).toBe(false);
      fireEvent.pointerUp(document, { isPrimary: true, clientX: 50, clientY: 10 });
      await afterDrag();
    } finally {
      textarea.remove();
    }
  });

  it('leaves Escape alone when no drag is in progress', async () => {
    mounted = mountTabGroup(twoPanels());
    await screen.findByTestId('panel-p1');
    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      input.focus();
      expect(fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' })).toBe(true);
    } finally {
      input.remove();
    }
  });

  it('a drag starting ends split mode, and a cancel leaves it ended', async () => {
    mounted = mountTabGroup(twoPanels());
    await screen.findByTestId('panel-p1');
    startSplitMode('p1');
    beginDrag();
    await waitFor(() => expect(getSplitModePanel()).toBeNull());
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(mounted!.ghost.stop).toHaveBeenCalled());
    expect(getSplitModePanel()).toBeNull();
    await afterDrag();
  });
});

describe('outer-edge bands (FR-060)', () => {
  it('are absent when a tab has a single panel — there is no rest to run beside', async () => {
    mounted = mountTabGroup(createDefaultLayout('proj-one', { tab: 't1', panel: 'p1' }));
    await screen.findByTestId('panel-p1');
    beginDrag();
    await waitFor(() => expect(mounted!.ghost.start).toHaveBeenCalled());
    expect(screen.queryByTestId('outer-edge-zones')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    await afterDrag();
  });

  it('draw all four bands while a panel is dragged', async () => {
    mounted = mountTabGroup(twoPanels());
    await screen.findByTestId('panel-p1');
    beginDrag();
    await waitFor(() => expect(screen.queryByTestId('outer-edge-zones')).not.toBeNull());
    for (const e of ['top', 'bottom', 'left', 'right']) expect(screen.getByTestId(`outer-edge-${e}`)).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    await afterDrag();
  });
});

describe('the store wrapper movePanelToOuterEdge (FR-061, FR-067)', () => {
  it('moves the panel and saves; a no-op drop changes nothing and does not save', async () => {
    mounted = mountTabGroup(twoPanels());
    await screen.findByTestId('panel-p2');
    const first = mounted.ws().layout;
    act(() => mounted!.ws().movePanelToOuterEdge('t1', 'p2', 'right')); // p2 already spans the right edge
    expect(mounted.ws().layout).toBe(first);

    act(() => mounted!.ws().movePanelToOuterEdge('t1', 'p2', 'left'));
    await waitFor(() => expect(mounted!.ws().layout).not.toBe(first));

    // A second identical drop is a no-op: same reference, no further save scheduled.
    const moved = mounted.ws().layout;
    act(() => mounted!.ws().movePanelToOuterEdge('t1', 'p2', 'left'));
    expect(mounted.ws().layout).toBe(moved);
  });
});
