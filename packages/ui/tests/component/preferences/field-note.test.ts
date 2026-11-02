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
import { SETTINGS_METADATA, THRONG_THEME } from '@throng/core';
import { NotificationProvider } from '../../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../../src/renderer/confirm-dialog.js';
import { ConfigProvider } from '../../../src/renderer/config/config-store.js';
import { ResetNoticeProvider } from '../../../src/renderer/preferences/reset-notice.js';
import { SettingsMetadataContext, SettingsTab } from '../../../src/renderer/preferences/settings-tab.js';

const KEY = 'resourceMonitor.captureIntervalSeconds';
const NEEDED = new Set([KEY, 'resourceMonitor.historyMinutes']);
// Trial (audit, component-2a): render only the descriptors a case needs, through the metadata context,
// rather than the whole registry. `full` keeps the shipped registry for the one claim about every
// OTHER setting ("no other setting grows a note").
const NEEDED_ONLY = SETTINGS_METADATA.filter((d) => NEEDED.has(d.key));

async function mount(
  resourceMonitor: Record<string, number>,
  full = false,
): Promise<{ writes: ReturnType<typeof vi.fn> }> {
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
          createElement(
            ConfirmProvider,
            null,
            createElement(
              SettingsMetadataContext.Provider,
              { value: full ? SETTINGS_METADATA : NEEDED_ONLY },
              createElement(SettingsTab, { searchDebounceMs: 150 }),
            ),
          ),
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

/*
 * Eight tests became three mounts, one per seed (audit, component-2a); every assertion is kept.
 */
describe('the capture interval’s minimum and note (055 FR-004, T098, R11)', () => {
  it('seed {2 s, 30 min}: the note says what was raised and why, sits in the row, is display only, and is the only note', async () => {
    const { writes } = await mount({ captureIntervalSeconds: 2, historyMinutes: 30 }, true);

    const note = await screen.findByTestId(`setting-note-${KEY}`);
    expect(note).toHaveTextContent('Raised to 30 s: the minimum for a 30-minute history');
    // Beside the field, in its own row.
    expect(screen.getByTestId(`setting-${KEY}`)).toContainElement(note);
    // Display only: showing it writes nothing.
    expect(writes).not.toHaveBeenCalled();
    // No other setting grows a note it does not declare.
    expect(screen.getAllByTestId(/^setting-note-/)).toHaveLength(1);
  });

  it('seed {2 s, 5 min}: the minimum is the descriptor’s static one, and there is no note', async () => {
    await mount({ captureIntervalSeconds: 2, historyMinutes: 5 });
    expect(await screen.findByTestId(`control-${KEY}-slider`)).toHaveAttribute('min', '2');
    // Absent when nothing was raised.
    await waitFor(() => expect(screen.getByTestId(`control-${KEY}`)).toBeInTheDocument());
    expect(screen.queryByTestId(`setting-note-${KEY}`)).toBeNull();
  });

  it('seed {30 s, 30 min}: the minimum follows the window, the field refuses less, and there is no note', async () => {
    await mount({ captureIntervalSeconds: 30, historyMinutes: 30 });
    const slider = await screen.findByTestId(`control-${KEY}-slider`);
    expect(slider).toHaveAttribute('min', '30');
    // Absent when the interval already meets the minimum.
    expect(screen.queryByTestId(`setting-note-${KEY}`)).toBeNull();

    const field = screen.getByTestId(`control-${KEY}`);
    fireEvent.change(field, { target: { value: '5' } });
    fireEvent.blur(field);
    expect(await screen.findByTestId(`control-${KEY}-invalid`)).toHaveTextContent('≥ 30');
  });
});
