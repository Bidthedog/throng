/**
 * FR-004b: changing the History window in Preferences raises the capture interval to the new minimum
 * IMMEDIATELY — it is written with the window, not left as a number below the minimum that only the
 * resolver was quietly covering until the interval control was touched.
 *
 * Layer: component — the real settings tab over the real config store, the bridge faked. What the minimum
 * IS belongs to core (`minimumIntervalFor`, unit-tested); what is claimed here is that a window-only change
 * reaches the interval's setting, and that nothing else does.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THRONG_THEME } from '@throng/core';
import { NotificationProvider } from '../../../src/renderer/common/notification.js';
import { settleConfigWrites } from '../../../src/renderer/config/write-config.js';
import { ConfirmProvider } from '../../../src/renderer/confirm-dialog.js';
import { ConfigProvider } from '../../../src/renderer/config/config-store.js';
import { ResetNoticeProvider } from '../../../src/renderer/preferences/reset-notice.js';
import { SettingsTab } from '../../../src/renderer/preferences/settings-tab.js';

const INTERVAL = 'resourceMonitor.captureIntervalSeconds';
const WINDOW = 'resourceMonitor.historyMinutes';

async function mount(resourceMonitor: Record<string, number>): Promise<ReturnType<typeof vi.fn>> {
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
        createElement(ResetNoticeProvider, null, createElement(ConfirmProvider, null, createElement(SettingsTab, { searchDebounceMs: 150 }))),
      ),
    ),
  );
  await screen.findByTestId(`setting-${WINDOW}`);
  return writes;
}

/** Type a value into a setting's number field and commit it, as the user does. */
async function set(writes: ReturnType<typeof vi.fn>, key: string, value: number): Promise<void> {
  const field = screen.getByTestId(`control-${key}`);
  fireEvent.change(field, { target: { value: String(value) } });
  fireEvent.blur(field);
  // Writes queue behind the config write lock: wait for this one to land, then let any companion write follow.
  await waitFor(() => expect(written(writes).map((p) => p.path.join('.'))).toContain(key.replace('resourceMonitor.', 'resourceMonitor.')));
  // Any companion write is queued behind the same lock: drain it (a condition), not a 50 ms guess.
  await settleConfigWrites();
}

const written = (writes: ReturnType<typeof vi.fn>): { path: string[]; value: unknown }[] =>
  writes.mock.calls.flatMap((call) => (call as unknown[])[1] as { path: string[]; value: unknown }[]);

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

describe('History window → capture interval (FR-004b)', () => {
  it.each([
    { name: 'a longer window needs it', start: { captureIntervalSeconds: 2, historyMinutes: 5 }, window: 30, interval: 30 },
    { name: 'the band’s minimum, not the window: a 10-minute window needs 5 s', start: { captureIntervalSeconds: 2, historyMinutes: 5 }, window: 10, interval: 5 },
  ])('raises the interval to the new minimum — $name', async ({ start, window, interval }) => {
    const writes = await mount(start);
    await set(writes, WINDOW, window);
    const patches = written(writes);
    expect(patches).toContainEqual({ path: ['resourceMonitor', 'historyMinutes'], value: window });
    expect(patches).toContainEqual({ path: ['resourceMonitor', 'captureIntervalSeconds'], value: interval });
  });

  it.each([
    { name: 'it already meets the new minimum', start: { captureIntervalSeconds: 30, historyMinutes: 5 }, window: 30 },
    { name: 'the window gets shorter (the user’s slower choice stands)', start: { captureIntervalSeconds: 30, historyMinutes: 30 }, window: 5 },
  ])('leaves the interval alone when $name', async ({ start, window }) => {
    const writes = await mount(start);
    await set(writes, WINDOW, window);
    expect(written(writes).map((p) => p.path.join('.'))).not.toContain(INTERVAL);
  });

  // The "showing a stored interval below the minimum writes nothing" case is asserted by
  // `field-note.test.ts` (seed {2, 30}: "display only"); this copy was deleted as an exact duplicate.
});

