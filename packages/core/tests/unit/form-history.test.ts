import { describe, expect, it } from 'vitest';
import { parseFormHistory, recordFormValue, trimFormHistory } from '../../src/terminal/form-history.js';

describe('recordFormValue (067 FR-061, FR-063)', () => {
  it('puts the newest first', () => {
    expect(recordFormValue(['a'], 'b', 10)).toEqual(['b', 'a']);
  });
  it('moves a repeated value to the top rather than listing it twice', () => {
    expect(recordFormValue(['a', 'b', 'c'], 'c', 10)).toEqual(['c', 'a', 'b']);
  });
  it('ignores an empty or blank value', () => {
    expect(recordFormValue(['a'], '', 10)).toEqual(['a']);
    expect(recordFormValue(['a'], '   ', 10)).toEqual(['a']);
  });
  it('keeps only the newest N', () => {
    expect(recordFormValue(['a', 'b'], 'c', 2)).toEqual(['c', 'a']);
  });
});

describe('trimFormHistory (067 FR-065)', () => {
  it('trims both lists of every terminal type to the newest N', () => {
    const file = {
      version: 1 as const,
      entries: {
        one: { startupCommand: ['a', 'b', 'c'], shellArguments: ['d', 'e'] },
        two: { startupCommand: ['f'], shellArguments: ['g', 'h', 'i'] },
      },
    };
    expect(trimFormHistory(file, 2).entries).toEqual({
      one: { startupCommand: ['a', 'b'], shellArguments: ['d', 'e'] },
      two: { startupCommand: ['f'], shellArguments: ['g', 'h'] },
    });
  });
});

describe('parseFormHistory', () => {
  it('reads a stored file', () => {
    const text = JSON.stringify({ version: 1, entries: { one: { startupCommand: ['a'], shellArguments: [] } } });
    expect(parseFormHistory(text).entries['one']?.startupCommand).toEqual(['a']);
  });
  it.each(['not json', '[]', '{"version":2,"entries":{}}', '{"version":1,"entries":3}'])('reads %s as empty', (text) => {
    expect(parseFormHistory(text)).toEqual({ version: 1, entries: {} });
  });
  it('drops a malformed entry and keeps the rest', () => {
    const text = JSON.stringify({
      version: 1,
      entries: { bad: { startupCommand: 'x' }, good: { startupCommand: ['a', 7], shellArguments: ['b'] } },
    });
    expect(parseFormHistory(text).entries).toEqual({ good: { startupCommand: ['a'], shellArguments: ['b'] } });
  });
});
