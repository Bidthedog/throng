/**
 * 048 iterate round 1, defect D1 (FR-091, 033 FR-071) — the transient scrim in a sub-workspace window
 * sits in the SAME stacking context as the overlays it dims behind.
 *
 * `.throng-root` is `position: fixed`, so it is a stacking context of its own. The tab picker renders
 * inside it (the tab group lives in `.throng-shell`) at z 2000; a scrim mounted OUTSIDE it (z 1999) is
 * compared against `.throng-root` as a whole, not against the picker, and paints over everything —
 * picker included. The main window mounts the scrim inside the shell (`app.tsx`); this pins the
 * sub-workspace window to the same place. jsdom has no layout, so the assertion is structural: the
 * scrim's nearest `.throng-root` ancestor exists.
 *
 * Rendered under the window's real composition root, over a stubbed bridge.
 */
import { act, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SubWorkspaceCompositionRoot } from '../../src/renderer/composition-root.js';
import {
  __resetTransientOverlayForTests,
  claimTransientOverlay,
} from '../../src/renderer/common/transient-overlay.js';

const SUB_ID = 'sw-1';

beforeEach(() => {
  __resetTransientOverlayForTests();
  Reflect.set(window, 'throng', {
    // Every daemon call answers empty: the window shows its loading state, which is all this needs.
    invoke: (method: string) => {
      const result =
        method === 'projects.list'
          ? { projects: [] }
          : method === 'subworkspace.list' || method === 'workspace.loadSubWorkspaces'
            ? { subWorkspaces: [] }
            : {};
      return Promise.resolve({ ok: true, result });
    },
    config: {
      get: () => Promise.resolve({ settings: {} }),
      onChange: () => () => {},
    },
  });
});

afterEach(() => {
  __resetTransientOverlayForTests();
  Reflect.deleteProperty(window, 'throng');
});

describe('the transient scrim in a sub-workspace window (D1, FR-091)', () => {
  it('renders inside .throng-root, the stacking context the tab picker renders in', async () => {
    const view = render(createElement(SubWorkspaceCompositionRoot, { id: SUB_ID }));
    try {
      await act(() => Promise.resolve());
      let release: () => void = () => {};
      act(() => {
        release = claimTransientOverlay(() => {});
      });
      const scrim = screen.getByTestId('transient-scrim');
      expect(scrim.closest('.throng-root')).not.toBeNull();
      act(() => release());
    } finally {
      view.unmount();
    }
  });
});
