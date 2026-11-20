/**
 * 073 FR-022, FR-046 — the CSV grid model: RFC 4180 quoting, delimiter detection, field spans, the
 * first unterminated quote.
 */
import { describe, expect, it } from 'vitest';
import { cellValue, detectDelimiter, parseCsv, recordFieldCount } from '../../src/csv/csv-model.js';

function rows(text: string): string[][] {
  const m = parseCsv(text);
  const out: string[][] = [];
  for (let r = 0; r < m.records; r++) {
    const row: string[] = [];
    for (let c = 0; c < recordFieldCount(m, r); c++) row.push(cellValue(m, text, r, c));
    out.push(row);
  }
  return out;
}

describe('parseCsv', () => {
  it('splits plain records on commas and line feeds', () => {
    expect(rows('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps quoted delimiters, line breaks and doubled quotes inside one field', () => {
    const text = '"a, b","line one\r\nline two","say ""hi"""\r\nx,y,z';
    expect(rows(text)).toEqual([
      ['a, b', 'line one\r\nline two', 'say "hi"'],
      ['x', 'y', 'z'],
    ]);
  });

  it('records the line ending it first finds, and whether the text ends with one', () => {
    expect(parseCsv('a\r\nb\r\n').lineEnding).toBe('\r\n');
    expect(parseCsv('a\nb').lineEnding).toBe('\n');
    expect(parseCsv('a\rb').lineEnding).toBe('\r');
    expect(parseCsv('a').lineEnding).toBeNull();
    expect(parseCsv('a\nb\n').trailingLineEnding).toBe(true);
    expect(parseCsv('a\nb').trailingLineEnding).toBe(false);
  });

  it('reads an empty text as no records, and a blank line as one empty field', () => {
    expect(parseCsv('').records).toBe(0);
    expect(rows('a\n\nb\n')).toEqual([['a'], [''], ['b']]);
  });

  it('reports the widest record and leaves short records short', () => {
    const m = parseCsv('a,b,c\n1\n');
    expect(m.width).toBe(3);
    expect(recordFieldCount(m, 1)).toBe(1);
    expect(cellValue(m, 'a,b,c\n1\n', 1, 2)).toBe('');
  });

  it('records the exact span of every field, quotes included', () => {
    const text = 'a,"b,c"\n';
    const m = parseCsv(text);
    const span = (r: number, c: number): string => {
      const i = m.recordFieldStart[r]! + c;
      return text.slice(m.fieldStart[i], m.fieldEnd[i]);
    };
    expect(span(0, 0)).toBe('a');
    expect(span(0, 1)).toBe('"b,c"');
    expect(m.recordEnd[0]).toBe(7);
  });

  it('names the line of the first unterminated quote', () => {
    const m = parseCsv('a,b\n1,"open\n2,3\n');
    expect(m.fault).toEqual({ line: 2 });
  });

  it('takes a quote in the middle of a bare field literally', () => {
    expect(rows('ab"c,d\n')).toEqual([['ab"c', 'd']]);
  });

  it('keeps text after a closing quote as part of the field', () => {
    expect(rows('"ab"c,d\n')).toEqual([['abc', 'd']]);
  });

  it('splits on the delimiter it is given', () => {
    expect(rows('a;b\n1;2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a;b\n1;2\n').delimiter).toBe(';');
  });
});

describe('detectDelimiter', () => {
  it('finds comma, semicolon and tab by their consistent count across lines', () => {
    expect(detectDelimiter('a,b,c\n1,2,3\n')).toBe(',');
    expect(detectDelimiter('a;b;c\n1;2,5;3\n')).toBe(';');
    expect(detectDelimiter('a\tb\n1\t2\n')).toBe('\t');
  });

  it('ignores delimiters inside quotes', () => {
    expect(detectDelimiter('"a;b;c",d\n"1;2;3",e\n')).toBe(',');
  });

  it('defaults to comma when nothing is conclusive', () => {
    expect(detectDelimiter('just one column\nand another\n')).toBe(',');
    expect(detectDelimiter('')).toBe(',');
  });
});

describe('parseCsv at the editor size limit (SC-001)', () => {
  it('parses a 10 MB, 100,000-row document well inside the first-screen budget', () => {
    const row = '1234567,"Surname, Given",some text that pads the row out to a little over a hundred bytes,42.5\n';
    const text = row.repeat(100_000);
    expect(text.length).toBeGreaterThan(9_000_000);
    const started = performance.now();
    const m = parseCsv(text);
    const elapsed = performance.now() - started;
    expect(m.records).toBe(100_000);
    expect(m.width).toBe(4);
    // The whole SC-001 budget is 1.5 s to the first screen; the parse may take at most half of it.
    expect(elapsed).toBeLessThan(750);
  });
});
