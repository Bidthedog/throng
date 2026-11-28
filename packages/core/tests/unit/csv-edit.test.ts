/**
 * 073 FR-036 – FR-038, FR-047, SC-005 — grid edits as minimal text changes: only the edited fields'
 * bytes, and the delimiters and line endings an insertion or removal needs, ever change.
 */
import { describe, expect, it } from 'vitest';
import { parseCsv, cellValue, recordFieldCount } from '../../src/csv/csv-model.js';
import {
  applyCsvChanges,
  csvDeleteColumns,
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
    expect(edit(bare, (m) => csvSetCells(m, bare, [{ row: 1, col: 0, value: 'x' }]))).toBe('a,b\nx,');
  });

  // 081 FR-081, FR-081a — the entry row (row index `records`) becomes one record of the file's width.
  it('pads a record written at the entry row to the full width, after a final line ending', () => {
    const text = 'a,b,c\r\n1,2,3\r\n';
    expect(edit(text, (m) => csvSetCells(m, text, [{ row: 2, col: 1, value: 'x' }]))).toBe('a,b,c\r\n1,2,3\r\n,x,\r\n');
  });

  it('writes the entry row after the file\'s own line ending with none after it, when the file has no final one', () => {
    const text = 'a;b;c\n1;2;3';
    expect(edit(text, (m) => csvSetCells(m, text, [{ row: 2, col: 0, value: 'x' }]))).toBe('a;b;c\n1;2;3\nx;;');
  });

  it('pads the entry row to the widest record when the last record is short', () => {
    const text = 'a,b,c\n1\n';
    expect(edit(text, (m) => csvSetCells(m, text, [{ row: 2, col: 0, value: 'x' }]))).toBe('a,b,c\n1\nx,,\n');
  });

  it('writes nothing for an empty value in the entry row', () => {
    const text = 'a,b\n1,2\n';
    const m = parseCsv(text);
    expect(csvSetCells(m, text, [{ row: 2, col: 0, value: '' }])).toEqual([]);
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

describe('csvInsertRows with values (FR-038a)', () => {
  it('inserts the copied records above a record, in the document\'s delimiter and line ending', () => {
    const text = 'a;b\r\n1;2\r\n';
    const out = edit(text, (m) => csvInsertRows(m, 1, 2, [['x', 'y;z'], ['p', 'q']]));
    expect(out).toBe('a;b\r\nx;"y;z"\r\np;q\r\n1;2\r\n');
  });

  it('pads a copied record narrower than the table to the full width, and appends below the last record', () => {
    expect(edit('a,b,c\n', (m) => csvInsertRows(m, 1, 1, [['x']]))).toBe('a,b,c\nx,,\n');
    expect(edit('a,b', (m) => csvInsertRows(m, 1, 1, [['x', 'y']]))).toBe('a,b\nx,y');
  });

  it('quotes a value holding a quote or a line break', () => {
    expect(edit('a\n', (m) => csvInsertRows(m, 0, 1, [['say "hi"\nthere']]))).toBe('"say ""hi""\nthere"\na\n');
  });

  it('is one text change, so one undo step', () => {
    const m = parseCsv('a,b\n1,2\n');
    expect(csvInsertRows(m, 1, 2, [['x', 'y'], ['p', 'q']])).toHaveLength(1);
  });
});

describe('csvInsertColumn with a count and values (FR-038a)', () => {
  it('inserts several empty columns at once', () => {
    expect(edit('a,b\n1,2\n', (m) => csvInsertColumn(m, 1, 2))).toBe('a,,,b\n1,,,2\n');
  });

  it('inserts the copied columns, record by record, before a column', () => {
    const cols = [['x', 'y'], ['p', 'q']];
    expect(edit('a,b\n1,2\n', (m) => csvInsertColumn(m, 1, 2, cols))).toBe('a,x,p,b\n1,y,q,2\n');
  });

  it('appends them right of the last column, and pads a record shorter than the insertion point', () => {
    expect(edit('a,b\n1\n', (m) => csvInsertColumn(m, 2, 1, [['x', 'y']]))).toBe('a,b,x\n1,,y\n');
  });

  it('quotes values by the document\'s delimiter and leaves a record that ends before the point alone when the values are empty', () => {
    expect(edit('a;b\n', (m) => csvInsertColumn(m, 0, 1, [['x;y']]))).toBe('"x;y";a;b\n');
    expect(edit('a,b,c\n1\n', (m) => csvInsertColumn(m, 2, 1, [['', '']]))).toBe('a,b,,c\n1\n');
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

describe('csvDeleteColumns (T4, Delete Column)', () => {
  it('removes the fields from every record, header included, with one delimiter each', () => {
    expect(edit('h1,h2,h3\r\n1,2,3\r\n', (m) => csvDeleteColumns(m, 1, 1))).toBe('h1,h3\r\n1,3\r\n');
    expect(edit('a,b,c\n1,2,3\n', (m) => csvDeleteColumns(m, 0, 1))).toBe('b,c\n2,3\n');
  });

  it('takes the delimiter before the last column, so no record gains a trailing one', () => {
    expect(edit('a,b,c\n1,2,3', (m) => csvDeleteColumns(m, 2, 1))).toBe('a,b\n1,2');
    expect(edit('a,b,c\n1,2,3\n', (m) => csvDeleteColumns(m, 1, 2))).toBe('a\n1\n');
  });

  it('removes a quoted field whole, and keeps every other byte', () => {
    expect(edit('"x,y";b\n"p\nq";"r"\n', (m) => csvDeleteColumns(m, 0, 1))).toBe('b\n"r"\n');
    expect(edit('a,"say ""hi""",c\n', (m) => csvDeleteColumns(m, 2, 1))).toBe('a,"say ""hi"""\n');
  });

  it('leaves a ragged record that ends before the columns alone, and trims one that ends inside them', () => {
    expect(edit('a,b,c\n1\n', (m) => csvDeleteColumns(m, 1, 2))).toBe('a\n1\n');
    expect(edit('a,b,c,d\n1,2\n', (m) => csvDeleteColumns(m, 1, 2))).toBe('a,d\n1\n');
  });

  it('is one change per record and nothing for columns past the widest record', () => {
    const m = parseCsv('a,b\n1,2\n');
    expect(csvDeleteColumns(m, 0, 1)).toHaveLength(2);
    expect(csvDeleteColumns(m, 2, 1)).toEqual([]);
    expect(csvDeleteColumns(m, 0, 0)).toEqual([]);
  });
});

describe('inserting into a blank CSV (T5)', () => {
  it('a row in an empty file is one empty field, followed by a line ending so it exists', () => {
    expect(edit('', (m) => csvInsertRows(m, 0, 1))).toBe('\n');
    expect(edit('', (m) => csvInsertRows(m, 0, 2))).toBe('\n\n');
  });

  it('a column in an empty file makes one record two fields wide', () => {
    expect(edit('', (m) => csvInsertColumn(m, 0))).toBe(',\n');
    expect(edit('', (m) => csvInsertColumn(m, 1))).toBe(',\n');
    expect(edit('', (m) => csvInsertColumn(m, 1, 2))).toBe(',,\n');
  });

  it('copied columns into an empty file land at their place, one record per copied row', () => {
    expect(edit('', (m) => csvInsertColumn(m, 0, 1, [['x', 'y']]))).toBe('x,\ny,\n');
    expect(edit('', (m) => csvInsertColumn(m, 1, 1, [['x']]))).toBe(',x\n');
  });

  it('builds up a blank table by inserts alone, keeping the line ending it started with', () => {
    let text = '';
    const step = (make: (m: ReturnType<typeof parseCsv>) => ReturnType<typeof csvSetCells>): void => {
      text = edit(text, make);
    };
    step((m) => csvInsertRows(m, 0, 1));
    step((m) => csvInsertColumn(m, 1));
    expect(text).toBe(',\n');
    step((m) => csvInsertColumn(m, 2));
    step((m) => csvInsertRows(m, 1, 1));
    expect(text).toBe(',,\n,,\n');
  });

  it('a row in a three-wide table with no final newline keeps having none', () => {
    expect(edit('a,b,c', (m) => csvInsertRows(m, 1, 1))).toBe('a,b,c\n,,');
    expect(edit('\r\n', (m) => csvInsertRows(m, 1, 1))).toBe('\r\n\r\n');
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
