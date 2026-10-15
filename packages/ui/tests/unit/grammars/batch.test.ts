/**
 * The Batch grammar (055 FR-015, FR-016) — `.bat` and `.cmd`. Every form FR-015 names highlights
 * distinctly; keywords match in any case, because cmd.exe does.
 */
import { describe, expect, it } from 'vitest';
import { batch } from '../../../src/renderer/editor/grammars/batch.js';
import { styleOf, tokenize } from './tokenize.js';

describe('batch grammar', () => {
  it('reads REM and :: lines as comments, REM in any case', () => {
    expect(tokenize(batch, 'REM build it')).toEqual([[['REM build it', 'comment']]]);
    expect(tokenize(batch, 'rem build it')).toEqual([[['rem build it', 'comment']]]);
    expect(tokenize(batch, ':: build it')).toEqual([[[':: build it', 'comment']]]);
  });

  it('does not mistake a word starting with rem for a comment', () => {
    expect(styleOf(tokenize(batch, 'remove.exe x'), 'remove.exe')).not.toBe('comment');
  });

  it('reads the @ prefix as an operator and the command after it as a keyword', () => {
    const lines = tokenize(batch, '@echo off');
    expect(styleOf(lines, '@')).toBe('operator');
    expect(styleOf(lines, 'echo')).toBe('keyword');
  });

  it.each(['echo', 'ECHO', 'Echo', 'set', 'if', 'else', 'for', 'in', 'do', 'exist', 'not', 'errorlevel', 'setlocal', 'endlocal', 'shift', 'pushd', 'popd', 'exit', 'goto', 'call'])(
    'reads %s as a keyword',
    (word) => {
      expect(styleOf(tokenize(batch, `${word} x`), word)).toBe('keyword');
    },
  );

  it('reads a label and the targets of goto and call as labels', () => {
    const lines = tokenize(batch, ':build\ngoto build\ncall :build arg');
    expect(styleOf(lines, ':build')).toBe('labelName');
    expect(lines[1]).toEqual([['goto', 'keyword'], ['build', 'labelName']]);
    expect(lines[2]!.slice(0, 2)).toEqual([['call', 'keyword'], [':build', 'labelName']]);
  });

  it.each(['%PATH%', '%~dp0', '%~1', '%1', '%%i', '%%~nf', '!COUNT!'])('reads %s as a variable', (variable) => {
    expect(styleOf(tokenize(batch, `echo ${variable}`), variable)).toBe('variableName');
  });

  it('reads a quoted string as a string', () => {
    expect(styleOf(tokenize(batch, 'echo "hello world"'), '"hello world"')).toBe('string');
  });

  it.each(['>', '>>', '<', '|', '&&', '||', '2>&1'])('reads %s as an operator', (op) => {
    expect(styleOf(tokenize(batch, `dir ${op} out.txt`), op)).toBe('operator');
  });

  it('reads a ^ escape, with the character it escapes, as a string — not an unmapped escape tag', () => {
    expect(styleOf(tokenize(batch, 'echo a^&b'), '^&')).toBe('string');
  });
});
