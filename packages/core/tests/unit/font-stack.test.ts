import { describe, it, expect } from 'vitest';
import { parseFontStack, serializeFontStack } from '../../src/config/font-stack.js';

/**
 * font-stack (feature 007, H4 — FR-038b). The font control edits a CSS
 * font-family stack as ordered pills; these pure helpers convert between the
 * comma-separated stack saved to the theme and the pill list shown in the UI.
 */
describe('parseFontStack', () => {
  it('splits a CSS stack into trimmed families, stripping matching quotes', () => {
    expect(parseFontStack("'Segoe UI', system-ui, sans-serif")).toEqual([
      'Segoe UI',
      'system-ui',
      'sans-serif',
    ]);
    expect(parseFontStack('"Courier New", monospace')).toEqual(['Courier New', 'monospace']);
    expect(parseFontStack('  Arial  ')).toEqual(['Arial']);
  });

  it('returns an empty list for an empty / whitespace / non-string value', () => {
    expect(parseFontStack('')).toEqual([]);
    expect(parseFontStack('   ')).toEqual([]);
    expect(parseFontStack(',, ,')).toEqual([]);
    expect(parseFontStack(undefined as unknown as string)).toEqual([]);
  });
});

describe('serializeFontStack', () => {
  it('quotes families with whitespace or commas and joins with ", "', () => {
    expect(serializeFontStack(['Segoe UI', 'system-ui', 'sans-serif'])).toBe(
      "'Segoe UI', system-ui, sans-serif",
    );
    expect(serializeFontStack(['Arial'])).toBe('Arial');
    expect(serializeFontStack([])).toBe('');
  });

  it('drops empty entries', () => {
    expect(serializeFontStack(['Arial', '', '  ', 'Georgia'])).toBe('Arial, Georgia');
  });
});

describe('round-trip', () => {
  it('parse ∘ serialize is identity for a clean family list', () => {
    const families = ['Segoe UI', 'system-ui', 'sans-serif'];
    expect(parseFontStack(serializeFontStack(families))).toEqual(families);
  });

  it('serialize ∘ parse normalises a raw stack', () => {
    const raw = '"Segoe UI" ,  system-ui,sans-serif';
    expect(serializeFontStack(parseFontStack(raw))).toBe("'Segoe UI', system-ui, sans-serif");
  });
});
