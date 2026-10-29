/**
 * A setting's `note` beside its field (055 R11): the capture interval raised to the history window's
 * minimum says so where the user set it, instead of silently showing a number that is not in force.
 *
 * Layer: component — the real settings tab over the real config store, with the bridge faked. The rule
 * that RAISES the interval is core's (`resolveResourceMonitorSettings`, unit-tested); what is claimed
 * here is that the descriptor's note reaches the screen, only when there is something to say, and never
 * rewrites the stored value.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THRONG_THEME } from '@throng/core';
import { NotificationProvider } from '../../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../../src/renderer/confirm-dialog.js';
import { ConfigProvider } from '../../../src/renderer/config/config-store.js';
import { ResetNoticeProvider } from '../../../src/renderer/preferences/reset-notice.js';
import { SettingsTab } from '../../../src/renderer/preferences/settings-tab.js';

const KEY = 'resourceMonitor.captureIntervalSeconds';

async function mount(resourceMonitor: Record<string, number>): Promise<{ writes: ReturnType<typeof vi.fn> }> {
  const writes = vi.fn(() => Promise.resolve({ ok: true }));
  Reflect.set(window, 'throng', {
    config: {
      get: () => Promise.resolve({ settings: { resourceMonitor }, theme: THRONG_THEME }),
      onChange: () => () => {},
      writePatch: writes,
    },
  });
  render(
    createElement(
      ConfigProvider,
      null,
      createElement(
        NotificationProvider,
        null,
        createElement(
          ResetNoticeProvider,
          null,
          createElement(ConfirmProvider, null, createElement(SettingsTab, { searchDebounceMs: 150 })),
        ),
      ),
    ),
  );
  await screen.findByTestId(`setting-${KEY}`);
  return { writes };
}

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

describe('the capture interval’s minimum (055 FR-004, T098)', () => {
  it('follows the history window: the slider and the field refuse a value below it', async () => {
    await mount({ captureIntervalSeconds: 30, historyMinutes: 30 });
    const slider = await screen.findByTestId(`control-${KEY}-slider`);
    expect(slider).toHaveAttribute('min', '30');
    const field = screen.getByTestId(`control-${KEY}`);
    fireEvent.change(field, { target: { value: '5' } });
    fireEvent.blur(field);
    expect(await screen.findByTestId(`control-${KEY}-invalid`)).toHaveTextContent('≥ 30');
  });

  it('is the descriptor’s static minimum when the window allows it', async () => {
    await mount({ captureIntervalSeconds: 2, historyMinutes: 5 });
    expect(await screen.findByTestId(`control-${KEY}-slider`)).toHaveAttribute('min', '2');
  });
});

describe('the capture interval’s note', () => {
  it('says the interval was raised, and to what and why, when the history window demands it', async () => {
    await mount({ captureIntervalSeconds: 2, historyMinutes: 30 });

    const note = await screen.findByTestId(`setting-note-${KEY}`);
    expect(note).toHaveTextContent('Raised to 30 s: the minimum for a 30-minute history');
  });

  it('sits in the field’s own row, beside it', async () => {
    await mount({ captureIntervalSeconds: 2, historyMinutes: 30 });
    const row = screen.getByTestId(`setting-${KEY}`);
    expect(row).toContainElement(await screen.findByTestId(`setting-note-${KEY}`));
  });

  it('is absent when nothing was raised', async () => {
    await mount({ captureIntervalSeconds: 2, historyMinutes: 5 });
    await waitFor(() => expect(screen.getByTestId(`control-${KEY}`)).toBeInTheDocument());
    expect(screen.queryByTestId(`setting-note-${KEY}`)).toBeNull();
  });

  it('is absent when the interval already meets the minimum', async () => {
    await mount({ captureIntervalSeconds: 30, historyMinutes: 30 });
    await waitFor(() => expect(screen.getByTestId(`control-${KEY}`)).toBeInTheDocument());
    expect(screen.queryByTestId(`setting-note-${KEY}`)).toBeNull();
  });

  it('is display only: showing it writes nothing', async () => {
    const { writes } = await mount({ captureIntervalSeconds: 2, historyMinutes: 30 });
    await screen.findByTestId(`setting-note-${KEY}`);
    expect(writes).not.toHaveBeenCalled();
  });

  it('no other setting grows a note it does not declare', async () => {
    await mount({ captureIntervalSeconds: 2, historyMinutes: 30 });
    await screen.findByTestId(`setting-note-${KEY}`);
    expect(screen.getAllByTestId(/^setting-note-/)).toHaveLength(1);
  });
});
