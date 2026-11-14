/**
 * 068 US3 T046 (FR-031f, FR-031g; constitution 5.5.0 "one gesture follows a link") — when the panel
 * reaches its limit the main window raises ONE sticky warning toast: whatever the warning mode (even
 * Never display), saying to change the notification preferences and that unattended notifications can
 * affect performance, with a link that opens Preferences at Notifications. Its X tells main to warn no
 * more; following the link closes it WITHOUT that call; it is not added to the panel.
 *
 * Layer: component — the real providers and `LimitWarning` over a fake `window.throng`. When main
 * reports the limit, and that a dismissed warning is never reported again, are T036's.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { LimitWarning } from '../../src/renderer/notifications/limit-warning.js';

let settingsPayload: Record<string, unknown> = { version: 1 };
let reachLimit: () => void;
const dismissLimitWarning = vi.fn();
const openPreferences = vi.fn();
const add = vi.fn();
const followLimitWarning = vi.fn();
let outstanding = false;

beforeEach(() => {
  settingsPayload = { version: 1 };
  dismissLimitWarning.mockReset();
  openPreferences.mockReset();
  add.mockReset();
  followLimitWarning.mockReset();
  outstanding = false;
  add.mockImplementation(() => Promise.resolve({ outcome: 'added', id: 'e1' }));
  reachLimit = () => {};
  Reflect.set(window, 'throng', {
    notices: { log: () => {} },
    config: { get: () => Promise.resolve({ settings: settingsPayload }) },
    openPreferences,
    notifications: {
      add,
      list: () =>
        Promise.resolve({ entries: [], order: 'oldest', pendingCount: 0, pendingSeverity: null, limit: 100, limitWarningActive: outstanding }),
      onChanged: () => () => {},
      onRepeat: () => () => {},
      onLimitReached: (cb: () => void) => {
        reachLimit = cb;
        return () => {};
      },
      dismissLimitWarning,
      followLimitWarning,
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
  vi.useRealTimers();
});

async function mount(): Promise<void> {
  render(createElement(ConfigProvider, null, createElement(NotificationProvider, null, createElement(LimitWarning))));
  await waitFor(() => expect(reachLimit).not.toBe(undefined));
  await act(async () => {
    await Promise.resolve();
  });
}

const warning = (): HTMLElement | null => screen.queryByTestId('notification-limit-warning');

describe('the limit warning (FR-031f)', () => {
  it('raises one sticky warning that says what to do and why', async () => {
    await mount();
    act(() => reachLimit());
    const card = warning();
    expect(card).not.toBeNull();
    expect(card!.className).toContain('notice--warning');
    expect(card!.textContent).toMatch(/notification preferences/i);
    expect(card!.textContent).toMatch(/performance/i);
    // Sticky: it stays long past the toast duration.
    vi.useFakeTimers();
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(warning()).not.toBeNull();
  });

  it('raises it whatever the warning mode — even Never display', async () => {
    settingsPayload = { version: 1, notifications: { warning: { mode: 'never' } } };
    await mount();
    act(() => reachLimit());
    expect(warning()).not.toBeNull();
  });

  it('is not added to the panel', async () => {
    await mount();
    act(() => reachLimit());
    await act(async () => {
      await Promise.resolve();
    });
    expect(add).not.toHaveBeenCalled();
  });

  it('raises ONE card however often the limit is reported while it is up', async () => {
    await mount();
    act(() => reachLimit());
    act(() => reachLimit());
    expect(screen.getAllByTestId('notification-limit-warning')).toHaveLength(1);
  });
});

describe('the X and the link (FR-031g)', () => {
  it('the X removes the card and tells main to warn no more', async () => {
    await mount();
    act(() => reachLimit());
    fireEvent.click(screen.getByTestId('notification-limit-warning-dismiss'));
    expect(warning()).toBeNull();
    expect(dismissLimitWarning).toHaveBeenCalledTimes(1);
  });

  it('following the link opens Preferences at Notifications and closes the card WITHOUT that call', async () => {
    await mount();
    act(() => reachLimit());
    const link = screen.getByTestId('notification-limit-warning-link');
    // One gesture follows a link: Ctrl+click. A plain click navigates nothing (constitution 5.5.0).
    fireEvent.click(link);
    expect(openPreferences).not.toHaveBeenCalled();
    expect(warning()).not.toBeNull();
    fireEvent.click(link, { ctrlKey: true });
    expect(openPreferences).toHaveBeenCalledWith('settings', 'Notifications');
    expect(warning()).toBeNull();
    expect(dismissLimitWarning).not.toHaveBeenCalled();
    // B12: it is not a refusal — main arms the warning again for the raised limit.
    expect(followLimitWarning).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Enter follows the link from the keyboard, and Enter alone does not', async () => {
    await mount();
    act(() => reachLimit());
    const link = screen.getByTestId('notification-limit-warning-link');
    expect(link.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(link, { key: 'Enter' });
    expect(openPreferences).not.toHaveBeenCalled();
    fireEvent.keyDown(link, { key: 'Enter', ctrlKey: true });
    expect(openPreferences).toHaveBeenCalledWith('settings', 'Notifications');
    expect(dismissLimitWarning).not.toHaveBeenCalled();
  });

  it('names the gesture in the link’s hover text', async () => {
    await mount();
    act(() => reachLimit());
    expect(screen.getByTestId('notification-limit-warning-link').getAttribute('title')).toMatch(/Ctrl\+click/);
  });

  it('a later report after the card was closed raises it again (main decides whether to report)', async () => {
    await mount();
    act(() => reachLimit());
    fireEvent.click(screen.getByTestId('notification-limit-warning-dismiss'));
    act(() => reachLimit());
    expect(warning()).not.toBeNull();
  });
});

describe('a warning still outstanding when the app starts (B12, FR-031f)', () => {
  it('is shown again on startup when it was shown and neither dismissed nor followed', async () => {
    outstanding = true;
    await mount();
    await waitFor(() => expect(warning()).not.toBeNull());
  });

  it('is not shown on startup when nothing is outstanding', async () => {
    await mount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(warning()).toBeNull();
  });
});
