import { describe, it, expect } from 'vitest';
import { matchFamilies } from '../../src/config/font-typeahead.js';

const FAMILIES = ['Arial', 'Gamar', 'Ariales', 'Esarame', 'Consolas', 'Segoe UI', 'Times New Roman'];

describe('matchFamilies (FR-038b: partial, order-independent, case-insensitive)', () => {
  it('a single token matches any family containing it as a substring', () => {
    expect(matchFamilies('ar', FAMILIES)).toEqual(['Arial', 'Gamar', 'Ariales', 'Esarame']);
  });

  it('every whitespace token must be a substring (order-independent)', () => {
    expect(matchFamilies('ar es', FAMILIES)).toEqual(['Ariales', 'Esarame']);
    expect(matchFamilies('es ar', FAMILIES)).toEqual(['Ariales', 'Esarame']); // order-independent
  });

  it('is case-insensitive', () => {
    expect(matchFamilies('ARIAL', FAMILIES)).toEqual(['Arial', 'Ariales']); // both contain "arial"
    expect(matchFamilies('sEgOe', FAMILIES)).toEqual(['Segoe UI']);
  });

  it('an empty or whitespace-only query returns all families', () => {
    expect(matchFamilies('', FAMILIES)).toEqual(FAMILIES);
    expect(matchFamilies('   ', FAMILIES)).toEqual(FAMILIES);
  });

  it('multi-token across a spaced family name', () => {
    expect(matchFamilies('new roman', FAMILIES)).toEqual(['Times New Roman']);
    expect(matchFamilies('times seg', FAMILIES)).toEqual([]); // no family has both
  });
});
