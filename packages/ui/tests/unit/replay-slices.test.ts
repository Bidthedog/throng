import { describe, expect, it } from 'vitest';
import { sliceReplay } from '../../src/renderer/terminal/replay-slices.js';

describe('sliceReplay (061 R6)', () => {
  it('gives nothing for an empty replay', () => {
    expect(sliceReplay('', 4)).toEqual([]);
  });

  it('leaves a short replay whole', () => {
    expect(sliceReplay('abcd', 4)).toEqual(['abcd']);
  });

  it('cuts a long replay into pieces no larger than the limit that rejoin exactly', () => {
    const replay = 'x'.repeat(10);
    const slices = sliceReplay(replay, 4);
    expect(slices.map((s) => s.length)).toEqual([4, 4, 2]);
    expect(slices.join('')).toBe(replay);
  });
});
