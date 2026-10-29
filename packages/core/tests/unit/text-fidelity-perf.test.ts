import { describe, it, expect } from 'vitest';
import { readText, encode } from '../../src/editor/text-fidelity.js';
import { utf16, concat, BOM_UTF16LE } from '../fixtures/text-formats.js';

/**
 * 059 SC-005 — a 5 MB open in any encoding costs no more than 1.5× the same content as UTF-8.
 *
 * Measured over the whole read path a file open runs (`readText`: detection plus the decode), as a
 * RATIO to UTF-8 on the same machine in the same run, so a slow CI runner moves both sides and the
 * assertion stays about the encodings rather than the hardware. The two sides are timed INTERLEAVED,
 * one of each per round, and each keeps its best of nine: timed one after the other, a burst of load
 * from a neighbouring worker lands on one side only and decides the ratio by itself.
 */
const LINE = 'The quick brown fox jumps over the lazy dog, 0123456789 — café £5.\n';
const TEXT = LINE.repeat(Math.ceil((5 * 1024 * 1024) / LINE.length));
const ROUNDS = 9;

function time(fn: () => void): number {
  const t = performance.now();
  fn();
  return performance.now() - t;
}

/** Best time of each side over `rounds` rounds, each round timing `a` then `b`. */
function bestInterleaved(rounds: number, a: () => void, b: () => void): [number, number] {
  let bestA = Infinity;
  let bestB = Infinity;
  for (let i = 0; i < rounds; i++) {
    bestA = Math.min(bestA, time(a));
    bestB = Math.min(bestB, time(b));
  }
  return [bestA, bestB];
}

describe('5 MB read cost by encoding (059 SC-005)', () => {
  const utf8Bytes = new TextEncoder().encode(TEXT);
  const cases: [string, Uint8Array][] = [
    ['UTF-16 LE + BOM', concat(BOM_UTF16LE, utf16(TEXT, 'le'))],
    ['UTF-16 BE, no BOM', utf16(TEXT, 'be')],
    ['Windows-1252', encode(TEXT, { encoding: 'windows1252', hasBom: false, lineEnding: 'lf' })],
  ];

  it('the UTF-8 baseline reads as UTF-8', () => {
    expect(readText(utf8Bytes)).toMatchObject({ ok: true, file: { encoding: 'utf8' } });
  });

  for (const [name, bytes] of cases) {
    it(`${name} is within 1.5× of UTF-8`, () => {
      const r = readText(bytes);
      expect(r.ok && r.file.text.length).toBe(TEXT.length);
      const [base, cost] = bestInterleaved(
        ROUNDS,
        () => readText(utf8Bytes),
        () => readText(bytes),
      );
      expect(cost).toBeLessThanOrEqual(base * 1.5);
    });
  }
});
