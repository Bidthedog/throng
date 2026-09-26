/**
 * The cog menu's Zoom row — REMOVED (046 iterate round 2, FR-113). Round 1 (T121/T122, FR-107) added
 * Zoom Out / Reset Zoom / Zoom In as a `viewState` row acting on the WINDOW zoom, exactly as the
 * `zoom.out` / `zoom.reset` / `zoom.in` chords do. The maintainer's own words, mid-build: "Remove the
 * new 'Zoom' options from the menu." This file inverts every assertion the round-1 version made: the
 * three controls and the `viewState` "Zoom" section must be ABSENT from the rendered cog menu,
 * whatever `windowZoomLevel` a caller still passes (the prop is tolerated but has nothing to draw).
 *
 * Zoom stays reachable — the keyboard chords are unchanged, and the panel header's own Zoom submenu
 * (`panel.zoomIn` / `panel.zoomOut` / `panel.zoomReset`) is untouched by this round. The cog simply
 * has no mouse route to it any more, matching the shape it had before round 1.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TitleBar } from '../../src/renderer/title-bar/title-bar.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';

interface ZoomBridge {
  zoomBy: ReturnType<typeof vi.fn>;
  zoomReset: ReturnType<typeof vi.fn>;
}

function stubZoomBridge(): ZoomBridge {
  const bridge: ZoomBridge = { zoomBy: vi.fn(), zoomReset: vi.fn() };
  window.throng = bridge as typeof window.throng;
  return bridge;
}

afterEach(() => {
  delete window.throng;
});

async function openCog(): Promise<{ bridge: ZoomBridge; user: ReturnType<typeof userEvent.setup> }> {
  const bridge = stubZoomBridge();
  const user = userEvent.setup();
  render(
    createElement(ContextMenuProvider, {
      children: createElement(TitleBar, { identity: 'throng', showCog: true }),
    }),
  );
  await user.click(screen.getByTestId('title-bar-cog'));
  return { bridge, user };
}

describe('046 iterate round 2 (T154, FR-113) — the Zoom row is gone from the cog menu', () => {
  it('draws none of the three zoom controls', async () => {
    await openCog();
    expect(screen.queryByTestId('cog-menu-zoom-out')).toBeNull();
    expect(screen.queryByTestId('cog-menu-zoom-reset')).toBeNull();
    expect(screen.queryByTestId('cog-menu-zoom-in')).toBeNull();
  });

  it('draws no "Zoom" row at all, and no viewState-sectioned item', async () => {
    await openCog();
    expect(screen.queryByTestId('menu-item-Zoom')).toBeNull();
    expect(screen.queryByText('Zoom')).toBeNull();
  });

  it('never calls the zoom bridge just by opening the menu', async () => {
    const { bridge } = await openCog();
    expect(bridge.zoomBy).not.toHaveBeenCalled();
    expect(bridge.zoomReset).not.toHaveBeenCalled();
  });

  it('offers exactly the five Application rows, nothing ahead of them', async () => {
    await openCog();
    const ids = screen.getAllByRole('menuitem').map((el) => el.getAttribute('data-testid'));
    expect(ids).toEqual([
      'cog-menu-settings',
      'cog-menu-keybindings',
      'cog-menu-themes',
      'cog-menu-logs',
      'cog-menu-about',
    ]);
  });
});
