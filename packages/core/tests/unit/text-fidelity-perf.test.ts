import { describe, it, expect } from 'vitest';
import { readText, encode } from '../../src/editor/text-fidelity.js';
import { utf16, concat, BOM_UTF16LE } from '../fixtures/text-formats.js';

/**
 * 059 SC-005 — a 5 MB open in any supported encoding costs no more than 2× the same content as UTF-8.
 *
 * Measured over the whole read path a file open runs (`readText`: detection plus the decode), as a
 * RATIO to UTF-8 on the same machine in the same run, so a slow CI runner moves both sides and the
 * assertion stays about the encodings rather than the hardware. Each round times both sides back to
 * back, in alternating order, and the claim is the MEDIAN of the per-round ratios: a burst of load from
 * a neighbouring worker spoils one round rather than deciding the result, and no single lucky UTF-8
 * read sets the baseline — the best-of-nine of each side it replaced failed hosted runners at 1.51–1.72×
 * on whichever encoding drew the outlier.
 */
const LINE = 'The quick brown fox jumps over the lazy dog, 0123456789 — café £5.\n';
const TEXT = LINE.repeat(Math.ceil((5 * 1024 * 1024) / LINE.length));
const ROUNDS = 15;
/** Reads per sample when only wall time is available; see {@link time}. */
const WALL_TRIES = 3;

const threadCpu = (process as { threadCpuUsage?: () => { user: number; system: number } }).threadCpuUsage;

/** This thread's CPU time in ms, or `null` on a Node without `threadCpuUsage`. */
function cpuNow(): number | null {
  if (typeof threadCpu !== 'function') return null;
  const u = threadCpu.call(process);
  return (u.user + u.system) / 1000;
}

/** The thread CPU clock's smallest step in ms: microseconds on most systems, a clock tick (about 15.6 ms) on some. */
function cpuClockStep(): number {
  const first = cpuNow();
  if (first === null) return Number.POSITIVE_INFINITY;
  let next = first;
  while (next === first) next = cpuNow()!;
  return next - first;
}

/** Fine enough to time one read: well under the few milliseconds a 5 MB read takes. */
const CPU_CLOCK_IS_FINE = cpuClockStep() < 1;

/**
 * One read's cost in milliseconds of THIS thread's CPU time. Wall time also counted the time the thread spent
 * waiting for a core, which a parallel unit run hands out unevenly between the two sides of a round: the median
 * ratio still read 2.0x+ for Windows-1252 on a loaded workstation while it read well under it alone. A clock that
 * steps in ticks coarser than a read (Windows) keeps wall time, as does a Node without `threadCpuUsage`.
 */
function time(fn: () => void): number {
  if (!CPU_CLOCK_IS_FINE) {
    // Wall time counts every preemption, so a side's sample is the fastest of WALL_TRIES back-to-back reads: a read
    // the scheduler interrupted is discarded rather than deciding its round, and a cost the read always pays is still
    // in every try. One preempted read was enough to put UTF-16 BE, whose ICU decode sits nearest the bound, at 2.14×
    // in a parallel Windows unit run.
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < WALL_TRIES; i++) {
      const t = performance.now();
      fn();
      best = Math.min(best, performance.now() - t);
    }
    return best;
  }
  const before = cpuNow()!;
  fn();
  return cpuNow()! - before;
}

/** Median over `rounds` rounds of `cost / base`, the two timed back to back in alternating order. */
function medianRatio(rounds: number, base: () => void, cost: () => void): number {
  const ratios: number[] = [];
  for (let i = 0; i < rounds; i++) {
    let b: number;
    let c: number;
    if (i % 2 === 0) {
      b = time(base);
      c = time(cost);
    } else {
      c = time(cost);
      b = time(base);
    }
    ratios.push(c / b);
  }
  ratios.sort((x, y) => x - y);
  return ratios[Math.floor(rounds / 2)] as number;
}

describe('5 MB read cost by encoding (059 SC-005)', { tags: ['regression'] }, () => {
  const utf8Bytes = new TextEncoder().encode(TEXT);
  // Held to 2×, amended 2026-10-30: on hosted runners the platform decoders alone measured 1.55–1.72× its
  // UTF-8 one for Windows-1252 and 1.51× for UTF-16, as the median of fifteen interleaved rounds.
  const cases: [string, Uint8Array, number][] = [
    ['UTF-16 LE + BOM', concat(BOM_UTF16LE, utf16(TEXT, 'le')), 2],
    ['UTF-16 BE, no BOM', utf16(TEXT, 'be'), 2],
    ['Windows-1252', encode(TEXT, { encoding: 'windows1252', hasBom: false, lineEnding: 'lf' }), 2],
  ];

  it('the UTF-8 baseline reads as UTF-8', () => {
    expect(readText(utf8Bytes)).toMatchObject({ ok: true, file: { encoding: 'utf8' } });
  });

  for (const [name, bytes, bound] of cases) {
    it(`${name} is within ${bound}× of UTF-8`, () => {
      const r = readText(bytes);
      expect(r.ok && r.file.text.length).toBe(TEXT.length);
      const ratio = medianRatio(
        ROUNDS,
        () => readText(utf8Bytes),
        () => readText(bytes),
      );
      expect(ratio).toBeLessThanOrEqual(bound);
    });
  }
});
