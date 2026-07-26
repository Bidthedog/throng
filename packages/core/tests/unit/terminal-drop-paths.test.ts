import { describe, expect, it } from 'vitest';
import { quoteDropPath, formatDroppedPaths } from '../../src/terminal/drop-paths.js';

/**
 * US2 / FR-005, FR-004a (spec 024): a path dropped onto a terminal is wrapped in double quotes ONLY
 * when it contains whitespace (otherwise bare); no other shell-significant character is escaped
 * (consistent with the Copy Path default). Several dragged items join with a single space.
 */
describe('terminal drop-path formatting (024 US2)', () => {
  it('leaves a whitespace-free path unquoted', () => {
    expect(quoteDropPath('D:\\src\\app.ts')).toBe('D:\\src\\app.ts');
    expect(quoteDropPath('/home/u/app.ts')).toBe('/home/u/app.ts');
  });

  it('double-quotes a path that contains whitespace', () => {
    expect(quoteDropPath('D:\\my projects\\app.ts')).toBe('"D:\\my projects\\app.ts"');
    expect(quoteDropPath('/home/u/two words.txt')).toBe('"/home/u/two words.txt"');
  });

  it('does NOT escape other shell-significant characters (Copy Path default)', () => {
    // $, &, (), ; etc. pass through as-is — the quote rule is whitespace-only.
    expect(quoteDropPath('/home/u/a$b&c.txt')).toBe('/home/u/a$b&c.txt');
    expect(quoteDropPath('/home/u/a (1).txt')).toBe('"/home/u/a (1).txt"'); // whitespace → quoted
  });

  it('joins several items with a single space, each quoted independently, in order', () => {
    expect(formatDroppedPaths(['D:\\a.ts', 'D:\\b c.ts', 'D:\\d.ts'])).toBe(
      'D:\\a.ts "D:\\b c.ts" D:\\d.ts',
    );
  });

  it('formats a single item', () => {
    expect(formatDroppedPaths(['D:\\a.ts'])).toBe('D:\\a.ts');
  });

  it('returns empty for no items', () => {
    expect(formatDroppedPaths([])).toBe('');
  });
});
