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
  await new Promise((r) => setTimeout(r, 50));
}

const written = (writes: ReturnType<typeof vi.fn>): { path: string[]; value: unknown }[] =>
  writes.mock.calls.flatMap((call) => (call as unknown[])[1] as { path: string[]; value: unknown }[]);

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

describe('History window → capture interval (FR-004b)', () => {
  it('raises the interval to the new minimum when a longer window needs it', async () => {
    const writes = await mount({ captureIntervalSeconds: 2, historyMinutes: 5 });
    await set(writes, WINDOW, 30);
    const patches = written(writes);
    expect(patches).toContainEqual({ path: ['resourceMonitor', 'historyMinutes'], value: 30 });
    expect(patches).toContainEqual({ path: ['resourceMonitor', 'captureIntervalSeconds'], value: 30 });
  });

  it('raises it to the band\'s minimum, not to the window: a 10-minute window needs 5 s', async () => {
    const writes = await mount({ captureIntervalSeconds: 2, historyMinutes: 5 });
    await set(writes, WINDOW, 10);
    expect(written(writes)).toContainEqual({ path: ['resourceMonitor', 'captureIntervalSeconds'], value: 5 });
  });

  it('leaves an interval that already meets the new minimum alone', async () => {
    const writes = await mount({ captureIntervalSeconds: 30, historyMinutes: 5 });
    await set(writes, WINDOW, 30);
    expect(written(writes).map((p) => p.path.join('.'))).not.toContain(INTERVAL);
  });

  it('does not touch the interval when the window gets shorter (the user\'s slower choice stands)', async () => {
    const writes = await mount({ captureIntervalSeconds: 30, historyMinutes: 30 });
    await set(writes, WINDOW, 5);
    expect(written(writes).map((p) => p.path.join('.'))).not.toContain(INTERVAL);
  });

  it('still says nothing and writes nothing merely for showing a stored interval below the minimum (hand-edited file)', async () => {
    const writes = await mount({ captureIntervalSeconds: 2, historyMinutes: 30 });
    await screen.findByTestId(`setting-note-${INTERVAL}`);
    expect(writes).not.toHaveBeenCalled();
  });
});
