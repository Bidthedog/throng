/**
 * 073 FR-050 – FR-053, FR-056 — what a workbook reads as: every sheet in order with its hidden flag,
 * each cell's stored display value (formulas never recalculated), dates as ISO 8601 where the file has
 * no display text, and one named refusal for a protected or unreadable file.
 *
 * Fixtures are written with the same library, so each format round-trips through a real file image.
 */
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { cellDisplay, readWorkbook, WORKBOOK_READ_OPTIONS } from '../../src/renderer/preview/providers/spreadsheet/workbook-read.js';

function fixture(bookType: XLSX.BookType): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const first = XLSX.utils.aoa_to_sheet([
    ['name', 'n'],
    ['a', 1],
    ['b', 2],
    ['c', 3],
  ]);
  // A formula whose stored value is deliberately NOT what it would recalculate to: the preview must show
  // the stored value.
  first['B5'] = { t: 'n', f: 'SUM(B2:B4)', v: 99 };
  first['!ref'] = 'A1:B5';
  XLSX.utils.book_append_sheet(wb, first, 'Data');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['secret']]), 'Hidden');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x', 'y']]), 'Third');
  wb.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }, { Hidden: 0 }] };
  const out = XLSX.write(wb, { bookType, type: 'array' }) as ArrayBuffer;
  return out;
}

// The OpenDocument writers do not record a sheet's hidden flag, so only the others can carry one here.
describe.each([
  ['xlsx', true],
  ['xls', true],
  ['xlsb', true],
  ['ods', false],
  ['fods', false],
] as const)('readWorkbook (%s)', (bookType, carriesHidden) => {
  it('lists every sheet in order, marks the hidden one, and shows stored values', () => {
    const result = readWorkbook(fixture(bookType));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sheets.map((s) => [s.name, s.hidden])).toEqual([
      ['Data', false],
      ['Hidden', carriesHidden],
      ['Third', false],
    ]);
    const data = result.sheets[0]!;
    expect(data.rows[0]).toEqual(['name', 'n']);
    expect(data.rows[4]?.[1]).toBe('99');
    expect(data.width).toBe(2);
  });
});

describe('readWorkbook refusals', () => {
  it('names a file that is not a workbook as malformed, never throwing', () => {
    const bytes = new TextEncoder().encode('PK\u0003\u0004 not really a zip').buffer;
    const result = readWorkbook(bytes);
    expect(result).toEqual({ ok: false, reason: 'malformed', detail: expect.any(String) });
  });

  // FR-056 (convergence T092) — an encrypted Office file is a compound file holding EncryptionInfo and an
  // EncryptedPackage in place of the workbook's parts. Built here rather than shipped as a binary fixture.
  it('names a password-protected workbook as such, not as damaged', () => {
    const cfb = XLSX.CFB.utils.cfb_new();
    XLSX.CFB.utils.cfb_add(cfb, '/EncryptionInfo', new Uint8Array([4, 0, 4, 0, 0x40, 0, 0, 0, ...new Array<number>(64).fill(0)]));
    XLSX.CFB.utils.cfb_add(cfb, '/EncryptedPackage', new Uint8Array(512));
    const bytes = (XLSX.CFB.write(cfb, { type: 'array' }) as Uint8Array | number[]);
    const buffer = Uint8Array.from(bytes).buffer;
    expect(readWorkbook(buffer)).toEqual({ ok: false, reason: 'password', detail: expect.any(String) });
  });

  it('shows the display text a file records, and a date with none as an ISO 8601 date', () => {
    expect(cellDisplay({ t: 'n', v: 0.5, w: '50%' })).toBe('50%');
    expect(cellDisplay({ t: 'd', v: new Date(Date.UTC(2026, 10, 18)) })).toBe('2026-11-18');
    expect(cellDisplay({ t: 'd', v: new Date(Date.UTC(2026, 10, 18, 9, 30)) })).toBe('2026-11-18T09:30:00Z');
    expect(cellDisplay({ t: 'n', v: 6 })).toBe('6');
    expect(cellDisplay(undefined)).toBe('');
  });

  it('reads with macros unextracted and formulas unevaluated (SC-007)', () => {
    expect(WORKBOOK_READ_OPTIONS).toMatchObject({ bookVBA: false, cellFormula: false, cellHTML: false, cellStyles: false });
  });
});
