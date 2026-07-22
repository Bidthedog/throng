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

  // US2 (#140): a folder toggles its expansion on DOUBLE-click, and only selects on single —
  // single-click select-only is #121, double-click toggle is #140. Never opens.
  it('a folder toggles on double-click and selects on single (any open-on-click mode)', () => {
    expect(decideClick('single', 'folder', 1)).toBe('select');
    expect(decideClick('single', 'folder', 2)).toBe('toggle');
    expect(decideClick('double', 'folder', 1)).toBe('select');
    expect(decideClick('double', 'folder', 2)).toBe('toggle');
  });
});
