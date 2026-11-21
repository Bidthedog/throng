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
import { THRONG_THEME, formatGrouped } from '@throng/core';
import { NotificationProvider } from '../../../src/renderer/common/notification.js';
import { settleConfigWrites } from '../../../src/renderer/config/write-config.js';
import { ConfirmProvider } from '../../../src/renderer/confirm-dialog.js';
import { ConfigProvider } from '../../../src/renderer/config/config-store.js';
import { ResetNoticeProvider } from '../../../src/renderer/preferences/reset-notice.js';
import { SettingsTab } from '../../../src/renderer/preferences/settings-tab.js';

// 077 FR-001 — both leaves are stored in ms, and the number box holds the stored value.
const INTERVAL = 'resourceMonitor.captureIntervalMs';
const WINDOW = 'resourceMonitor.historyMs';
const S = 1000;
const MIN = 60_000;

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
  // The row first draws the shipped value; wait for the seeded one. 077 FR-009: confirming the value already
  // stored writes nothing, so typing the shipped 5 minutes over a not-yet-loaded seed would be a silent no-op.
  const seeded = resourceMonitor.historyMs;
  if (seeded !== undefined) {
    await waitFor(() => expect(screen.getByTestId(`control-${WINDOW}`)).toHaveValue(formatGrouped(seeded)));
  }
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
    { name: 'a longer window needs it', start: { captureIntervalMs: 2 * S, historyMs: 5 * MIN }, window: 30 * MIN, interval: 30 * S },
    {
      name: 'the band’s minimum, not the window: a 10-minute window needs 5 s',
      start: { captureIntervalMs: 2 * S, historyMs: 5 * MIN },
      window: 10 * MIN,
      interval: 5 * S,
    },
  ])('raises the interval to the new minimum — $name', async ({ start, window, interval }) => {
    const writes = await mount(start);
    await set(writes, WINDOW, window);
    const patches = written(writes);
    expect(patches).toContainEqual({ path: ['resourceMonitor', 'historyMs'], value: window });
    expect(patches).toContainEqual({ path: ['resourceMonitor', 'captureIntervalMs'], value: interval });
  });

  it.each([
    { name: 'it already meets the new minimum', start: { captureIntervalMs: 30 * S, historyMs: 5 * MIN }, window: 30 * MIN },
    {
      name: 'the window gets shorter (the user’s slower choice stands)',
      start: { captureIntervalMs: 30 * S, historyMs: 30 * MIN },
      window: 5 * MIN,
    },
  ])('leaves the interval alone when $name', async ({ start, window }) => {
    const writes = await mount(start);
    await set(writes, WINDOW, window);
    expect(written(writes).map((p) => p.path.join('.'))).not.toContain(INTERVAL);
  });

  // The "showing a stored interval below the minimum writes nothing" case is asserted by
  // `field-note.test.ts` (seed {2, 30}: "display only"); this copy was deleted as an exact duplicate.
});

