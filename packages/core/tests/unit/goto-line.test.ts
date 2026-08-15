import { describe, it, expect } from 'vitest';
import { resolveGotoLine } from '@throng/core';

/**
 * 033 US2 — Go To Line's pure half (contracts/navigation-modals.md §5, G3–G5;
 * spec FR-021 – FR-023). `resolveGotoLine` never throws and never raises a
 * notice: it either returns a line number already clamped into [1, lineCount],
 * or `null` meaning "do nothing", which is a different answer from clamping.
 */
describe('resolveGotoLine (033 goto-line.ts)', () => {
  describe('a number inside the document resolves to itself', () => {
    it('returns the line asked for', () => {
      expect(resolveGotoLine('1', 10)).toBe(1);
      expect(resolveGotoLine('7', 10)).toBe(7);
      expect(resolveGotoLine('10', 10)).toBe(10);
    });

    it('ignores surrounding whitespace around a real number', () => {
      expect(resolveGotoLine('  4  ', 10)).toBe(4);
      expect(resolveGotoLine('\t4\n', 10)).toBe(4);
    });
  });

  describe('G3 — out of range clamps, it does not fail', () => {
    it('a number beyond the count resolves to the LAST line', () => {
      expect(resolveGotoLine('11', 10)).toBe(10);
      expect(resolveGotoLine('999999', 10)).toBe(10);
    });

    it('zero resolves to the FIRST line', () => {
      expect(resolveGotoLine('0', 10)).toBe(1);
    });

    it('a negative number resolves to the FIRST line', () => {
      expect(resolveGotoLine('-1', 10)).toBe(1);
      expect(resolveGotoLine('-4000', 10)).toBe(1);
    });

    it('clamping never yields null — the caller always moves the caret', () => {
      for (const raw of ['0', '-1', '11', '999999']) {
        expect(resolveGotoLine(raw, 10)).not.toBeNull();
      }
    });
  });

  describe('G4 — input that is not a line number returns null', () => {
    it('returns null for empty input', () => {
      expect(resolveGotoLine('', 10)).toBeNull();
    });

    it('returns null for whitespace-only input', () => {
      expect(resolveGotoLine(' ', 10)).toBeNull();
      expect(resolveGotoLine('   \t \n ', 10)).toBeNull();
    });

    it('returns null for non-numeric input', () => {
      expect(resolveGotoLine('abc', 10)).toBeNull();
      expect(resolveGotoLine('12abc', 10)).toBeNull();
      expect(resolveGotoLine('abc12', 10)).toBeNull();
      expect(resolveGotoLine('1 2', 10)).toBeNull();
      expect(resolveGotoLine('-', 10)).toBeNull();
      expect(resolveGotoLine('+', 10)).toBeNull();
      expect(resolveGotoLine('1e3', 10)).toBeNull();
      expect(resolveGotoLine('0x10', 10)).toBeNull();
      expect(resolveGotoLine('NaN', 10)).toBeNull();
      expect(resolveGotoLine('Infinity', 10)).toBeNull();
    });

    it('returns null for a fractional number — a line number is a whole line', () => {
      expect(resolveGotoLine('3.5', 10)).toBeNull();
      expect(resolveGotoLine('3.', 10)).toBeNull();
      expect(resolveGotoLine('.5', 10)).toBeNull();
    });

    it('null is distinct from clamping — "0" is not the same answer as ""', () => {
      expect(resolveGotoLine('0', 10)).toBe(1);
      expect(resolveGotoLine('', 10)).toBeNull();
    });
  });

  describe('G5 — an empty document has one line', () => {
    it('every number resolves to line 1', () => {
      expect(resolveGotoLine('1', 1)).toBe(1);
      expect(resolveGotoLine('2', 1)).toBe(1);
      expect(resolveGotoLine('0', 1)).toBe(1);
      expect(resolveGotoLine('-7', 1)).toBe(1);
      expect(resolveGotoLine('999', 1)).toBe(1);
    });

    it('non-numeric input is still null in an empty document', () => {
      expect(resolveGotoLine('', 1)).toBeNull();
      expect(resolveGotoLine('x', 1)).toBeNull();
    });
  });

  describe('the result is always a usable line number', () => {
    it('stays inside [1, lineCount] for every numeric input', () => {
      const lineCount = 25;
      for (const raw of ['-100', '-1', '0', '1', '13', '25', '26', '10000']) {
        const line = resolveGotoLine(raw, lineCount);
        expect(line).not.toBeNull();
        expect(line as number).toBeGreaterThanOrEqual(1);
        expect(line as number).toBeLessThanOrEqual(lineCount);
      }
    });

    it('a nonsensical line count is still floored at one line', () => {
      expect(resolveGotoLine('5', 0)).toBe(1);
    });
  });
});
