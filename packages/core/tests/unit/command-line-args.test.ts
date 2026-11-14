import { describe, expect, it } from 'vitest';
import { splitWindowsCommandLine } from '../../src/terminal/command-line-args.js';

describe('splitWindowsCommandLine (CommandLineToArgvW rules)', () => {
  it('splits plain arguments on whitespace', () => {
    expect(splitWindowsCommandLine('claude --model opus')).toEqual(['claude', '--model', 'opus']);
  });

  it('keeps a quoted argument with spaces together and drops the quotes', () => {
    expect(splitWindowsCommandLine('claude --add-dir "C:\\My Projects\\x"')).toEqual([
      'claude',
      '--add-dir',
      'C:\\My Projects\\x',
    ]);
  });

  it('reads an unquoted exe path with backslashes verbatim', () => {
    expect(splitWindowsCommandLine('C:\\Users\\a\\claude.exe --resume abc')).toEqual([
      'C:\\Users\\a\\claude.exe',
      '--resume',
      'abc',
    ]);
  });

  it('reads a quoted exe path', () => {
    expect(splitWindowsCommandLine('"C:\\Program Files\\claude.exe" -c')).toEqual([
      'C:\\Program Files\\claude.exe',
      '-c',
    ]);
  });

  it('turns a backslash-escaped quote into a literal quote', () => {
    expect(splitWindowsCommandLine('a \\"b c\\" d')).toEqual(['a', '"b', 'c"', 'd']);
  });

  it('halves a run of backslashes before a quote and toggles quoting', () => {
    expect(splitWindowsCommandLine('a "b\\\\" c')).toEqual(['a', 'b\\', 'c']);
    expect(splitWindowsCommandLine('a "b\\\\\\" c"')).toEqual(['a', 'b\\" c']);
  });

  it('leaves backslashes not followed by a quote untouched', () => {
    expect(splitWindowsCommandLine('a b\\\\c')).toEqual(['a', 'b\\\\c']);
  });

  it('keeps an empty quoted argument', () => {
    expect(splitWindowsCommandLine('a "" b')).toEqual(['a', '', 'b']);
  });

  it('collapses repeated whitespace and ignores leading and trailing space', () => {
    expect(splitWindowsCommandLine('  a   b  ')).toEqual(['a', 'b']);
    expect(splitWindowsCommandLine('')).toEqual([]);
  });
});
