import { describe, it, expect } from 'vitest';
import { decideClick } from '@throng/core';

describe('explorer open-on-click decision (004 T055/T057)', () => {
  it('single mode: a single click on a file opens', () => {
    expect(decideClick('single', 'file', 1)).toBe('open');
  });

  it('double mode: single click selects, double click opens', () => {
    expect(decideClick('double', 'file', 1)).toBe('select');
    expect(decideClick('double', 'file', 2)).toBe('open');
  });

  it('a folder always toggles, never opens', () => {
    expect(decideClick('single', 'folder', 1)).toBe('toggle');
    expect(decideClick('double', 'folder', 2)).toBe('toggle');
  });
});
