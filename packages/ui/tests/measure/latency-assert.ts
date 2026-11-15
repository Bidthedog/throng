/**
 * 070 FR-050, SC-012, research R28 — what `THRONG_MEASURE_ASSERT_P95_MS` asks of terminal-load.measure.ts.
 *
 * Unset (the default, and every lane before 070), the measurement asserts nothing and only prints. Set, it fails when
 * the visible terminal's keystroke echo exceeds the ceiling at the 95th percentile. There is no macOS reference
 * hardware, so the gate's macOS lane asserts it on the hosted Mac itself (`THRONG_MEASURE_ASSERT_P95_MS=100`).
 *
 * @param ceiling the variable's value
 * @param echoes every echo latency measured, in ms
 * @param p95 their 95th percentile, in ms
 * @returns why the run fails, or `null`
 */
export function latencyFailure(ceiling: string | undefined, echoes: readonly number[], p95: number): string | null {
  if (ceiling === undefined || ceiling.trim() === '') return null;
  const limit = Number(ceiling);
  if (!Number.isFinite(limit) || limit <= 0) {
    return `THRONG_MEASURE_ASSERT_P95_MS must be a positive number of milliseconds, not '${ceiling}'`;
  }
  // A visible emitter (THRONG_MEASURE_VISIBLE_BUSY) leaves no echo to time; a p95 of nothing is not under any ceiling.
  if (echoes.length === 0) return 'no keystroke echo was measured, so there is no p95 to hold to the ceiling';
  if (p95 > limit) return `typing echo p95 was ${p95} ms, over the ${limit} ms ceiling (THRONG_MEASURE_ASSERT_P95_MS)`;
  return null;
}
