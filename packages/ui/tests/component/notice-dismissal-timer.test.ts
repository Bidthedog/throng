/**
 * 030 US1 (#224) — A TIMED notice leaves only at ITS OWN NUMBER, and a DISMISS-ONLY notice never
 * leaves on its own at all.
 *
 * MOVED FROM `packages/ui/tests/e2e/notification-prefs.e2e.ts` (034 FR-045/SC-008).
 *
 * ══ WHY THIS LAYER ══
 *
 * Two of that file's sleeps prove absence: that a `timed` notice armed for `LONG_MS` (30000) has not
 * gone by `STILL_UP_AFTER` (15000), and that a `dismiss` notice — the "Dismiss only outlives any
 * timeout" test — has not gone by 7000 ms, past the pre-030 hardcoded `AUTO_DISMISS_MS` (5000).
 * Neither claim is about a window, a real daemon or real rendering — both are
 * `NotificationProvider.notify` deciding whether to call
 * `setTimeout(() => dismiss(id), behaviour.timeoutMs)` at all, and if so for how long
 * (`notification.tsx:640-644`). That decision has no event to fence on — the absence of a timer
 * firing produces no signal — so the E2E waited real seconds to observe it; a fake clock proves the
 * same thing in microseconds, and can go further: an hour past a `dismiss` notice's non-existent
 * timer below, not merely fifteen seconds past a `timed` one's.
 *
 * ══ WHAT STAYS IN THE E2E ══
 *
 * That a real Preferences window can set `error` to `timed`/`30000` and the change reaches the
 * running MAIN window; that a REAL error notice (a project pointed at a folder that does not exist)
 * renders under that mode; and — in the sibling "Dismiss only" test — that a real panel-rename
 * collision through the real daemon raises a real `warning` notice that survives a dismiss click. All
 * of that needs Electron and none of it is repeated here. What moved is only the "…and N seconds
 * later, nothing happened on its own" half of each.
 *
 * ══ ANTI-VACUITY ══
 *
 * Every "still present" assertion below sits beside the notice having been observed present FIRST, so
 * an unrendered DOM cannot satisfy it. And the `timed` case also proves the POSITIVE half: advance
 * PAST the real timeout and the same notice IS gone. A test asserting survival alone could pass
 * against a provider that armed no timer for ANY mode — a worse bug than the one #224 reported, and
 * silently green.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DisplayMode } from '@throng/core';
import {
  NotificationProvider,
  useNotify,
  type NoticeInput,
} from '../../src/renderer/common/notification.js';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';

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
  // Each test switches to fake timers itself, after its own `mount()` — see there for why.
  vi.useRealTimers();
});

interface Probe {
  notify?: (input: NoticeInput) => void;
  loaded?: boolean;
}

function ProbeView({ into }: { into: Probe }): ReactElement | null {
  into.notify = useNotify().notify;
  into.loaded = useConfigLoaded();
  return null;
}

/** Seed one severity's mode/duration before mounting — the config-root equivalent of a slider drag. */
function withMode(severity: 'error' | 'warning', mode: DisplayMode, timeoutMs: number): void {
  settingsPayload = { version: 1, notifications: { [severity]: { mode, timeoutMs } } };
}

/**
 * Mount over the real config store and wait for the seed to land — with REAL timers still active.
 * `useConfigLoaded` resolves through `ConfigProvider`'s own promise chain, and fake time would never
 * advance a microtask queue nothing is pumping; each test switches the clock over itself, immediately
 * before it raises the notice it is timing.
 */
async function mount(): Promise<Probe> {
  const probe: Probe = {};
  render(
    createElement(
      ConfigProvider,
      null,
      createElement(
        NotificationProvider,
        null,
        createElement(ProbeView, { into: probe, key: 'probe' }),
      ),
    ),
  );
  await waitFor(() => {
    expect(probe.loaded, 'the seeded settings never reached the config store').toBe(true);
  });
  return probe;
}

/** A minimal, valid raise — the content is not what either test is about. */
const RAISE: Omit<NoticeInput, 'severity'> = {
  message: 'Something happened.',
  subject: { kind: 'folder', name: 'x' },
  testId: 'probe-notice',
};

describe('a Display For notice leaves at its own number, and not before (FR-004, FR-012)', () => {
  it('is still present just short of its timeout, and gone once the timeout elapses', async () => {
    const LONG_MS = 30_000; // notification-prefs.e2e.ts's LONG_MS — the ceiling of the allowed range
    const STILL_UP_AFTER = 15_000; // notification-prefs.e2e.ts's own margin under it
    withMode('error', 'timed', LONG_MS);
    const probe = await mount();

    vi.useFakeTimers();
    act(() => probe.notify!({ severity: 'error', ...RAISE }));
    expect(screen.getByTestId('probe-notice')).toBeVisible();

    act(() => {
      vi.advanceTimersByTime(STILL_UP_AFTER);
    });
    expect(
      screen.queryByTestId('probe-notice'),
      `a ${LONG_MS} ms notice left within ${STILL_UP_AFTER} ms — the timer is not the user's number`,
    ).not.toBeNull();

    // The positive half no E2E run ever proved on this control: advance PAST the real duration and
    // the same notice IS gone, on the user's own clock rather than a hardcoded one.
    act(() => {
      vi.advanceTimersByTime(LONG_MS - STILL_UP_AFTER);
    });
    expect(screen.queryByTestId('probe-notice')).toBeNull();
  });
});

describe('Dismiss only never arms a timer, whatever the severity (FR-012)', () => {
  it('is still present an hour later — long past the pre-030 hardcoded 5000 ms', async () => {
    withMode('warning', 'dismiss', 5000);
    const probe = await mount();

    vi.useFakeTimers();
    act(() => probe.notify!({ severity: 'warning', ...RAISE }));
    expect(screen.getByTestId('probe-notice')).toBeVisible();

    // A fake clock can do what the E2E's 7000 ms could only gesture at: prove there is no duration,
    // not merely a duration longer than the one it happened to wait.
    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1000);
    });
    expect(screen.getByTestId('probe-notice')).toBeVisible();
  });
});
