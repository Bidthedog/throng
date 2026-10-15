/**
 * The cog menu's Resource Monitor row and the one route every "open the monitor" takes (055 FR-056).
 *
 * Layer: component — the menu is the real `TitleBar` + `ContextMenuProvider`; the route is the real
 * `openResourceMonitor`. The shipped order and section shape are pinned at unit level by
 * `menu-sections.test.ts`; this proves the row is DRAWN with its icon and does what it says.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { THRONG_THEME } from '@throng/core';
import { TitleBar } from '../../../src/renderer/title-bar/title-bar.js';
import { ContextMenuProvider } from '../../../src/renderer/context-menu-provider.js';
import { __resetMonitorStore, isMonitorOpen, openResourceMonitor } from '../../../src/renderer/resources/monitor-store.js';
import { installResourcesBridge, type ResourcesBridge } from '../helpers/resource-bridge.js';

let bridge: ResourcesBridge;

beforeEach(() => {
  bridge = installResourcesBridge(null);
});

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
  window.history.replaceState(null, '', '/');
  __resetMonitorStore();
});

async function openCog(): Promise<void> {
  const user = userEvent.setup();
  render(
    createElement(ContextMenuProvider, {
      children: createElement(TitleBar, { identity: 'throng', showCog: true }),
    }),
  );
  await user.click(screen.getByTestId('title-bar-cog'));
}

describe('the cog menu lists Resource Monitor (FR-056)', () => {
  it('draws it after Open Logs Folder and before About, in the one application section', async () => {
    await openCog();

    const ids = screen.getAllByRole('menuitem').map((el) => el.getAttribute('data-testid'));
    expect(ids.indexOf('cog-resource-monitor')).toBe(ids.indexOf('cog-menu-logs') + 1);
    expect(ids.indexOf('cog-resource-monitor')).toBe(ids.indexOf('cog-menu-about') - 1);
    // One section: the menu has no divider anywhere.
    expect(document.querySelectorAll('[role="separator"]')).toHaveLength(0);
  });

  it('is named Resource Monitor and draws the resourceMonitor icon, not a borrowed one', async () => {
    await openCog();

    const row = screen.getByTestId('cog-resource-monitor');
    expect(row).toHaveTextContent('Resource Monitor');
    // The cell holds the glyph the theme gives the `resourceMonitor` token.
    expect(row).toHaveTextContent(THRONG_THEME.icons.resourceMonitor as string);
  });

  it('opens the monitor when chosen, and closes the menu', async () => {
    const user = userEvent.setup();
    await openCog();
    expect(isMonitorOpen()).toBe(false);

    await user.click(screen.getByTestId('cog-resource-monitor'));

    expect(isMonitorOpen()).toBe(true);
    expect(screen.queryByTestId('cog-menu')).toBeNull();
  });
});

describe('where the open goes (FR-056, research R12)', () => {
  it('the main window opens its own modal and asks nobody', () => {
    openResourceMonitor();

    expect(isMonitorOpen()).toBe(true);
    expect(bridge.opens()).toBe(0);
  });

  it('a sub-workspace window asks main to open it in the main window, and opens nothing itself', () => {
    window.history.replaceState(null, '', '/?sw=sub-1');

    openResourceMonitor();

    expect(bridge.opens()).toBe(1);
    expect(isMonitorOpen()).toBe(false);
  });
});
