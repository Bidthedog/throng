/**
 * 073 FR-002, FR-024, FR-037a, FR-037c — the grid's column letters and its clipboard formats.
 */
import { describe, expect, it } from 'vitest';
import { columnLabel, gridToHtmlTable, gridToTsv, parseTsv } from '../../src/csv/grid-clipboard.js';

describe('columnLabel', () => {
  it('names columns A … Z, AA …', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnLabel)).toEqual([
      'A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA',
    ]);
  });
});

describe('gridToTsv / parseTsv', () => {
  it('writes rows of tab-separated cells, quoting a cell that holds a tab, a quote or a line break', () => {
    expect(gridToTsv([['a', 'b'], ['c\td', 'say "x"'], ['two\nlines', '']])).toBe(
      'a\tb\n"c\td"\t"say ""x"""\n"two\nlines"\t',
    );
  });

  it('reads back what it writes', () => {
    const cells = [['a', 'b'], ['c\td', 'say "x"'], ['two\nlines', '']];
    expect(parseTsv(gridToTsv(cells))).toEqual(cells);
  });

  it('reads another application’s copy, ignoring one trailing line break and CRLF endings', () => {
    expect(parseTsv('1\t2\r\n3\t4\r\n')).toEqual([['1', '2'], ['3', '4']]);
    expect(parseTsv('single')).toEqual([['single']]);
  });
});

describe('gridToHtmlTable', () => {
  it('writes a text-only table, escaping every cell', () => {
    expect(gridToHtmlTable([['<b>', '&']])).toBe('<table><tbody><tr><td>&lt;b&gt;</td><td>&amp;</td></tr></tbody></table>');
  });
});
