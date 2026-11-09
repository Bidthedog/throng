import { describe, expect, it } from 'vitest';
import { RetainedOutput } from '@throng/core';

const numbered = (from: number, count: number): string =>
  Array.from({ length: count }, (_, i) => `line ${from + i}\n`).join('');

describe('RetainedOutput (061 FR-016)', () => {
  it('keeps everything while under both limits', () => {
    const kept = new RetainedOutput(10, 1000);
    kept.append('a\n');
    kept.append('b');
    expect(kept.snapshot()).toBe('a\nb');
    expect(kept.length).toBe(3);
  });

  it('keeps only the latest lines, whole chunks at a time', () => {
    const kept = new RetainedOutput(3, 1000);
    for (let i = 1; i <= 5; i += 1) kept.append(`line ${i}\n`);
    expect(kept.snapshot()).toBe(numbered(3, 3));
  });

  it('trims inside a chunk holding more lines than are kept', () => {
    const kept = new RetainedOutput(3, 1000);
    kept.append(numbered(1, 5));
    expect(kept.snapshot()).toBe(numbered(3, 3));
  });

  it('counts a partial last line as no line at all', () => {
    const kept = new RetainedOutput(2, 1000);
    kept.append('a\nb\nprompt');
    expect(kept.snapshot()).toBe('a\nb\nprompt');
  });

  it('holds no more than the character limit, cutting at a line start', () => {
    const kept = new RetainedOutput(1000, 12);
    kept.append('aaaaaa\n');
    kept.append('bbbbbb\n');
    kept.append('cccc\n');
    expect(kept.snapshot()).toBe('bbbbbb\ncccc\n');
    kept.append('d\n');
    expect(kept.snapshot()).toBe('cccc\nd\n');
  });

  it('does not lose a line when a whole chunk is evicted that ended mid-line', () => {
    const kept = new RetainedOutput(1, 1000);
    kept.append('a\nb');
    kept.append('c\nd\n');
    expect(kept.snapshot()).toBe('d\n');
  });

  it('starts at a line start when evicting a chunk that ended mid-line', () => {
    const kept = new RetainedOutput(1000, 8);
    kept.append('aaaaaa');
    kept.append('aa\nbb\ncc');
    expect(kept.snapshot()).toBe('bb\ncc');
  });

  it('drops to empty rather than replay from the middle of one enormous line', () => {
    const kept = new RetainedOutput(1000, 10);
    kept.append('x'.repeat(30));
    expect(kept.snapshot()).toBe('');
    expect(kept.length).toBe(0);
  });

  it('stays bounded under output that only rewrites one line', () => {
    const kept = new RetainedOutput(1000, 100);
    for (let i = 0; i < 1000; i += 1) kept.append('\rprogress 50%');
    expect(kept.length).toBeLessThanOrEqual(100);
  });

  it('keeps running totals right across many evictions', () => {
    const kept = new RetainedOutput(100, 100_000);
    for (let i = 0; i < 5000; i += 1) kept.append(`line ${i}\n`);
    const out = kept.snapshot();
    expect(out.split('\n').length - 1).toBe(100);
    expect(out.startsWith('line 4900\n')).toBe(true);
    expect(kept.length).toBe(out.length);
  });
});
