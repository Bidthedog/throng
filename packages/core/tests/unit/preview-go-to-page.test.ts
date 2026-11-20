/** 074 FR-062b — what a PDF's Go to Page field accepts and goes to, and which previews offer it. */
import { describe, expect, it } from 'vitest';
import { isPageInput, previewGoToKind, resolveGotoPage, SHIPPED_PREVIEW_PROVIDERS } from '../../src/index.js';

describe('the page field (isPageInput)', () => {
  it.each([
    ['', true],
    ['1', true],
    ['12', true],
    ['15', true],
    ['16', false],
    ['0', false],
    ['01', false],
    ['-1', false],
    ['1.5', false],
    ['1,5', false],
    ['a', false],
    [' 3', false],
  ])('%j in a 15-page PDF → %s', (text, ok) => {
    expect(isPageInput(text, 15)).toBe(ok);
  });

  it('allows every prefix of a page that exists, so typing one is never refused part-way', () => {
    for (let page = 1; page <= 250; page++) {
      const digits = String(page);
      for (let k = 1; k <= digits.length; k++) expect(isPageInput(digits.slice(0, k), 250)).toBe(true);
    }
  });
});

describe('resolveGotoPage', () => {
  it('names the page typed, or null for nothing or a page that does not exist', () => {
    expect(resolveGotoPage('7', 15)).toBe(7);
    expect(resolveGotoPage(' 7 ', 15)).toBe(7);
    expect(resolveGotoPage('', 15)).toBeNull();
    expect(resolveGotoPage('16', 15)).toBeNull();
    expect(resolveGotoPage('x', 15)).toBeNull();
  });
});

describe('previewGoToKind', () => {
  it('a PDF goes to a page, a flowing document to a heading, a single picture nowhere', () => {
    expect(previewGoToKind(SHIPPED_PREVIEW_PROVIDERS.get('pdf'))).toBe('page');
    expect(previewGoToKind(SHIPPED_PREVIEW_PROVIDERS.get('markdown'))).toBe('heading');
    expect(previewGoToKind(SHIPPED_PREVIEW_PROVIDERS.get('mermaid'))).toBeNull();
    expect(previewGoToKind(SHIPPED_PREVIEW_PROVIDERS.get('image'))).toBeNull();
    expect(previewGoToKind(undefined)).toBeNull();
  });
});
