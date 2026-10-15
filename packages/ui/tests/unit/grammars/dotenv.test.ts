/**
 * The Dotenv grammar (055 FR-013, FR-016) — keys, values, comments and a leading `export`, each
 * distinct. Values are highlighted, never resolved or masked.
 */
import { describe, expect, it } from 'vitest';
import { dotenv } from '../../../src/renderer/editor/grammars/dotenv.js';
import { styleOf, tokenize } from './tokenize.js';

describe('dotenv grammar', () => {
  it('reads a whole-line comment as a comment', () => {
    expect(tokenize(dotenv, '# database settings')).toEqual([[['# database settings', 'comment']]]);
  });

  it('separates the key, the = and an unquoted value', () => {
    expect(tokenize(dotenv, 'DB_HOST=localhost')).toEqual([
      [['DB_HOST', 'propertyName'], ['=', 'operator'], ['localhost', 'string']],
    ]);
  });

  it('reads a leading export as a keyword, not part of the key', () => {
    const lines = tokenize(dotenv, 'export API_KEY=abc123');
    expect(styleOf(lines, 'export')).toBe('keyword');
    expect(styleOf(lines, 'API_KEY')).toBe('propertyName');
    expect(styleOf(lines, 'abc123')).toBe('string');
  });

  it('reads single- and double-quoted values as strings, a # inside them included', () => {
    expect(styleOf(tokenize(dotenv, 'A="hello # world"'), '"hello # world"')).toBe('string');
    expect(styleOf(tokenize(dotenv, "B='it''s'"), "'it'")).toBe('string');
  });

  it('reads a trailing # note after an unquoted value as a comment', () => {
    const lines = tokenize(dotenv, 'PORT=8080 # the dev port');
    expect(styleOf(lines, '8080')).toBe('string');
    expect(styleOf(lines, '# the dev port')).toBe('comment');
  });

  it('marks ${OTHER} as a variable without changing the value around it', () => {
    const lines = tokenize(dotenv, 'URL=http://${HOST}:8080');
    expect(styleOf(lines, '${HOST}')).toBe('variableName');
    expect(lines[0]!.map(([t]) => t).join('')).toBe('URL=http://${HOST}:8080');
  });

  it('carries a quoted value across lines', () => {
    const lines = tokenize(dotenv, 'KEY="line one\nline two"\nNEXT=1');
    expect(lines[1]).toEqual([['line two"', 'string']]);
    expect(styleOf(lines, 'NEXT')).toBe('propertyName');
  });

  it('tolerates spaces around the =', () => {
    const lines = tokenize(dotenv, 'KEY = value');
    expect(styleOf(lines, 'KEY')).toBe('propertyName');
    expect(styleOf(lines, '=')).toBe('operator');
    expect(styleOf(lines, 'value')).toBe('string');
  });
});
