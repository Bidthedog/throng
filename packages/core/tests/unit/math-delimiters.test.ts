import { describe, expect, it } from 'vitest';
import { matchDisplayBlock, matchInlineMath } from '../../src/index.js';

/**
 * 075 FR-040, FR-041, SC-005 — GitHub's rules for where maths starts and ends, as pure scanners the Markdown
 * pipeline's rules call. Code spans, code blocks and escapes are markdown-it's: by the time these run, a `\$`
 * has been consumed as text and code has been tokenised, so these see only prose.
 */
const at = (text: string): ReturnType<typeof matchInlineMath> => matchInlineMath(text, text.indexOf('$'));

describe('inline maths (FR-041)', () => {
  it('reads $…$ when the opener is not followed by space and the closer is not preceded by one', () => {
    expect(at('$x^2$ end')).toEqual({ end: 5, source: 'x^2', open: '$' });
    expect(at('$O(n \\log n)$')).toEqual({ end: 13, source: 'O(n \\log n)', open: '$' });
  });

  it('keeps prose dollars as text', () => {
    expect(at('costs $5 and $10')).toBeNull();
    expect(at('$ 5 $')).toBeNull();
    expect(at('$5 $')).toBeNull();
    expect(at('$')).toBeNull();
    expect(at('$$')).toBeNull();
  });

  it('does not close on a dollar followed by a digit', () => {
    expect(at('$x$5')).toBeNull();
    expect(at('$x$5 then $y$')).toEqual({ end: 13, source: 'x$5 then $y', open: '$' });
  });

  it('skips an escaped dollar inside the expression', () => {
    expect(at('$a\\$b$')).toEqual({ end: 6, source: 'a\\$b', open: '$' });
  });

  it('reads GitHub\'s code-span form $`…`$', () => {
    expect(at('$`x^2 + $y`$')).toEqual({ end: 12, source: 'x^2 + $y', open: '$`' });
    expect(at('$`unclosed')).toBeNull();
  });

  it('reads an inline $$…$$ as display maths', () => {
    expect(at('see $$\\sum x$$ here')).toEqual({ end: 14, source: '\\sum x', open: '$$' });
    expect(at('$$ $$')).toBeNull();
  });

  it('starts only at a dollar', () => {
    expect(matchInlineMath('x $y$', 0)).toBeNull();
  });
});

describe('display blocks (FR-040)', () => {
  it('reads $$ on its own lines, across lines', () => {
    expect(matchDisplayBlock(['$$', '\\sum_{i=1}^n i', '= x', '$$', 'after'], 0)).toEqual({ endLine: 3, source: '\\sum_{i=1}^n i\n= x' });
  });

  it('reads a one-line $$…$$ block', () => {
    expect(matchDisplayBlock(['$$a+b$$'], 0)).toEqual({ endLine: 0, source: 'a+b' });
  });

  it('reads an opener with content and a closer with content', () => {
    expect(matchDisplayBlock(['$$a', 'b$$'], 0)).toEqual({ endLine: 1, source: 'a\nb' });
  });

  it('leaves an unclosed $$ as text', () => {
    expect(matchDisplayBlock(['$$', 'x', 'y'], 0)).toBeNull();
  });

  it('ends at a blank line, as a paragraph would', () => {
    expect(matchDisplayBlock(['$$', 'x', '', '$$'], 0)).toBeNull();
  });

  it('needs the line to start with $$', () => {
    expect(matchDisplayBlock(['text $$x$$'], 0)).toBeNull();
    expect(matchDisplayBlock(['$x$'], 0)).toBeNull();
  });

  it('leaves an empty block as text', () => {
    expect(matchDisplayBlock(['$$', '$$'], 0)).toBeNull();
    expect(matchDisplayBlock(['$$$$'], 0)).toBeNull();
  });
});
