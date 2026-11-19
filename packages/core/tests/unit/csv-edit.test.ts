/**
 * 073 FR-036 – FR-038, FR-047, SC-005 — grid edits as minimal text changes: only the edited fields'
 * bytes, and the delimiters and line endings an insertion or removal needs, ever change.
 */
import { describe, expect, it } from 'vitest';
import { parseCsv, cellValue, recordFieldCount } from '../../src/csv/csv-model.js';
import {
  applyCsvChanges,
  csvDeleteRows,
  csvInsertColumn,
  csvInsertRows,
  csvSetCells,
  encodeCsvField,
} from '../../src/csv/csv-edit.js';

function edit(text: string, make: (m: ReturnType<typeof parseCsv>) => ReturnType<typeof csvSetCells>): string {
  return applyCsvChanges(text, make(parseCsv(text)));
}

describe('encodeCsvField', () => {
  it('writes a value bare unless the format requires quotes', () => {
    expect(encodeCsvField('plain', ',')).toBe('plain');
    expect(encodeCsvField('a,b', ',')).toBe('"a,b"');
    expect(encodeCsvField('a;b', ',')).toBe('a;b');
    expect(encodeCsvField('a;b', ';')).toBe('"a;b"');
    expect(encodeCsvField('say "hi"', ',')).toBe('"say ""hi"""');
    expect(encodeCsvField('two\nlines', ',')).toBe('"two\nlines"');
    expect(encodeCsvField('cr\rhere', ',')).toBe('"cr\rhere"');
    expect(encodeCsvField('', ',')).toBe('');
  });
});

describe('csvSetCells', () => {
  it('changes only the edited field, keeping every other byte', () => {
    const text = '"a","b",c\r\n1,"2",3\r\n';
    expect(edit(text, (m) => csvSetCells(m, text, [{ row: 1, col: 1, value: 'two' }]))).toBe('"a","b",c\r\n1,two,3\r\n');
  });

  it('quotes an edited value only where it needs it', () => {
    const text = 'a,b\n';
    expect(edit(text, (m) => csvSetCells(m, text, [{ row: 0, col: 0, value: 'x,y' }]))).toBe('"x,y",b\n');
  });

  it('appends the delimiters a short record needs to reach the edited column, to that record only', () => {
    const text = 'a,b,c\n1\n';
    expect(edit(text, (m) => csvSetCells(m, text, [{ row: 1, col: 2, value: '3' }]))).toBe('a,b,c\n1,,3\n');
  });

  it('combines several edits past the end of one record', () => {
    const text = 'a\n';
    expect(
      edit(text, (m) =>
        csvSetCells(m, text, [
          { row: 0, col: 3, value: 'd' },
          { row: 0, col: 1, value: 'b' },
        ]),
      ),
    ).toBe('a,b,,d\n');
  });

  it('adds records past the last one, keeping the trailing line ending style', () => {
    const text = 'a,b\r\n';
    expect(edit(text, (m) => csvSetCells(m, text, [{ row: 2, col: 1, value: 'z' }]))).toBe('a,b\r\n\r\n,z\r\n');
    const bare = 'a,b';
    expect(edit(bare, (m) => csvSetCells(m, bare, [{ row: 1, col: 0, value: 'x' }]))).toBe('a,b\nx');
  });

  it('writes the first field of an empty text', () => {
    expect(edit('', (m) => csvSetCells(m, '', [{ row: 0, col: 0, value: 'hello' }]))).toBe('hello');
  });

  it('makes no change for a value already there, or an empty value past the end', () => {
    const text = 'a,b\n1\n';
    const m = parseCsv(text);
    expect(csvSetCells(m, text, [{ row: 0, col: 0, value: 'a' }])).toEqual([]);
    expect(csvSetCells(m, text, [{ row: 1, col: 1, value: '' }])).toEqual([]);
  });
});

describe('csvInsertRows', () => {
  it('inserts empty records of the full width above a record', () => {
    const text = 'a,b,c\r\n1,2,3\r\n';
    expect(edit(text, (m) => csvInsertRows(m, 1, 1))).toBe('a,b,c\r\n,,\r\n1,2,3\r\n');
  });

  it('inserts below the last record, with or without a trailing line ending', () => {
    expect(edit('a,b\n', (m) => csvInsertRows(m, 1, 1))).toBe('a,b\n,\n');
    expect(edit('a,b', (m) => csvInsertRows(m, 1, 1))).toBe('a,b\n,');
  });
});

describe('csvInsertColumn', () => {
  it('inserts an empty field before the column in every record that reaches it', () => {
    const text = 'a,b,c\n1\n';
    expect(edit(text, (m) => csvInsertColumn(m, 1))).toBe('a,,b,c\n1\n');
  });

  it('appends an empty field to records exactly as wide as the insertion point', () => {
    const text = 'a,b\n1,2\n';
    expect(edit(text, (m) => csvInsertColumn(m, 2))).toBe('a,b,\n1,2,\n');
  });
});

describe('csvDeleteRows', () => {
  it('removes whole records with their line endings', () => {
    expect(edit('a\nb\nc\n', (m) => csvDeleteRows(m, 1, 1))).toBe('a\nc\n');
  });

  it('removes the last record without leaving a dangling line ending', () => {
    expect(edit('a\nb', (m) => csvDeleteRows(m, 1, 1))).toBe('a');
    expect(edit('a\nb\n', (m) => csvDeleteRows(m, 1, 1))).toBe('a\n');
  });
});

describe('round trip (SC-005)', () => {
  it('reads every edited value back, and every other field unchanged', () => {
    const text = 'id,"name, full","note"\r\n1,"Ann ""A""","x\r\ny"\r\n2,Bob,\r\n';
    const before = parseCsv(text);
    const next = applyCsvChanges(text, csvSetCells(before, text, [{ row: 2, col: 2, value: 'line "one"\nline two' }]));
    const after = parseCsv(next);
    for (let r = 0; r < before.records; r++) {
      for (let c = 0; c < Math.max(recordFieldCount(before, r), recordFieldCount(after, r)); c++) {
        const expected = r === 2 && c === 2 ? 'line "one"\nline two' : cellValue(before, text, r, c);
        expect(cellValue(after, next, r, c)).toBe(expected);
      }
    }
    expect(next.startsWith('id,"name, full","note"\r\n1,"Ann ""A""","x\r\ny"\r\n2,Bob,')).toBe(true);
  });
});
