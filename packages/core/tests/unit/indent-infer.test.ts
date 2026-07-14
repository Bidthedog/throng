/**
 * Bounded indentation inference (016, FR-018c).
 *
 * The bound is the requirement, not an optimisation: the cost must be O(1) in document size, so a
 * 200 MB minified bundle is sampled exactly as cheaply as a config file. Sample =
 * min(ceil(10% of lines), 100) lines, never fewer than one; only the first 20 characters of each.
 *
 * That 10% is why these fixtures are padded. A document's signal has to live INSIDE the sample
 * window to be seen at all — `withSample(...)` builds a document whose sample is exactly the lines
 * you pass, so each test says plainly which lines the algorithm actually reads.
 */
import { describe, expect, it } from 'vitest';
import { inferIndent } from '../../src/editor/indent-infer.js';

/**
 * A document whose 10% sample is EXACTLY `signal`: n signal lines followed by 9n unindented
 * filler lines, so ceil(0.1 × 10n) === n.
 */
const withSample = (...signal: string[]): string =>
  [...signal, ...Array.from({ length: 9 * signal.length }, () => 'filler')].join('\n');

describe('inferIndent (FR-018c)', () => {
  it('infers tabs from a tab-indented document', () => {
    expect(inferIndent(withSample('\treturn 1;'))).toEqual({ style: 'tabs' });
  });

  it('infers the most frequent leading-space count', () => {
    expect(inferIndent(withSample('    a = 1', '    b = 2', '    c = 3', '  d = 4'))).toEqual({
      style: 'spaces',
      width: 4,
    });
  });

  it('breaks a tie towards the SMALLER width', () => {
    expect(inferIndent(withSample('  x', '    y'))).toEqual({ style: 'spaces', width: 2 });
  });

  it('lets a tab ANYWHERE in the inspected prefix force tabs', () => {
    // Spaces outnumber tabs, but a tab in the leading whitespace is decisive: that is what a
    // tab-indented file looks like mid-migration, and answering "spaces" would pour spaces into
    // a file the build reads as tabs.
    expect(inferIndent(withSample('  x', '  y', '\tz'))).toEqual({ style: 'tabs' });
  });

  it('returns null when no sampled line is indented — the language profile then applies', () => {
    expect(inferIndent(withSample('a', 'b', 'c'))).toBeNull();
    expect(inferIndent('')).toBeNull();
  });

  it('inspects only the first 20 characters of a line', () => {
    // The tab sits at column 30, past the inspected window: it must not be seen, so the answer
    // stays "spaces" rather than flipping to tabs.
    expect(inferIndent(withSample('  x', `${' '.repeat(29)}\ty`))).toEqual({
      style: 'spaces',
      width: 2,
    });
  });

  it('EXCLUDES a line whose leading whitespace runs past 20 chars — it is not width 20', () => {
    // Three deeply-nested lines (24 spaces) and one 2-space line. If the deep lines were counted
    // as width 20 they would be the most frequent and WIN, inventing an indent width the file
    // never uses. Their width is indeterminate, so they are dropped from the tally.
    const deep = `${' '.repeat(24)}deep`;
    expect(inferIndent(withSample(deep, deep, deep, '  x'))).toEqual({ style: 'spaces', width: 2 });
  });

  it('samples 10% of lines, capped at 100 — a change past the sample is not seen', () => {
    // 1000 lines → sample = 100. The first 100 are 2-space; the remaining 900 are 8-space and
    // lie outside the window. The cap is what keeps a huge file cheap.
    const head = Array.from({ length: 100 }, () => '  two');
    const tail = Array.from({ length: 900 }, () => '        eight');
    expect(inferIndent([...head, ...tail].join('\n'))).toEqual({ style: 'spaces', width: 2 });
  });

  it('samples at least one line, however short the document', () => {
    expect(inferIndent('\tonly')).toEqual({ style: 'tabs' });
  });

  it('ignores a line that starts with no whitespace at all', () => {
    expect(inferIndent(withSample('no indent here', 'nor here'))).toBeNull();
  });

  it('ignores a whitespace-only line — it indents nothing', () => {
    expect(inferIndent(withSample('    ', '  x'))).toEqual({ style: 'spaces', width: 2 });
  });
});
