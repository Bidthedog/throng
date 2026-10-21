/**
 * 057 FR-110 (T102, renderer half) — an ordinary notice of a type whose OS Notify is on is also
 * sent to main (`window.throng.notices.toOs`), which raises the Windows notification while no throng
 * window is focused. Whether a window is focused is MAIN's to know; this proves what the renderer sends
 * and when.
 *
 * ══ WHAT COUNTS AS "ACCEPTED" ══
 *
 * The moment the provider files its log record: a NEW notice (or a silenced one), not a repeat that only
 * flashes the card already up, and not an update to a card. It is independent of the display mode —
 * Never display with the OS on gives the Windows notification alone. And a notice carrying its own
 * `display` (the find-in-files summary) does not go: attention reaches the OS from main itself.
 *
 * Layer: component — `NotificationProvider` over the real config store with a fake bridge.
 * ANTI-VACUITY CONTROL: drop the `toOs` call and every positive test fails; send for a `display`
 * override and the override test fails; send on a flash and the repeat test fails.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationProvider, useNotify, type NoticeInput } from '../../src/renderer/common/notification.js';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';

let settingsPayload: Record<string, unknown> = { version: 1 };
const toOs = vi.fn();

beforeEach(() => {
  toOs.mockReset();
  settingsPayload = { version: 1 };
  (window as unknown as { throng: unknown }).throng = {
    notices: { log: () => {}, toOs },
    config: { get: () => Promise.resolve({ settings: settingsPayload }) },
  };
});
afterEach(() => {
  delete (window as unknown as { throng?: unknown }).throng;
});

interface Probe {
  notify?: (input: NoticeInput) => string;
  update?: (id: string, patch: Partial<NoticeInput>) => boolean;
  loaded?: boolean;
}

function ProbeView({ into }: { into: Probe }): ReactElement | null {
  const n = useNotify();
  into.notify = n.notify;
  into.update = n.update;
  into.loaded = useConfigLoaded();
  return null;
}

async function mount(notifications: Record<string, unknown>): Promise<Probe> {
  settingsPayload = { version: 1, notifications };
  const probe: Probe = {};
  render(
    createElement(ConfigProvider, null,
      createElement(NotificationProvider, null, createElement(ProbeView, { into: probe, key: 'probe' }))),
  );
  await waitFor(() => expect(probe.loaded).toBe(true));
  return probe;
}

const RAISE: Omit<NoticeInput, 'severity'> = {
  title: 'Saving failed',
  message: 'The disk is full.',
  subject: { kind: 'none' },
  testId: 'os-notice',
};

const ERROR_OS_ON = { os: true, error: { mode: 'dismiss', timeoutMs: 5000, os: true } };

describe('a notice reaches the OS when its type says so (FR-110)', () => {
  it('sends severity, the card heading as the title, and the message as the body', async () => {
    const probe = await mount(ERROR_OS_ON);
    act(() => { probe.notify!({ ...RAISE, severity: 'error' }); });
    expect(toOs).toHaveBeenCalledTimes(1);
    expect(toOs).toHaveBeenCalledWith({ severity: 'error', title: 'Saving failed', body: 'The disk is full.' });
  });

  it('is independent of the display mode: Never display with the OS on still sends, and shows no card', async () => {
    const probe = await mount({ os: true, error: { mode: 'never', timeoutMs: 5000, os: true } });
    act(() => { probe.notify!({ ...RAISE, severity: 'error' }); });
    expect(toOs).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('os-notice')).toBeNull();
  });

  it('does not send while that type’s own switch is off', async () => {
    const probe = await mount({ os: true, error: { mode: 'dismiss', timeoutMs: 5000, os: false } });
    act(() => { probe.notify!({ ...RAISE, severity: 'error' }); });
    expect(toOs).not.toHaveBeenCalled();
  });

  it('does not send for ANY type while the global switch is off', async () => {
    const probe = await mount({ os: false, error: { mode: 'dismiss', timeoutMs: 5000, os: true } });
    act(() => { probe.notify!({ ...RAISE, severity: 'error' }); });
    expect(toOs).not.toHaveBeenCalled();
  });

  it('follows the severity: another type’s switch does not send this one', async () => {
    const probe = await mount({ os: true, error: { mode: 'dismiss', timeoutMs: 5000, os: true } });
    act(() => { probe.notify!({ ...RAISE, severity: 'info' }); });
    expect(toOs).not.toHaveBeenCalled();
  });

  it('sends once for a notice raised again while it is still up — the repeat only flashes the card', async () => {
    const probe = await mount(ERROR_OS_ON);
    act(() => { probe.notify!({ ...RAISE, severity: 'error' }); });
    act(() => { probe.notify!({ ...RAISE, severity: 'error' }); });
    expect(toOs).toHaveBeenCalledTimes(1);
  });

  it('does not send for an update to a card already up', async () => {
    const probe = await mount(ERROR_OS_ON);
    let id = '';
    act(() => { id = probe.notify!({ ...RAISE, severity: 'error' }); });
    toOs.mockClear();
    act(() => { probe.update!(id, { message: 'The disk is still full.' }); });
    expect(toOs).not.toHaveBeenCalled();
  });

  it('does not send for a notice that carries its own display (attention reaches the OS from main)', async () => {
    const probe = await mount(ERROR_OS_ON);
    act(() => {
      probe.notify!({ ...RAISE, severity: 'error', display: { mode: 'timed', timeoutMs: 1000 } });
    });
    expect(toOs).not.toHaveBeenCalled();
  });

  it('does not fail when the bridge has no toOs (a window with no OS route)', async () => {
    const probe = await mount(ERROR_OS_ON);
    (window as unknown as { throng: { notices: Record<string, unknown> } }).throng.notices = { log: () => {} };
    expect(() => act(() => { probe.notify!({ ...RAISE, severity: 'error' }); })).not.toThrow();
  });
});
