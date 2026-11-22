/**
 * 073 FR-033c — the mapping a CSV preview and its text editor scroll by: a record's first source line, and the record a
 * source line falls in. Lines are 0-based, the numbering the preview's scroll sync uses (`syncLine`,
 * `onTopLineChange`). A record that spans lines (a quoted field holding a line break) maps to its FIRST line, and
 * every line inside it maps back to that record.
 *
 * Layer: unit — pure arithmetic over a parsed model; no DOM.
 */
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../src/csv/csv-model.js';
import { recordAtLine, recordStartLines } from '../../src/csv/record-lines.js';

const starts = (text: string): number[] => [...recordStartLines(parseCsv(text), text)];

describe('recordStartLines', () => {
  it('is one line per record for plain rows, LF or CRLF', () => {
    expect(starts('a,b\n1,2\n3,4\n')).toEqual([0, 1, 2]);
    expect(starts('a,b\r\n1,2\r\n3,4')).toEqual([0, 1, 2]);
  });

  it('puts a record after a multi-line quoted field on the line it really starts on', () => {
    // Line 0: a,b | lines 1-3: a record whose second field holds two line breaks | line 4: the last record.
    expect(starts('a,b\n1,"x\ny\nz"\n3,4\n')).toEqual([0, 1, 4]);
  });

  it('counts a carriage return alone as a line break, as the editor does', () => {
    expect(starts('a\r1\r2')).toEqual([0, 1, 2]);
  });

  it('is empty for an empty text', () => {
    expect(starts('')).toEqual([]);
  });
});

describe('recordAtLine', () => {
  const s = Int32Array.from([0, 1, 4, 5]);

  it('is the record that starts on the line, or the one a later line of a multi-line record falls in', () => {
    expect(recordAtLine(s, 0)).toBe(0);
    expect(recordAtLine(s, 1)).toBe(1);
    expect(recordAtLine(s, 2)).toBe(1);
    expect(recordAtLine(s, 3)).toBe(1);
    expect(recordAtLine(s, 4)).toBe(2);
    expect(recordAtLine(s, 5)).toBe(3);
  });

  it('clamps: a line past the last record is the last record, a negative one the first', () => {
    expect(recordAtLine(s, 99)).toBe(3);
    expect(recordAtLine(s, -3)).toBe(0);
  });

  it('is 0 with no records', () => {
    expect(recordAtLine(new Int32Array(0), 4)).toBe(0);
  });

  it('round-trips: every record maps back to itself through its first line', () => {
    const text = 'a,b\n1,"x\ny"\n3,4\n"p\nq\nr",6\n7,8\n';
    const lines = recordStartLines(parseCsv(text), text);
    for (let r = 0; r < lines.length; r++) expect(recordAtLine(lines, lines[r]!)).toBe(r);
  });
});
