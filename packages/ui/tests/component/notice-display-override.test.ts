/**
 * 043 T201 / FR-082a — a notice may carry ITS OWN display mode and timeout, and the provider honours
 * it in preference to the severity-keyed global.
 *
 * ══ WHAT DOES NOT EXIST BEFORE THIS ══
 *
 * A raiser can state a severity and nothing else. `NotificationProvider.notify` resolves the mode and
 * the duration from `notifications.<severity>` alone, so there is no way for one notice to be timed
 * while every other notice of that severity waits to be dismissed. FR-082 needs exactly that, for one
 * notice — the Find in Files replace summary — and FR-082a is the widening of the app-wide contract
 * that makes it expressible. `specs/030-failure-presentation/contracts/notice-api.md` is where the
 * contract lives and is amended in the same change.
 *
 * ══ WHY THE COMPONENT TIER ══
 *
 * The claim is entirely about `notify` deciding whether to call `setTimeout(() => dismiss(id), …)`,
 * and with what number — the same decision the E2E notification-prefs sleeps observed in real time
 * (`notice-dismissal-timer.test.ts` was merged into this file's FR-082a block). There is no window, no daemon and no rendering in it; a fake clock proves in
 * microseconds what a real one needed seconds of sleeping to observe. The file follows that one's
 * arrangement exactly, including mounting over the REAL config store so the "global" half of every
 * comparison is a genuine settings document rather than a stub.
 *
 * ══ THE ASSERTION THAT MATTERS MOST IS THE ONE ABOUT EVERY OTHER NOTICE ══
 *
 * This widens a contract every notice in the application passes through. So the last group here is
 * not about the override at all: it raises a notice with NO override under two different global
 * settings and asserts each behaves exactly as it does today. A regression there reaches every
 * failure report in the app, and it would not be visible in any test of the new field.
 *
 * ══ ANTI-VACUITY ══
 *
 * Every "still present" assertion sits beside the same notice having been observed present first, and
 * every override test sets the GLOBAL to the opposite behaviour — so a provider that ignored the
 * override entirely fails, and so does one that ignored the global entirely.
 */
import { act, render, screen } from '@testing-library/react';
import { flushUntil } from './helpers/flush-until.js';
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
let logged: unknown[] = [];

beforeEach(() => {
  settingsPayload = { version: 1 };
  logged = [];
  (window as unknown as { throng: unknown }).throng = {
    notices: {
      log: (record: unknown) => {
        logged.push(record);
      },
    },
    config: { get: () => Promise.resolve({ settings: settingsPayload }) },
  };
});

afterEach(() => {
  delete (window as unknown as { throng?: unknown }).throng;
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

/** Seed one severity's GLOBAL mode and the global toast duration before mounting — what the override has to beat. */
function withGlobal(severity: 'error' | 'warning' | 'success', mode: DisplayMode, toastDurationMs: number): void {
  settingsPayload = { version: 1, notifications: { [severity]: { mode }, toastDurationMs } };
}

/**
 * Mount over the real config store and wait for the seed to land, with REAL timers still running —
 * `useConfigLoaded` settles through a promise chain that fake time would never pump. Each test
 * switches the clock over itself, immediately before the raise it is timing.
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
  await flushUntil(() => probe.loaded === true);
  return probe;
}

/** A minimal, valid raise — the content is not what any of this is about. */
const RAISE: Omit<NoticeInput, 'severity'> = {
  message: 'Something happened.',
  subject: { kind: 'folder', name: 'x' },
  testId: 'probe-notice',
};

/*
 * 068 FR-021: a notice's own display now carries the MODE only; the toast duration is the one global
 * number, so what an override can change is whether the notice shows at all, and whether it is kept in
 * the Notifications panel. The tests below keep FR-082a's two halves: the override beats the severity,
 * and a notice with no override behaves as its severity says.
 */
describe('a notice carrying its own display beats the severity-keyed global (FR-082a)', () => {
  it('is displayed on the override alone while its severity says never', async () => {
    withGlobal('error', 'never', 3000);
    const probe = await mount();

    vi.useFakeTimers();
    act(() => probe.notify!({ severity: 'error', ...RAISE, display: { toast: true, panel: true } }));
    expect(screen.getByTestId('probe-notice')).toBeVisible();

    // It is a toast like any other: it leaves after the one global duration.
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(screen.queryByTestId('probe-notice')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByTestId('probe-notice')).toBeNull();
  });

  it('is NEVER displayed on the override alone — and still writes its log record', async () => {
    // *Never display* is offerable at all only because silence on screen is not silence in the
    // record (030 FR-005/FR-006). An override that silenced the notice AND the log would be taking
    // away the thing that makes the choice offerable.
    withGlobal('warning', 'panel', 5000);
    const probe = await mount();

    act(() => probe.notify!({ severity: 'warning', ...RAISE, display: { toast: false, panel: false } }));

    expect(screen.queryByTestId('probe-notice')).toBeNull();
    expect(logged, 'a silenced notice must still reach the diagnostic log').toHaveLength(1);
  });
});

describe('a notice with NO override behaves exactly as its severity says (FR-082a)', () => {
  it('is not displayed when its severity says never', async () => {
    withGlobal('success', 'never', 3000);
    const probe = await mount();
    act(() => probe.notify!({ severity: 'success', ...RAISE }));
    expect(screen.queryByTestId('probe-notice')).toBeNull();
  });

  it('leaves after the global toast duration, whatever its severity’s mode', async () => {
    withGlobal('success', 'toast', 8000);
    const probe = await mount();

    vi.useFakeTimers();
    act(() => probe.notify!({ severity: 'success', ...RAISE }));
    expect(screen.getByTestId('probe-notice')).toBeVisible();

    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(screen.queryByTestId('probe-notice')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByTestId('probe-notice')).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * 043 T239, reshaped by 068 — a REPEATED notice restarts the global duration
 *
 * A repeat is absorbed into the card already up, and `flash()` re-arms that card's timer. It must
 * restart the FULL global duration (the per-notice dwell of T239 went with the per-notice timeout).
 * ────────────────────────────────────────────────────────────────────────── */

describe('a repeated notice re-arms the full global duration (T239)', () => {
  it('keeps the card for a whole new duration when an identical notice arrives', async () => {
    withGlobal('success', 'toast', 10_000);
    const probe = await mount();

    vi.useFakeTimers();
    const raise = (): void => probe.notify!({ severity: 'success', ...RAISE, display: { toast: true, panel: false } });
    act(() => raise());
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    // The repeat — absorbed into the same card, which re-arms its timer.
    act(() => raise());

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(
      screen.queryByTestId('probe-notice'),
      'the repeat did not restart the clock: 12 s of a 10 s duration have passed in total',
    ).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId('probe-notice')).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * 043 T237 (FR-058, SC-008) — a notice whose DETAILS differ is a different notice
 *
 * The duplicate rule compared what a notice says — severity, message, title, action, test id,
 * subject — but not its `details`. A replace summary's headline is built from counts alone, so two
 * commits touching different files with the same counts ("1 of 1 files changed …") read as one
 * notice raised twice: the second only pulsed the first card, its own file list was never shown, and
 * its log record was never written. The rule's own comment states the principle this restores —
 * "identical content is one event seen twice; different content is two events".
 * ────────────────────────────────────────────────────────────────────────── */

describe('a notice with different details is not a duplicate (T237)', () => {
  it('raises a SECOND card when only the details differ, and logs both', async () => {
    withGlobal('success', 'panel', 5000);
    const probe = await mount();

    act(() => probe.notify!({ severity: 'success', ...RAISE, details: ['src/a.ts'] }));
    act(() => probe.notify!({ severity: 'success', ...RAISE, details: ['src/b.ts'] }));

    const cards = screen.getAllByTestId('probe-notice');
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.textContent ?? '').join(' ')).toContain('src/b.ts');
    expect(logged).toHaveLength(2);
  });

  it('still collapses a notice raised again with IDENTICAL details — one event seen twice', async () => {
    // The half that must not regress: a watcher re-reporting one unchanged failure, file list and
    // all, is exactly what the duplicate rule exists to keep from stacking.
    withGlobal('success', 'panel', 5000);
    const probe = await mount();

    act(() => probe.notify!({ severity: 'success', ...RAISE, details: ['src/a.ts'] }));
    act(() => probe.notify!({ severity: 'success', ...RAISE, details: ['src/a.ts'] }));

    expect(screen.getAllByTestId('probe-notice')).toHaveLength(1);
  });
});
