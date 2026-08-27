/**
 * 041 US2 (#328) — A REPEAT MAKES THE NOTICE LOUDER, NOT LONGER.
 *
 * ══ THE DEFECT ══
 *
 * Open a file throng will not open, three times, and the notice grew a third identical row: same
 * panel, same path, same reason. The list got longer for exactly as long as the user had not
 * understood the first row. 030 FR-037a already forbade it — "MUST NOT repeat panels the earlier
 * notice already reported" — and the model already DETECTED the repeat; it just did nothing with it.
 *
 * Two sites returned silently, and they are the same decision at two scales:
 *
 *   • `mergeAffected` returned the original array — a casualty already listed reported again.
 *   • the duplicate check matched — an identical notice raised again.
 *
 * Both now flash. Which is the whole of 041 FR-008: the model had the information all along and threw
 * it away, so the user re-triggering a condition got silence and concluded nothing had registered.
 *
 * ══ WHAT A FLASH IS, EXACTLY (FR-008a) ══
 *
 * Two effects and no others: pulse the card, and restart that notice's dismissal timer. Nothing is
 * added, nothing changes, and NO REPEAT COUNT is rendered (FR-008d) — a count is a new element inside
 * a height-bounded list and nobody asked for one.
 *
 * The timer restart is not decoration. It is what stops a notice expiring while the user is still
 * producing the condition it reports (FR-008b), which is the case where the silence was worst: the
 * notice vanished mid-retry and the next attempt raised a fresh one.
 *
 * ══ WHY THESE ASSERTIONS AND NOT PRETTIER ONES ══
 *
 * jsdom applies no stylesheet and performs no layout, so "the card visibly pulses" and "the list did
 * not move" are not observable here and a test claiming them would pass vacuously. What IS observable
 * is the pulse STATE (FR-008aa requires it to have a start and an end for exactly this reason),
 * `scrollTop`, `document.activeElement`, and the rendered row sequence. Those are what this file
 * asserts; the animation itself is a stylesheet decision like every other.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AffectedCasualty, DisplayMode } from '@throng/core';
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
    notices: { log: (record: unknown) => logged.push(record) },
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

function withMode(severity: 'error' | 'warning', mode: DisplayMode, timeoutMs: number): void {
  settingsPayload = { version: 1, notifications: { [severity]: { mode, timeoutMs } } };
}

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

const TEST_ID = 'probe-notice';

/** A refused open: a casualty with NO panel, which is what #327's fix leaves behind. */
function refused(subject: string, reason = 'too-large'): AffectedCasualty {
  return { subject, reason, displayPath: subject, detail: `D:\\proj\\${subject} (${reason})` };
}

/** One raise of the same cause, so every call below is the SAME notice growing or repeating. */
function raise(affected: AffectedCasualty[]): NoticeInput {
  return {
    severity: 'error',
    message: 'That file is too large to open in an editor.',
    subject: { kind: 'project', name: 'Proj' },
    testId: TEST_ID,
    groupKey: 'op:one::p1',
    affected,
  };
}

/** Is the notice currently pulsing? The state FR-008aa requires to have a start and an end. */
function pulsing(): boolean {
  return screen.getByTestId(TEST_ID).getAttribute('data-pulsing') === 'true';
}

function rowLabels(): string[] {
  return screen.queryAllByTestId('notice-affected-row').map((el) => el.textContent ?? '');
}

describe('a repeat of a listed casualty flashes rather than appending (FR-008, FR-009)', () => {
  it('leaves the row count unchanged and pulses the card', async () => {
    withMode('error', 'timed', 30_000);
    const probe = await mount();
    vi.useFakeTimers();

    act(() => probe.notify!(raise([refused('big.bin')])));
    expect(rowLabels()).toHaveLength(1);

    act(() => probe.notify!(raise([refused('big.bin')])));

    expect(rowLabels(), 'the repeat appended a row instead of flashing').toHaveLength(1);
    expect(pulsing(), 'the repeat was absorbed silently — the user got no signal at all').toBe(true);
  });

  it('raises no second notice for the repeat', async () => {
    withMode('error', 'timed', 30_000);
    const probe = await mount();
    vi.useFakeTimers();

    act(() => probe.notify!(raise([refused('big.bin')])));
    act(() => probe.notify!(raise([refused('big.bin')])));

    expect(screen.queryAllByTestId(TEST_ID)).toHaveLength(1);
  });

  it('renders no repeat count on the row (FR-008d)', async () => {
    withMode('error', 'timed', 30_000);
    const probe = await mount();
    vi.useFakeTimers();

    act(() => probe.notify!(raise([refused('big.bin')])));
    const before = rowLabels()[0];
    act(() => probe.notify!(raise([refused('big.bin')])));
    act(() => probe.notify!(raise([refused('big.bin')])));

    expect(rowLabels()[0], 'the row grew a count — the pulse is the signal').toBe(before);
  });

  it('still ADDS a genuinely new casualty rather than flashing (030 FR-037)', async () => {
    // The control. A flash that swallowed new casualties would "fix" #328 by breaking the thing
    // consolidation exists for — a notice that hides what it speaks for.
    withMode('error', 'timed', 30_000);
    const probe = await mount();
    vi.useFakeTimers();

    act(() => probe.notify!(raise([refused('big.bin')])));
    act(() => probe.notify!(raise([refused('other.bin')])));

    expect(rowLabels()).toHaveLength(2);
  });
});

describe('the flash restarts the dismissal timer (FR-008b, SC-005a)', () => {
  it('keeps a re-triggered notice on screen past its own timeout', async () => {
    // SC-005a exactly: five repeats spaced at half the timeout. Today the notice expires mid-sequence
    // and the sixth attempt raises a fresh one — so the user re-triggering a condition watches the
    // report vanish underneath them.
    const TIMEOUT = 10_000;
    withMode('error', 'timed', TIMEOUT);
    const probe = await mount();
    vi.useFakeTimers();

    act(() => probe.notify!(raise([refused('big.bin')])));
    for (let i = 0; i < 5; i += 1) {
      act(() => {
        vi.advanceTimersByTime(TIMEOUT / 2);
      });
      act(() => probe.notify!(raise([refused('big.bin')])));
    }

    expect(
      screen.queryByTestId(TEST_ID),
      'the notice expired while the user was still producing the condition it reports',
    ).not.toBeNull();

    // …and the positive half: left alone, it still goes. A test asserting survival alone would pass
    // against a provider that had stopped arming any timer at all.
    act(() => {
      vi.advanceTimersByTime(TIMEOUT);
    });
    expect(screen.queryByTestId(TEST_ID)).toBeNull();
  });
});

describe('display modes (FR-008c)', () => {
  it('pulses a Dismiss-only notice and leaves it standing — there is no timer to restart', async () => {
    withMode('error', 'dismiss', 10_000);
    const probe = await mount();
    vi.useFakeTimers();

    act(() => probe.notify!(raise([refused('big.bin')])));
    act(() => probe.notify!(raise([refused('big.bin')])));

    expect(pulsing()).toBe(true);
    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1000);
    });
    expect(screen.queryByTestId(TEST_ID), 'a Dismiss-only notice armed a timer').not.toBeNull();
  });

  it('neither raises nor pulses a Never-display notice, but still logs it', async () => {
    withMode('error', 'never', 10_000);
    const probe = await mount();

    act(() => probe.notify!(raise([refused('big.bin')])));

    expect(screen.queryByTestId(TEST_ID)).toBeNull();
    expect(logged.length, 'silence on screen became silence in the record').toBeGreaterThan(0);
  });
});

describe('absorption — repeats during a running pulse (FR-008e)', () => {
  it('does not queue a second pulse, and still restarts the timer', async () => {
    // A watcher re-firing, or a user holding the open action. A queue of pulses would make the notice
    // twitch for as long as they kept trying; the pulse is a signal that the condition recurred, not
    // a counter.
    const TIMEOUT = 10_000;
    withMode('error', 'timed', TIMEOUT);
    const probe = await mount();
    vi.useFakeTimers();

    act(() => probe.notify!(raise([refused('big.bin')])));
    for (let i = 0; i < 10; i += 1) act(() => probe.notify!(raise([refused('big.bin')])));

    expect(pulsing()).toBe(true);
    // One pulse, so ONE pulse-end: after the pulse duration the state is clear, not still running
    // through nine more queued turns.
    act(() => {
      vi.advanceTimersByTime(TIMEOUT - 1);
    });
    expect(pulsing(), 'the pulses queued — ten repeats produced ten turns').toBe(false);
    expect(screen.queryByTestId(TEST_ID), 'the absorbed repeats did not restart the timer').not.toBeNull();
  });
});

describe('the flash moves nothing (FR-010)', () => {
  it('leaves scroll position, focus and row order untouched', async () => {
    withMode('error', 'timed', 30_000);
    const probe = await mount();
    vi.useFakeTimers();

    act(() => probe.notify!(raise([refused('a.bin'), refused('b.bin'), refused('c.bin')])));
    const list = screen.getByTestId('notice-affected');
    list.scrollTop = 24;
    (screen.getByTestId(TEST_ID).querySelector('[tabindex]') as HTMLElement | null)?.focus();
    const focusedBefore = document.activeElement;
    const orderBefore = rowLabels();

    act(() => probe.notify!(raise([refused('a.bin')])));

    expect(list.scrollTop, 'the flash scrolled the list under the reader').toBe(24);
    expect(document.activeElement, 'the flash stole focus').toBe(focusedBefore);
    expect(rowLabels(), 'the flash reordered the list').toEqual(orderBefore);
  });
});

describe('suppression is scoped to the LIVE notice (FR-012)', () => {
  it('raises a fresh notice once the first has gone', async () => {
    const TIMEOUT = 10_000;
    withMode('error', 'timed', TIMEOUT);
    const probe = await mount();
    vi.useFakeTimers();

    act(() => probe.notify!(raise([refused('big.bin')])));
    act(() => {
      vi.advanceTimersByTime(TIMEOUT + 1);
    });
    expect(screen.queryByTestId(TEST_ID)).toBeNull();

    act(() => probe.notify!(raise([refused('big.bin')])));

    expect(
      screen.queryByTestId(TEST_ID),
      'suppression outlived the notice it was scoped to — the condition can never be reported again',
    ).not.toBeNull();
  });
});
