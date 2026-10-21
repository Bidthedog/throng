import { describe, expect, it } from 'vitest';
import { createAttentionScan } from '../../src/terminal/attention-scan.js';

/*
 * SC-004 / Principle XII — the scanner sits in the daemon's output path for every terminal, so its cost
 * is measured rather than assumed. Layer: unit — it is a pure function; no daemon is needed to time it.
 * The bound is deliberately loose (a loaded workstation must not flake it) yet two orders of magnitude
 * under what would be noticeable: a terminal tops out at a few MB/s of real output. Measured at
 * authoring: the three 10 MB passes (warm-up, quiet, storm) took about 250 ms together, roughly
 * 8 ms/MB, against a bound of 50.
 */
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const CHUNK = 64 * 1024;
const TOTAL = 10 * 1024 * 1024;
/** Stated bound: milliseconds per MB scanned, worst case (a bell storm). */
const MAX_MS_PER_MB = 50;

function mixedChunk(bellsPerChunk: number): string {
  const line = `${ESC}[32mcompiled${ESC}[0m src/module/file.ts in 12ms ${'x'.repeat(40)}\r\n`;
  const parts: string[] = [];
  let length = 0;
  while (length < CHUNK) {
    parts.push(line);
    length += line.length;
  }
  let text = parts.join('').slice(0, CHUNK);
  if (bellsPerChunk > 0) {
    const stride = Math.floor(CHUNK / bellsPerChunk);
    const pieces: string[] = [];
    for (let i = 0; i < bellsPerChunk; i++) pieces.push(text.slice(i * stride, (i + 1) * stride - 1), BEL);
    text = pieces.join('');
  }
  return text;
}

function msPerMb(bellsPerChunk: number): { ms: number; hits: number } {
  const scan = createAttentionScan();
  const chunk = mixedChunk(bellsPerChunk);
  let hits = 0;
  const started = performance.now();
  for (let scanned = 0; scanned < TOTAL; scanned += chunk.length) hits += scan.scan(chunk).length;
  const elapsed = performance.now() - started;
  return { ms: elapsed / (TOTAL / (1024 * 1024)), hits };
}

describe('attention scan cost (SC-004)', () => {
  it('stays under the bound with and without a bell storm', () => {
    msPerMb(1000); // warm the JIT before timing
    const quiet = msPerMb(0);
    const storm = msPerMb(1000);
    console.log(
      `attention-scan: ${quiet.ms.toFixed(2)} ms/MB without bells, ${storm.ms.toFixed(2)} ms/MB with 1000 bells per 64 KB (bound ${MAX_MS_PER_MB})`,
    );
    expect(quiet.hits).toBe(0);
    expect(storm.hits).toBeGreaterThan(0);
    expect(quiet.ms).toBeLessThan(MAX_MS_PER_MB);
    expect(storm.ms).toBeLessThan(MAX_MS_PER_MB);
  });
});
