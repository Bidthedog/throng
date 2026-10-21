/**
 * 057 FR-111 — an attention toast, of either kind, answers to `notifications.attention`, not to the Info or
 * Error notice settings; FR-112 — a later raise on its mark changes the card silently.
 *
 * Layer: component — the REAL `ConfigProvider`, `NotificationProvider` and `AttentionToasts`, with a
 * seeded settings document. Whether the provider honours a notice's `display` override is
 * `notice-display-override.test.ts`'s claim; this proves the toasts pass the right one, per kind.
 *
 * ANTI-VACUITY CONTROL: drop `display` from `attention-toasts.tsx` and the toast falls back to its
 * severity's settings — Info is timed, Error is Dismiss only — so the `never` case shows a card and the
 * timed Failed card outlives its 3 seconds.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';
import { AttentionToasts } from '../../src/renderer/attention/attention-toasts.js';
import type { AttentionToastEvent } from '../../src/renderer/global.js';

let push: (e: AttentionToastEvent) => void;
let settingsPayload: Record<string, unknown>;
const state = { loaded: false };

function Loaded(): ReactElement | null {
  state.loaded = useConfigLoaded();
  return null;
}

beforeEach(() => {
  state.loaded = false;
  Reflect.set(window, 'throng', {
    notices: { log: () => {} },
    config: { get: () => Promise.resolve({ settings: settingsPayload }) },
    attention: {
      onToast: (cb: (e: AttentionToastEvent) => void) => {
        push = cb;
        return () => {};
      },
      goTo: () => {},
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
  vi.useRealTimers();
});

async function mount(attention: Record<string, unknown>): Promise<void> {
  settingsPayload = { version: 1, notifications: { attention } };
  render(
    createElement(
      ConfigProvider,
      null,
      createElement(NotificationProvider, null, createElement(AttentionToasts), createElement(Loaded)),
    ),
  );
  await waitFor(() => expect(state.loaded).toBe(true));
}

const raise = (panelId: string, kind: 'attention' | 'failed'): void =>
  act(() => push({ op: 'raise', panelId, kind, title: 'Build', projectName: 'Alpha', reason: 'Wants your attention' }));

describe('attention toast display (FR-111)', () => {
  it('shows no card under Never display, for either kind', async () => {
    await mount({ mode: 'never', timeoutMs: 5000 });
    raise('p1', 'attention');
    raise('p2', 'failed');
    expect(screen.queryByTestId('attention-toast-p1')).toBeNull();
    expect(screen.queryByTestId('attention-toast-p2')).toBeNull();
  });

  it('removes a timed Failed card after the Attention duration', async () => {
    await mount({ mode: 'timed', timeoutMs: 3000 });
    vi.useFakeTimers();
    raise('p1', 'failed');
    act(() => vi.advanceTimersByTime(3100));
    expect(screen.queryByTestId('attention-toast-p1')).toBeNull();
  });
});

describe('a later raise on an announced mark (FR-112)', () => {
  const update = (panelId: string, reason: string): void =>
    act(() => push({ op: 'update', panelId, kind: 'attention', title: 'Build', projectName: 'Alpha', reason }));

  it('changes the card without restarting its timer', async () => {
    await mount({ mode: 'timed', timeoutMs: 4000 });
    vi.useFakeTimers();
    raise('p1', 'attention');
    act(() => vi.advanceTimersByTime(3000));
    update('p1', 'Claude is waiting for your input');
    expect(screen.getByTestId('attention-toast-p1').textContent).toContain('Claude is waiting');
    act(() => vi.advanceTimersByTime(1100));
    expect(screen.queryByTestId('attention-toast-p1')).toBeNull();
  });

  it('raises no card once the first has gone', async () => {
    await mount({ mode: 'dismiss', timeoutMs: 5000 });
    update('p1', 'Claude is waiting for your input');
    expect(screen.queryByTestId('attention-toast-p1')).toBeNull();
  });
});
