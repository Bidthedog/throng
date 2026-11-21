/**
 * 073 FR-043b — the shared Go to dialog's one rule: its field holds only a whole number from 1 to the count.
 * Layer: unit — pure string and number arithmetic; the dialog's component test proves only the wiring.
 */
import { describe, expect, it } from 'vitest';
import { isGotoInput, resolveGotoNumber } from '../../src/navigation/go-to-input.js';

describe('isGotoInput', () => {
  it('allows the empty field, so a number can be typed from nothing', () => {
    expect(isGotoInput('', 120)).toBe(true);
  });

  it('allows a whole number from 1 to the count, both ends included', () => {
    for (const v of ['1', '9', '10', '99', '120']) expect(isGotoInput(v, 120), v).toBe(true);
  });

  it('refuses a number past the count, so a further digit is refused', () => {
    expect(isGotoInput('121', 120)).toBe(false);
    expect(isGotoInput('1200', 120)).toBe(false);
    expect(isGotoInput('99999999999999999999', 120)).toBe(false);
  });

  it('refuses a leading zero, zero itself, a sign, a decimal point and anything that is not a digit', () => {
    for (const v of ['0', '00', '01', '-1', '+1', '1.5', '1,2', '1e2', 'a', '1a', ' 1', '1 ', '١٢']) {
      expect(isGotoInput(v, 120), JSON.stringify(v)).toBe(false);
    }
  });

  it('allows only the empty field when there is nothing to go to', () => {
    expect(isGotoInput('', 0)).toBe(true);
    expect(isGotoInput('1', 0)).toBe(false);
  });

  it('refuses a fractional or unreadable count rather than guessing', () => {
    expect(isGotoInput('1', Number.NaN)).toBe(false);
    expect(isGotoInput('2', 2.9)).toBe(true);
    expect(isGotoInput('3', 2.9)).toBe(false);
  });
});

describe('resolveGotoNumber', () => {
  it('is the number typed, once it is valid', () => {
    expect(resolveGotoNumber('7', 10)).toBe(7);
    expect(resolveGotoNumber('10', 10)).toBe(10);
  });

  it('is null for the empty field and for anything the field would have refused', () => {
    for (const v of ['', '0', '11', 'x', '-3']) expect(resolveGotoNumber(v, 10), JSON.stringify(v)).toBeNull();
  });
});
