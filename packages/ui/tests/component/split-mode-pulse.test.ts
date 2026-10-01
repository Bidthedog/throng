/**
 * 048 FR-026 — a panel in split mode draws a pulse over its border.
 *
 * The overlay is shown for exactly the panel `useSplitMode` names, goes with `endSplitMode`, and is a
 * plain non-interactive layer. `unit/split-mode-pulse-css.test.ts` holds the stylesheet half (opacity
 * only, steady under reduced motion).
 */
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultLayout } from '@throng/core';
import { mountTabGroup, type MountedTabGroup } from './helpers/mount-tab-group.js';
import { endSplitMode, startSplitMode, __resetSplitMode } from '../../src/renderer/workspace/split-mode.js';
import { __resetPanelFocus } from '../../src/renderer/workspace/panel-focus.js';

let mounted: MountedTabGroup | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  __resetSplitMode();
  __resetPanelFocus();
});

describe('the split-mode pulse overlay', () => {
  it('is drawn over the panel in split mode and only that one, and clears when it ends', async () => {
    const layout = createDefaultLayout('proj-pulse', { tab: 't1', panel: 'p1' });
    mounted = mountTabGroup(layout);
    await screen.findByTestId('panel-p1');
    act(() => {
      mounted!.ws().splitPanel('t1', 'p1', 'right');
    });
    await waitFor(() => expect(document.querySelectorAll('.panel-box')).toHaveLength(2));

    expect(document.querySelector('.panel-box__split-mode')).toBeNull();

    act(() => startSplitMode('p1'));
    const pulse = screen.getByTestId('panel-split-mode-p1');
    expect(pulse).toHaveClass('panel-box__split-mode');
    expect(screen.getByTestId('panel-p1').contains(pulse)).toBe(true);
    // The other panel has none.
    expect(document.querySelectorAll('.panel-box__split-mode')).toHaveLength(1);
    // Never in the way: decorative, and not announced.
    expect(pulse).toHaveAttribute('aria-hidden', 'true');

    act(() => endSplitMode());
    expect(document.querySelector('.panel-box__split-mode')).toBeNull();
  });

  it('moves to the new panel when split mode is started on another (a restart on the same one is not a second overlay)', async () => {
    mounted = mountTabGroup(createDefaultLayout('proj-pulse2', { tab: 't1', panel: 'p1' }));
    await screen.findByTestId('panel-p1');
    act(() => {
      mounted!.ws().splitPanel('t1', 'p1', 'right');
    });
    await waitFor(() => expect(document.querySelectorAll('.panel-box')).toHaveLength(2));
    const other = [...document.querySelectorAll<HTMLElement>('.panel-box')]
      .map((el) => el.dataset.panelId!)
      .find((id) => id !== 'p1')!;

    act(() => startSplitMode('p1'));
    act(() => startSplitMode('p1'));
    expect(document.querySelectorAll('.panel-box__split-mode')).toHaveLength(1);
    act(() => startSplitMode(other));
    expect(document.querySelectorAll('.panel-box__split-mode')).toHaveLength(1);
    expect(screen.getByTestId(`panel-${other}`).querySelector('.panel-box__split-mode')).not.toBeNull();
    expect(screen.getByTestId('panel-p1').querySelector('.panel-box__split-mode')).toBeNull();
  });
});
