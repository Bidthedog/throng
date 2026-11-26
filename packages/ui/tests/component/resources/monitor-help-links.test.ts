/**
 * 080 FR-046 — the Resource Monitor's "?" controls are help links like every other (?): the shared help icon at
 * the help link's own size, opening a Resource Monitor task of the guide in the Help window (FR-048). No popover opens.
 * (Supersedes 055 FR-093 and FR-119's help panel and popover helpers; the general "?" keeps its place, 055 FR-121.)
 *
 * Layer: component — the real toolbar, list and Held folders over the real session and config store.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, Fragment } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HELP_APP_BASE_URL, THRONG_THEME, helpUrl } from '@throng/core';
import { Breakdown } from '../../../src/renderer/resources/breakdown.js';
import { HeldFolders } from '../../../src/renderer/resources/held-folders.js';
import { HELPER_TOPICS, type HelperTopic } from '../../../src/renderer/resources/helper-targets.js';
import { ConfigProvider } from '../../../src/renderer/config/config-store.js';
import { __resetSession, ingestFrame, startSession } from '../../../src/renderer/resources/monitor-session.js';
import { HelpControl, ToolbarControls } from '../../../src/renderer/resources/toolbar.js';
import { frame, sampleHierarchy } from '../helpers/resource-fixtures.js';

const openHelp = vi.fn();

beforeEach(() => {
  openHelp.mockReset();
  __resetSession();
  startSession({ intervalSeconds: 2, historyMinutes: 5 });
  act(() => ingestFrame(frame(1, sampleHierarchy())));
  window.throng = {
    openHelp,
    config: {
      get: () => Promise.resolve({ settings: { resourceMonitor: {} }, theme: THRONG_THEME }),
      onChange: () => () => {},
      writePatch: () => Promise.resolve({ ok: true }),
    },
  } as unknown as typeof window.throng;
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'throng');
  __resetSession();
});

async function mountAll(): Promise<void> {
  render(
    createElement(
      ConfigProvider,
      null,
      createElement(
        Fragment,
        null,
        createElement(HelpControl),
        createElement(ToolbarControls),
        createElement(Breakdown),
        createElement(HeldFolders),
      ),
    ),
  );
  await waitFor(() => expect(screen.getByTestId('monitor-interval')).toBeInTheDocument());
}

const resources = (anchor: string): string => helpUrl({ page: 'resources', anchor }, { base: HELP_APP_BASE_URL });

describe("the monitor's general ? (FR-046)", () => {
  it('opens Find your way around the Resource Monitor, and no popover', async () => {
    await mountAll();
    const help = screen.getByTestId('monitor-help');
    expect(help.classList.contains('help-link')).toBe(true);
    fireEvent.click(help);
    expect(openHelp).toHaveBeenCalledExactlyOnceWith(resources('find-your-way-around-the-resource-monitor'));
    expect(screen.queryByTestId('monitor-help-panel')).toBeNull();
  });
});

describe('the ? beside each control (FR-046)', () => {
  const expected: Record<HelperTopic, string> = {
    orderBy: 'choose-what-the-list-shows',
    hideIdle: 'choose-what-the-list-shows',
    hideEnded: 'choose-what-the-list-shows',
    interval: 'choose-what-the-list-shows',
    heldFolders: 'see-which-folders-throng-is-holding',
    totalRow: 'read-the-figures',
    marks: 'read-the-figures',
  };

  it.each([...HELPER_TOPICS])('%s opens its guide task, at the help link size, with no popover', async (topic) => {
    await mountAll();
    const button = await screen.findByTestId(`info-helper-${topic}`);
    expect(button.classList.contains('help-link')).toBe(true);
    fireEvent.click(button);
    expect(openHelp).toHaveBeenCalledExactlyOnceWith(resources(expected[topic]));
    expect(screen.queryByTestId('info-helper-popover')).toBeNull();
  });
});
