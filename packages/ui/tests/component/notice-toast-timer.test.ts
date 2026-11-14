/**
 * 068 US3 T031 (FR-021, FR-021e, FR-022) — every toast, in any mode, leaves after ONE global
 * `toastDurationMs`; the pointer or keyboard focus inside the card pauses it, and leaving restarts
 * the FULL duration; every toast has a close X that removes it at once and runs `onDismiss`, while
 * expiry runs `onExpire` instead; a `sticky` toast never expires; a flash restarts the full duration.
 *
 * Layer: component — the decision is `setTimeout`s the provider arms, so a fake clock proves it in
 * microseconds. Mounted over the REAL config store, as `notice-display-override.test.ts` does.
 *
 * ANTI-VACUITY: each "still present" assertion is made after the same toast was seen present, and
 * the pause tests advance past the duration while held, so a provider that ignored the hold fails.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement, useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationProvider, useErrorNotice, useNotify, type NoticeInput } from '../../src/renderer/common/notification.js';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';
import { flushUntil } from './helpers/flush-until.js';

let settingsPayload: Record<string, unknown> = { version: 1 };

beforeEach(() => {
  settingsPayload = { version: 1 };
  (window as unknown as { throng: unknown }).throng = {
    notices: { log: () => {} },
    config: { get: () => Promise.resolve({ settings: settingsPayload }) },
  };
});

afterEach(() => {
  delete (window as unknown as { throng?: unknown }).throng;
  vi.useRealTimers();
});

interface Probe {
  notify?: (input: NoticeInput) => string;
  dismiss?: (id: string) => void;
  loaded?: boolean;
}

function ProbeView({ into }: { into: Probe }): ReactElement | null {
  const n = useNotify();
  into.notify = n.notify;
  into.dismiss = n.dismiss;
  into.loaded = useConfigLoaded();
  return null;
}

async function mount(): Promise<Probe> {
  const probe: Probe = {};
  render(
    createElement(
      ConfigProvider,
      null,
      createElement(NotificationProvider, null, createElement(ProbeView, { into: probe, key: 'probe' })),
    ),
  );
  await flushUntil(() => probe.loaded === true);
  return probe;
}

const RAISE: Omit<NoticeInput, 'severity'> = {
  message: 'Something happened.',
  subject: { kind: 'folder', name: 'x' },
  testId: 'probe-notice',
};

const present = (): boolean => screen.queryByTestId('probe-notice') !== null;
const tick = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe('every toast leaves after the toast duration (FR-021)', () => {
  it.each(['toast', 'panel'] as const)('in mode %s, at the configured duration', async (mode) => {
    settingsPayload = { version: 1, notifications: { info: { mode }, toastDurationMs: 5000 } };
    const probe = await mount();
    vi.useFakeTimers();
    act(() => void probe.notify!({ severity: 'info', ...RAISE }));
    expect(present()).toBe(true);
    tick(4900);
    expect(present(), 'left before the configured duration').toBe(true);
    tick(200);
    expect(present(), 'still there after the configured duration').toBe(false);
  });

  it('applies to an error too — no severity is exempt any more', async () => {
    const probe = await mount();
    vi.useFakeTimers();
    act(() => void probe.notify!({ severity: 'error', ...RAISE }));
    expect(present()).toBe(true);
    tick(3100);
    expect(present()).toBe(false);
  });

  it('a notice with its own display still leaves after the same duration', async () => {
    const probe = await mount();
    vi.useFakeTimers();
    act(() => void probe.notify!({ severity: 'error', ...RAISE, display: { toast: true, panel: true } }));
    expect(present()).toBe(true);
    tick(3100);
    expect(present()).toBe(false);
  });

  it('never shows a notice whose mode is never', async () => {
    settingsPayload = { version: 1, notifications: { info: { mode: 'never' } } };
    const probe = await mount();
    vi.useFakeTimers();
    act(() => void probe.notify!({ severity: 'info', ...RAISE }));
    expect(present()).toBe(false);
  });
});

describe('the pointer and keyboard focus pause the toast (FR-021, FR-022)', () => {
  const card = (): HTMLElement => screen.getByTestId('probe-notice');

  it('pointerenter pauses it, pointerleave restarts the FULL duration', async () => {
    const probe = await mount();
    vi.useFakeTimers();
    act(() => void probe.notify!({ severity: 'info', ...RAISE }));
    tick(2000);
    fireEvent.pointerEnter(card());
    tick(60_000);
    expect(present(), 'a toast under the pointer expired').toBe(true);
    fireEvent.pointerLeave(card());
    tick(2900);
    expect(present(), 'restarted with less than the full duration').toBe(true);
    tick(200);
    expect(present()).toBe(false);
  });

  it('under the E2E seam `?toastHold=off` the pointer does not hold it (gate run 43340046866)', async () => {
    window.history.replaceState(null, '', '?toastHold=off');
    try {
      const probe = await mount();
      vi.useFakeTimers();
      act(() => void probe.notify!({ severity: 'info', ...RAISE }));
      tick(2000);
      fireEvent.pointerEnter(card());
      tick(1100);
      expect(present(), 'the pointer still held the toast with the hold turned off').toBe(false);
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it('focusin pauses it, focusout restarts the full duration', async () => {
    const probe = await mount();
    vi.useFakeTimers();
    act(() => void probe.notify!({ severity: 'info', ...RAISE }));
    const button = screen.getByTestId('probe-notice-dismiss');
    fireEvent.focusIn(button);
    tick(60_000);
    expect(present(), 'a toast with focus inside expired').toBe(true);
    fireEvent.focusOut(button, { relatedTarget: null });
    tick(2900);
    expect(present()).toBe(true);
    tick(200);
    expect(present()).toBe(false);
  });

  it('focus moving between two controls inside the card does not release the hold', async () => {
    const probe = await mount();
    vi.useFakeTimers();
    act(() => void probe.notify!({ severity: 'info', ...RAISE }));
    const dismissButton = screen.getByTestId('probe-notice-dismiss');
    const copyButton = screen.getByTestId('probe-notice-copy');
    fireEvent.focusIn(dismissButton);
    fireEvent.focusOut(dismissButton, { relatedTarget: copyButton });
    fireEvent.focusIn(copyButton);
    tick(60_000);
    expect(present()).toBe(true);
  });

  it('with pointer and focus both inside, it stays until BOTH have left', async () => {
    const probe = await mount();
    vi.useFakeTimers();
    act(() => void probe.notify!({ severity: 'info', ...RAISE }));
    const button = screen.getByTestId('probe-notice-dismiss');
    fireEvent.pointerEnter(card());
    fireEvent.focusIn(button);
    fireEvent.pointerLeave(card());
    tick(60_000);
    expect(present(), 'released while focus was still inside').toBe(true);
    fireEvent.focusOut(button, { relatedTarget: null });
    tick(3100);
    expect(present()).toBe(false);
  });
});

describe('the close X, onDismiss and onExpire (FR-021)', () => {
  it('every toast has a close X that removes it at once and runs onDismiss, not onExpire', async () => {
    const probe = await mount();
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const onExpire = vi.fn();
    act(() => void probe.notify!({ severity: 'warning', ...RAISE, onDismiss, onExpire }));
    fireEvent.click(screen.getByTestId('probe-notice-dismiss'));
    expect(present()).toBe(false);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('expiry runs onExpire and NOT onDismiss', async () => {
    const probe = await mount();
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const onExpire = vi.fn();
    act(() => void probe.notify!({ severity: 'warning', ...RAISE, onDismiss, onExpire }));
    tick(3100);
    expect(present()).toBe(false);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('a sticky toast and a flash (FR-021e)', () => {
  it('a sticky toast never expires, but its close X still removes it', async () => {
    const probe = await mount();
    vi.useFakeTimers();
    const onExpire = vi.fn();
    act(() => void probe.notify!({ severity: 'info', ...RAISE, sticky: true, onExpire }));
    tick(10 * 60_000);
    expect(present()).toBe(true);
    expect(onExpire).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('probe-notice-dismiss'));
    expect(present()).toBe(false);
  });

  it('a repeat of the same notice restarts the FULL duration', async () => {
    const probe = await mount();
    vi.useFakeTimers();
    act(() => void probe.notify!({ severity: 'info', ...RAISE }));
    tick(2500);
    act(() => void probe.notify!({ severity: 'info', ...RAISE }));
    tick(2500);
    expect(present(), 'the repeat did not restart the clock').toBe(true);
    tick(600);
    expect(present()).toBe(false);
  });
});

/**
 * B10 (reviewer) — a toast that EXPIRES must leave the raiser able to raise the same failure again. The store
 * a surface reads its error from is cleared by `useErrorNotice`'s `clearError`; if only a user dismissal did
 * that, an expiry left the old string in the store and an identical next failure never re-ran the effect:
 * no toast, no flash, no log record (#287, #328).
 */
describe('a failure raised again after its toast expired is raised again (B10)', () => {
  function Surface({ api }: { api: { fail?: (m: string) => void } }): ReactElement | null {
    const [error, setError] = useState<string | null>(null);
    api.fail = (m) => setError(m);
    useErrorNotice(error, 'surface-notice', { kind: 'folder', name: 'x' }, () => setError(null));
    return null;
  }

  it('raises the identical failure a second time once the first toast has timed out', async () => {
    const api: { fail?: (m: string) => void } = {};
    const probe: Probe = {};
    render(
      createElement(
        ConfigProvider,
        null,
        createElement(
          NotificationProvider,
          null,
          createElement(ProbeView, { into: probe, key: 'probe' }),
          createElement(Surface, { api, key: 'surface' }),
        ),
      ),
    );
    await flushUntil(() => probe.loaded === true);
    vi.useFakeTimers();
    act(() => api.fail!('Cannot undo: the name is taken.'));
    expect(screen.queryByTestId('surface-notice')).not.toBeNull();
    tick(31000);
    expect(screen.queryByTestId('surface-notice'), 'the first toast did not expire').toBeNull();
    act(() => api.fail!('Cannot undo: the name is taken.'));
    expect(screen.queryByTestId('surface-notice'), 'the identical failure was swallowed').not.toBeNull();
  });
});
