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
 * Layer: unit — detection is a pure function of the line. The bound is a RATIO of two scans timed the same way: each
 * side is this thread's CPU time, the fastest of six passes. The passes ALTERNATE nested and flat, so a slow spell on a
 * shared runner lands on both sides alike. Timed one side after the other, it can land on one side only: CI read 2.12
 * (PR #709's ready run, 0.536 ms nested against 0.252 ms flat) where this machine reads 1.25 to 1.27 every time
 * interleaved and 1.13 to 1.34 back to back. The defect this guards read 7.7.
 *
 * Each pass runs scans until the clock has moved SAMPLE_MS, never a fixed count: Windows reports thread CPU time in
 * ~15.6 ms ticks, so a fixed 40 flat scans (about 1 ms of work) read as 0 ms there and the ratio as Infinity
 * (pipeline 44889368543). Measured over at least 200 ms, a tick is under 8% of one pass.
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
const PASSES = 6;
function onePass(line: string): number {
  const started = cpuMs();
  let runs = 0;
  let elapsed = 0;
  while (elapsed < SAMPLE_MS) {
    for (let r = 0; r < 20; r += 1) detectPathCandidates(line, []);
    runs += 20;
    elapsed = cpuMs() - started;
  }
  return elapsed / runs;
}
/** The fastest pass of each line, the two lines' passes alternating. */
function msPerScan(): { nested: number; flat: number } {
  let nested = Number.POSITIVE_INFINITY;
  let flat = Number.POSITIVE_INFINITY;
  for (let pass = 0; pass < PASSES; pass += 1) {
    nested = Math.min(nested, onePass(NESTED));
    flat = Math.min(flat, onePass(FLAT));
  }
  return { nested, flat };
}

describe('path detection on a line of nested brackets (045 FR-188f, Principle XII)', () => {
  it('finds no path in a JSON document, and costs no more than twice the same characters without brackets', () => {
    expect(NESTED.length).toBeGreaterThan(1500);
    expect(detectPathCandidates(NESTED, [])).toEqual([]);
    onePass(NESTED); // warm the JIT
    onePass(FLAT);
    const { nested, flat } = msPerScan();
    // A zero would make the ratio Infinity (or NaN), whatever the scan cost: the clock, not the code.
    expect(flat, 'the flat scan measured as no time at all').toBeGreaterThan(0);
    expect(nested / flat, `nested ${nested.toFixed(3)} ms, flat ${flat.toFixed(3)} ms per scan`).toBeLessThanOrEqual(2);
  });
});
