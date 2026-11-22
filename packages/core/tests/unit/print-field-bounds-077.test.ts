/**
 * 077 FR-020 — the print dialog's number fields declare their bounds and step, and say what is wrong with a value
 * the way Preferences does (FR-008): past a bound names the bound and offers it to clamp to; what is no number says so.
 */
import { describe, expect, it } from 'vitest';
import { checkPrintField, COPIES_MAX, MARGIN_MAX_MM, PRINT_FIELDS, SCALE_MAX, SCALE_MIN } from '../../src/index.js';

describe('PRINT_FIELDS (077 FR-020)', () => {
  it('declares each field’s bounds, step and unit', () => {
    expect(PRINT_FIELDS.margin).toEqual({ min: 0, max: MARGIN_MAX_MM, step: 1, integer: false, unit: 'mm' });
    expect(PRINT_FIELDS.scale).toEqual({ min: SCALE_MIN, max: SCALE_MAX, step: 5, integer: true, unit: '%' });
    expect(PRINT_FIELDS.copies).toEqual({ min: 1, max: COPIES_MAX, step: 1, integer: true, unit: 'copies' });
  });
});

describe('checkPrintField (077 FR-020)', () => {
  it('accepts a value within the bounds, a decimal only where the field takes one', () => {
    expect(checkPrintField('12.5', PRINT_FIELDS.margin)).toEqual({ ok: true, value: 12.5 });
    expect(checkPrintField(' 4 ', PRINT_FIELDS.copies)).toEqual({ ok: true, value: 4 });
    expect(checkPrintField('2.5', PRINT_FIELDS.copies)).toEqual({ ok: false, message: 'Not a whole number' });
  });

  it('names the bound a value is past, and offers it to clamp to', () => {
    expect(checkPrintField('100', PRINT_FIELDS.copies)).toEqual({ ok: false, message: 'Up to 99 copies', clampTo: 99 });
    expect(checkPrintField('0', PRINT_FIELDS.copies)).toEqual({ ok: false, message: 'At least 1 copy', clampTo: 1 });
    expect(checkPrintField('5', PRINT_FIELDS.scale)).toEqual({ ok: false, message: 'At least 10%', clampTo: 10 });
    expect(checkPrintField('51', PRINT_FIELDS.margin)).toEqual({ ok: false, message: 'Up to 50 mm', clampTo: 50 });
  });

  it('says what is no number, and offers nothing to clamp to', () => {
    expect(checkPrintField('abc', PRINT_FIELDS.margin)).toEqual({ ok: false, message: 'Not a number' });
    expect(checkPrintField('', PRINT_FIELDS.copies)).toEqual({ ok: false, message: 'Not a whole number' });
  });
});
