/**
 * 041 FR-011a/FR-011b/FR-011c — WHAT A SCREEN READER HEARS WHEN A CONDITION RECURS.
 *
 * The pulse is a visual-only signal. Without an announcement a screen-reader user who retries a
 * refused open is met with silence and cannot tell whether the retry registered — which is #328's
 * complaint, arriving through the one channel where "the notice got louder" means nothing at all.
 *
 * ══ THE BOUND, AND WHY IT IS THE PULSE RATHER THAN A DURATION ══
 *
 * A polite live region QUEUES rather than interrupts, so an unbounded announcement turns ten rapid
 * retries into ten utterances the user must sit through — the audible form of the row-stacking this
 * feature exists to stop. FR-011c binds it to ONE PER PULSE: a repeat absorbed into a running pulse
 * (FR-008e) is not separately announced.
 *
 * Binding to the pulse rather than to a timing constant is what makes this testable without racing a
 * clock. The assertion is "utterances equal pulses", measured in both directions — rapid repeats give
 * one of each, spaced repeats give N of each — because a bound that only ever suppressed would pass
 * against an implementation that had gone silent altogether, which is the defect FR-011a exists to
 * fix.
 *
 * ══ AND IT MUST NOT RE-READ THE LIST (FR-011b) ══
 *
 * 030 FR-032a exists to stop a notice re-reading itself: a forty-row list read again because one row
 * joined. This announcement names the recurring SUBJECT and says the condition recurred, and nothing
 * more. The separate `announceGrowth` region already handles a notice that genuinely GREW.
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
  notify?: (input: NoticeInput) => void;
  loaded?: boolean;
}

function ProbeView({ into }: { into: Probe }): ReactElement | null {
  into.notify = useNotify().notify;
  into.loaded = useConfigLoaded();
  return null;
}

function withMode(severity: 'error', mode: DisplayMode, timeoutMs: number): void {
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
const PULSE_MS = 600;

function refused(subject: string): AffectedCasualty {
  return { subject, reason: 'too-large', displayPath: subject, detail: `D:\\proj\\${subject}` };
}

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

/** What the repeat live region currently says — empty when it has said nothing. */
function repeatText(): string {
  return screen.getByTestId('notice-repeat-region').textContent ?? '';
}

/**
 * How many times it has spoken.
 *
 * Counted from the region's own sequence rather than by comparing text, because two consecutive
 * repeats of the same subject produce the SAME sentence — so text comparison silently under-counts.
 * The sequence is an attribute precisely so the nonce that makes an identical repeat announce again
 * is not inside the words a screen reader reads out.
 */
function utteranceCount(): number {
  return Number(screen.getByTestId('notice-repeat-region').getAttribute('data-announce-seq') ?? 0);
}

describe('a pure repeat is announced (FR-011a)', () => {
  it('names the recurring subject rather than restating the notice', async () => {
    withMode('error', 'timed', 30_000);
    const probe = await mount();
    vi.useFakeTimers();

    act(() => probe.notify!(raise([refused('big.bin')])));
    expect(repeatText(), 'the FIRST raise is not a repeat and must not announce one').toBe('');

    act(() => probe.notify!(raise([refused('big.bin')])));

    expect(repeatText(), 'the retry was met with silence — the pulse is visual only').not.toBe('');
    expect(repeatText()).toContain('big.bin');
  });

  it('is polite, so it queues behind whatever is being read rather than interrupting', async () => {
    withMode('error', 'timed', 30_000);
    const probe = await mount();
    vi.useFakeTimers();
    act(() => probe.notify!(raise([refused('big.bin')])));

    expect(screen.getByTestId('notice-repeat-region').getAttribute('aria-live')).toBe('polite');
  });
});

describe('it does not re-read the list (FR-011b, 030 FR-032a)', () => {
  it('names the subject and never the other rows', async () => {
    withMode('error', 'timed', 30_000);
    const probe = await mount();
    vi.useFakeTimers();

    act(() => probe.notify!(raise([refused('big.bin'), refused('other.bin'), refused('third.bin')])));
    act(() => probe.notify!(raise([refused('big.bin')])));

    const said = repeatText();
    expect(said).toContain('big.bin');
    expect(said, 'the announcement re-read the casualty list').not.toContain('other.bin');
    expect(said, 'the announcement re-read the casualty list').not.toContain('third.bin');
  });
});

describe('utterances equal pulses (FR-011c, SC-006e)', () => {
  it('says it ONCE for ten repeats inside one pulse', async () => {
    withMode('error', 'timed', 30_000);
    const probe = await mount();
    vi.useFakeTimers();

    act(() => probe.notify!(raise([refused('big.bin')])));
    const before = utteranceCount();
    for (let i = 0; i < 10; i += 1) act(() => probe.notify!(raise([refused('big.bin')])));

    expect(
      utteranceCount() - before,
      'ten rapid retries produced ten queued utterances — the audible form of row-stacking',
    ).toBe(1);
  });

  it('says it EACH TIME when the repeats are spaced beyond the pulse', async () => {
    // The other direction, and the one that matters more: a bound that only ever suppressed would
    // pass against an implementation that had simply gone silent — which is the defect FR-011a fixes.
    withMode('error', 'timed', 30_000);
    const probe = await mount();
    vi.useFakeTimers();

    act(() => probe.notify!(raise([refused('big.bin')])));
    const before = utteranceCount();
    for (let i = 0; i < 3; i += 1) {
      act(() => {
        vi.advanceTimersByTime(PULSE_MS + 50);
      });
      act(() => probe.notify!(raise([refused('big.bin')])));
    }

    expect(utteranceCount() - before, 'a retry after a pause went unannounced').toBe(3);
  });
});
