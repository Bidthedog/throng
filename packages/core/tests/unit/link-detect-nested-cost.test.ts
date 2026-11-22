import { describe, expect, it } from 'vitest';
import { detectPathCandidates } from '../../src/links/detect.js';

/*
 * 045 FR-002 / FR-073, Principle XII — an editor rescans every visible line for links on each viewport change, so a
 * line's scan has to cost about what its length costs. The maintainer's linked CSV pair (2026-11-21) lagged on a CSV
 * whose every record holds a ~2 KB JSON document: with editor word wrap off, every frame of a synced scroll spent
 * 230 long tasks of up to 340 ms in this scan. A line of nested brackets cost 7.7 times the same characters without
 * them, because each bracket pair re-scanned its whole contents for FR-188f's quoted-sentence rule — before asking
 * whether the contents read as a path at all, which a JSON object never does.
 *
 * Layer: unit — detection is a pure function of the line. The bound is a RATIO of two scans timed the same way, so a
 * busy machine slows both sides alike: each side is this thread's CPU time, the fastest of three passes.
 *
 * Each pass runs scans until the clock has moved SAMPLE_MS, never a fixed count: Windows reports thread CPU time in
 * ~15.6 ms ticks, so a fixed 40 flat scans (about 1 ms of work) read as 0 ms there and the ratio as Infinity
 * (pipeline 44889368543). Measured over at least 200 ms, a tick is under 8% of either side.
 */
const record = (i: number): string =>
  `{ ""k"": ${i}, ""v"": ""quokka dolor aliqua labore ${i}"", ""n"": 0.${(i * 7919) % 10_000}, ""tags"": [ ""a"", ""b"" ] }`;
/** One CSV record like the reported file's: an id, a name, and a quoted JSON document of about 2 KB. */
const NESTED = `1,do,"{ ""id"": 1, ""items"": [ ${Array.from({ length: 18 }, (_, i) => record(i)).join(', ')} ] }"`;
/** The same characters with every bracket a space: the cost of the line's length alone. */
const FLAT = NESTED.replace(/[[\]{}()<>]/g, ' ');

const cpuMs = (): number => {
  const u = typeof process.threadCpuUsage === 'function' ? process.threadCpuUsage() : null;
  return u ? (u.user + u.system) / 1000 : performance.now();
};
const SAMPLE_MS = 200;
function msPerScan(line: string): number {
  let best = Number.POSITIVE_INFINITY;
  for (let sample = 0; sample < 3; sample += 1) {
    const started = cpuMs();
    let runs = 0;
    let elapsed = 0;
    while (elapsed < SAMPLE_MS) {
      for (let r = 0; r < 20; r += 1) detectPathCandidates(line, []);
      runs += 20;
      elapsed = cpuMs() - started;
    }
    best = Math.min(best, elapsed / runs);
  }
  return best;
}

describe('path detection on a line of nested brackets (045 FR-188f, Principle XII)', () => {
  it('finds no path in a JSON document, and costs no more than twice the same characters without brackets', () => {
    expect(NESTED.length).toBeGreaterThan(1500);
    expect(detectPathCandidates(NESTED, [])).toEqual([]);
    msPerScan(NESTED); // warm the JIT
    msPerScan(FLAT);
    const nested = msPerScan(NESTED);
    const flat = msPerScan(FLAT);
    // A zero would make the ratio Infinity (or NaN), whatever the scan cost: the clock, not the code.
    expect(flat, 'the flat scan measured as no time at all').toBeGreaterThan(0);
    expect(nested / flat, `nested ${nested.toFixed(3)} ms, flat ${flat.toFixed(3)} ms per scan`).toBeLessThanOrEqual(2);
  });
});
