import { describe, expect, it } from 'vitest';

import { latencyFailure } from '../measure/latency-assert.js';

/**
 * 070 FR-050, SC-012, research R28 — the gate's macOS lane fails when typing in the visible terminal, with 10 others
 * busy, takes over 100 ms at the 95th percentile. The measurement prints its figures either way; this is the decision
 * it then asserts. Unset, the measurement stays a measurement, as it was (061 FR-060).
 *
 * Layer: unit — a pure decision over the measured figures.
 */

describe('THRONG_MEASURE_ASSERT_P95_MS (FR-050)', () => {
  const echoes = [10, 12, 15, 40];

  it('asserts nothing when it is not set', () => {
    expect(latencyFailure(undefined, echoes, 500)).toBeNull();
    expect(latencyFailure('', echoes, 500)).toBeNull();
  });

  it('passes at or under the ceiling', () => {
    expect(latencyFailure('100', echoes, 99)).toBeNull();
    expect(latencyFailure('100', echoes, 100)).toBeNull();
  });

  it('fails over the ceiling, saying both numbers', () => {
    expect(latencyFailure('100', echoes, 101)).toBe('typing echo p95 was 101 ms, over the 100 ms ceiling (THRONG_MEASURE_ASSERT_P95_MS)');
  });

  it('fails when nothing was measured, rather than passing a p95 of nothing', () => {
    expect(latencyFailure('100', [], 0)).toMatch(/no keystroke echo was measured/);
  });

  it.each(['abc', '0', '-5', '1e999'])('refuses a ceiling of %s instead of reading it as no ceiling', (value) => {
    expect(latencyFailure(value, echoes, 1)).toMatch(/must be a positive number of milliseconds/);
  });
});
