/**
 * 047 T052 (partial, unit layer) — the Go to Heading pop-down's pure logic: flattening, the search
 * filter's ancestor-inclusion and fold-override, and finding the current entry from measured positions.
 */
import { describe, expect, it } from 'vitest';
import type { DocumentSymbol } from '@throng/core';
import {
  currentHeadingSlug,
  flattenHeadings,
  matchesQuery,
  visibleRows,
} from '../../src/renderer/preview/heading-outline-model.js';

const sym = (name: string, slug: string, children: DocumentSymbol[] = []): DocumentSymbol => ({
  name,
  level: 1,
  line: 0,
  slug,
  children,
});

// Install → Windows, macOS; Usage → Basic; Reference
const TREE: DocumentSymbol[] = [
  sym('Install', 'install', [sym('Windows', 'windows'), sym('macOS', 'macos')]),
  sym('Usage', 'usage', [sym('Basic', 'basic')]),
  sym('Reference', 'reference'),
];

describe('flattenHeadings', () => {
  it('walks depth-first in document order, with depth and parent slug', () => {
    const flat = flattenHeadings(TREE);
    expect(flat.map((f) => [f.symbol.slug, f.depth, f.parentSlug])).toEqual([
      ['install', 0, null],
      ['windows', 1, 'install'],
      ['macos', 1, 'install'],
      ['usage', 0, null],
      ['basic', 1, 'usage'],
      ['reference', 0, null],
    ]);
  });

  it('an empty tree flattens to nothing', () => {
    expect(flattenHeadings([])).toEqual([]);
  });
});

describe('matchesQuery', () => {
  it('is case-insensitive substring matching', () => {
    expect(matchesQuery('Install', 'ins')).toBe(true);
    expect(matchesQuery('Install', 'INS')).toBe(true);
    expect(matchesQuery('Install', 'xyz')).toBe(false);
  });

  it('an empty query matches everything', () => {
    expect(matchesQuery('anything', '')).toBe(true);
  });
});

describe('visibleRows — no query', () => {
  it('shows every heading when nothing is collapsed', () => {
    const rows = visibleRows(flattenHeadings(TREE), '', new Set());
    expect(rows.map((r) => r.heading.symbol.slug)).toEqual(['install', 'windows', 'macos', 'usage', 'basic', 'reference']);
    expect(rows.every((r) => r.matched)).toBe(true);
  });

  it('a collapsed tree node hides its descendants, never its siblings', () => {
    const rows = visibleRows(flattenHeadings(TREE), '', new Set(['install']));
    expect(rows.map((r) => r.heading.symbol.slug)).toEqual(['install', 'usage', 'basic', 'reference']);
  });
});

describe('visibleRows — a query (FR-043)', () => {
  it('matches show with their ancestors, everything else is hidden', () => {
    const rows = visibleRows(flattenHeadings(TREE), 'win', new Set());
    expect(rows.map((r) => r.heading.symbol.slug)).toEqual(['install', 'windows']);
    expect(rows.find((r) => r.heading.symbol.slug === 'install')?.matched).toBe(false); // ancestor only
    expect(rows.find((r) => r.heading.symbol.slug === 'windows')?.matched).toBe(true);
  });

  it('a match under a COLLAPSED ancestor is still shown — the filter overrides the fold', () => {
    const rows = visibleRows(flattenHeadings(TREE), 'win', new Set(['install']));
    expect(rows.map((r) => r.heading.symbol.slug)).toEqual(['install', 'windows']);
  });

  it('no match at all shows nothing', () => {
    expect(visibleRows(flattenHeadings(TREE), 'zzz', new Set())).toEqual([]);
  });

  it('a top-level match with no children shows just itself', () => {
    const rows = visibleRows(flattenHeadings(TREE), 'refer', new Set());
    expect(rows.map((r) => r.heading.symbol.slug)).toEqual(['reference']);
  });
});

describe('currentHeadingSlug (R7)', () => {
  it('the LAST heading at or above the viewport top', () => {
    const positions = [
      { slug: 'install', top: 0 },
      { slug: 'windows', top: 100 },
      { slug: 'macos', top: 200 },
      { slug: 'usage', top: 300 },
    ];
    expect(currentHeadingSlug(positions, 150)).toBe('windows');
    expect(currentHeadingSlug(positions, 200)).toBe('macos');
    expect(currentHeadingSlug(positions, 0)).toBe('install');
  });

  it('null above every heading (a preamble the reader has not scrolled past)', () => {
    const positions = [{ slug: 'install', top: 100 }];
    expect(currentHeadingSlug(positions, 50)).toBeNull();
  });

  it('null with no headings at all', () => {
    expect(currentHeadingSlug([], 0)).toBeNull();
  });
});
