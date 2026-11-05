import { act, render, screen } from '@testing-library/react';
import { createElement, Fragment } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttentionMark } from '../../src/renderer/attention/attention-mark.js';

/**
 * 057 FR-093a — a mark blinks by stepping, never by a CSS animation.
 *
 * Layer: component. The timer, the attribute and the stylesheet are all a DOM can see. What the step
 * SAVES (one frame a second against every frame the display offers) is a rendering cost only a real
 * window shows; it was measured by hand and is recorded in the commit.
 *
 * ANTI-VACUITY CONTROL: never clear the interval and the "no timer" test fails; ignore the media query and
 * the reduced-motion test fails. The stylesheet half is `attention-mark-css.test.ts`.
 */

const MARK = { kind: 'attention' as const, label: 'Build: Bell (Attention)', count: 1 };
const DIM = 'data-blink-dim';

function mountMarks(...testIds: string[]) {
  return render(
    createElement(
      Fragment,
      null,
      testIds.map((testId) => createElement(AttentionMark, { key: testId, mark: MARK, testId })),
    ),
  );
}

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AttentionMark blink (057 FR-093, FR-093a)', () => {
  it('holds each half of the 2 s cycle for a second', () => {
    mountMarks('a');
    const el = screen.getByTestId('a');
    expect(el).not.toHaveAttribute(DIM);
    advance(999);
    expect(el).not.toHaveAttribute(DIM);
    advance(1);
    expect(el).toHaveAttribute(DIM);
    advance(1000);
    expect(el).not.toHaveAttribute(DIM);
  });

  it('keeps every holder in step, including one that appears mid-cycle', () => {
    const first = mountMarks('a');
    advance(1000);
    render(createElement(AttentionMark, { mark: MARK, testId: 'b' }));
    expect(screen.getByTestId('b')).toHaveAttribute(DIM);
    advance(1000);
    expect(screen.getByTestId('a')).not.toHaveAttribute(DIM);
    expect(screen.getByTestId('b')).not.toHaveAttribute(DIM);
    first.unmount();
  });

  it('runs no timer once no mark is left', () => {
    const { unmount } = mountMarks('a', 'b');
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stays still at full opacity under reduced motion (FR-093)', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduced-motion') }));
    mountMarks('a');
    advance(3000);
    expect(screen.getByTestId('a')).not.toHaveAttribute(DIM);
  });

  it('still hands its element to a caller ref', () => {
    const ref = { current: null as HTMLSpanElement | null };
    render(createElement(AttentionMark, { mark: MARK, testId: 'a', ref }));
    expect(ref.current).toBe(screen.getByTestId('a'));
  });
});
