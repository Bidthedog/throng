/**
 * The Ignore file grammar (055 FR-014, FR-016) — `.gitignore` syntax and its relatives: comments
 * distinct from patterns, and a leading `!` negation distinct from both.
 */
import { describe, expect, it } from 'vitest';
import { ignore } from '../../../src/renderer/editor/grammars/ignore.js';
import { styleOf, tokenize } from './tokenize.js';

describe('ignore-file grammar', () => {
  it('reads a # line as a comment', () => {
    expect(tokenize(ignore, '# build output')).toEqual([[['# build output', 'comment']]]);
  });

  it('reads a pattern as something other than a comment', () => {
    const lines = tokenize(ignore, 'node_modules/\n*.log');
    expect(styleOf(lines, 'node_modules/')).not.toBe('comment');
    expect(styleOf(lines, '*.log')).not.toBe('comment');
  });

  it('reads a leading ! as a negation operator, and the rest as the pattern', () => {
    const lines = tokenize(ignore, '!keep.log');
    expect(lines[0]).toEqual([['!', 'operator'], ['keep.log', 'string']]);
  });

  it('reads an escaped \\# as the start of a pattern, not a comment', () => {
    expect(styleOf(tokenize(ignore, '\\#notes.md'), '\\#notes.md')).toBe('string');
  });

  it('reads a .gitattributes line: the pattern, then its attributes', () => {
    const lines = tokenize(ignore, '*.png binary -diff');
    expect(styleOf(lines, '*.png')).toBe('string');
    expect(styleOf(lines, 'binary')).toBe('attributeName');
    expect(styleOf(lines, '-diff')).toBe('attributeName');
  });
});
